import axios, { AxiosInstance, AxiosError } from 'axios';
import { createLogger } from 'core/utils/logger';
import {
  HeliusApiConfig,
  HeliusTransaction,
  GetMultipleAccountsResult,
  GetTokenAccountsByOwnerResult,
  // RpcAccountInfo, // Not directly used as a parameter/return type of public methods here yet
} from '@/types/helius-api';
import { DatabaseService } from 'core/services/database-service';
import { Injectable } from '@nestjs/common';

/** Interface for the signature information returned by the Solana RPC `getSignaturesForAddress`. */
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

/** Simple promise-based delay function. */
async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
// --- End Retry Logic Helper ---

// --- Default Rate Limit --- (Now configurable)
const DEFAULT_RPS = 10; // Default target Requests Per Second (Developer Plan)
const RATE_LIMIT_SAFETY_BUFFER_MS = 15; // Add small buffer

// Define RPC URLs at the module level
const MODULE_SOLANA_RPC_URL_MAINNET = 'https://mainnet.helius-rpc.com/';
const MODULE_SOLANA_RPC_URL_DEVNET = 'https://devnet.helius-rpc.com/';

@Injectable()
/**
 * Client for interacting with the Helius API and Solana RPC for transaction data.
 * Includes rate limiting, retry logic, and caching integration.
 */
export class HeliusApiClient {
  private readonly api: AxiosInstance;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly BATCH_SIZE = 100; // Maximum signatures to process in one batch
  private lastRequestTime: number = 0;
  private readonly minRequestIntervalMs: number; // Calculated based on RPS
  private readonly rpcUrl: string; // Store the full RPC URL with API key
  private readonly RPC_SIGNATURE_LIMIT = 1000; // Max limit for getSignaturesForAddress
  private dbService: DatabaseService; // Add DatabaseService member

  /**
   * Handles configuration and sets up the Axios instance.
   * @param config Configuration object containing the Helius API key and optionally the base URL, network, and target RPS.
   * @param dbService An instance of DatabaseService for caching.
   */
  constructor(config: HeliusApiConfig, dbService: DatabaseService) {
    this.apiKey = config.apiKey;
    // Allow network to be specified for RPC URL construction
    const rpcNetworkUrl = config.network === 'devnet' ? MODULE_SOLANA_RPC_URL_DEVNET : MODULE_SOLANA_RPC_URL_MAINNET;
    this.baseUrl = config.baseUrl || (config.network === 'mainnet' 
      ? 'https://api.helius.xyz'
      : 'https://api-devnet.helius.xyz');
    this.rpcUrl = `${rpcNetworkUrl}?api-key=${this.apiKey}`; // Store the full RPC URL with API key
    
    const targetRps = config.requestsPerSecond || DEFAULT_RPS;
    // Calculate interval: (1000 ms / RPS) + safety buffer
    this.minRequestIntervalMs = Math.ceil(1000 / targetRps) + RATE_LIMIT_SAFETY_BUFFER_MS;
    logger.info(`Initializing HeliusApiClient: Target RPS=${targetRps}, Min Request Interval=${this.minRequestIntervalMs}ms`);

    this.api = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000, // Increased timeout for potentially larger requests
      headers: {
        'Content-Type': 'application/json'
      }
    });

    this.dbService = dbService; // Assign passed DatabaseService instance
  }

  /** Ensures a minimum interval between requests to respect rate limits. */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestIntervalMs) {
      const waitTime = this.minRequestIntervalMs - timeSinceLastRequest;
      logger.debug(`Rate limiting: Waiting ${waitTime}ms...`);
      await delay(waitTime);
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Fetches a single page of transaction signatures using the Solana JSON-RPC `getSignaturesForAddress` method
   * via the Helius RPC endpoint. Includes retry logic.
   *
   * @param address The wallet address to fetch signatures for.
   * @param limit The maximum number of signatures to fetch in this page (RPC limit applies).
   * @param before An optional signature to fetch signatures older than this one.
   * @returns A promise resolving to an array of SignatureInfo objects.
   * @throws Throws an error if the RPC call fails after all retries.
   */
  private async getSignaturesViaRpcPage(
    address: string,
    limit: number,
    before?: string | null
  ): Promise<SignatureInfo[]> {
    const url = `${this.rpcUrl}`;
    const payload = {
        jsonrpc: '2.0',
        id: `fetch-rpc-signatures-${address}-${before || 'first'}`,
        method: 'getSignaturesForAddress',
        params: [
            address,
            {
                limit: limit,
                before: before || undefined 
            }
        ]
    };

    let retries = 0;
    while(retries <= MAX_RETRIES) {
        const attempt = retries + 1;
        logger.debug(`Attempt ${attempt}: Fetching RPC signatures page: limit=${limit}, before=${before || 'N/A'}`);
        try {
            await this.rateLimit(); // Apply rate limit before RPC call too
            const response = await this.api.post<{ result: SignatureInfo[], error?: any }>(url, payload); // Use the internal axios instance

            // Check for RPC-level errors within the response body
            if (response.data.error) {
                logger.warn(`Attempt ${attempt}: RPC call returned an error`, { rpcError: response.data.error, address, limit, before });
                // Treat RPC errors like server errors for retry purposes
                throw new Error(`RPC Error: ${response.data.error.message || JSON.stringify(response.data.error)}`);
            }

            if (response.data && Array.isArray(response.data.result)) {
                logger.debug(`Attempt ${attempt}: Received ${response.data.result.length} signatures via RPC.`);
                return response.data.result; // Success
            } else {
                logger.warn(`Attempt ${attempt}: Received unexpected response structure from getSignaturesForAddress RPC.`, { responseData: response.data });
                // Consider retrying or throwing based on policy
                throw new Error('Unexpected RPC response structure'); 
            }
        } catch (error) {
            const isAxiosError = axios.isAxiosError(error);
            const status = isAxiosError ? (error as AxiosError).response?.status : undefined;

            // Log the failure
            const logLevel = retries === 0 ? 'info' : 'warn'; 
            logger[logLevel](`Attempt ${attempt} failed: Error fetching RPC signatures page`, { 
                error: this.sanitizeError(error), address, limit, before, status 
            });

            if (attempt > MAX_RETRIES) {
                logger.error('Max retries reached fetching RPC signatures page. Aborting.', { address, limit, before });
                throw new Error(`Failed to fetch RPC signatures for ${address} after ${MAX_RETRIES + 1} attempts: ${error}`);
            }

            // Decide whether to retry
            // Retry on rate limits (429), server errors (5xx), potential RPC errors wrapped in non-Axios errors, or network errors
            let shouldRetry = false;
            if (isAxiosError && status && (status === 429 || status >= 500)) {
                 shouldRetry = true;
            } else if (!isAxiosError) { 
                 // Assume non-Axios errors (like RPC errors thrown above or network issues) are potentially transient
                 shouldRetry = true;
            } // Don't retry on other 4xx client errors

            if (shouldRetry) {
                 const backoffTime = INITIAL_BACKOFF_MS * Math.pow(2, retries);
                 logger.info(`Attempt ${attempt}: Encountered retryable error (status=${status ?? 'N/A'}). Retrying RPC signatures fetch in ${backoffTime}ms...`);
                 await delay(backoffTime);
                 retries++;
            } else {
                 logger.error(`Attempt ${attempt}: Unrecoverable error during RPC signatures fetch (status=${status}). Aborting.`, { address, limit, before });
                 throw error; // Re-throw original error
            }
        } // end catch
    } // end while
    // Should not be reachable
    throw new Error(`Failed to fetch RPC signatures for ${address} unexpectedly.`); 
  }

  /**
   * Fetches full, parsed transaction details from Helius for a batch of signatures.
   * Implements retry logic with exponential backoff for rate limits (429) and server errors (5xx).
   *
   * @param signatures An array of transaction signatures.
   * @returns A promise resolving to an array of HeliusTransaction objects.
   * @throws Throws an error if the batch fetch fails after all retries or encounters an unrecoverable client error.
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
            if (response.data.length < signatures.length * 0.8 && signatures.length > 5) { // Adjusted threshold slightly
                logger.warn(
                    `Attempt ${attempt}: Received significantly fewer transactions (${response.data.length}) ` +
                    `than signatures requested (${signatures.length}). Some might be missing. ` +
                    `Helius response data (first 5 if many):`, 
                    JSON.stringify(response.data.slice(0, 5), null, 2) // Log a sample of the raw response
                );
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
   * Retrieves all relevant transactions for a given wallet address, combining RPC signature fetching,
   * database caching, and Helius parsed transaction fetching.
   *
   * Workflow:
   * 1. Fetches all transaction signatures using Solana RPC (`getSignaturesForAddress`) paginated.
   * 2. Checks the database cache (`HeliusTransactionCache`) for transactions corresponding to these signatures.
   * 3. Identifies signatures for which details are missing from the cache.
   * 4. Fetches the full, parsed transaction details for these missing signatures from the Helius API (`/v0/transactions`) in batches.
   * 5. Saves the newly fetched transactions to the database cache.
   * 6. Merges cached and newly fetched transactions (controlled by `includeCached`).
   * 7. Filters the combined list based on optional timestamps (`newestProcessedTimestamp`, `untilTimestamp`).
   * 8. Filters the list to include only transactions relevant to the target `address` (sender, receiver, account data changes, swaps).
   * 9. Sorts the final relevant transactions by timestamp ascending (oldest first).
   *
   * @param address The wallet address to fetch transactions for.
   * @param parseBatchLimit The number of signatures to include in each batch request to the Helius `/v0/transactions` endpoint (default: 100).
   * @param maxSignatures Optional maximum total number of signatures to process (fetched via RPC). Fetching stops once this limit is reached.
   * @param stopAtSignature Optional signature. If encountered during RPC fetch, stops fetching older pages.
   * @param newestProcessedTimestamp Optional Unix timestamp (seconds). If provided, filters the results to include only transactions *strictly newer* than this timestamp.
   * @param includeCached If true (default), combines cached transactions with newly fetched ones in the final result. If false, only returns newly fetched transactions.
   * @param untilTimestamp Optional Unix timestamp (seconds). If provided, filters the results to include only transactions *strictly older* than this timestamp.
   * @param phase2InternalConcurrency New parameter for internal concurrency
   * @returns A promise resolving to an array of HeliusTransaction objects, filtered and sorted chronologically.
   */
  async getAllTransactionsForAddress(
    address: string,
    parseBatchLimit: number = this.BATCH_SIZE,
    maxSignatures: number | null = null,
    stopAtSignature?: string, // Optional signature to stop fetching pages at
    newestProcessedTimestamp?: number, // Optional timestamp to filter results (exclusive)
    includeCached: boolean = true, // Flag to control whether to include cached transactions in results
    untilTimestamp?: number,
    phase2InternalConcurrency: number = 3 // New parameter for internal concurrency
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
                    hasMoreSignatures = false;
                }
            }

            // IMPORTANT: This condition stops PAGINATION, not processing of already fetched signatures.
            // We will apply a hard limit AFTER this loop if maxSignatures is set.
            if (maxSignatures !== null && fetchedSignaturesCount >= maxSignatures && !stopAtSignature) {
                logger.info(`RPC fetcher has retrieved ${fetchedSignaturesCount} signatures, which meets or exceeds an intended conceptual target related to maxSignatures (${maxSignatures}). Stopping further RPC pagination.`);
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

    // --- Apply hard maxSignatures limit to the RPC results before detail fetching ---
    if (maxSignatures !== null && allRpcSignaturesInfo.length > maxSignatures) {
        logger.info(`RPC fetch resulted in ${allRpcSignaturesInfo.length} signatures. Applying hard limit of ${maxSignatures}.`);
        // Sort by blockTime descending (newest first) to keep the most recent ones
        // Handle null/undefined blockTimes by treating them as older than any defined blockTime
        allRpcSignaturesInfo.sort((a, b) => {
            const timeA = a.blockTime ?? 0; // Treat null/undefined as very old
            const timeB = b.blockTime ?? 0;
            return timeB - timeA; // Descending order
        });
        allRpcSignaturesInfo = allRpcSignaturesInfo.slice(0, maxSignatures);
        logger.info(`Sliced RPC signatures to newest ${allRpcSignaturesInfo.length} based on maxSignatures limit.`);
    }

    const uniqueSignatures = Array.from(new Set(allRpcSignaturesInfo.map(s => s.signature)));
    logger.debug(`Total unique signatures from RPC after potential maxSignatures slicing: ${uniqueSignatures.length}`);

    // === Check Cache to Identify Signatures to Fetch ===
    logger.debug(`Checking database cache existence for ${uniqueSignatures.length} signatures...`);
    
    // Use the dbService instance method
    const cachedTxMap = await this.dbService.getCachedTransaction(uniqueSignatures) as Map<string, HeliusTransaction>;
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
        logger.info(`Starting Phase 2: Fetching parsed details from Helius for ${signaturesToFetchArray.length} new signatures with internal concurrency of ${phase2InternalConcurrency}.`);
        
        // Reset newlyFetchedTransactions here as it only holds results from THIS phase
        newlyFetchedTransactions = []; 
        
        const totalSignaturesToFetch = signaturesToFetchArray.length;
        let processedSignaturesCount = 0;
        let lastLoggedPercentage = 0;

        // Process signatures in chunks, each chunk handled by a concurrent set of batch fetches
        for (let i = 0; i < totalSignaturesToFetch; i += parseBatchLimit * phase2InternalConcurrency) {
            const chunkSignatures = signaturesToFetchArray.slice(i, i + parseBatchLimit * phase2InternalConcurrency);
            const promises: Promise<HeliusTransaction[]>[] = [];

            for (let j = 0; j < chunkSignatures.length; j += parseBatchLimit) {
                const batchSignatures = chunkSignatures.slice(j, j + parseBatchLimit);
                if (batchSignatures.length > 0) {
                    // The getTransactionsBySignatures method already includes rate limiting and retries
                    promises.push(
                        this.getTransactionsBySignatures(batchSignatures)
                            .catch(error => {
                                // Log error for this specific batch and return empty array to not break Promise.allSettled
                                logger.error(`A batch fetch within concurrent set failed for ${batchSignatures.length} signatures. Continuing with others.`, {
                                    error: this.sanitizeError(error),
                                    signatures: batchSignatures.slice(0, 5) // Log a few for context
                                });
                                return []; // Resolve with empty for this failed batch
                            })
                    );
                }
            }

            if (promises.length > 0) {
                const results = await Promise.allSettled(promises);
                results.forEach(result => {
                    if (result.status === 'fulfilled' && result.value) {
                        newlyFetchedTransactions.push(...result.value);
                    }
                    // Failed promises are already handled by the catch within the push to `promises`
                });
            }
            
            processedSignaturesCount += chunkSignatures.length; // Update based on the size of the chunk attempted
            const currentPercentage = Math.floor((newlyFetchedTransactions.length / totalSignaturesToFetch) * 100); // Progress based on successfully fetched
            
            if (currentPercentage >= lastLoggedPercentage + 5 || processedSignaturesCount >= totalSignaturesToFetch) {
                 const displayPercentage = Math.min(100, Math.floor((processedSignaturesCount / totalSignaturesToFetch) * 100));
                 process.stdout.write(`  Fetching details: Processed ~${displayPercentage}% of signatures (${newlyFetchedTransactions.length} successful txns fetched so far)...\r`);
                 lastLoggedPercentage = currentPercentage;
            }
        } // End loop through chunks
        
        process.stdout.write('\n'); // Newline after final progress update
        logger.debug('Concurrent batch requests for Phase 2 finished.');
        logger.info(`Successfully fetched details for ${newlyFetchedTransactions.length} out of ${totalSignaturesToFetch} new transactions attempted in Phase 2.`);

        // --- Save newly fetched transactions to DB Cache --- 
        if (newlyFetchedTransactions.length > 0) {
            logger.debug(`Saving ${newlyFetchedTransactions.length} newly fetched transactions to database cache...`);
            // Use the dbService instance method
            await this.dbService.saveCachedTransactions(newlyFetchedTransactions);
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

    logger.debug(`Helius API client process finished. Returning ${relevantFiltered.length} relevant transactions.`);
    return relevantFiltered; // Return the filtered & sorted list of ALL filtered transactions
  }

  /**
   * Sanitizes error objects for logging, removing potentially sensitive information
   * like full API keys from URLs and simplifying Axios error structures.
   *
   * @param error The error object to sanitize.
   * @returns A sanitized error object suitable for logging.
   */
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
        // Include message from thrown RPC errors or network errors
        return { name: error.name, message: error.message, stack: '[Stack trace cleared]' };
    }
    
    // Fallback for unknown error types
    return String(error); 
  }

  private async makeRpcRequest<T>(method: string, params: any[]): Promise<T> {
    await this.rateLimit(); // Apply rate limiting before each RPC call
    const payload = {
      jsonrpc: '2.0',
      id: `helius-rpc-${method}-${Date.now()}`,
      method: method,
      params: params,
    };

    let retries = 0;
    while (retries < MAX_RETRIES) {
      try {
        // Use the stored rpcUrl which already includes the API key
        const response = await this.api.post<{
          jsonrpc: string;
          id: string;
          result: T;
          error?: { code: number; message: string };
        }>(this.rpcUrl, payload, {
          // Override baseURL for RPC calls if it was set for REST API
          // Ensuring this post goes to the RPC endpoint (e.g. mainnet.helius-rpc.com or devnet.helius-rpc.com)
          // This is now handled by using this.rpcUrl directly, which is constructed with the correct RPC base.
        });

        if (response.data.error) {
          logger.error(
            `RPC Error for method ${method}: ${response.data.error.message} (Code: ${response.data.error.code})`,
            { params }
          );
          throw new Error(
            `RPC Error for ${method}: ${response.data.error.message}`
          );
        }
        this.lastRequestTime = Date.now(); // Update last request time on successful call
        return response.data.result;
      } catch (error: any) {
        retries++;
        const sanitizedError = this.sanitizeError(error);
        logger.warn(
          `Attempt ${retries}/${MAX_RETRIES} failed for RPC method ${method}. Error: ${JSON.stringify(sanitizedError)}`,
          { params, error: sanitizedError }
        );
        if (retries >= MAX_RETRIES) {
          logger.error(
            `All ${MAX_RETRIES} retries failed for RPC method ${method}.`,
            { params, lastError: sanitizedError }
          );
          throw new Error(
            `Failed to execute RPC method ${method} after ${MAX_RETRIES} retries: ${sanitizedError.message || 'Unknown RPC Error'}`
          );
        }
        const backoffTime = INITIAL_BACKOFF_MS * Math.pow(2, retries - 1); // Exponential backoff
        logger.info(`Retrying RPC method ${method} in ${backoffTime}ms...`);
        await delay(backoffTime);
      }
    }
    // Should not be reached due to throw in loop, but typescript needs a return path
    throw new Error(`RPC method ${method} failed unexpectedly after retries.`);
  }

  /**
   * Fetches account information for a list of public keys using the `getMultipleAccounts` RPC method.
   *
   * @param pubkeys An array of base-58 encoded public key strings.
   * @param commitment Optional commitment level (e.g., "finalized", "confirmed", "processed").
   * @param encoding Optional encoding for account data (e.g., "base64", "jsonParsed"). Defaults to "base64".
   * @returns A promise resolving to the `GetMultipleAccountsResult` structure, which includes account data and context.
   * @throws Throws an error if the RPC call fails after all retries or if input is invalid.
   */
  public async getMultipleAccounts(
    pubkeys: string[],
    commitment?: string,
    encoding: string = 'base64' // Default to base64 as it's common for SOL balance checks
  ): Promise<GetMultipleAccountsResult> {
    if (!pubkeys || pubkeys.length === 0) {
      // Return a structure consistent with a successful call for no accounts
      // Attempt to get api version or default, ensuring it's a string
      const apiVersionHeader = this.api.defaults.headers?.common?.['X-API-Version'];
      return {
        context: { slot: 0, apiVersion: typeof apiVersionHeader === 'string' ? apiVersionHeader : 'unknown' }, 
        value: [],
      };
    }
    // Max 100 pubkeys per request for getMultipleAccounts
    if (pubkeys.length > 100) {
        // This case should ideally be handled by the calling service (WalletBalanceService)
        // by batching requests to getMultipleAccounts if more than 100 keys are provided.
        // For now, log a warning and proceed, Helius might truncate or error.
        logger.warn(`getMultipleAccounts called with ${pubkeys.length} pubkeys, exceeding the typical limit of 100. The RPC node might truncate or error.`);
    }

    const params: any[] = [pubkeys];
    const options: { commitment?: string; encoding?: string } = {};
    if (commitment) {
      options.commitment = commitment;
    }
    if (encoding) {
      options.encoding = encoding;
    }
    if (Object.keys(options).length > 0) {
      params.push(options);
    }

    logger.debug(`Fetching multiple accounts for ${pubkeys.length} pubkeys with options:`, options);
    try {
      const result = await this.makeRpcRequest<GetMultipleAccountsResult>(
        'getMultipleAccounts',
        params
      );
      logger.info(`Successfully fetched multiple accounts for ${pubkeys.length} pubkeys.`);
      return result;
    } catch (error) {
      logger.error(
        `Failed to fetch multiple accounts for pubkeys: ${pubkeys.join(', ')}`,
        { error: this.sanitizeError(error) }
      );
      // Re-throw to allow the caller to handle it, or transform into a standard error response
      throw error;
    }
  }

  /**
   * Fetches all token accounts owned by a given public key using the `getTokenAccountsByOwner` RPC method.
   *
   * @param ownerPubkey The base-58 encoded public key of the account owner.
   * @param mintPubkey Optional. The base-58 encoded public key of the specific token mint to filter by.
   *                   If not provided, token accounts for all mints owned by `ownerPubkey` are returned.
   * @param programId The base-58 encoded public key of the Token Program ID. Defaults to SPL Token Program.
   *                  Crucially, use `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` for standard SPL tokens.
   * @param commitment Optional commitment level (e.g., "finalized", "confirmed", "processed").
   * @param encoding Optional encoding for account data. **Highly recommended to use `jsonParsed`** for structured token data.
   * @returns A promise resolving to the `GetTokenAccountsByOwnerResult` structure, containing token account details.
   * @throws Throws an error if the RPC call fails, if `ownerPubkey` is not provided, or for other issues.
   */
  public async getTokenAccountsByOwner(
    ownerPubkey: string,
    mintPubkey?: string, // Optional: if you only want accounts for a specific mint
    programId: string = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token Program ID
    commitment?: string,
    encoding: string = 'jsonParsed' // Default and recommended for token accounts
  ): Promise<GetTokenAccountsByOwnerResult> {
    if (!ownerPubkey) {
      throw new Error('ownerPubkey is required for getTokenAccountsByOwner.');
    }

    const programFilter = mintPubkey ? { mint: mintPubkey } : { programId };
    const params: any[] = [ownerPubkey, programFilter];

    const options: { commitment?: string; encoding?: string; dataSlice?: { offset: number; length: number } } = {};
    if (commitment) {
      options.commitment = commitment;
    }
    options.encoding = encoding; // Always include encoding, defaults to jsonParsed
    // dataSlice is typically not needed with jsonParsed for token accounts unless accounts are unusually large

    params.push(options);

    logger.debug(
      `Fetching token accounts for owner ${ownerPubkey} with program/mint filter: `,
      programFilter,
      ` and options: `,
      options
    );

    try {
      const result = await this.makeRpcRequest<GetTokenAccountsByOwnerResult>(
        'getTokenAccountsByOwner',
        params
      );
      logger.info(`Successfully fetched token accounts for owner ${ownerPubkey}. Count: ${result.value.length}`);
      return result;
    } catch (error) {
      logger.error(
        `Failed to fetch token accounts for owner ${ownerPubkey}`,
        { error: this.sanitizeError(error), ownerPubkey, programFilter, options }
      );
      throw error; // Re-throw to allow the caller to handle it
    }
  }
} 