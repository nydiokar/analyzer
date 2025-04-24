import axios, { AxiosInstance, AxiosError } from 'axios';
import { createLogger } from '../utils/logger';
import { HeliusApiConfig, HeliusTransaction } from '../types/helius-api';
import fs from 'fs';
import path from 'path';

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
   * Get SWAP transaction signatures for an address with retries.
   */
  private async getSwapSignaturesForAddress(address: string, limit: number, before?: string): Promise<string[]> {
    let retries = 0;
    while (retries <= MAX_RETRIES) {
      try {
        await this.rateLimit(); // Apply rate limit before each attempt
        logger.debug(`Attempt ${retries + 1}: Fetching SWAP signatures`, { address, limit, before });
        
        let endpoint = `/v0/addresses/${address}/transactions?api-key=${this.apiKey}`;
        endpoint += `&type=SWAP`; 
        endpoint += `&limit=${limit}`;
        if (before) {
          endpoint += `&before=${before}`;
        }

        const response = await this.api.get(endpoint);
        const signatures = response.data.map((tx: { signature: string }) => tx.signature);
        logger.debug(`Attempt ${retries + 1}: Retrieved ${signatures.length} signatures`);
        return signatures; // Success

      } catch (error) {
        const isAxiosError = axios.isAxiosError(error);
        const status = isAxiosError ? (error as AxiosError).response?.status : undefined;
        const attempt = retries + 1;

        logger.warn(`Attempt ${attempt} failed: Error fetching SWAP signatures`, { 
            error: this.sanitizeError(error), address, status 
        });

        if (attempt > MAX_RETRIES) {
           logger.error('Max retries reached fetching signatures. Aborting.', { address });
           throw new Error(`Failed to fetch SWAP signatures for ${address} after ${MAX_RETRIES + 1} attempts: ${error}`);
        }

        // Decide whether to retry based on status code
        if (isAxiosError && status) {
            if (status === 429 || status >= 500) { // Retry on rate limit or server error
                const backoffTime = INITIAL_BACKOFF_MS * Math.pow(2, retries);
                logger.info(`Attempt ${attempt}: Rate limit or server error (${status}). Retrying in ${backoffTime}ms...`);
                await delay(backoffTime);
                retries++;
            } else { // Don't retry for client errors (4xx except 429)
                logger.error(`Attempt ${attempt}: Unrecoverable client error (${status}). Aborting fetch signatures.`, { address });
                throw error; // Re-throw original error
            }
        } else { // Handle non-HTTP errors (e.g., network issues)
             const backoffTime = INITIAL_BACKOFF_MS * Math.pow(2, retries);
             logger.info(`Attempt ${attempt}: Network or unknown error. Retrying in ${backoffTime}ms...`);
             await delay(backoffTime);
             retries++;
        }
      } // end catch
    } // end while
    // Should not be reachable if logic is correct, but satisfies TypeScript
    throw new Error(`Failed to fetch SWAP signatures for ${address} unexpectedly.`); 
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
   * Get all SWAP transactions for an address using the recommended two-step process.
   * Includes robust error handling and retries.
   */
  async getAllTransactionsForAddress(address: string, batchLimit: number = 100): Promise<HeliusTransaction[]> {
    let allNewSignatures: string[] = [];
    let newTransactions: HeliusTransaction[] = [];
    const cachedTransactions = this.loadFromCache(address);
    const cachedSignatures = new Set(cachedTransactions.map(tx => tx.signature));
    logger.info(`Loaded ${cachedTransactions.length} transactions from cache.`);

    try {
      logger.info(`Starting SWAP transaction fetch for address: ${address} using two-step process`);
      
      // Step 2: Get all SWAP signatures not in cache
      let lastSignature: string | undefined = undefined;
      let hasMoreSignatures = true;
      let fetchedSignaturesCount = 0;
      const MAX_SIGNATURES_TO_FETCH = 5000; // Limit total signatures

      while (hasMoreSignatures && fetchedSignaturesCount < MAX_SIGNATURES_TO_FETCH) {
        // Fetch signatures - this will now throw on persistent error after retries
        const signatures = await this.getSwapSignaturesForAddress(address, batchLimit, lastSignature);
        
        if (signatures.length > 0) {
          const newSigs = signatures.filter(sig => !cachedSignatures.has(sig) && !allNewSignatures.includes(sig));
          
          if (newSigs.length > 0) {
             allNewSignatures.push(...newSigs);
             fetchedSignaturesCount += newSigs.length;
             logger.info(`Collected ${newSigs.length} new SWAP signatures (total new: ${allNewSignatures.length})`);
          }

          lastSignature = signatures[signatures.length - 1];
          
          if (signatures.length < batchLimit) {
            hasMoreSignatures = false;
            logger.info('Reached end of SWAP signatures from API.');
          } else if (newSigs.length === 0 && fetchedSignaturesCount > 0) {
             hasMoreSignatures = false;
             logger.info('No new unique SWAP signatures found in the last batch, stopping signature fetch.');
           }
        } else {
          hasMoreSignatures = false;
          logger.info('API returned no more SWAP signatures.');
        }
      }

      if (fetchedSignaturesCount >= MAX_SIGNATURES_TO_FETCH) {
         logger.warn(`Reached MAX_SIGNATURES_TO_FETCH limit (${MAX_SIGNATURES_TO_FETCH}). May not have fetched all history.`);
      }
      logger.info(`Finished fetching signatures. Total new SWAP signatures to process: ${allNewSignatures.length}`);
      // Log first few for debug
      if (allNewSignatures.length > 0) {
        logger.debug('First few new signatures:', allNewSignatures.slice(0, 10));
      }

      // Step 3: Fetch full transaction details for new signatures in batches
      for (let i = 0; i < allNewSignatures.length; i += this.BATCH_SIZE) {
        const batchSignatures = allNewSignatures.slice(i, i + this.BATCH_SIZE);
        logger.info(`Processing batch ${Math.floor(i/this.BATCH_SIZE) + 1}/${Math.ceil(allNewSignatures.length/this.BATCH_SIZE)} of signatures.`);
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
        logger.debug(`Signatures before tokenTransfer filter (batch ${Math.floor(i/this.BATCH_SIZE) + 1}):`, receivedSignatures);

        // Filter for swaps with token transfers
        const swapsWithTokenTransfers = batchTransactions.filter(tx => 
            tx.tokenTransfers && tx.tokenTransfers.length > 0
        );
        
        // Log signatures AFTER client-side filtering
        const filteredSignatures = swapsWithTokenTransfers.map(tx => tx.signature);
        logger.debug(`Signatures after tokenTransfer filter (batch ${Math.floor(i/this.BATCH_SIZE) + 1}):`, filteredSignatures);

        if(swapsWithTokenTransfers.length > 0) {
            newTransactions.push(...swapsWithTokenTransfers);
            logger.info(`Added ${swapsWithTokenTransfers.length} SWAPs with token transfers from batch.`);
        } else {
            logger.info('No SWAPs with token transfers found in this batch.');
        }
        
        // Delay applied within rateLimit() before next batch request
      }
      
    } catch (error) {
      // Catch errors specifically from the signature/transaction fetching process
      logger.error('Failed to complete transaction fetching process due to error:', { error: this.sanitizeError(error), address });
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
    
    logger.info(`Process finished. Returning ${combinedTransactions.length} total SWAP transactions with token transfers.`);
    return combinedTransactions;
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