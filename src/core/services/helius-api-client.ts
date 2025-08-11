import axios, { AxiosInstance, AxiosError } from 'axios';
import { createLogger } from 'core/utils/logger';
import {
  HeliusApiConfig,
  HeliusTransaction,
  GetMultipleAccountsResult,
  GetTokenAccountsByOwnerResult,
  // RpcAccountInfo, // Not directly used as a parameter/return type of public methods here yet
} from '@/types/helius-api';
import { DatabaseService } from '../../api/services/database.service';
import { Injectable } from '@nestjs/common';
import { HELIUS_CONFIG } from '../../config/constants';
import * as fs from 'fs';
import * as path from 'path';

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
  private readonly BATCH_SIZE = HELIUS_CONFIG.BATCH_SIZE; // Maximum signatures to process in one batch
  private lastRequestTime: number = 0;
  private readonly minRequestIntervalMs: number; // Calculated based on RPS
  private readonly rpcUrl: string; // Store the full RPC URL with API key
  private readonly RPC_SIGNATURE_LIMIT = 1000; // Max limit for getSignaturesForAddress
  private dbService: DatabaseService; // Add DatabaseService member
  
  // Global rate limiter - shared across all instances to prevent overwhelming API
  private static globalLastRequestTime: number = 0;
  private static globalRequestQueue: Array<() => void> = [];
  private static processingQueue: boolean = false;
  private static globalMinRequestIntervalMs: number = 0; // Global rate limit interval shared across all instances


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
    
    const targetRps = config.requestsPerSecond || HELIUS_CONFIG.DEFAULT_RPS;

    // Calculate interval: (1000 ms / RPS) + safety buffer
    this.minRequestIntervalMs = Math.ceil(1000 / targetRps) + RATE_LIMIT_SAFETY_BUFFER_MS;
    
    // Set global rate limit interval to the most restrictive (highest) value to ensure all instances respect the same limit
    if (HeliusApiClient.globalMinRequestIntervalMs === 0 || this.minRequestIntervalMs > HeliusApiClient.globalMinRequestIntervalMs) {
      HeliusApiClient.globalMinRequestIntervalMs = this.minRequestIntervalMs;
      logger.info(`Updated global rate limit interval to ${HeliusApiClient.globalMinRequestIntervalMs}ms (from instance with ${targetRps} RPS)`);
    }
    
    logger.info(`Initializing HeliusApiClient: Target RPS=${targetRps}, Min Request Interval=${this.minRequestIntervalMs}ms, Global Interval=${HeliusApiClient.globalMinRequestIntervalMs}ms`);

    this.api = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000, // 30 second timeout
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.dbService = dbService; // Assign passed DatabaseService instance

  }

  /** Ensures a minimum interval between requests to respect rate limits globally. */
  private async rateLimit(): Promise<void> {
    return new Promise((resolve) => {
      HeliusApiClient.globalRequestQueue.push(resolve);
      this.processGlobalQueue();
    });
  }

  /** Processes the global request queue to enforce rate limits across all instances. */
  private async processGlobalQueue(): Promise<void> {
    if (HeliusApiClient.processingQueue) {
      return; // Already processing
    }
    
    HeliusApiClient.processingQueue = true;
    
    while (HeliusApiClient.globalRequestQueue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - HeliusApiClient.globalLastRequestTime;
      
      if (timeSinceLastRequest < HeliusApiClient.globalMinRequestIntervalMs) {
        const waitTime = HeliusApiClient.globalMinRequestIntervalMs - timeSinceLastRequest;
        // logger.debug(`Global rate limiting: Waiting ${waitTime}ms for next request...`);
        await delay(waitTime);
      }
      
      HeliusApiClient.globalLastRequestTime = Date.now();
      const resolve = HeliusApiClient.globalRequestQueue.shift();
      if (resolve) {
        resolve();
      }
    }
    
    HeliusApiClient.processingQueue = false;
  }

  /**
   * Determines if an error is retryable.
   * 
   * @param error The error to inspect.
   * @returns `true` if the error is retryable, `false` otherwise.
   */
  private isRetryableError(error: any): boolean {
    if (axios.isAxiosError(error)) {
      // Retry on server errors (5xx) and rate limits (429)
      if (error.response && ([429, 500, 502, 503, 504].includes(error.response.status))) {
        return true;
      }
    }
    // Check for specific non-retryable RPC error messages
    const errorMessage = error?.message?.toLowerCase() || '';
    if (errorMessage.includes('invalid param') || errorMessage.includes('wrongsize')) {
      return false;
    }
    
    // Default to retry for generic network errors, but not for client-side errors (4xx)
    if (axios.isAxiosError(error) && error.response && error.response.status >= 400 && error.response.status < 500) {
        return false;
    }
    
    return true; // Assume other errors might be transient network issues
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
                    // logger.debug(`Attempt ${attempt}: Fetching RPC signatures page: limit=${limit}, before=${before || 'N/A'}`);
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
                // logger.debug(`Attempt ${attempt}: Received ${response.data.result.length} signatures via RPC.`);
                return response.data.result; // Success
            } else {
                logger.warn(`Attempt ${attempt}: Received unexpected response structure from getSignaturesForAddress RPC.`, { responseData: response.data });
                // Consider retrying or throwing based on policy
                throw new Error('Unexpected RPC response structure'); 
            }
        } catch (error) {
            // Abort immediately on non-retryable errors (e.g. "Invalid param: WrongSize")
            if (!this.isRetryableError(error)) {
                // Re-throw so callers can handle appropriately and we skip all retries
                throw error;
            }
            const isAxiosError = axios.isAxiosError(error);
            const status = isAxiosError ? (error as AxiosError).response?.status : undefined;

            // Log the failure
            const logLevel = retries === 0 ? 'debug' : 'warn'; 
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
                 logger.debug(`Attempt ${attempt}: Encountered retryable error (status=${status ?? 'N/A'}). Retrying RPC signatures fetch in ${backoffTime}ms...`);
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
            // logger.debug(`Attempt ${attempt}: Fetching full transactions for ${signatures.length} signatures.`);
            
            const endpoint = `/v0/transactions?api-key=${this.apiKey}`;

            const response = await this.api.post(endpoint, {
                transactions: signatures
            });

            // logger.debug(`Attempt ${attempt}: Retrieved ${response.data.length} full transactions.`);
            
            // Simple validation: Check if we got data for *most* requested signatures
            if (response.data.length < signatures.length * 0.8 && signatures.length > 5) { // Adjusted threshold slightly
                logger.warn(
                    `Attempt ${attempt}: Received significantly fewer transactions (${response.data.length}) ` +
                    `than signatures requested (${signatures.length}). Some might be missing due to failed TXs. ` +
                    `Helius response data (first 5 if many):`, 
                    JSON.stringify(response.data.slice(0, 5), null, 2) // Log a sample of the raw response
                );
            }
            return response.data; // Success

        } catch (error) {
            // Abort immediately on non-retryable errors (e.g. "Invalid param: WrongSize")
            if (!this.isRetryableError(error)) {
                throw error;
            }
            
            const isAxiosError = axios.isAxiosError(error);
            const status = isAxiosError ? (error as AxiosError).response?.status : undefined;
            const attempt = retries + 1;
            const signatureCount = signatures.length;

            // Enhanced error logging for 400 errors to help with diagnosis
            if (isAxiosError && status === 400) {
                const responseData = (error as AxiosError).response?.data;
                logger.error(`Attempt ${attempt}: 400 Bad Request error fetching transactions`, {
                    signatureCount,
                    sampleSignatures: signatures.slice(0, 3), // Log first 3 signatures for diagnosis
                    endpoint: `/v0/transactions?api-key=***`,
                    requestPayload: {
                        transactions: signatures.slice(0, 3) // Show structure but limit data
                    },
                    responseData: responseData ? JSON.stringify(responseData).substring(0, 500) : 'No response data',
                    error: this.sanitizeError(error)
                });
            }

            // Log initial failure as debug, subsequent retry attempts as warn
            const logLevel = retries === 0 ? 'debug' : 'warn'; 
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
                    logger.debug(`Attempt ${attempt}: Rate limit or server error (${status}). Retrying batch in ${backoffTime}ms...`);
                    await delay(backoffTime);
                    retries++;
                } else { // Don't retry for client errors (4xx except 429)
                    logger.error(`Attempt ${attempt}: Unrecoverable client error (${status}). Aborting batch fetch.`, { signatureCount });
                    throw error; // Re-throw original error
                }
            } else { // Handle non-HTTP errors (e.g., network issues)
                const backoffTime = INITIAL_BACKOFF_MS * Math.pow(2, retries);
                logger.debug(`Attempt ${attempt}: Network or unknown error. Retrying batch in ${backoffTime}ms...`);
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
   * 6. Filters the newly fetched transactions based on optional timestamps (`newestProcessedTimestamp`, `untilTimestamp`).
   * 7. Filters the list to include only transactions relevant to the target `address` (sender, receiver, account data changes, swaps).
   * 8. Sorts the final relevant transactions by timestamp ascending (oldest first).
   *
   * @param address The wallet address to fetch transactions for.
   * @param parseBatchLimit The number of signatures to include in each batch request to the Helius `/v0/transactions` endpoint (default: 100).
   * @param maxSignatures Optional maximum total number of signatures to process (fetched via RPC). Fetching stops once this limit is reached.
   * @param stopAtSignature Optional signature. If encountered during RPC fetch, stops fetching older pages.
   * @param newestProcessedTimestamp Optional Unix timestamp (seconds). If provided, filters the results to include only transactions *strictly newer* than this timestamp.
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
    untilTimestamp?: number,
    phase2InternalConcurrency: number = HELIUS_CONFIG.INTERNAL_CONCURRENCY,
    onProgress?: (progress: number) => void,
    onTransactionBatch?: (batch: HeliusTransaction[]) => Promise<void>, // ✅ NEW: Stream processing callback
    processCachedSignatures: boolean = true // ✅ NEW: also process cache hits by refetching details
  ): Promise<HeliusTransaction[]> {
    // --- DEBUG TRACE: initialize trace state for specific signatures ---
    const traceSet = new Set<string>((HELIUS_CONFIG.DEBUG_TRACE_SIGNATURES || []).map(s => s.trim()));
    const trace: Record<string, any> = {};
    const markTrace = (sig: string, field: string, value: any = true) => {
      if (!traceSet.has(sig)) return;
      if (!trace[sig]) trace[sig] = { sig };
      trace[sig][field] = value;
    };
    let allRpcSignaturesInfo: SignatureInfo[] = [];
    // List to hold ONLY the transactions fetched from API in this run
    let newlyFetchedTransactions: HeliusTransaction[] = []; 
    // Set to hold signatures whose details need to be fetched from API
    const signaturesToFetchDetails = new Set<string>();

    // === PHASE 1: Fetch Signatures via RPC ===
    logger.debug(`Starting Phase 1: Fetching signatures via Solana RPC for ${address}`);
    let lastRpcSignature: string | null = null;
    let hasMoreSignatures = true;
    let fetchedSignaturesCount = 0;
    const rpcLimit = this.RPC_SIGNATURE_LIMIT;

    try {
      while (hasMoreSignatures) {
        const signatureInfos = await this.getSignaturesViaRpcPage(address, rpcLimit, lastRpcSignature);
        
        if (signatureInfos.length > 0) {
            allRpcSignaturesInfo.push(...signatureInfos);
            // DEBUG TRACE: mark inRPC
            for (const info of signatureInfos) {
              if (traceSet.has(info.signature)) markTrace(info.signature, 'inRpc', true);
            }
            fetchedSignaturesCount += signatureInfos.length;
            lastRpcSignature = signatureInfos[signatureInfos.length - 1].signature;

            // Check if we need to stop based on stopAtSignature
            if (stopAtSignature) {
                const stopIndex = signatureInfos.findIndex(info => info.signature === stopAtSignature);
                if (stopIndex !== -1) {
                    logger.debug(`Found stopAtSignature (${stopAtSignature}) in the current batch at index ${stopIndex}. Stopping signature fetch.`);
                    hasMoreSignatures = false;
                }
            }

            // IMPORTANT: This condition stops PAGINATION, not processing of already fetched signatures.
            // We will apply a hard limit AFTER this loop if maxSignatures is set.
            if (maxSignatures !== null && fetchedSignaturesCount >= maxSignatures && !stopAtSignature) {
                logger.debug(`RPC fetcher has retrieved ${fetchedSignaturesCount} signatures, which meets or exceeds an intended conceptual target related to maxSignatures (${maxSignatures}). Stopping further RPC pagination.`);
                hasMoreSignatures = false;
            } else if (signatureInfos.length < rpcLimit) {
                logger.debug('Last page of RPC signatures reached (received less than limit).');
                hasMoreSignatures = false;
            }
        } else {
            logger.debug('Last page of RPC signatures reached (received 0 items).');
            hasMoreSignatures = false;
        }
      }
      logger.debug(`Finished Phase 1. Total signatures retrieved via RPC: ${allRpcSignaturesInfo.length}`);

    } catch (rpcError) {
       if (!this.isRetryableError(rpcError)) {
           // Propagate non-retryable errors so higher-level services can terminate the workflow
           throw rpcError;
       }
       logger.error('Failed during RPC signature fetching phase (Phase 1): Returning empty list.', { 
           error: this.sanitizeError(rpcError), 
           address, 
           signaturesFetchedBeforeError: allRpcSignaturesInfo.length 
       });
       return []; // Return empty if signature fetching fails critically
    }

    // --- Apply hard maxSignatures limit to the RPC results before detail fetching ---
    const capDroppedSet = new Set<string>(); // DEBUG/Rescue: signatures beyond cap
    if (HELIUS_CONFIG.WRITE_RPC_MANIFEST) {
      try {
        const outDir = path.resolve(HELIUS_CONFIG.LEGIT_MISSING_OUTPUT_DIR || 'debug_output');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        fs.writeFileSync(path.join(outDir, `rpc-manifest-precap-${address}-${ts}.json`), JSON.stringify({ address, signatures: allRpcSignaturesInfo.map(s => ({ sig: s.signature, blockTime: s.blockTime ?? null })) }, null, 2));
      } catch {}
    }

    if (maxSignatures !== null && allRpcSignaturesInfo.length > maxSignatures) {
        logger.debug(`RPC fetch resulted in ${allRpcSignaturesInfo.length} signatures. Applying hard limit of ${maxSignatures}.`);

        // Diagnostics: compare RPC-order cap vs blockTime-sorted cap
        if (HELIUS_CONFIG.DEBUG_CAP_COMPARE) {
          const rpcOrderedCap = allRpcSignaturesInfo.slice(0, maxSignatures).map(s => s.signature);
          const sortedByBlockTime = [...allRpcSignaturesInfo].sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
          const sortedCap = sortedByBlockTime.slice(0, maxSignatures).map(s => s.signature);
          const onlyInRpcCap = rpcOrderedCap.filter(sig => !sortedCap.includes(sig));
          const onlyInSortedCap = sortedCap.filter(sig => !rpcOrderedCap.includes(sig));
          if (onlyInRpcCap.length > 0 || onlyInSortedCap.length > 0) {
            logger.warn(`CAP difference detected: rpcCapOnly=${onlyInRpcCap.length}, sortedCapOnly=${onlyInSortedCap.length}. Writing cap-compare diagnostics.`);
            try {
              const outDir = path.resolve(HELIUS_CONFIG.LEGIT_MISSING_OUTPUT_DIR || 'debug_output');
              if (!fs.existsSync(outDir)) {
                fs.mkdirSync(outDir, { recursive: true });
              }
              const ts = new Date().toISOString().replace(/[:.]/g, '-');
              const filePath = path.join(outDir, `cap-compare-${address}-${ts}.json`);
              const payload = {
                address,
                maxSignatures,
                totalSignatures: allRpcSignaturesInfo.length,
                onlyInRpcCap,
                onlyInSortedCap,
                sampleRpcCap: rpcOrderedCap.slice(0, 50),
                sampleSortedCap: sortedCap.slice(0, 50)
              };
              fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
            } catch (e) {
              logger.warn('Failed to write cap-compare diagnostics file.', { error: this.sanitizeError(e) });
            }
          }
        }

        // Apply cap in RPC order (newest-first) to avoid blockTime nulls reordering
        const preCapAll = allRpcSignaturesInfo.map(s => s.signature);
        const kept = preCapAll.slice(0, maxSignatures);
        const dropped = preCapAll.slice(maxSignatures);
        for (const sig of dropped) capDroppedSet.add(sig);
        // Trace: mark dropped-by-cap for traced signatures
        for (const sig of dropped) { if (traceSet.has(sig)) markTrace(sig, 'droppedByCap', true); }
        allRpcSignaturesInfo = allRpcSignaturesInfo.slice(0, maxSignatures);
        logger.debug(`Sliced RPC signatures to newest ${allRpcSignaturesInfo.length} based on maxSignatures limit (RPC order).`);
    }

    if (HELIUS_CONFIG.WRITE_RPC_MANIFEST) {
      try {
        const outDir = path.resolve(HELIUS_CONFIG.LEGIT_MISSING_OUTPUT_DIR || 'debug_output');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        fs.writeFileSync(path.join(outDir, `rpc-manifest-postcap-${address}-${ts}.json`), JSON.stringify({ address, signatures: allRpcSignaturesInfo.map(s => ({ sig: s.signature, blockTime: s.blockTime ?? null })) }, null, 2));
      } catch {}
    }

    const uniqueSignatures = Array.from(new Set(allRpcSignaturesInfo.map(s => s.signature)));
    logger.debug(`Total unique signatures from RPC after potential maxSignatures slicing: ${uniqueSignatures.length}`);
    // Map for quick lookup of RPC info by signature (used for missing classification)
    const rpcInfoBySignature = new Map<string, SignatureInfo>();
    for (const info of allRpcSignaturesInfo) {
      rpcInfoBySignature.set(info.signature, info);
    }

    // === Check Cache to Identify Signatures to Fetch ===
    logger.debug(`Checking database cache existence for ${uniqueSignatures.length} signatures...`);
    
    // Use the dbService instance method - now returns lightweight cache info
    const cachedTxMap = await this.dbService.getCachedTransaction(uniqueSignatures) as Map<string, { timestamp: number }>;
    const cacheHits = cachedTxMap.size;
    
    // Separate cached signatures and signatures that need to be fetched
    for (const sig of uniqueSignatures) {
      const cachedInfo = cachedTxMap.get(sig);
      if (cachedInfo) {
        // Signature exists in cache - skip fetching details
        // logger.debug(`Signature ${sig} found in cache, skipping fetch`);
        markTrace(sig, 'cacheHit', true);
      } else {
        // Signature not in cache - need to fetch details
        signaturesToFetchDetails.add(sig);
        markTrace(sig, 'cacheHit', false);
      }
    }
    
    logger.debug(`Found ${cacheHits} signatures in cache. Need to fetch details for ${signaturesToFetchDetails.size} signatures.`);
    
    const signaturesToFetchArray = Array.from(signaturesToFetchDetails);
    const cachedSignaturesArray = uniqueSignatures.filter(sig => cachedTxMap.has(sig));
    if (cachedSignaturesArray.length > 0) {
      logger.debug(`Identified ${cachedSignaturesArray.length} signatures in cache that will${processCachedSignatures ? '' : ' not'} be processed in this run.`);
    }

    // === PHASE 2: Fetch Uncached Details SEQUENTIALLY & Save to Cache ===
    if (signaturesToFetchArray.length > 0) {
        logger.debug(`Starting Phase 2: Fetching parsed details from Helius for ${signaturesToFetchArray.length} new signatures with internal concurrency of ${phase2InternalConcurrency}.`);
        
        // Reset newlyFetchedTransactions here as it only holds results from THIS phase
        newlyFetchedTransactions = []; 
        
        const totalSignaturesToFetch = signaturesToFetchArray.length;
        let processedSignaturesCount = 0;
        let lastLoggedPercentage = 0;
        // Classification tracking
        const legitMissingForRetry = new Set<string>();
        let missingFailedCount = 0;
        let totalRequestedCount = 0;
        let totalReceivedCount = 0;
        let totalMissingCount = 0;
        let totalLegitMissingCount = 0;

        onProgress?.(0);
        
        // Process signatures in chunks, each chunk handled by a concurrent set of batch fetches
        for (let i = 0; i < totalSignaturesToFetch; i += parseBatchLimit * phase2InternalConcurrency) {
            const chunkSignatures = signaturesToFetchArray.slice(i, i + parseBatchLimit * phase2InternalConcurrency);
            const promises: Promise<{ txs: HeliusTransaction[]; requested: string[]; err?: any }>[] = [];

            for (let j = 0; j < chunkSignatures.length; j += parseBatchLimit) {
                const batchSignatures = chunkSignatures.slice(j, j + parseBatchLimit);
                if (batchSignatures.length > 0) {
                    // DEBUG TRACE: requested in Phase 2
                    for (const s of batchSignatures) markTrace(s, 'requestedP2', true);
                    // The getTransactionsBySignatures method already includes rate limiting and retries
                    promises.push(
                        this.getTransactionsBySignatures(batchSignatures)
                            .then(txs => ({ txs, requested: batchSignatures }))
                            .catch(error => {
                                // Log error for this specific batch and return empty structure to not break Promise.allSettled
                                logger.error(`A batch fetch within concurrent set failed for ${batchSignatures.length} signatures. Continuing with others.`, {
                                    error: this.sanitizeError(error),
                                    signatures: batchSignatures.slice(0, 5)
                                });
                                return { txs: [], requested: batchSignatures, err: this.sanitizeError(error) };
                            })
                    );
                }
            }

            if (promises.length > 0) {
                const results = await Promise.allSettled(promises);
                
                // ✅ STREAM PROCESSING: Process each batch immediately
                for (const result of results) {
                  if (result.status === 'fulfilled' && result.value) {
                    const txs = result.value.txs || [];
                    const requested = result.value.requested || [];
                    if (txs.length > 0) {
                      if (onTransactionBatch) {
                        // Stream process immediately - no memory accumulation!
                        await onTransactionBatch(txs);
                        // Save streamed batches to cache for visibility and future runs
                        try {
                          await this.dbService.saveCachedTransactions(txs);
                        } catch (e) {
                          logger.warn('Failed to save streamed batch to cache (continuing).', { error: this.sanitizeError(e) });
                        }
                      } else {
                        // Fallback: accumulate for existing callers
                        newlyFetchedTransactions.push(...txs);
                      }
                    }
                    // Classification
                    const received = new Set<string>(txs.map(t => t.signature));
                    // DEBUG TRACE: mark receivedP2
                    for (const s of received) markTrace(s, 'receivedP2', true);
                    const missing = requested.filter(sig => !received.has(sig));
                    totalRequestedCount += requested.length;
                    totalReceivedCount += received.size;
                    totalMissingCount += missing.length;
                    if (missing.length > 0) {
                      let legitCount = 0;
                      let failedCount = 0;
                      for (const sig of missing) {
                        const info = rpcInfoBySignature.get(sig);
                        if (info && info.err) {
                          failedCount++;
                          missingFailedCount++;
                        } else {
                          legitMissingForRetry.add(sig);
                          legitCount++;
                        }
                      }
                      totalLegitMissingCount += legitCount;
                      if (HELIUS_CONFIG.LOG_MISSING_CLASSIFICATION_PER_BATCH) {
                        logger.warn(
                          `Detected missing transactions in batch response: requested=${requested.length}, received=${received.size}, missing=${missing.length}, legitMissing=${legitCount}, failedMissing=${failedCount}.`
                        );
                      }
                      // DEBUG TRACE: if a traced signature is missing, optionally probe it immediately
                      if (HELIUS_CONFIG.DEBUG_TRACE_PROBE_ON_MISSING) {
                        const tracedMissing = missing.filter(sig => traceSet.has(sig));
                        for (const sig of tracedMissing) {
                          try {
                            logger.warn(`TRACE-PROBE: Immediately fetching details for traced missing signature ${sig}`);
                            const probe = await this.getTransactionsBySignatures([sig]);
                            if (probe && probe.length > 0) {
                              markTrace(sig, 'probeReceived', true);
                              if (onTransactionBatch) {
                                await onTransactionBatch(probe);
                                try { await this.dbService.saveCachedTransactions(probe); } catch {}
                              } else {
                                newlyFetchedTransactions.push(...probe);
                              }
                            } else {
                              markTrace(sig, 'probeReceived', false);
                            }
                          } catch (e) {
                            markTrace(sig, 'probeError', this.sanitizeError(e));
                          }
                        }
                      }
                    }
                  }
                  // Failed promises are already handled by the catch within the push to `promises`
                }
            }
            
            processedSignaturesCount += chunkSignatures.length; // Update based on the size of the chunk attempted
            const currentPercentage = Math.floor((processedSignaturesCount / totalSignaturesToFetch) * 100);
            
            onProgress?.(currentPercentage);

            // Only show progress for larger operations (more than 50 signatures)
            if (totalSignaturesToFetch > 50 && (currentPercentage >= lastLoggedPercentage + 25 || processedSignaturesCount >= totalSignaturesToFetch)) {
                 const displayPercentage = Math.min(100, Math.floor((processedSignaturesCount / totalSignaturesToFetch) * 100));
                 // ✅ ENHANCED PROGRESS: Show signatures processed vs successful transactions
                 process.stdout.write(`  Fetching details: Processed ~${displayPercentage}% of signatures (${processedSignaturesCount}/${totalSignaturesToFetch} sigs → ${newlyFetchedTransactions.length} successful txns)...\r`);
                 lastLoggedPercentage = currentPercentage;
            }
        } // End loop through chunks
        
        onProgress?.(100);
        
        if (totalSignaturesToFetch > 50) {
            process.stdout.write('\n'); // Newline after final progress update only if we showed progress
        }
        logger.debug('Concurrent batch requests for Phase 2 finished.');
        logger.debug(`Successfully fetched details for ${newlyFetchedTransactions.length} out of ${totalSignaturesToFetch} new transactions attempted in Phase 2.`);
        if (HELIUS_CONFIG.LOG_MISSING_CLASSIFICATION_PER_BATCH) {
          if (missingFailedCount > 0) {
            logger.info(`Classified ${missingFailedCount} missing signatures as failed transactions based on RPC err field. These will be skipped.`);
          }
          logger.info(`Phase 2 aggregate: requested=${totalRequestedCount}, received=${totalReceivedCount}, missing=${totalMissingCount}, legitMissing=${totalLegitMissingCount}.`);
        }

        // Optionally write legit-missing signatures to a JSON file
        if (HELIUS_CONFIG.WRITE_LEGIT_MISSING_TO_FILE && legitMissingForRetry.size > 0) {
          try {
            const outDir = path.resolve(HELIUS_CONFIG.LEGIT_MISSING_OUTPUT_DIR || 'debug_output');
            if (!fs.existsSync(outDir)) {
              fs.mkdirSync(outDir, { recursive: true });
            }
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const filePath = path.join(outDir, `legit-missing-${address}-${ts}.json`);
            const payload = {
              address,
              requested: totalRequestedCount,
              received: totalReceivedCount,
              missing: totalMissingCount,
              legitMissingCount: totalLegitMissingCount,
              signatures: Array.from(legitMissingForRetry),
            };
            fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
            if (HELIUS_CONFIG.LOG_MISSING_CLASSIFICATION_PER_BATCH) {
              logger.info(`Wrote legit-missing signatures to ${filePath}`);
            }
          } catch (writeErr) {
            if (HELIUS_CONFIG.LOG_MISSING_CLASSIFICATION_PER_BATCH) {
              logger.error('Failed to write legit-missing signatures file', { error: this.sanitizeError(writeErr) });
            }
          }
        }

        // Second pass retry for legit-missing (optional)
        if (HELIUS_CONFIG.ENABLE_SECOND_PASS_RETRY && legitMissingForRetry.size > 0) {
          const microLimit = HELIUS_CONFIG.SECOND_PASS_MICRO_BATCH_LIMIT || 10;
          const waitMs = HELIUS_CONFIG.SECOND_PASS_INDEXING_WAIT_MS || 1500;
          const secondPassTargets = Array.from(legitMissingForRetry);
          if (HELIUS_CONFIG.LOG_MISSING_CLASSIFICATION_PER_BATCH) {
            logger.warn(`Preparing second-pass retry for ${secondPassTargets.length} legitimately missing transactions using micro-batches of ${microLimit}. Waiting ${waitMs}ms for indexing...`);
          }
          await delay(waitMs);
          for (let k = 0; k < secondPassTargets.length; k += microLimit) {
            const microBatch = secondPassTargets.slice(k, k + microLimit);
            try {
              const txs = await this.getTransactionsBySignatures(microBatch);
              if (txs && txs.length > 0) {
                if (onTransactionBatch) {
                  await onTransactionBatch(txs);
                  try {
                    await this.dbService.saveCachedTransactions(txs);
                  } catch (e) {
                    logger.warn('Failed to save second-pass streamed batch to cache (continuing).', { error: this.sanitizeError(e) });
                  }
                } else {
                  newlyFetchedTransactions.push(...txs);
                }
              }
              const got = new Set<string>((txs || []).map(t => t.signature));
              const stillMissing = microBatch.filter(sig => !got.has(sig));
              if (stillMissing.length > 0 && HELIUS_CONFIG.LOG_MISSING_CLASSIFICATION_PER_BATCH) {
                logger.warn(`Second pass micro-batch returned fewer results. requested=${microBatch.length}, received=${got.size}, stillMissing=${stillMissing.length}. Sample: ${stillMissing.slice(0, 3).join(', ')}`);
              }
            } catch (e) {
              if (HELIUS_CONFIG.LOG_MISSING_CLASSIFICATION_PER_BATCH) {
                logger.error(`Second pass micro-batch fetch failed for ${microBatch.length} signatures.`, { error: this.sanitizeError(e) });
              }
            }
          }
        }

        // --- Save newly fetched transactions to DB Cache --- 
        if (newlyFetchedTransactions.length > 0) {
            logger.debug(`Saving ${newlyFetchedTransactions.length} newly fetched transactions to database cache...`);
            // Use the dbService instance method
            await this.dbService.saveCachedTransactions(newlyFetchedTransactions);
            logger.debug('Finished saving new transactions to cache.');
            // Do NOT combine with cached data here. newlyFetchedTransactions holds the results.
        } else {
             logger.debug('No new transactions were successfully fetched in Phase 2.');
        }
    } // End if signaturesToFetchArray.length > 0
    
    // === PHASE 2b: Process Cached Signatures (optional re-fetch) ===
    if (processCachedSignatures && cachedSignaturesArray.length > 0) {
      logger.debug(`Starting Phase 2b: Re-fetching ${cachedSignaturesArray.length} cached signatures for processing.`);
      for (let i = 0; i < cachedSignaturesArray.length; i += parseBatchLimit * phase2InternalConcurrency) {
        const chunk = cachedSignaturesArray.slice(i, i + parseBatchLimit * phase2InternalConcurrency);
        const promises: Promise<HeliusTransaction[]>[] = [];
        for (let j = 0; j < chunk.length; j += parseBatchLimit) {
          const batch = chunk.slice(j, j + parseBatchLimit);
          if (batch.length > 0) {
            // DEBUG TRACE: requested in Phase 2b
            for (const s of batch) markTrace(s, 'requestedP2b', true);
            promises.push(
              this.getTransactionsBySignatures(batch).catch(err => {
                logger.error(`Cached batch fetch failed for ${batch.length} signatures.`, { error: this.sanitizeError(err) });
                return [] as HeliusTransaction[];
              })
            );
          }
        }
        if (promises.length > 0) {
          const results = await Promise.allSettled(promises);
          for (const res of results) {
            if (res.status === 'fulfilled' && res.value && res.value.length > 0) {
              if (onTransactionBatch) {
                await onTransactionBatch(res.value);
              } else {
                newlyFetchedTransactions.push(...res.value);
              }
              // DEBUG TRACE: received in Phase 2b
              for (const s of res.value.map(t => t.signature)) markTrace(s, 'receivedP2b', true);
            }
          }
        }
      }
      logger.debug('Phase 2b complete: processed cached signatures by re-fetching details.');
    }

    // === PHASE 2c: Rescue fetch for traced signatures dropped by cap ===
    if (capDroppedSet.size > 0) {
      const tracedDropped = Array.from(capDroppedSet).filter(sig => traceSet.has(sig));
      if (tracedDropped.length > 0) {
        logger.warn(`TRACE-RESCUE: Fetching ${tracedDropped.length} traced signatures that were dropped by cap.`);
        for (let i = 0; i < tracedDropped.length; i += parseBatchLimit) {
          const batch = tracedDropped.slice(i, i + parseBatchLimit);
          try {
            const txs = await this.getTransactionsBySignatures(batch);
            if (txs && txs.length > 0) {
              if (onTransactionBatch) {
                await onTransactionBatch(txs);
                try { await this.dbService.saveCachedTransactions(txs); } catch {}
              } else {
                newlyFetchedTransactions.push(...txs);
              }
              for (const s of txs.map(t => t.signature)) markTrace(s, 'rescueReceived', true);
            }
          } catch (e) {
            logger.warn('TRACE-RESCUE batch fetch failed.', { error: this.sanitizeError(e) });
          }
        }
      }
    }

    // With lightweight cache, we only have newly fetched transactions
    // Cached signatures are used to avoid re-fetching, not to provide transaction data
    logger.debug(`Cache hit ${cacheHits} signatures (avoided re-fetching).`);
    logger.debug(`Fetched ${newlyFetchedTransactions.length} new transactions from API.`);
    
    // === RECONCILIATION: ensure cache contains all RPC signatures that are not failed ===
    if (HELIUS_CONFIG.RECONCILE_ENABLED) {
      try {
        const rpcSet = new Set<string>(Array.from(new Set(allRpcSignaturesInfo.map(s => s.signature))));
        // Exclude known failed from RPC err
        for (const info of allRpcSignaturesInfo) {
          if ((info as any).err) rpcSet.delete(info.signature);
        }
        // Read cache for these signatures in chunks
        const rpcList = Array.from(rpcSet);
        const cachedSet = new Set<string>();
        const chunk = 1000;
        for (let i = 0; i < rpcList.length; i += chunk) {
          const part = rpcList.slice(i, i + chunk);
          const cacheMap = await this.dbService.getCachedTransaction(part) as Map<string, { timestamp: number }>;
          for (const sig of part) {
            if (cacheMap.get(sig)) cachedSet.add(sig);
          }
        }
        const stillMissing = rpcList.filter(sig => !cachedSet.has(sig));
        if (stillMissing.length > 0) {
          logger.warn(`RECONCILE: ${stillMissing.length} signatures missing from cache after normal phases. Attempting micro-fetch.`);
          const limit = HELIUS_CONFIG.RECONCILE_MICRO_BATCH_LIMIT || 50;
          for (let i = 0; i < stillMissing.length; i += limit) {
            const batch = stillMissing.slice(i, i + limit);
            try {
              const txs = await this.getTransactionsBySignatures(batch);
              if (txs && txs.length > 0) {
                if (onTransactionBatch) {
                  await onTransactionBatch(txs);
                  try { await this.dbService.saveCachedTransactions(txs); } catch {}
                } else {
                  newlyFetchedTransactions.push(...txs);
                }
              }
            } catch (e) {
              logger.warn('RECONCILE micro-fetch failed for a batch.', { error: this.sanitizeError(e) });
            }
          }
          // Final verify and diagnostics
          const afterCacheSet = new Set<string>();
          for (let i = 0; i < rpcList.length; i += chunk) {
            const part = rpcList.slice(i, i + chunk);
            const cacheMap = await this.dbService.getCachedTransaction(part) as Map<string, { timestamp: number }>;
            for (const sig of part) {
              if (cacheMap.get(sig)) afterCacheSet.add(sig);
            }
          }
          const stillMissingAfter = rpcList.filter(sig => !afterCacheSet.has(sig));
          if (stillMissingAfter.length > 0) {
            try {
              const outDir = path.resolve(HELIUS_CONFIG.LEGIT_MISSING_OUTPUT_DIR || 'debug_output');
              if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
              const ts = new Date().toISOString().replace(/[:.]/g, '-');
              fs.writeFileSync(path.join(outDir, `reconcile-${address}-${ts}.json`), JSON.stringify({ address, missing: stillMissingAfter }, null, 2), 'utf-8');
              logger.warn(`RECONCILE: Wrote diagnostics for ${stillMissingAfter.length} signatures still missing after reconciliation.`);
            } catch {}
          }
        }
      } catch (e) {
        logger.warn('RECONCILE step encountered an error (continuing).', { error: this.sanitizeError(e) });
      }
    }

    const allTransactions = [...newlyFetchedTransactions];
    
    // === Filtering & Sorting of All Transactions ===

    // --- Timestamp Filtering (Incremental Logic & Until Logic) ---
    let filteredTransactions = allTransactions;
    // If stopAtSignature is provided, rely on signature boundary and skip strict timestamp filter
    if (newestProcessedTimestamp !== undefined && !stopAtSignature) {
        const countBefore = filteredTransactions.length;
        filteredTransactions = filteredTransactions.filter(tx => tx.timestamp > newestProcessedTimestamp);
        const countAfter = filteredTransactions.length;
        logger.debug(`Filtered by newestProcessedTimestamp (${newestProcessedTimestamp}): ${countBefore} -> ${countAfter} transactions.`);
    } else {
        logger.debug('No newestProcessedTimestamp provided or stopAtSignature present, skipping timestamp filter.');
    }
    
    // --- Until Timestamp Filtering ---
    if (untilTimestamp !== undefined) {
        const countBefore = filteredTransactions.length;
        // Inclusive boundary to avoid dropping equal-timestamp siblings
        filteredTransactions = filteredTransactions.filter(tx => tx.timestamp <= untilTimestamp);
        const countAfter = filteredTransactions.length;
        logger.debug(`Filtered by untilTimestamp (${untilTimestamp}): ${countBefore} -> ${countAfter} transactions.`);
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

    // --- DEBUG TRACE: write trace file if any tracked ---
    try {
      if (HELIUS_CONFIG.DEBUG_TRACE_TO_FILE && Object.keys(trace).length > 0) {
        const outDir = path.resolve(HELIUS_CONFIG.LEGIT_MISSING_OUTPUT_DIR || 'debug_output');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const filePath = path.join(outDir, `trace-${address}-${ts}.json`);
        fs.writeFileSync(filePath, JSON.stringify({ address, trace }, null, 2), 'utf-8');
        logger.info(`Wrote trace diagnostics to ${filePath}`);
      }
    } catch (e) {
      logger.warn('Failed to write trace diagnostics file.', { error: this.sanitizeError(e) });
    }

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
          const { code, message } = response.data.error;
          const rpcError = new Error(`RPC Error for ${method}: ${message}`);
          (rpcError as any).code = code;
          throw rpcError;
        }
        this.lastRequestTime = Date.now(); // Update last request time on successful call
        return response.data.result;
      } catch (error) {
        retries++;
        const sanitizedError = this.sanitizeError(error);

        if (!this.isRetryableError(error) || retries >= MAX_RETRIES) {
           logger.error(
            `All retries failed or non-retryable error for RPC method ${method}.`,
            { params, lastError: sanitizedError }
          );
          throw new Error(
            `Failed to execute RPC method ${method}: ${sanitizedError.message || 'Unknown RPC Error'}`
          );
        }
        
        const backoffTime = INITIAL_BACKOFF_MS * Math.pow(2, retries - 1); // Exponential backoff
        logger.warn(
          `Attempt ${retries}/${MAX_RETRIES} failed for RPC method ${method}. Retrying in ${backoffTime}ms...`,
          { params, error: sanitizedError }
        );
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
      // logger.info(`Successfully fetched multiple accounts for ${pubkeys.length} pubkeys.`);
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
   * @param dataSlice Optional data slice to limit the amount of account data returned (useful for lightweight checks).
   * @returns A promise resolving to the `GetTokenAccountsByOwnerResult` structure, containing token account details.
   * @throws Throws an error if the RPC call fails, if `ownerPubkey` is not provided, or for other issues.
   */
  public async getTokenAccountsByOwner(
    ownerPubkey: string,
    mintPubkey?: string, // Optional: if you only want accounts for a specific mint
    programId: string = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token Program ID
    commitment?: string,
    encoding: string = 'jsonParsed', // Default and recommended for token accounts
    dataSlice?: { offset: number; length: number } // Optional: for lightweight checks
  ): Promise<GetTokenAccountsByOwnerResult> {
    if (!ownerPubkey) {
      throw new Error('ownerPubkey is required for get.TokenAccountsByOwner.');
    }

    const programFilter = mintPubkey ? { mint: mintPubkey } : { programId };
    const params: any[] = [ownerPubkey, programFilter];

    const options: { commitment?: string; encoding?: string; dataSlice?: { offset: number; length: number } } = {};
    if (commitment) {
      options.commitment = commitment;
    }
    options.encoding = encoding; // Always include encoding, defaults to jsonParsed
    if (dataSlice) {
      options.dataSlice = dataSlice; // Include dataSlice if provided for lightweight checks
    }

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
