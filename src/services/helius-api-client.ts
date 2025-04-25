import axios, { AxiosInstance, AxiosError } from 'axios';
import { createLogger } from '../utils/logger';
import { HeliusApiConfig, HeliusTransaction } from '../types/helius-api';
import fs from 'fs';
import path from 'path';

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
  private readonly cacheDir: string;
  private transactionCache: Map<string, HeliusTransaction>;
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

    // Initialize cache
    this.cacheDir = path.join(process.cwd(), '.cache', 'helius');
    this.transactionCache = new Map();
    this.initializeCache();
  }

  private initializeCache(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private getCacheFilePath(address: string): string {
    return path.join(this.cacheDir, `${address.toLowerCase()}.json`);
  }

  private loadFromCache(address: string): HeliusTransaction[] {
    const cacheFile = this.getCacheFilePath(address);
    if (fs.existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (Array.isArray(cached)) {
          this.transactionCache.clear();
          cached.forEach(tx => this.transactionCache.set(tx.signature, tx));
          return cached;
        }
      } catch (error) {
        logger.warn('Failed to load cache', { error, address });
      }
    }
    return [];
  }

  private saveToCache(address: string, transactions: HeliusTransaction[]): void {
    const cacheFile = this.getCacheFilePath(address);
    try {
      const uniqueTransactions = Array.from(new Map(
        transactions.map(tx => [tx.signature, tx])
      ).values());
      
      fs.writeFileSync(cacheFile, JSON.stringify(uniqueTransactions, null, 2));
      
      this.transactionCache.clear();
      uniqueTransactions.forEach(tx => this.transactionCache.set(tx.signature, tx));
    } catch (error) {
      logger.warn('Failed to save cache', { error, address });
    }
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

    logger.info(`Fetching RPC signatures page: limit=${limit}, before=${before || 'N/A'}`);
    try {
        await this.rateLimit(); // Apply rate limit before RPC call too
        const response = await this.api.post<{ result: SignatureInfo[] }>(url, payload); // Use the internal axios instance

        if (response.data && Array.isArray(response.data.result)) {
            logger.info(`Received ${response.data.result.length} signatures via RPC.`);
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

            logger.warn(`Attempt ${attempt} failed: Error fetching transactions by signatures`, { 
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
   * 2. Fetch parsed transaction details from Helius `/v0/transactions` endpoint.
   */
  async getAllTransactionsForAddress(
    address: string, 
    parseBatchLimit: number = this.BATCH_SIZE, // Limit for Helius parsing step
    maxSignatures: number | null = null // Optional limit for signature fetching
  ): Promise<HeliusTransaction[]> {
    let allRpcSignatures: SignatureInfo[] = [];
    let newTransactions: HeliusTransaction[] = [];
    const cachedTransactions = this.loadFromCache(address);
    const cachedSignatures = new Set(cachedTransactions.map(tx => tx.signature));
    logger.info(`Loaded ${cachedTransactions.length} transactions from cache.`);

    // === PHASE 1: Fetch Signatures via RPC ===
    logger.info(`Starting Phase 1: Fetching all signatures via Solana RPC for ${address}`);
    let lastRpcSignature: string | null = null;
    let hasMoreSignatures = true;
    let fetchedSignaturesCount = 0;
    const rpcLimit = this.RPC_SIGNATURE_LIMIT;

    try {
      while (hasMoreSignatures) {
        const signatureInfos = await this.getSignaturesViaRpcPage(address, rpcLimit, lastRpcSignature);
        
        if (signatureInfos.length > 0) {
            allRpcSignatures.push(...signatureInfos);
            fetchedSignaturesCount += signatureInfos.length;
            lastRpcSignature = signatureInfos[signatureInfos.length - 1].signature;

            // Stop if we hit the maxSignatures limit, if provided
            if (maxSignatures !== null && fetchedSignaturesCount >= maxSignatures) {
                logger.info(`Reached maxSignatures limit (${maxSignatures}). Stopping signature fetch.`);
                hasMoreSignatures = false;
            } else if (signatureInfos.length < rpcLimit) {
                // Stop if the API returned fewer than requested (last page)
                logger.info('Last page of RPC signatures reached (received less than limit).');
                hasMoreSignatures = false;
            }
        } else {
            // Stop if API returned zero signatures
            logger.info('Last page of RPC signatures reached (received 0 items).');
            hasMoreSignatures = false;
        }
      }
      logger.info(`Finished Phase 1. Total signatures retrieved via RPC: ${allRpcSignatures.length}`);
      const uniqueSignaturesToParse = Array.from(new Set(allRpcSignatures.map(s => s.signature)));
      const signaturesToFetchDetails = uniqueSignaturesToParse.filter(sig => !cachedSignatures.has(sig));

      logger.info(`Total unique signatures from RPC: ${uniqueSignaturesToParse.length}`);
      logger.info(`Signatures needing details from Helius (not in cache): ${signaturesToFetchDetails.length}`);

      // Step 3: Fetch full transaction details for new signatures in batches
      logger.info(`Starting Phase 2: Fetching parsed details from Helius for ${signaturesToFetchDetails.length} new signatures.`);
      for (let i = 0; i < signaturesToFetchDetails.length; i += parseBatchLimit) {
        const batchSignatures = signaturesToFetchDetails.slice(i, i + parseBatchLimit);
        logger.info(`Processing Helius parse batch ${Math.floor(i/parseBatchLimit) + 1}/${Math.ceil(signaturesToFetchDetails.length/parseBatchLimit)} (Size: ${batchSignatures.length})`);
        logger.debug('Requesting full transactions for signatures:', batchSignatures);

        // Fetch transactions - this will now throw on persistent error after retries
        const batchTransactions = await this.getTransactionsBySignatures(batchSignatures);
        
        // Log received signatures for verification
        const receivedSignatures = batchTransactions.map(tx => tx.signature);
        logger.debug(`Received full transactions for ${receivedSignatures.length} signatures:`, receivedSignatures);
        if (receivedSignatures.length !== batchSignatures.length) {
            const missingSigs = batchSignatures.filter(sig => !receivedSignatures.includes(sig));
            logger.warn('Mismatch between requested and received signatures for batch. Missing:', missingSigs);
        }

        // Log signatures BEFORE client-side filtering
        logger.debug(`Signatures before any client-side filtering (batch ${Math.floor(i/parseBatchLimit) + 1}):`, receivedSignatures);

        // Filter for swaps with token transfers
        const relevantTransactions = batchTransactions; // Process all fetched

        if(relevantTransactions.length > 0) {
            newTransactions.push(...relevantTransactions);
            logger.info(`Added ${relevantTransactions.length} transactions from batch to be mapped.`);
        } else {
            logger.info('No transactions returned in this batch?'); // Should be rare if signatures were found
        }
        
        // Delay applied within rateLimit() before next batch request
      }
      
    } catch (rpcError) {
      // Catch errors specifically from the signature/transaction fetching process
      logger.error('Failed during RPC signature fetching phase:', { error: this.sanitizeError(rpcError), address });
      // Optionally re-throw, or return partial data (current + cache)
      // For now, let's return what we have + cache, but log clearly it might be incomplete.
      logger.warn('Returning potentially incomplete results due to fetching error.');
      // Proceed to combine and save what was successfully fetched + cached data
    }

    // Step 4/5: Combine and Save Cache (always attempt this even if fetching failed partway)
    logger.info(`Combining ${newTransactions.length} newly fetched transactions with ${cachedTransactions.length} cached transactions.`);
    const combinedMap = new Map<string, HeliusTransaction>();
    cachedTransactions.forEach(tx => combinedMap.set(tx.signature, tx));
    newTransactions.forEach(tx => combinedMap.set(tx.signature, tx)); // Overwrite cache with new if fetched
    const combinedTransactions = Array.from(combinedMap.values());
    
    if (newTransactions.length > 0) {
      // Save even if the fetch was interrupted, includes newly fetched ones
      this.saveToCache(address, combinedTransactions);
    } else {
      logger.info('No new transactions fetched, cache remains unchanged.');
    }
    
    logger.info(`Process finished. Returning ${combinedTransactions.length} total transactions.`);
    // Final filter: Only return transactions that have *some* token or native transfer involving the target address
    // This helps filter out pure fee payments or system instructions if they slip through API filters
    const lowerCaseAddress = address.toLowerCase();
    const relevantCombined = combinedTransactions.filter(tx => {
        const hasTokenTransfer = tx.tokenTransfers?.some(t => 
            t.fromUserAccount?.toLowerCase() === lowerCaseAddress || 
            t.toUserAccount?.toLowerCase() === lowerCaseAddress
        );
        const hasNativeTransfer = tx.nativeTransfers?.some(t => 
            t.fromUserAccount?.toLowerCase() === lowerCaseAddress || 
            t.toUserAccount?.toLowerCase() === lowerCaseAddress
        );
        return hasTokenTransfer || hasNativeTransfer;
    });

    logger.info(`Filtered down to ${relevantCombined.length} transactions involving the target address.`);
    return relevantCombined;
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