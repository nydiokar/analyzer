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
  const [completedJobs, setCompletedJobs] = useState<Set<string>>(new Set());
  const jobSocketDebug = process.env.NEXT_PUBLIC_JOB_SOCKET_DEBUG === 'true';
  const debugStatsRef = useRef<Map<string, DebugJobStats>>(new Map());
  const activeJobIdsRef = useRef<Set<string>>(new Set());

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
    async (jobId: string): Promise<any | null> => {
      try {
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
  const handleJobCompletedFromHttp = useCallback((job: JobStatusResponseDto) => {
    // Prevent duplicate processing
    if (completedJobs.has(job.id)) {
      return;
    }
    
    setCompletedJobs(prev => new Set(prev).add(job.id));
    
    const completionData: JobCompletionData = {
      jobId: job.id,
      queue: job.queue,
      result: job.result,
      timestamp: job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now(),
      processingTime: (job.finishedAt && job.processedAt)
        ? new Date(job.finishedAt).getTime() - new Date(job.processedAt).getTime()
        : 0,
      enrichmentJobId: job.result?.enrichmentJobId,
    };

    if (job.queue === 'enrichment-operations' && job.result) {
      // Transform JobResult to EnrichmentCompletionData
      const resultData = job.result as { enrichedBalances?: unknown; data?: unknown };
      const enrichmentData: EnrichmentCompletionData = {
        requestId: job.id,
        enrichedBalances: resultData.enrichedBalances || resultData.data || {},
        timestamp: job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now(),
      };
      callbacksRef.current.onEnrichmentComplete?.(enrichmentData);
    } else {
      callbacksRef.current.onJobCompleted?.(completionData);
    }
  }, [callbacksRef, completedJobs]);

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
    // Use the backend URL directly - no proxy needed
    const baseUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'https://sova-intel.duckdns.org';
    const forceNewSocket = (process.env.NEXT_PUBLIC_SOCKET_FORCE_NEW === 'true');

    const transportsEnv = (process.env.NEXT_PUBLIC_SOCKET_TRANSPORTS || 'polling,websocket') as string;
    const transports = transportsEnv
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t === 'polling' || t === 'websocket');
    const upgrade = process.env.NEXT_PUBLIC_SOCKET_UPGRADE !== 'false';
    const includeNonce = process.env.NEXT_PUBLIC_SOCKET_NONCE === 'true';
    const query = includeNonce ? { nonce: Date.now().toString(36) } : undefined;

    const newSocket = io(`${baseUrl}`, {
      autoConnect: true,
      path: "/socket.io/",
      transports,
      upgrade,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 20000, // 20 second timeout
      forceNew: forceNewSocket, // Allow forcing a fresh Manager via env flag when debugging sticky sessions
      query,
    });

    const handleConnect = () => {
      console.log('✅ WebSocket connected');
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
      incrementDebugCounter(data.jobId, 'completed', { dedupSkipped: completedJobs.has(data.jobId) });
      if (completedJobs.has(data.jobId)) {
        return; 
      }
      setCompletedJobs(prev => new Set(prev).add(data.jobId));

      const processCompletion = async () => {
        let resolvedResult = data.result;
        const pointerKey = getResultPointerKey(resolvedResult);
        const requiresHydration =
          data.queue === 'similarity-operations' && (!resolvedResult || pointerKey !== null);
        if (requiresHydration) {
          debugLog('hydrate-job-result', { jobId: data.jobId, pointerKey });
          const hydrated = await hydrateJobResult(data.jobId);
          if (hydrated) {
            resolvedResult = hydrated;
            debugLog('hydrate-job-result-success', { jobId: data.jobId });
          } else {
            debugLog('hydrate-job-result-miss', { jobId: data.jobId });
          }
        }

        if (data.queue === 'similarity-operations' && !resolvedResult) {
          console.warn(
            `[JobBridgeClient] Similarity completion ${data.jobId} missing result payload even after hydration`
          );
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
      incrementDebugCounter(data.jobId, 'progress', { status: data.status, progress: data.progress });
      callbacksRef.current.onJobProgress?.(data);
    };

    const handleJobFailed = (data: JobFailedData) => {
      incrementDebugCounter(data.jobId, 'failed', { error: data.error });
      console.error('❌ Job failed (WebSocket):', data.jobId, data.error);
      if (data.queue === 'enrichment-operations' && callbacksRef.current.onEnrichmentError) {
        callbacksRef.current.onEnrichmentError?.({ requestId: data.jobId, error: data.error });
      } else {
        callbacksRef.current.onJobFailed?.(data);
      }
    };

    const handleJobQueueToStart = (data: JobQueueToStartData) => {
      incrementDebugCounter(data.jobId, 'queueToStart', { queue: data.queue, queueToStartTime: data.queueToStartTime });
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
  }, [debugLog, incrementDebugCounter, hydrateJobResult]);

  // Main function to subscribe to a job's progress.
  const subscribeToJob = useCallback(async (jobId: string) => {
    // Don't clear completed jobs when subscribing to new jobs
    // This prevents duplicate processing of job completion events
    // setCompletedJobs(new Set()); // ❌ REMOVED: This was causing duplicate events

    // Subscribe to WebSocket to catch live events.
    if (socket?.connected) {
      console.log(`🔔 Subscribing to WebSocket for job: ${jobId}`);
      debugLog('job-subscribe', { jobId });
      socket.emit('subscribe-to-job', { jobId });
      activeJobIdsRef.current.add(jobId);
      incrementDebugCounter(jobId, 'subscribe', { socketConnected: true });
      // That's it! WebSocket will handle all updates (progress, completion, failure)
      // No HTTP polling needed - avoids browser connection limits
    } else {
      console.warn(`⚠️ WebSocket not connected for job ${jobId}. Falling back to HTTP polling.`);
      incrementDebugCounter(jobId, 'httpFallbacks', { socketConnected: false });
      // Fallback: If WebSocket is not connected, poll via HTTP
      try {
        const job: JobStatusResponseDto = await fetcher(`/jobs/${jobId}`);
        if (job) {
          if (job.status === 'completed') {
            handleJobCompletedFromHttp(job);
          } else if (job.status === 'failed') {
            handleJobFailedFromHttp(job);
          } else {
            // Job is still running but no WebSocket - user needs to refresh or check connection
            console.warn(`Job ${jobId} is ${job.status} but WebSocket is disconnected. Updates won't be received.`);
          }
        }
      } catch (error: unknown) {
        const apiError = error as ApiError;
        if (apiError.status !== 404) {
          console.error(`Error polling job status for ${jobId}:`, error);
          toast({
            title: 'Could not get job status',
            description: 'Network error: Unable to connect to the server. Please check your connection.',
            variant: 'destructive',
          });
        }
      }
    }
  }, [socket, handleJobCompletedFromHttp, handleJobFailedFromHttp, incrementDebugCounter, debugLog]);

  const unsubscribeFromJob = useCallback((jobId: string) => {
    if (socket?.connected) {
      console.log(`🔕 Unsubscribing from job: ${jobId}`);
      debugLog('job-unsubscribe', { jobId });
      socket.emit('unsubscribe-from-job', { jobId });
      activeJobIdsRef.current.delete(jobId);
      incrementDebugCounter(jobId, 'unsubscribe');
    }
  }, [socket, incrementDebugCounter, debugLog]);

  const cleanup = useCallback(() => {
    if (socket) {
      socket.disconnect();
    }
    // Clear completed jobs on cleanup
    setCompletedJobs(new Set());
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
