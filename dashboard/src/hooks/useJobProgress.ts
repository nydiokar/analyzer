import { io, Socket } from 'socket.io-client';
import { useCallback, useEffect, useState, useRef } from 'react';
import { toast } from './use-toast';
import { 
  JobCompletionData, 
  JobProgressData, 
  JobFailedData,
  EnrichmentCompletionData 
} from '@/types/websockets';

/**
 * Callbacks for the useJobProgress hook.
 */
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

  // Use a ref to store the latest callbacks
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  useEffect(() => {
    // Create socket
    const newSocket = io(process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'http://localhost:3001/job-progress', {
      autoConnect: true,
      transports: ['websocket'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    // Simple event handlers
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

    const handleJobCompleted = (data: any) => {
      console.log('📢 Job completed - RAW EVENT STRUCTURE:', JSON.stringify(data, null, 2));
      console.log('📢 Job completed - Queue:', data.queue);
      console.log('📢 Job completed - JobId:', data.jobId);
      console.log('📢 Job completed - Result structure:', data.result ? Object.keys(data.result) : 'No result');
      
      // Handle enrichment completion
      if (data.queue === 'enrichment-operations' && data.result) {
        callbacksRef.current.onEnrichmentComplete?.(data.result);
      } else {
        // Pass all job completion events to the main handler
        callbacksRef.current.onJobCompleted?.(data);
      }
    };

    const handleJobProgress = (data: JobProgressData) => {
      console.log('📊 Job progress event:', data.jobId, data.progress, data.queue);
      callbacksRef.current.onJobProgress?.(data);
    };

    const handleJobFailed = (data: JobFailedData) => {
      console.error('❌ Job failed:', data.jobId, data.error);
      if (data.queue === 'enrichment-operations' && callbacksRef.current.onEnrichmentError) {
        callbacksRef.current.onEnrichmentError?.({ requestId: data.jobId, error: data.error });
      } else {
        callbacksRef.current.onJobFailed?.(data);
      }
    };

    // Attach listeners
    newSocket.on('connect', handleConnect);
    newSocket.on('disconnect', handleDisconnect);
    newSocket.on('connect_error', handleError);
    newSocket.on('job-progress', handleJobProgress);
    newSocket.on('job-completed', handleJobCompleted);
    newSocket.on('job-failed', handleJobFailed);

    setSocket(newSocket);

    // Cleanup
    return () => {
      newSocket.off('connect', handleConnect);
      newSocket.off('disconnect', handleDisconnect);
      newSocket.off('connect_error', handleError);
      newSocket.off('job-progress', handleJobProgress);
      newSocket.off('job-completed', handleJobCompleted);
      newSocket.off('job-failed', handleJobFailed);
      newSocket.disconnect();
    };
  }, []); // Dependencies are intentionally empty to prevent re-connections on re-renders. Callbacks are accessed via a ref.

  const subscribeToJob = useCallback((jobId: string) => {
    if (socket?.connected) {
      console.log('🔔 Subscribing to job:', jobId);
      socket.emit('subscribe-to-job', { jobId });
    } else {
      console.warn('⚠️ Cannot subscribe - socket not connected');
    }
  }, [socket]);

  const unsubscribeFromJob = useCallback((jobId: string) => {
    if (socket?.connected) {
      console.log('🔕 Unsubscribing from job:', jobId);
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
