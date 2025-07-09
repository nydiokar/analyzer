import { useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

interface JobProgressData {
  jobId: string;
  progress: number;
  status: string;
  data?: any;
}

interface JobCompletedData {
  jobId: string;
  result: any;
  processingTime: number;
}

interface JobFailedData {
  jobId: string;
  error: string;
  failedReason?: string;
}

interface EnrichmentCompleteData {
  requestId: string;
  enrichedBalances: Record<string, any>;
  timestamp: number;
}

interface EnrichmentErrorData {
  requestId: string;
  error: string;
  timestamp: number;
}

interface UseJobProgressOptions {
  onJobProgress?: (data: JobProgressData) => void;
  onJobCompleted?: (data: JobCompletedData) => void;
  onJobFailed?: (data: JobFailedData) => void;
  onEnrichmentComplete?: (data: EnrichmentCompleteData) => void;
  onEnrichmentError?: (data: EnrichmentErrorData) => void;
  onConnectionChange?: (connected: boolean) => void;
}

interface UseJobProgressReturn {
  isConnected: boolean;
  error: string | null;
  subscribeToJob: (jobId: string) => void;
  unsubscribeFromJob: (jobId: string) => void;
  cleanup: () => void;
}

export function useJobProgress(options: UseJobProgressOptions = {}): UseJobProgressReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const subscribedJobsRef = useRef<Set<string>>(new Set());
  const failureCountRef = useRef<number>(0);
  const [websocketDisabled, setWebsocketDisabled] = useState(false);

  // Use refs for callbacks to avoid recreating WebSocket connection on every render
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  // WebSocket connection (optional enhancement - polling is the reliable fallback)
  useEffect(() => {
    // Skip WebSocket if disabled due to repeated failures
    if (websocketDisabled) {
      console.log('ℹ️ WebSocket disabled - using reliable polling updates');
      return;
    }

    // SIMPLE APPROACH: Connect directly to backend in all environments
    // Remove any /api/v1 suffix from base URL for WebSocket connections
    const rawBackendUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
    const backendUrl = rawBackendUrl.replace('/api/v1', '');
    const socketUrl = `${backendUrl}/job-progress`;
    
    console.log(`🔌 Attempting WebSocket connection (optional real-time updates): ${socketUrl}`);
    
    const socket = io(socketUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: 2, // Reduced attempts
      timeout: 10000, // Reduced timeout
      transports: ['polling', 'websocket'], // Start with polling, upgrade to websocket
      upgrade: true,
      rememberUpgrade: false, // Don't remember to allow fresh connections
    });

    socketRef.current = socket;

    // Connection event handlers
    socket.on('connect', () => {
      setIsConnected(true);
      setError(null);
      failureCountRef.current = 0; // Reset failure count on successful connection
      callbacksRef.current.onConnectionChange?.(true);
      console.log(`✅ WebSocket connected - real-time updates enabled`);
    });

    socket.on('disconnect', (reason) => {
      setIsConnected(false);
      callbacksRef.current.onConnectionChange?.(false);
      console.log(`ℹ️ WebSocket disconnected: ${reason} - polling fallback active`);
      // Don't set error for disconnections - this is normal
    });

    socket.on('connect_error', (err) => {
      failureCountRef.current += 1;
      setIsConnected(false);
      callbacksRef.current.onConnectionChange?.(false);
      
      // Only log detailed errors in development
      if (process.env.NODE_ENV === 'development') {
        console.warn(`⚠️ WebSocket connection failed (${failureCountRef.current}/2):`, err.message);
      }

      // Disable WebSocket after 2 consecutive failures - no dramatic errors
      if (failureCountRef.current >= 2) {
        console.log('ℹ️ WebSocket disabled - using polling updates (equally reliable)');
        setWebsocketDisabled(true);
        socket.disconnect();
      }
    });

    socket.on('reconnect', (attemptNumber) => {
      console.log(`✅ WebSocket reconnected - real-time updates restored`);
      setError(null);
    });

    socket.on('reconnect_error', (err) => {
      // Silent in production - this is not critical
      if (process.env.NODE_ENV === 'development') {
        console.warn('WebSocket reconnection failed:', err.message);
      }
    });

    socket.on('reconnect_failed', () => {
      console.log('ℹ️ WebSocket reconnection failed - continuing with polling updates');
    });

    // Job progress event handlers
    socket.on('job-progress', (data: JobProgressData) => {
      console.log('📊 Real-time job progress:', data);
      callbacksRef.current.onJobProgress?.(data);
    });

    socket.on('job-completed', (data: any) => {
      // Handle enrichment completion events
      if (data.queue === 'enrichment' && data.result?.requestId) {
        console.log('🎨 Real-time enrichment completion:', data);
        callbacksRef.current.onEnrichmentComplete?.(data.result);
      } else {
        // Handle regular job completion
        console.log('✅ Real-time job completion:', data);
        callbacksRef.current.onJobCompleted?.(data);
      }
    });

    socket.on('job-failed', (data: any) => {
      // Handle enrichment errors
      if (data.queue === 'enrichment') {
        console.log('❌ Real-time enrichment failure:', data);
        callbacksRef.current.onEnrichmentError?.({
          requestId: data.jobId,
          error: data.error,
          timestamp: Date.now()
        });
      } else {
        // Handle regular job failure
        console.log('❌ Real-time job failure:', data);
        callbacksRef.current.onJobFailed?.(data);
      }
    });

    // Cleanup on unmount
    return () => {
      if (socket.connected) {
        socket.disconnect();
      }
    };
  }, [websocketDisabled]); // Only depend on websocketDisabled, not the callbacks

  // Subscribe to job updates
  const subscribeToJob = useCallback((jobId: string) => {
    if (!socketRef.current) {
      console.warn('Socket not initialized');
      return;
    }

    if (!socketRef.current.connected) {
      console.warn('Socket not connected - will subscribe once connected');
      return;
    }

    if (subscribedJobsRef.current.has(jobId)) {
      console.log(`Already subscribed to job: ${jobId}`);
      return;
    }

    socketRef.current.emit('subscribe-to-job', { jobId });
    subscribedJobsRef.current.add(jobId);
    console.log(`Subscribed to job: ${jobId}`);
  }, []);

  // Unsubscribe from job updates
  const unsubscribeFromJob = useCallback((jobId: string) => {
    if (!socketRef.current || !subscribedJobsRef.current.has(jobId)) {
      return;
    }

    if (socketRef.current.connected) {
      socketRef.current.emit('unsubscribe-from-job', { jobId });
    }
    subscribedJobsRef.current.delete(jobId);
    console.log(`Unsubscribed from job: ${jobId}`);
  }, []);

  // Cleanup function for manual cleanup
  const cleanup = useCallback(() => {
    if (socketRef.current) {
      // Unsubscribe from all jobs
      subscribedJobsRef.current.forEach(jobId => {
        if (socketRef.current?.connected) {
          socketRef.current.emit('unsubscribe-from-job', { jobId });
        }
      });
      subscribedJobsRef.current.clear();

      if (socketRef.current.connected) {
        socketRef.current.disconnect();
      }
      socketRef.current = null;
    }
  }, []);

  return {
    isConnected,
    error,
    subscribeToJob,
    unsubscribeFromJob,
    cleanup
  };
} 