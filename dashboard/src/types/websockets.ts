/**
 * WebSocket event data structures.
 * These types are based on the interfaces defined in the backend's
 * `job-progress.gateway.ts` to ensure type safety between client and server.
 */

export interface JobProgressData {
  jobId: string;
  progress: number;
  status?: string;
  timestamp: number;
  queue: string;
}

export interface JobCompletionData {
  jobId: string;
  result: JobResult;  // The complete job result wrapper
  timestamp: number;
  queue: string;
  processingTime: number;
  enrichmentJobId?: string;
}

export interface JobFailedData {
  jobId: string;
  failedReason: string;
  queue: string;
  error: string;
  timestamp: number;
  attemptsMade?: number;
  maxAttempts?: number;
}

/**
 * Unified job result structure.
 * This is the standard structure returned by all job processors.
 * The actual analysis data is in the `data` property.
 */
export interface JobResult {
  success: boolean;
  data: any;  // The actual analysis data (e.g., SimilarityAnalysisResult)
  requestId?: string;
  timestamp: number;
  processingTimeMs?: number;
  enrichmentJobId?: string;
  metadata?: {
    requestedWallets?: number;
    processedWallets?: number;
    failedWallets?: number;
    invalidWallets?: string[];
    systemWallets?: string[];
    successRate?: number;
    processingTimeMs?: number;
  };
}

/**
 * The enrichment completion event is a specialized 'job-completed' event.
 * The 'result' property contains the payload we care about.
 */
export interface EnrichmentCompletionData {
  requestId: string;
  enrichedBalances: Record<string, any>;
  timestamp: number;
}

/**
 * Enrichment error event structure
 */
export interface EnrichmentErrorData {
  requestId: string;
  error: string;
  timestamp: number;
} 