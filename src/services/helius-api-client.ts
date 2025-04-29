import axios, { AxiosInstance, AxiosError } from 'axios';
import { createLogger } from '../utils/logger';
import { HeliusApiConfig, HeliusTransaction } from '../types/helius-api';
import { getCachedTransaction, saveCachedTransactions } from './database-service'; // Update import - remove batchGetCachedTransactions

// Interface for the signature information returned by the Solana RPC
interface SignatureInfo {
    signature: string;
    slot: number;
    err: any; 
    memo: string | null;
    blockTime?: number | null;
}

// Logger instance for this module
const logger = createLogger('HeliusApiClient');

// --- Retry Logic Helper ---
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000; // Start with 1 second

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
// --- End Retry Logic Helper ---

export class HeliusApiClient {
  private readonly api: AxiosInstance;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly BATCH_SIZE = 100; // Maximum signatures to process in one batch
  private lastRequestTime: number = 0;
  private readonly MIN_REQUEST_INTERVAL = 550; // Minimum 550ms between requests (for ~2 req/s free tier)
  private readonly SOLANA_RPC_URL_MAINNET = 'https://mainnet.helius-rpc.com/'; // Using Helius RPC for consistency
  private readonly RPC_SIGNATURE_LIMIT = 1000; // Max limit for getSignaturesForAddress

  constructor(config: HeliusApiConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || (config.network === 'mainnet' 
      ? 'https://api.helius.xyz'
      : 'https://api-devnet.helius.xyz');

    this.api = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL) {
      await delay(this.MIN_REQUEST_INTERVAL - timeSinceLastRequest);
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Fetches a page of transaction signatures using the Solana JSON-RPC `getSignaturesForAddress`.
   */
  private async getSignaturesViaRpcPage(
    address: string, 
    limit: number, 
    before?: string | null
  ): Promise<SignatureInfo[]> {
    // Using Helius RPC endpoint but calling standard Solana method
    const url = `${this.SOLANA_RPC_URL_MAINNET}?api-key=${this.apiKey}`;
    const payload = {
        jsonrpc: '2.0',
        id: `fetch-rpc-signatures-${address}-${before || 'first'}`,
        method: 'getSignaturesForAddress',
        params: [
            address,
            {
                limit: limit,
                before: before || undefined // Only include 'before' if it has a value
            }
        ]
    };

    logger.debug(`Fetching RPC signatures page: limit=${limit}, before=${before || 'N/A'}`);
    try {
        await this.rateLimit(); // Apply rate limit before RPC call too
        const response = await this.api.post<{ result: SignatureInfo[] }>(url, payload); // Use the internal axios instance

        if (response.data && Array.isArray(response.data.result)) {
            logger.debug(`Received ${response.data.result.length} signatures via RPC.`);
            return response.data.result;
        } else {
            logger.warn('Received unexpected response structure from getSignaturesForAddress RPC.', { responseData: response.data });
            return [];
        }
    } catch (error) {
        logger.error(`Error fetching RPC signatures page`, { 
            error: this.sanitizeError(error) 
        });
        throw error; // Re-throw to stop the process
    }
  }

  /**
   * Get full transaction details from a batch of signatures with retries.
   */
  private async getTransactionsBySignatures(signatures: string[]): Promise<HeliusTransaction[]> {
    if (!signatures || signatures.length === 0) {
      return [];
    }

    let retries = 0;
    while(retries <= MAX_RETRIES) {
        try {
            await this.rateLimit(); // Apply rate limit before each attempt
            const attempt = retries + 1;
            logger.debug(`Attempt ${attempt}: Fetching full transactions for ${signatures.length} signatures.`);
            
            const endpoint = `/v0/transactions?api-key=${this.apiKey}`;
            const response = await this.api.post(endpoint, {
                transactions: signatures
            });

            logger.debug(`Attempt ${attempt}: Retrieved ${response.data.length} full transactions.`);
             // Simple validation: Check if we got data for *most* requested signatures
            if (response.data.length < signatures.length * 0.8 && signatures.length > 10) { // Heuristic threshold
                logger.warn(`Attempt ${attempt}: Received significantly fewer transactions (${response.data.length}) than signatures requested (${signatures.length}). Some might be missing.`);
            }
            return response.data; // Success

        } catch (error) {
            const isAxiosError = axios.isAxiosError(error);
            const status = isAxiosError ? (error as AxiosError).response?.status : undefined;
            const attempt = retries + 1;
            const signatureCount = signatures.length;

            // Log initial failure as info, subsequent retry attempts as warn?
            // Let's log the initial failure that triggers retry as info, keep final failure as error.
            const logLevel = retries === 0 ? 'info' : 'warn'; 
            logger[logLevel](`Attempt ${attempt} failed: Error fetching transactions by signatures`, { 
                error: this.sanitizeError(error), signatureCount, status 
            });

            if (attempt > MAX_RETRIES) {
                logger.error('Max retries reached fetching transactions by signatures. Aborting this batch.', { signatureCount });
                throw new Error(`Failed to fetch batch of ${signatureCount} transactions after ${MAX_RETRIES + 1} attempts: ${error}`);
            }

            // Decide whether to retry based on status code
            if (isAxiosError && status) {
                if (status === 429 || status >= 500) { // Retry on rate limit or server error
                    const backoffTime = INITIAL_BACKOFF_MS * Math.pow(2, retries);
                    logger.info(`Attempt ${attempt}: Rate limit or server error (${status}). Retrying batch in ${backoffTime}ms...`);
                    await delay(backoffTime);
                    retries++;
                } else { // Don't retry for client errors (4xx except 429)
                    logger.error(`Attempt ${attempt}: Unrecoverable client error (${status}). Aborting batch fetch.`, { signatureCount });
                    throw error; // Re-throw original error
                }
            } else { // Handle non-HTTP errors (e.g., network issues)
                const backoffTime = INITIAL_BACKOFF_MS * Math.pow(2, retries);
                logger.info(`Attempt ${attempt}: Network or unknown error. Retrying batch in ${backoffTime}ms...`);
                await delay(backoffTime);
                retries++;
            }
        } // end catch
    } // end while
    // Should not be reachable
    throw new Error(`Failed to fetch batch of ${signatures.length} transactions unexpectedly.`); 
  }

  /**
   * Get all transactions for an address using the recommended two-step process:
   * 1. Fetch all signatures via Solana RPC `getSignaturesForAddress`.
   * 2. Check DB cache for existing transaction details.
   * 3. Fetch details for uncached signatures from Helius `/v0/transactions` endpoint.
   * 4. Save newly fetched transactions to DB cache.
   */
  async getAllTransactionsForAddress(
    address: string,
    parseBatchLimit: number = this.BATCH_SIZE,
    maxSignatures: number | null = null,
    stopAtSignature?: string, // Optional signature to stop fetching pages at
    newestProcessedTimestamp?: number, // Optional timestamp to filter results (exclusive)
    includeCached: boolean = true, // Flag to control whether to include cached transactions in results
    untilTimestamp?: number
  ): Promise<HeliusTransaction[]> {
    let allRpcSignaturesInfo: SignatureInfo[] = [];
    // List to hold ONLY the transactions fetched from API in this run
    let newlyFetchedTransactions: HeliusTransaction[] = []; 
    // Set to hold signatures whose details need to be fetched from API
    const signaturesToFetchDetails = new Set<string>();
    // Add array to collect cached transactions
    const cachedTransactions: HeliusTransaction[] = [];

    // === PHASE 1: Fetch Signatures via RPC ===
    logger.info(`Starting Phase 1: Fetching signatures via Solana RPC for ${address}`);
    let lastRpcSignature: string | null = null;
    let hasMoreSignatures = true;
    let fetchedSignaturesCount = 0;
    const rpcLimit = this.RPC_SIGNATURE_LIMIT;

    try {
      while (hasMoreSignatures) {
        const signatureInfos = await this.getSignaturesViaRpcPage(address, rpcLimit, lastRpcSignature);
        
        if (signatureInfos.length > 0) {
            allRpcSignaturesInfo.push(...signatureInfos);
            fetchedSignaturesCount += signatureInfos.length;
            lastRpcSignature = signatureInfos[signatureInfos.length - 1].signature;

            // Check if we need to stop based on stopAtSignature
            if (stopAtSignature) {
                const stopIndex = signatureInfos.findIndex(info => info.signature === stopAtSignature);
                if (stopIndex !== -1) {
                    logger.info(`Found stopAtSignature (${stopAtSignature}) in the current batch at index ${stopIndex}. Stopping signature fetch.`);
                    // We have the batch containing the stop signature, no need to fetch older ones.
                    hasMoreSignatures = false;
                    // Note: We keep all signatures from this batch, including the stop one and potentially older ones within the same batch.
                    // Further filtering might be needed later if strict exclusion is required.
                }
            }

            if (maxSignatures !== null && fetchedSignaturesCount >= maxSignatures) {
                logger.info(`Reached maxSignatures limit (${maxSignatures}). Stopping signature fetch.`);
                hasMoreSignatures = false;
            } else if (signatureInfos.length < rpcLimit) {
                logger.info('Last page of RPC signatures reached (received less than limit).');
                hasMoreSignatures = false;
            }
        } else {
            logger.info('Last page of RPC signatures reached (received 0 items).');
            hasMoreSignatures = false;
        }
      }
      logger.info(`Finished Phase 1. Total signatures retrieved via RPC: ${allRpcSignaturesInfo.length}`);

    } catch (rpcError) {
       logger.error('Failed during RPC signature fetching phase (Phase 1): Returning empty list.', { 
           error: this.sanitizeError(rpcError), 
           address, 
           signaturesFetchedBeforeError: allRpcSignaturesInfo.length 
       });
       return []; // Return empty if signature fetching fails critically
    }

    const uniqueSignatures = Array.from(new Set(allRpcSignaturesInfo.map(s => s.signature)));
    logger.debug(`Total unique signatures from RPC: ${uniqueSignatures.length}`);

    // === Check Cache to Identify Signatures to Fetch ===
    logger.debug(`Checking database cache existence for ${uniqueSignatures.length} signatures...`);
    
    // Use the updated getCachedTransaction that supports batch operations
    const cachedTxMap = await getCachedTransaction(uniqueSignatures) as Map<string, HeliusTransaction>;
    const cacheHits = cachedTxMap.size;
    
    // Separate cached transactions and signatures that need to be fetched
    for (const sig of uniqueSignatures) {
      const cachedTx = cachedTxMap.get(sig);
      if (cachedTx) {
        if (includeCached) {
          cachedTransactions.push(cachedTx); // Only keep if includeCached is true
        }
      } else {
        signaturesToFetchDetails.add(sig);
      }
    }
    
    logger.info(`Found ${cacheHits} signatures in cache. Need to fetch details for ${signaturesToFetchDetails.size} signatures.`);
    logger.debug(`Cache inclusion is ${includeCached ? 'enabled' : 'disabled'}, keeping ${cachedTransactions.length} cached transactions.`);

    const signaturesToFetchArray = Array.from(signaturesToFetchDetails);

    // === PHASE 2: Fetch Uncached Details SEQUENTIALLY & Save to Cache ===
    if (signaturesToFetchArray.length > 0) {
        logger.info(`Starting Phase 2: Fetching parsed details from Helius sequentially for ${signaturesToFetchArray.length} new signatures.`);
        
        const totalBatches = Math.ceil(signaturesToFetchArray.length / parseBatchLimit);
        // Reset newlyFetchedTransactions here as it only holds results from THIS phase
        newlyFetchedTransactions = []; 
        let lastLoggedBatch = 0; 

        for (let i = 0; i < signaturesToFetchArray.length; i += parseBatchLimit) {
          const batchSignatures = signaturesToFetchArray.slice(i, i + parseBatchLimit);
          const batchNumber = Math.floor(i / parseBatchLimit) + 1;
          
          try {
            // Await the result of fetching this batch directly
            const batchTransactions = await this.getTransactionsBySignatures(batchSignatures);
            
            // Add successful results to the list of newly fetched
            newlyFetchedTransactions.push(...batchTransactions);

            if (batchNumber % 10 === 0 || batchNumber === totalBatches) {
                process.stdout.write(`  Fetching details: Batch ${batchNumber}/${totalBatches} (${newlyFetchedTransactions.length} successful txns fetched so far)...\r`);
                lastLoggedBatch = batchNumber;
            }

          } catch (error) {
              if (lastLoggedBatch > 0) process.stdout.write('\n'); 
              logger.error(`Batch ${batchNumber}/${totalBatches}: Failed to fetch transactions after retries. Skipping this batch.`, { 
                  error: this.sanitizeError(error), 
                  failedSignatures: batchSignatures 
              });
              lastLoggedBatch = 0; 
          }
        } // End loop through batches
        
        if (lastLoggedBatch > 0) process.stdout.write('\n'); 
        logger.debug('Sequential batch requests finished.');
        logger.info(`Successfully fetched details for ${newlyFetchedTransactions.length} new transactions sequentially.`);

        // --- Save newly fetched transactions to DB Cache --- 
        if (newlyFetchedTransactions.length > 0) {
            logger.debug(`Saving ${newlyFetchedTransactions.length} newly fetched transactions to database cache...`);
            await saveCachedTransactions(newlyFetchedTransactions); // Use DB service
            logger.debug('Finished saving new transactions to cache.');
            // Do NOT combine with cached data here. newlyFetchedTransactions holds the results.
        } else {
             logger.info('No new transactions were successfully fetched in Phase 2.');
        }
    } // End if signaturesToFetchArray.length > 0
    
    // Merge cached and newly fetched transactions based on includeCached flag
    if (includeCached) {
      logger.info(`Loaded ${cachedTransactions.length} cached transactions.`);
    } else {
      logger.info(`Skipping ${cachedTxMap.size} cached transactions (cache inclusion disabled).`);
    }
    
    const allTransactions = includeCached 
      ? [...cachedTransactions, ...newlyFetchedTransactions]
      : [...newlyFetchedTransactions];
    
    // === Filtering & Sorting of All Transactions ===

    // --- Timestamp Filtering (Incremental Logic & Until Logic) ---
    let filteredTransactions = allTransactions;
    if (newestProcessedTimestamp !== undefined) {
        const countBefore = filteredTransactions.length;
        filteredTransactions = filteredTransactions.filter(tx => tx.timestamp > newestProcessedTimestamp);
        const countAfter = filteredTransactions.length;
        logger.info(`Filtered by newestProcessedTimestamp (${newestProcessedTimestamp}): ${countBefore} -> ${countAfter} transactions.`);
    } else {
        logger.debug('No newestProcessedTimestamp provided, skipping timestamp filter.');
    }
    
    // --- Until Timestamp Filtering ---
    if (untilTimestamp !== undefined) {
        const countBefore = filteredTransactions.length;
        filteredTransactions = filteredTransactions.filter(tx => tx.timestamp < untilTimestamp);
        const countAfter = filteredTransactions.length;
        logger.info(`Filtered by untilTimestamp (${untilTimestamp}): ${countBefore} -> ${countAfter} transactions.`);
    } else {
        logger.debug('No untilTimestamp provided, skipping until filter.');
    }
    
    // --- Address Relevance Filtering ---
    logger.debug(`Total transactions before address relevance filter: ${filteredTransactions.length}`);
    // Filter *before* sorting 
    const lowerCaseAddress = address.toLowerCase();
    const relevantFiltered = filteredTransactions.filter(tx => {
        const hasTokenTransfer = tx.tokenTransfers?.some(t => 
            t.fromUserAccount?.toLowerCase() === lowerCaseAddress || 
            t.toUserAccount?.toLowerCase() === lowerCaseAddress ||
            (t as any).userAccount?.toLowerCase() === lowerCaseAddress
        );
        
        const hasNativeTransfer = tx.nativeTransfers?.some(t => 
            t.fromUserAccount?.toLowerCase() === lowerCaseAddress || 
            t.toUserAccount?.toLowerCase() === lowerCaseAddress ||
            (t as any).userAccount?.toLowerCase() === lowerCaseAddress
        );
        
        const hasAccountDataChange = tx.accountData?.some(ad => 
             ad.account?.toLowerCase() === lowerCaseAddress && 
             (ad.nativeBalanceChange !== 0 || ad.tokenBalanceChanges?.length > 0)
        );
        
        // Check if any swap event involves the wallet address
        const hasSwapEvent = !!tx.events?.swap && (
            tx.events.swap.tokenInputs?.some(i =>
                [(i as any).userAccount, (i as any).fromUserAccount, (i as any).toUserAccount]
                    .some(u => u?.toLowerCase() === lowerCaseAddress)
            ) ||
            tx.events.swap.tokenOutputs?.some(o =>
                [(o as any).userAccount, (o as any).fromUserAccount, (o as any).toUserAccount]
                    .some(u => u?.toLowerCase() === lowerCaseAddress)
            )
        );
        
        // Quick check for feePayer
        if (tx.feePayer?.toLowerCase() === lowerCaseAddress) {
            return true;
        }
        
        return hasTokenTransfer || hasNativeTransfer || hasAccountDataChange || hasSwapEvent;
    });
    logger.info(`Filtered combined transactions down to ${relevantFiltered.length} involving the target address.`);

    // Sort the relevant transactions by timestamp (ascending - oldest first)
    relevantFiltered.sort((a, b) => a.timestamp - b.timestamp);
    logger.debug(`Sorted ${relevantFiltered.length} relevant transactions by timestamp.`);

    logger.info(`Helius API client process finished. Returning ${relevantFiltered.length} relevant transactions.`);
    return relevantFiltered; // Return the filtered & sorted list of ALL filtered transactions
  }

  private sanitizeError(error: any): any {
    if (!error) return error;
    
    if (axios.isAxiosError(error)) {
      // Create a simplified structure for logging Axios errors
      const sanitized: Record<string, any> = {
        message: error.message,
        code: error.code,
        name: error.name,
        isAxiosError: true,
      };
      
      if (error.config?.url) {
        sanitized.url = error.config.url.replace(/api-key=([^&]*)/, 'api-key=REDACTED');
      }
      if (error.response) {
        sanitized.response = {
            status: error.response.status,
            statusText: error.response.statusText,
            // Omit headers and data for brevity/security
        };
      }
      // Omit config, request details
      return sanitized;
    }
    
    // Handle non-axios errors
    if (error instanceof Error) {
        return { name: error.name, message: error.message, stack: '[Stack trace cleared]' };
    }
    
    // Fallback for unknown error types
    return String(error); 
  }
} 