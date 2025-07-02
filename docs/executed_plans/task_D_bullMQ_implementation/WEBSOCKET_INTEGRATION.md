# WebSocket Integration Guide

## Overview

This document describes the WebSocket integration for real-time job progress tracking in the wallet analyzer dashboard. The implementation provides real-time updates for long-running analysis jobs with automatic fallback to polling when WebSocket connections fail.

## Architecture

### Backend Components

1. **WebSocket Gateway** (`src/api/websocket/job-progress.gateway.ts`)
   - Handles client connections and subscriptions
   - Subscribes to Redis pub/sub for job events
   - Manages client subscription state

2. **Job Progress Hook** (`dashboard/src/hooks/useJobProgress.ts`)
   - React hook for WebSocket connection management
   - Handles job subscriptions and event processing
   - Provides connection state and error handling

3. **WebSocket Status Component** (`dashboard/src/components/shared/WebSocketStatus.tsx`)
   - Reusable component for displaying connection status
   - Multiple display variants (icon, badge, full)

## Frontend Implementation

### Basic Usage

```typescript
import { useJobProgress } from '@/hooks/useJobProgress';

function MyComponent() {
  const {
    isConnected,
    error,
    subscribeToJob,
    unsubscribeFromJob,
    cleanup
  } = useJobProgress({
    onJobProgress: (data) => {
      console.log(`Job ${data.jobId}: ${data.progress}%`);
    },
    onJobCompleted: (data) => {
      console.log(`Job ${data.jobId} completed in ${data.processingTime}ms`);
    },
    onJobFailed: (data) => {
      console.error(`Job ${data.jobId} failed: ${data.error}`);
    }
  });

  // Subscribe to a job
  const handleJobSubmission = async () => {
    const response = await submitJob();
    subscribeToJob(response.jobId);
  };

  return (
    <div>
      <WebSocketStatus isConnected={isConnected} error={error} />
      {/* Your component UI */}
    </div>
  );
}
```

### WebSocket Events

#### Client → Server Events

- `subscribe-to-job` - Subscribe to specific job updates
  ```typescript
  socket.emit('subscribe-to-job', { jobId: 'similarity-ABC123' });
  ```

- `unsubscribe-from-job` - Unsubscribe from job updates
  ```typescript
  socket.emit('unsubscribe-from-job', { jobId: 'similarity-ABC123' });
  ```

- `subscribe-to-queue` - Subscribe to all jobs in a queue
  ```typescript
  socket.emit('subscribe-to-queue', { queueName: 'similarity-operations' });
  ```

#### Server → Client Events

- `job-progress` - Real-time progress updates
  ```typescript
  {
    jobId: string;
    progress: number;
    status: string;
    data?: any;
  }
  ```

- `job-completed` - Job completion notification
  ```typescript
  {
    jobId: string;
    result: any;
    processingTime: number;
  }
  ```

- `job-failed` - Job failure notification
  ```typescript
  {
    jobId: string;
    error: string;
    failedReason?: string;
  }
  ```

### Fallback Mechanism

The integration includes automatic fallback to polling when WebSocket connections fail:

1. **Primary:** WebSocket real-time updates
2. **Fallback:** HTTP polling every 3 seconds
3. **Graceful degradation:** Users see updated status indicators

```typescript
// Automatic fallback handling
const {
  isConnected,
  subscribeToJob
} = useJobProgress({
  onConnectionChange: (connected) => {
    if (!connected && currentJobId) {
      // Fallback to polling
      startPolling(currentJobId);
    }
  }
});

// Usage with fallback
if (isConnected) {
  subscribeToJob(jobId);
} else {
  startPolling(jobId);
}
```

## Implementation in Similarity Lab

The similarity lab (`dashboard/src/app/similarity-lab/page.tsx`) demonstrates the complete integration:

### Key Features

1. **Connection Status Display**
   - Visual indicators for WebSocket connection state
   - Real-time vs. polling mode indicators

2. **Automatic Job Tracking**
   - Subscribe to jobs immediately after submission
   - Handle completion/failure events
   - Cleanup subscriptions on component unmount

3. **User Experience Enhancements**
   - Real-time progress bars
   - Connection status in analysis method selection
   - Fallback notifications

### Code Example

```typescript
// Job submission with WebSocket tracking
const runAdvancedAnalysis = async (walletList: string[]) => {
  try {
    const jobResponse = await fetcher('/analyses/similarity/queue', {
      method: 'POST',
      body: JSON.stringify({
        walletAddresses: walletList,
        vectorType: 'capital',
        failureThreshold: 0.8,
        timeoutMinutes: 30,
      }),
    });

    setCurrentJobId(jobResponse.jobId);
    
    // Use WebSocket if connected, otherwise fallback to polling
    if (useWebSocket && wsConnected) {
      subscribeToJob(jobResponse.jobId);
    } else {
      await pollJobStatus(jobResponse.jobId);
    }
  } catch (error) {
    // Error handling
  }
};
```

## WebSocket Status Component

### Variants

```typescript
// Icon only (default)
<WebSocketStatus isConnected={wsConnected} error={wsError} />

// Badge with text
<WebSocketStatus 
  isConnected={wsConnected} 
  error={wsError} 
  variant="badge" 
/>

// Full display with icon and text
<WebSocketStatus 
  isConnected={wsConnected} 
  error={wsError} 
  variant="full" 
/>
```

### Visual States

- ✅ **Connected (Green Wifi):** Real-time updates active
- ⚠️ **Disconnected (Orange Wifi Off):** Using polling fallback  
- ❌ **Error (Red Alert):** Connection failed with error details

## Best Practices

### Connection Management

1. **Always cleanup subscriptions** on component unmount
2. **Handle connection errors gracefully** with fallback mechanisms
3. **Provide visual feedback** for connection state
4. **Implement retry logic** for failed connections

### Error Handling

```typescript
const { error } = useJobProgress({
  onConnectionChange: (connected) => {
    if (!connected) {
      // Show user-friendly message
      toast({
        title: "Connection Lost",
        description: "Falling back to polling for updates."
      });
    }
  }
});

// Display error state
if (error) {
  return <div>WebSocket Error: {error}</div>;
}
```

### Performance Considerations

1. **Limit subscriptions** - Only subscribe to relevant jobs
2. **Cleanup properly** - Prevent memory leaks
3. **Use connection pooling** - Share connections across components
4. **Implement heartbeat** - Detect stale connections

## Testing

### Manual Testing

1. **Start the backend** with Redis running
2. **Open similarity lab** in browser
3. **Submit an advanced analysis** job
4. **Verify real-time progress** updates
5. **Test fallback** by stopping Redis/backend

### Connection Testing

```bash
# Test WebSocket connection directly
wscat -c ws://localhost:3001/job-progress

# Subscribe to a job
{"event": "subscribe-to-job", "data": {"jobId": "test-123"}}
```

## Monitoring

### Backend Logs

```bash
# WebSocket connection logs
WebSocket connected to job progress
Job progress received: { jobId: 'similarity-ABC123', progress: 45 }

# Redis pub/sub logs  
Subscribed to Redis job events
Publishing job progress: similarity-ABC123
```

### Frontend Console

```javascript
// Connection status
WebSocket connected to job progress
Using WebSocket for job tracking
Subscribed to job: similarity-ABC123

// Progress events
Job progress received: { jobId: 'similarity-ABC123', progress: 75 }
Job completed: { jobId: 'similarity-ABC123', processingTime: 45000 }
```

## Troubleshooting

### Common Issues

1. **WebSocket connection fails**
   - Check backend server is running
   - Verify Redis is accessible
   - Check firewall/proxy settings

2. **Events not received**
   - Verify job subscription was successful
   - Check Redis pub/sub configuration
   - Review backend job event publishing

3. **Fallback not working**
   - Ensure polling mechanism is implemented
   - Check API endpoints are accessible
   - Verify error handling logic

### Debug Mode

Enable detailed logging:

```typescript
const { isConnected } = useJobProgress({
  onJobProgress: (data) => {
    console.debug('WebSocket job progress:', data);
  }
});
```

## Future Enhancements

1. **Queue-level subscriptions** for broader monitoring
2. **Batch job tracking** for multiple simultaneous jobs  
3. **Historical job events** replay functionality
4. **Performance metrics** tracking and display
5. **Admin dashboard** for WebSocket connection monitoring

---

**Status:** ✅ COMPLETE - WebSocket integration fully implemented and tested
**Last Updated:** January 2024 