import { io, Socket } from 'socket.io-client';
import { useCallback, useEffect, useState, useRef } from 'react';
import { toast } from './use-toast';
import { fetcher } from '@/lib/fetcher';
import { JobStatusResponseDto } from '@/types/api';
import {
  JobCompletionData,
  JobProgressData,
  JobFailedData,
  EnrichmentCompletionData,
  JobQueueToStartData
} from '@/types/websockets';
import { useAuthStore } from '@/store/auth-store';
import type { JobResult } from '@/types/websockets';

// Define proper error types
interface ApiError extends Error {
  status?: number;
  payload?: unknown;
}

interface NetworkError extends Error {
  status?: number;
  response?: Response;
}

export interface UseJobProgressCallbacks {
  onJobProgress: (data: JobProgressData) => void;
  onJobCompleted: (data: JobCompletionData) => void;
  onJobFailed: (data: JobFailedData) => void;
  onEnrichmentComplete: (data: EnrichmentCompletionData) => void;
  onEnrichmentError?: (data: { requestId: string; error: string }) => void;
  onConnectionChange?: (connected: boolean) => void;
  onJobQueueToStart?: (data: JobQueueToStartData) => void; // New callback for queue-to-start timing
}

type DebugJobStats = {
  progress: number;
  completed: number;
  failed: number;
  queueToStart: number;
  subscribe: number;
  unsubscribe: number;
  httpFallbacks: number;
};

const getResultPointerKey = (result: unknown): string | null => {
  if (!result || typeof result !== 'object') {
    return null;
  }
  const payload = result as Record<string, unknown>;
  const data = payload.data as Record<string, unknown> | undefined;
  const key = data?.resultKey;
  return typeof key === 'string' ? key : null;
};

export const useJobProgress = (callbacks: UseJobProgressCallbacks) => {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const completedJobsRef = useRef<Set<string>>(new Set());
  const jobSocketDebug = process.env.NEXT_PUBLIC_JOB_SOCKET_DEBUG === 'true';
  const debugStatsRef = useRef<Map<string, DebugJobStats>>(new Map());
  const activeJobIdsRef = useRef<Set<string>>(new Set());
  const normalizeJobId = useCallback((jobId: string | number | undefined | null): string => String(jobId ?? ''), []);

  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  const debugLog = useCallback(
    (message: string, payload?: Record<string, unknown>) => {
      if (!jobSocketDebug) {
        return;
      }
      console.debug(`[JobBridgeClient] ${message}`, payload ?? {});
    },
    [jobSocketDebug]
  );

  const incrementDebugCounter = useCallback(
    (jobId: string | undefined, key: keyof DebugJobStats, extra?: Record<string, unknown>) => {
      if (!jobSocketDebug || !jobId) {
        return;
      }
      const stats =
        debugStatsRef.current.get(jobId) ?? {
          progress: 0,
          completed: 0,
          failed: 0,
          queueToStart: 0,
          subscribe: 0,
          unsubscribe: 0,
          httpFallbacks: 0,
        };
      stats[key]++;
      debugStatsRef.current.set(jobId, stats);
      debugLog(`event:${key}`, {
        jobId,
        stats,
        activeJobs: Array.from(activeJobIdsRef.current.values()),
        ...extra,
      });
    },
    [jobSocketDebug, debugLog]
  );

  const hydrateJobResult = useCallback(
    async (jobId: string, resultKey?: string | null): Promise<any | null> => {
      try {
        // Fast path: if we already have the resultKey from the WebSocket event,
        // use the lightweight by-key endpoint (1 Redis read, no BullMQ job lookup).
        if (resultKey) {
          const data = await fetcher(`/jobs/result/by-key?key=${encodeURIComponent(resultKey)}`);
          return data ?? null;
        }
        // Slow path: fetch via jobId (2 Redis reads — BullMQ lookup + key resolve).
        const response = await fetcher(`/jobs/${jobId}/result`);
        return response?.result ?? null;
      } catch (fetchError) {
        console.error(`Failed to hydrate job result for ${jobId}`, fetchError);
        return null;
      }
    },
    []
  );

  // This handler processes job completion data from the initial HTTP poll.
  const handleJobCompletedFromHttp = useCallback(async (job: JobStatusResponseDto) => {
    // Prevent duplicate processing
    if (completedJobsRef.current.has(job.id)) {
      return;
    }

    completedJobsRef.current.add(job.id);

    // Similarity and holder-profiles jobs store large payloads in Redis behind a pointer key.
    // The /jobs/:id status endpoint returns the raw returnvalue (with resultKey),
    // so we hydrate via the by-key endpoint (1 Redis read, no BullMQ lookup).
    let result = job.result;
    const pointerKey = getResultPointerKey(result);
    if (pointerKey) {
      const hydrated = await hydrateJobResult(job.id, pointerKey);
      if (hydrated) {
        if (job.queue === 'analysis-operations') {
          // Holder-profiles: Redis value IS the full HolderProfilesResult — don't wrap.
          result = hydrated;
        } else {
          // Similarity: wrap into JobResult shape.
          const existing = result && typeof result === 'object' ? (result as JobResult) : undefined;
          result = {
            success: existing?.success ?? true,
            timestamp: existing?.timestamp ?? Date.now(),
            data: hydrated,
            requestId: existing?.requestId,
            processingTimeMs: existing?.processingTimeMs,
            enrichmentJobId: existing?.enrichmentJobId,
          } as JobResult;
        }
      }
    }

    if (job.queue === 'similarity-operations' && !result) {
      const hydrated = await hydrateJobResult(job.id);
      if (hydrated) {
        result = {
          success: true,
          timestamp: Date.now(),
          data: hydrated,
        } as JobResult;
      }
    }

    const completionData: JobCompletionData = {
      jobId: job.id,
      queue: job.queue,
      result,
      timestamp: job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now(),
      processingTime: (job.finishedAt && job.processedAt)
        ? new Date(job.finishedAt).getTime() - new Date(job.processedAt).getTime()
        : 0,
      enrichmentJobId: result?.enrichmentJobId,
    };

    if (job.queue === 'enrichment-operations' && result) {
      // Transform JobResult to EnrichmentCompletionData
      const resultData = result as { enrichedBalances?: unknown; data?: unknown };
      const enrichmentData: EnrichmentCompletionData = {
        requestId: job.id,
        enrichedBalances: resultData.enrichedBalances || resultData.data || {},
        timestamp: job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now(),
      };
      callbacksRef.current.onEnrichmentComplete?.(enrichmentData);
    } else {
      callbacksRef.current.onJobCompleted?.(completionData);
    }
  }, [callbacksRef, hydrateJobResult]);

  // This handler processes job failure data from the initial HTTP poll.
  const handleJobFailedFromHttp = useCallback((job: JobStatusResponseDto) => {
    const failureData: JobFailedData = {
      jobId: job.id,
      failedReason: job.error ?? 'Unknown error',
      queue: job.queue,
      error: job.error ?? 'Unknown error',
      timestamp: job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now(),
    };
    if (job.queue === 'enrichment-operations' && callbacksRef.current.onEnrichmentError) {
      callbacksRef.current.onEnrichmentError?.({ requestId: job.id, error: failureData.error });
    } else {
      callbacksRef.current.onJobFailed?.(failureData);
    }
  }, [callbacksRef]);

  useEffect(() => {
    // Get user from auth store for room-based WebSocket subscription
    const user = useAuthStore.getState().user;
    const userId = user?.id;

    const baseUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || '';
    const forceNewSocket = (process.env.NEXT_PUBLIC_SOCKET_FORCE_NEW === 'true');

    const transportsEnv = (process.env.NEXT_PUBLIC_SOCKET_TRANSPORTS || 'polling,websocket') as string;
    const transports = transportsEnv
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t === 'polling' || t === 'websocket');
    const upgrade = process.env.NEXT_PUBLIC_SOCKET_UPGRADE !== 'false';
    const includeNonce = process.env.NEXT_PUBLIC_SOCKET_NONCE === 'true';
    const query = includeNonce ? { nonce: Date.now().toString(36) } : undefined;

    const newSocket = io(`${baseUrl}/jobs`, {
      autoConnect: true,
      transports,
      upgrade,
      reconnectionAttempts: Infinity, // Never give up reconnecting
      reconnectionDelay: 1000, // Start with 1 second
      reconnectionDelayMax: 10000, // Max 10 seconds between attempts
      timeout: 20000, // 20 second timeout
      forceNew: forceNewSocket, // Allow forcing a fresh Manager via env flag when debugging sticky sessions
      query,
      auth: {
        userId // Pass userId for user-scoped room join
      },
    });

    const handleConnect = () => {
      console.log('✅ WebSocket connected successfully');
      debugLog('socket-connected', { socketId: newSocket.id });
      setIsConnected(true);
      setError(null);
      callbacksRef.current.onConnectionChange?.(true);
    };

    const handleDisconnect = (reason: string) => {
      console.log('🔌 WebSocket disconnected:', reason);
      debugLog('socket-disconnected', { reason });
      setIsConnected(false);
      callbacksRef.current.onConnectionChange?.(false);

      // Log reconnection strategy
      if (reason === 'io server disconnect') {
        console.log('⚠️  Server disconnected the socket. Will attempt to reconnect...');
      } else if (reason === 'transport close' || reason === 'transport error') {
        console.log('🔄 Connection lost. Attempting to reconnect...');
      }
    };

    const handleReconnectAttempt = (attemptNumber: number) => {
      console.log(`🔄 Reconnection attempt #${attemptNumber}...`);
    };

    const handleReconnect = (attemptNumber: number) => {
      console.log(`✅ Successfully reconnected after ${attemptNumber} attempt(s)`);
    };

    const handleReconnectFailed = () => {
      console.error('❌ All reconnection attempts failed');
    };

    const handleError = (error: Error) => {
      console.error('🔌 WebSocket error:', error);
      setError(error.message || 'WebSocket error');
    };

    const handleConnectError = (error: Error) => {
      console.error('🔌 WebSocket connection error:', error);
      setError(`Connection failed: ${error.message || 'Unknown error'}`);
    };

    const handleJobCompleted = (data: JobCompletionData) => {
      const normalizedJobId = normalizeJobId(data.jobId as unknown as string);
      if (!normalizedJobId || !activeJobIdsRef.current.has(normalizedJobId)) {
        debugLog('job-completed-ignored-untracked', { jobId: data.jobId, normalizedJobId, queue: data.queue });
        return;
      }
      incrementDebugCounter(normalizedJobId, 'completed', { dedupSkipped: completedJobsRef.current.has(normalizedJobId) });
      if (completedJobsRef.current.has(normalizedJobId)) {
        return; 
      }
      completedJobsRef.current.add(normalizedJobId);

      const processCompletion = async () => {
        let resolvedResult = data.result;
        const pointerKey = getResultPointerKey(resolvedResult);
        // Hydrate when the result contains a pointer (resultKey).
        // Works for both similarity-operations and analysis-operations (holder-profiles) jobs.
        const requiresHydration = pointerKey !== null;
        if (requiresHydration) {
          debugLog('hydrate-job-result', { jobId: data.jobId, pointerKey });
          // Pass the resultKey so the fast 1-read path is used (skips BullMQ lookup).
        const hydrated = await hydrateJobResult(normalizedJobId, pointerKey);
          if (hydrated) {
            if (data.queue === 'analysis-operations') {
              // Holder-profiles: the Redis value IS the full HolderProfilesResult (profiles at top level).
              // The page reads data.result directly as HolderProfilesResult — don't wrap it.
              resolvedResult = hydrated;
            } else {
              // Similarity: wrap into JobResult shape so data.result.data is the similarity payload.
              const existingResult =
                resolvedResult && typeof resolvedResult === 'object'
                  ? (resolvedResult as JobResult)
                  : undefined;
              const hydratedResult: JobResult = {
                success: existingResult?.success ?? true,
                timestamp: existingResult?.timestamp ?? Date.now(),
                data: hydrated,
                requestId: existingResult?.requestId,
                processingTimeMs: existingResult?.processingTimeMs,
                enrichmentJobId: existingResult?.enrichmentJobId,
                analysisScope: existingResult?.analysisScope,
                triggerSource: existingResult?.triggerSource,
                historyWindowDays: existingResult?.historyWindowDays ?? null,
                targetSignatureCount: existingResult?.targetSignatureCount,
                signaturesConsidered: existingResult?.signaturesConsidered,
                timeRange: existingResult?.timeRange,
                followUpJobsQueued: existingResult?.followUpJobsQueued,
                metadata: existingResult?.metadata,
              };
              resolvedResult = hydratedResult;
            }
          debugLog('hydrate-job-result-success', { jobId: normalizedJobId });
        } else {
          debugLog('hydrate-job-result-miss', { jobId: normalizedJobId });
        }
      }

        if (data.queue === 'similarity-operations' && !resolvedResult) {
          const hydrated = await hydrateJobResult(normalizedJobId);
          if (hydrated) {
            resolvedResult = {
              success: true,
              timestamp: Date.now(),
              data: hydrated,
            } as JobResult;
          } else {
            console.warn(
              `[JobBridgeClient] Similarity completion ${data.jobId} missing result payload even after hydration`
            );
          }
        }

        const finalData: JobCompletionData = {
          ...data,
          result: resolvedResult,
        };
        
        if (finalData.queue === 'enrichment-operations') {
          const enrichmentData: EnrichmentCompletionData = {
            requestId: finalData.jobId,
            enrichedBalances:
              (finalData.result as { enrichedBalances?: unknown; data?: unknown })?.enrichedBalances ||
              (finalData.result as { data?: unknown })?.data ||
              {},
            timestamp: finalData.timestamp,
          };
          callbacksRef.current.onEnrichmentComplete?.(enrichmentData);
        } else {
          callbacksRef.current.onJobCompleted?.(finalData);
        }
      };

      void processCompletion();
    };

    const handleJobProgress = (data: JobProgressData) => {
      const normalizedJobId = normalizeJobId(data.jobId as unknown as string);
      if (!normalizedJobId || !activeJobIdsRef.current.has(normalizedJobId)) {
        return;
      }
      incrementDebugCounter(normalizedJobId, 'progress', { status: data.status, progress: data.progress });
      callbacksRef.current.onJobProgress?.(data);
    };

    const handleJobFailed = (data: JobFailedData) => {
      const normalizedJobId = normalizeJobId(data.jobId as unknown as string);
      if (!normalizedJobId || !activeJobIdsRef.current.has(normalizedJobId)) {
        return;
      }
      incrementDebugCounter(normalizedJobId, 'failed', { error: data.error });
      const isLockConflict = data.error?.includes('already in progress');
      if (isLockConflict) {
        console.warn('⚠️ Job deduplicated (already running):', data.jobId);
      } else {
        console.error('❌ Job failed (WebSocket):', data.jobId, data.error);
      }
      if (data.queue === 'enrichment-operations' && callbacksRef.current.onEnrichmentError) {
        callbacksRef.current.onEnrichmentError?.({ requestId: data.jobId, error: data.error });
      } else {
        callbacksRef.current.onJobFailed?.(data);
      }
    };

    const handleJobQueueToStart = (data: JobQueueToStartData) => {
      const normalizedJobId = normalizeJobId(data.jobId as unknown as string);
      if (!normalizedJobId || !activeJobIdsRef.current.has(normalizedJobId)) {
        return;
      }
      incrementDebugCounter(normalizedJobId, 'queueToStart', { queue: data.queue, queueToStartTime: data.queueToStartTime });
      // console.log('🚀 Job started processing (WebSocket):', data.jobId, 'Queue time:', data.queueToStartTime + 'ms');
      callbacksRef.current.onJobQueueToStart?.(data);
    };

    const getListenerCount = (eventName: string) => {
      const socketAny = newSocket as unknown as { listeners?: (event: string) => unknown[] };
      try {
        if (typeof socketAny?.listeners === 'function') {
          const listeners = socketAny.listeners(eventName);
          return Array.isArray(listeners) ? listeners.length : undefined;
        }
      } catch (listenerError) {
        debugLog('listener-count-error', { event: eventName, error: (listenerError as Error).message });
      }
      return undefined;
    };

    newSocket.on('connect', handleConnect);
    newSocket.on('disconnect', handleDisconnect);
    newSocket.on('connect_error', handleConnectError);
    newSocket.on('reconnect_attempt', handleReconnectAttempt);
    newSocket.on('reconnect', handleReconnect);
    newSocket.on('reconnect_failed', handleReconnectFailed);
    newSocket.on('job-progress', handleJobProgress);
    newSocket.on('job-completed', handleJobCompleted);
    newSocket.on('job-failed', handleJobFailed);
    newSocket.on('job-queue-to-start', handleJobQueueToStart);
    debugLog('handlers-registered', {
      progressHandlers: getListenerCount('job-progress') ?? 1,
      completedHandlers: getListenerCount('job-completed') ?? 1,
      failedHandlers: getListenerCount('job-failed') ?? 1,
      queueToStartHandlers: getListenerCount('job-queue-to-start') ?? 1,
    });

    setSocket(newSocket);

    return () => {
      newSocket.off('connect', handleConnect);
      newSocket.off('disconnect', handleDisconnect);
      newSocket.off('connect_error', handleConnectError);
      newSocket.off('reconnect_attempt', handleReconnectAttempt);
      newSocket.off('reconnect', handleReconnect);
      newSocket.off('reconnect_failed', handleReconnectFailed);
      newSocket.off('job-progress', handleJobProgress);
      newSocket.off('job-completed', handleJobCompleted);
      newSocket.off('job-failed', handleJobFailed);
      newSocket.off('job-queue-to-start', handleJobQueueToStart);
      debugLog('handlers-removed', {
        progressHandlers: getListenerCount('job-progress') ?? 0,
        completedHandlers: getListenerCount('job-completed') ?? 0,
        failedHandlers: getListenerCount('job-failed') ?? 0,
        queueToStartHandlers: getListenerCount('job-queue-to-start') ?? 0,
      });
      newSocket.disconnect();
    };
  }, [debugLog, incrementDebugCounter, hydrateJobResult, normalizeJobId]);

  // Main function to subscribe to a job's progress.
  const subscribeToJob = useCallback(async (jobId: string) => {
    const normalizedJobId = normalizeJobId(jobId);
    if (!normalizedJobId) {
      return;
    }
    // Track active job for debugging/monitoring purposes
    //
    // IMPORTANT: No per-job WebSocket subscription is needed because the backend uses
    // user-scoped room broadcasting. When the WebSocket connects, the client automatically
    // joins a room (user-{userId}) and receives ALL job events for that user.
    //
    // Previously, this code emitted 'subscribe-to-job' events, but the backend has NO handler
    // for these events - they were legacy code from an old per-job subscription system.
    // The room-based system is simpler and prevents race conditions where jobs complete
    // before the frontend can register individual subscriptions.
    const wasAlreadyTracked = activeJobIdsRef.current.has(normalizedJobId);
    if (!wasAlreadyTracked) {
      activeJobIdsRef.current.add(normalizedJobId);
      console.log(`📋 Tracking job: ${normalizedJobId} (auto-broadcast via user room)`);
      debugLog('job-track', { jobId: normalizedJobId, roomBased: true });
    } else {
      debugLog('job-track-skip-already-active', { jobId: normalizedJobId, roomBased: true });
    }
    const socketConnected = !!socket?.connected;
    incrementDebugCounter(normalizedJobId, 'subscribe', { socketConnected });
    incrementDebugCounter(normalizedJobId, 'httpFallbacks', { socketConnected });

    try {
      const trackedJob: JobStatusResponseDto = await fetcher(`/jobs/${normalizedJobId}`);
      if (trackedJob?.status === 'completed') {
        debugLog('job-track-immediate-complete', { jobId: normalizedJobId, status: trackedJob.status });
        await handleJobCompletedFromHttp(trackedJob);
      } else if (trackedJob?.status === 'failed') {
        debugLog('job-track-immediate-fail', { jobId: normalizedJobId, status: trackedJob.status });
        handleJobFailedFromHttp(trackedJob);
      }
    } catch (error: unknown) {
      const apiError = error as ApiError;
      if (apiError.status !== 404) {
        console.error(`Error checking immediate job status for ${normalizedJobId}:`, error);
      }
    }

    // If WebSocket is not connected, poll via HTTP as fallback
    if (!socket?.connected) {
      console.warn(`⚠️ WebSocket not connected for job ${jobId}. Falling back to HTTP polling.`);
      incrementDebugCounter(jobId, 'httpFallbacks', { socketConnected: false });

      try {
        const job: JobStatusResponseDto = await fetcher(`/jobs/${normalizedJobId}`);
        if (job) {
          if (job.status === 'completed') {
            handleJobCompletedFromHttp(job);
          } else if (job.status === 'failed') {
            handleJobFailedFromHttp(job);
          } else {
            // Job is still running but no WebSocket - user needs to refresh or check connection
            console.warn(`Job ${normalizedJobId} is ${job.status} but WebSocket is disconnected. Updates won't be received.`);
          }
        }
      } catch (error: unknown) {
        const apiError = error as ApiError;
        if (apiError.status === 404) {
          console.warn(`Job ${normalizedJobId} not found - may have already completed or never existed`);
        } else if (apiError.status !== 404) {
          console.error(`Error polling job status for ${normalizedJobId}:`, error);
          toast({
            title: 'Could not get job status',
            description: 'Network error: Unable to connect to the server. Please check your connection.',
            variant: 'destructive',
          });
        }
      }
    }
  }, [socket, handleJobCompletedFromHttp, handleJobFailedFromHttp, incrementDebugCounter, debugLog, normalizeJobId]);

  const unsubscribeFromJob = useCallback((jobId: string) => {
    const normalizedJobId = normalizeJobId(jobId);
    if (!normalizedJobId) {
      return;
    }
    // Remove from active tracking
    //
    // NOTE: Like subscribe, this does NOT emit any WebSocket events. Previously emitted
    // 'unsubscribe-from-job' which had no backend handler. The room-based system means
    // we simply stop tracking this jobId locally - the server continues broadcasting
    // all events to the user room, but we ignore events for jobs not in activeJobIdsRef.
    const removed = activeJobIdsRef.current.delete(normalizedJobId);
    if (!removed) {
      debugLog('job-untrack-skip-not-active', { jobId: normalizedJobId, roomBased: true });
      return;
    }
    incrementDebugCounter(normalizedJobId, 'unsubscribe');

    console.log(`📋 Stopped tracking job: ${normalizedJobId}`);
    debugLog('job-untrack', { jobId: normalizedJobId, roomBased: true });
  }, [incrementDebugCounter, debugLog, normalizeJobId]);

  const cleanup = useCallback(() => {
    if (socket) {
      socket.disconnect();
    }
    // Clear completed jobs on cleanup
    completedJobsRef.current.clear();
    activeJobIdsRef.current.clear();
    debugStatsRef.current.clear();
    debugLog('cleanup', {});
  }, [socket, debugLog]);

  return {
    subscribeToJob,
    unsubscribeFromJob,
    isConnected,
    error,
    cleanup
  };
};
