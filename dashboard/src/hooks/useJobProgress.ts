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

export const useJobProgress = (callbacks: UseJobProgressCallbacks) => {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [completedJobs, setCompletedJobs] = useState<Set<string>>(new Set());

  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

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
    // Prefer explicit env; fall back to same-origin in dev
    const baseUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || '';
    const forceNewSocket = (process.env.NEXT_PUBLIC_SOCKET_FORCE_NEW === 'true');

    // In dev, avoid polling noise and upgrade confusion
    const transportsEnv = (process.env.NEXT_PUBLIC_SOCKET_TRANSPORTS || 'websocket') as string;
    const transports = transportsEnv
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t === 'polling' || t === 'websocket');
    const upgrade = process.env.NEXT_PUBLIC_SOCKET_UPGRADE !== 'false';
    const includeNonce = process.env.NEXT_PUBLIC_SOCKET_NONCE === 'true';
    const query = includeNonce ? { nonce: Date.now().toString(36) } : undefined;

    const newSocket = io(baseUrl, {
      autoConnect: true,
      path: "/socket.io/jobs",
      transports,
      upgrade,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 20000,
      forceNew: forceNewSocket,
      query,
    });

    const handleConnect = () => {
      console.log('✅ WebSocket connected to:', baseUrl);
      setIsConnected(true);
      setError(null);
      callbacksRef.current.onConnectionChange?.(true);
    };

    const handleDisconnect = (reason: string) => {
      console.log('🔌 WebSocket disconnected:', reason);
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
      if (completedJobs.has(data.jobId)) {
        return; 
      }
      setCompletedJobs(prev => new Set(prev).add(data.jobId));
      
      console.log('📢 Job completed (WebSocket):', data.jobId, 'Processing time:', data.processingTime);
      
      if (data.queue === 'enrichment-operations') {
        const enrichmentData: EnrichmentCompletionData = {
          requestId: data.jobId,
          enrichedBalances: (data.result as { enrichedBalances?: unknown; data?: unknown }).enrichedBalances || data.result.data || {},
          timestamp: data.timestamp,
        };
        callbacksRef.current.onEnrichmentComplete?.(enrichmentData);
      } else {
        callbacksRef.current.onJobCompleted?.(data);
      }
    };

    const handleJobProgress = (data: JobProgressData) => {
      callbacksRef.current.onJobProgress?.(data);
    };

    const handleJobFailed = (data: JobFailedData) => {
      console.error('❌ Job failed (WebSocket):', data.jobId, data.error);
      if (data.queue === 'enrichment-operations' && callbacksRef.current.onEnrichmentError) {
        callbacksRef.current.onEnrichmentError?.({ requestId: data.jobId, error: data.error });
      } else {
        callbacksRef.current.onJobFailed?.(data);
      }
    };

    const handleJobQueueToStart = (data: JobQueueToStartData) => {
      console.log('🚀 Job started processing (WebSocket):', data.jobId, 'Queue time:', data.queueToStartTime + 'ms');
      callbacksRef.current.onJobQueueToStart?.(data);
    };

    newSocket.on('connect', handleConnect);
    newSocket.on('disconnect', handleDisconnect);
    newSocket.on('connect_error', handleConnectError);
    newSocket.on('job-progress', handleJobProgress);
    newSocket.on('job-completed', handleJobCompleted);
    newSocket.on('job-failed', handleJobFailed);
    newSocket.on('job-queue-to-start', handleJobQueueToStart);

    setSocket(newSocket);

    return () => {
      newSocket.off('connect', handleConnect);
      newSocket.off('disconnect', handleDisconnect);
      newSocket.off('connect_error', handleConnectError);
      newSocket.off('job-progress', handleJobProgress);
      newSocket.off('job-completed', handleJobCompleted);
      newSocket.off('job-failed', handleJobFailed);
      newSocket.off('job-queue-to-start', handleJobQueueToStart);
      newSocket.disconnect();
    };
  }, []);

  // Main function to subscribe to a job's progress.
  const subscribeToJob = useCallback(async (jobId: string) => {
    // Don't clear completed jobs when subscribing to new jobs
    // This prevents duplicate processing of job completion events
    // setCompletedJobs(new Set()); // ❌ REMOVED: This was causing duplicate events
    
    // 1. Subscribe to WebSocket to catch live events.
    if (socket?.connected) {
      console.log(`🔔 Subscribing to WebSocket for job: ${jobId}`);
      socket.emit('subscribe-to-job', { jobId });
    } else {
      console.warn(`⚠️ Cannot subscribe to WebSocket for job ${jobId} - socket not connected.`);
    }

    // 2. Poll via HTTP to get the *current* state, solving the race condition.
    try {
      const job: JobStatusResponseDto = await fetcher(`/jobs/${jobId}`);
      if (job) {
        // If the job is already finished, process it immediately.
        if (job.status === 'completed') {
          handleJobCompletedFromHttp(job);
        } else if (job.status === 'failed') {
          handleJobFailedFromHttp(job);
        }
        // If 'active' or 'waiting', the WebSocket listener will handle it from here.
      }
    } catch (error: unknown) {
      const apiError = error as ApiError;
      if (apiError.status !== 404) {
        console.error(`Error polling job status for ${jobId}:`, error);
        toast({
          title: 'Could not get job status',
          description: `There was an error checking the status of job ${jobId}. Real-time updates may be affected.`,
          variant: 'destructive',
        });
      }
    }
  }, [socket, handleJobCompletedFromHttp, handleJobFailedFromHttp]);

  const unsubscribeFromJob = useCallback((jobId: string) => {
    if (socket?.connected) {
      console.log(`🔕 Unsubscribing from job: ${jobId}`);
      socket.emit('unsubscribe-from-job', { jobId });
    }
  }, [socket]);

  const cleanup = useCallback(() => {
    if (socket) {
      socket.disconnect();
    }
    // Clear completed jobs on cleanup
    setCompletedJobs(new Set());
  }, [socket]);

  return {
    subscribeToJob,
    unsubscribeFromJob,
    isConnected,
    error,
    cleanup
  };
};
