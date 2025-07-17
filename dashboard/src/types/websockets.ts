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
  result: any;
  timestamp: number;
  queue: string;
  processingTime: number;
  enrichmentJobId?: string;
}

export interface JobFailedData {
  jobId: string;
  error: string;
  failedReason?: string;
  timestamp: number;
  queue: string;
  attempts?: number;
  maxAttempts?: number;
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