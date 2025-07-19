import { io, Socket } from 'socket.io-client';
import { useCallback, useEffect, useState, useRef } from 'react';
import { toast } from './use-toast';
import { fetcher } from '@/lib/fetcher';
import { JobStatusResponseDto } from '@/types/api';
import {
  JobCompletionData,
  JobProgressData,
  JobFailedData,
  EnrichmentCompletionData
} from '@/types/websockets';

export interface UseJobProgressCallbacks {
  onJobProgress: (data: JobProgressData) => void;
  onJobCompleted: (data: JobCompletionData) => void;
  onJobFailed: (data: JobFailedData) => void;
  onEnrichmentComplete: (data: EnrichmentCompletionData) => void;
  onEnrichmentError?: (data: { requestId: string; error: string }) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export const useJobProgress = (callbacks: UseJobProgressCallbacks) => {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  // This handler processes job completion data from the initial HTTP poll.
  const handleJobCompletedFromHttp = useCallback((job: JobStatusResponseDto) => {
    console.log('📢 Job completed (polled) - JobId:', job.id);
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
      const enrichmentData: EnrichmentCompletionData = {
        requestId: job.id,
        enrichedBalances: (job.result as any).enrichedBalances || job.result.data,
        timestamp: job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now(),
      };
      callbacksRef.current.onEnrichmentComplete?.(enrichmentData);
    } else {
      callbacksRef.current.onJobCompleted?.(completionData);
    }
  }, [callbacksRef]);

  // This handler processes job failure data from the initial HTTP poll.
  const handleJobFailedFromHttp = useCallback((job: JobStatusResponseDto) => {
    console.error('❌ Job failed (polled):', job.id, job.error);
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
    const baseUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'http://localhost:3001';
    const newSocket = io(`${baseUrl}/job-progress`, {
      autoConnect: true,
      transports: ['websocket'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    const handleConnect = () => {
      console.log('✅ WebSocket connected');
      setIsConnected(true);
      setError(null);
      callbacksRef.current.onConnectionChange?.(true);
    };

    const handleDisconnect = (reason: string) => {
      console.log('🔌 WebSocket disconnected:', reason);
      setIsConnected(false);
      callbacksRef.current.onConnectionChange?.(false);
    };

    const handleError = (error: any) => {
      console.error('🔌 WebSocket error:', error);
      setError(error.message || 'WebSocket error');
    };

    // This handler processes job completion events from the live WebSocket connection.
    const handleJobCompleted = (data: JobCompletionData) => {
      console.log('📢 Job completed (WebSocket) - JobId:', data.jobId);
      if (data.queue === 'enrichment-operations' && data.result) {
        // Transform JobResult to EnrichmentCompletionData
        const enrichmentData: EnrichmentCompletionData = {
          requestId: data.jobId,
          enrichedBalances: (data.result as any).enrichedBalances || data.result.data,
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

    newSocket.on('connect', handleConnect);
    newSocket.on('disconnect', handleDisconnect);
    newSocket.on('connect_error', handleError);
    newSocket.on('job-progress', handleJobProgress);
    newSocket.on('job-completed', handleJobCompleted);
    newSocket.on('job-failed', handleJobFailed);

    setSocket(newSocket);

    return () => {
      newSocket.off('connect', handleConnect);
      newSocket.off('disconnect', handleDisconnect);
      newSocket.off('connect_error', handleError);
      newSocket.off('job-progress', handleJobProgress);
      newSocket.off('job-completed', handleJobCompleted);
      newSocket.off('job-failed', handleJobFailed);
      newSocket.disconnect();
    };
  }, []);

  // Main function to subscribe to a job's progress.
  const subscribeToJob = useCallback(async (jobId: string) => {
    // 1. Subscribe to WebSocket to catch live events.
    if (socket?.connected) {
      console.log(`🔔 Subscribing to WebSocket for job: ${jobId}`);
      socket.emit('subscribe-to-job', { jobId });
    } else {
      console.warn(`⚠️ Cannot subscribe to WebSocket for job ${jobId} - socket not connected.`);
    }

    // 2. Poll via HTTP to get the *current* state, solving the race condition.
    try {
      console.log(`🔍 Polling initial status for job: ${jobId}`);
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
    } catch (error: any) {
      if (error.status !== 404) {
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
  }, [socket]);

  return {
    subscribeToJob,
    unsubscribeFromJob,
    isConnected,
    error,
    cleanup
  };
};
