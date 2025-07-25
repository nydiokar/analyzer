# Dashboard Job Migration Plan

## Executive Summary

This document outlines the migration of the dashboard wallet analysis from synchronous processing to the job queue system, following the proven pattern established by the similarity lab. The goal is to provide non-blocking, scalable wallet analysis while maintaining the existing user experience.

## Current Situation

### Problem Statement
The dashboard currently uses synchronous processing in `analyses.controller.ts`:
```typescript
// Current blocking flow
await this.heliusSyncService.syncWalletData(walletAddress, syncOptions);
await this.pnlAnalysisService.analyzeWalletPnl(walletAddress);
await this.behaviorService.getWalletBehavior(walletAddress, behaviorConfig);
```

**Issues:**
- ❌ **Blocking UI** - Users wait 30+ seconds for analysis completion
- ❌ **No progress feedback** - Users don't know what's happening
- ❌ **No error recovery** - If analysis fails, user gets no feedback
- ❌ **Resource contention** - Multiple users can't analyze simultaneously
- ❌ **No scalability** - Can't handle multiple concurrent requests

### Current Architecture
```
Frontend → Backend API → Synchronous Processing → Core Services
```

## Desired Outcome

### Target Architecture
```
Frontend → Backend API → Job Queue → Worker Process → Core Services
```

**Benefits:**
- ✅ **Non-blocking UI** - Immediate response with job ID
- ✅ **Real-time progress** - WebSocket updates during processing
- ✅ **Error recovery** - Automatic retry and failure handling
- ✅ **Scalable** - Multiple workers can handle concurrent requests
- ✅ **Consistent** - Same pattern as similarity lab

## Why This Approach (Hybrid Direct Service Calls)

### Analysis of Options

**Option 1: Individual Job Orchestration**
```typescript
// Queue individual jobs with dependencies
const syncJob = await this.walletOperationsQueue.addSyncWalletJob({...});
const pnlJob = await this.analysisOperationsQueue.addPnlAnalysisJob({...});
const behaviorJob = await this.analysisOperationsQueue.addBehaviorAnalysisJob({...});
```
- ❌ **Complex dependencies** - sync → analysis → enrichment
- ❌ **Slower execution** - queue overhead for each operation
- ❌ **Harder to debug** - operations spread across multiple jobs
- ❌ **Progress complexity** - need to coordinate across multiple jobs

**Option 2: Direct Service Calls (Recommended)**
```typescript
// Direct service calls within single job
const [pnlResult, behaviorResult] = await Promise.all([
  this.pnlAnalysisService.analyzeWalletPnl(walletAddress),
  this.behaviorService.getWalletBehavior(walletAddress, config),
]);
```
- ✅ **Faster execution** - no queue overhead
- ✅ **Simpler coordination** - all operations in one process
- ✅ **Easier debugging** - all operations in one stack trace
- ✅ **Better progress tracking** - can track individual steps

### Why Direct Service Calls Are Optimal

1. **Proven Pattern**: Similarity processor already uses this approach successfully
2. **Performance**: Direct calls are faster than queue overhead for orchestrated operations
3. **Simplicity**: No complex job dependencies to manage
5. **Progress Tracking**: Can provide granular progress updates
6. **Resource Efficiency**: No unnecessary queue operations

### When Individual Jobs Are Used

Individual jobs are valuable for:
- **Standalone operations** (user wants only PNL analysis)
- **External integrations** (API calls from other services)
- **Background processing** (scheduled tasks)
- **Independent scaling** (scale PNL vs behavior workers separately)

## Implementation Plan

### Phase 1: Add Dashboard Job Type

#### 1.1 Define Job Data Type
**File**: `src/queues/jobs/types/index.ts`
```typescript
export interface DashboardWalletAnalysisJobData {
  walletAddress: string;
  requestId: string;
  forceRefresh?: boolean;
  enrichMetadata?: boolean;
  timeoutMinutes?: number;
}
```

#### 1.2 Add Job to AnalysisOperationsProcessor
**File**: `src/queues/processors/analysis-operations.processor.ts`

**Add to switch statement:**
```typescript
case 'dashboard-wallet-analysis':
  return await this.processDashboardWalletAnalysis(job as Job<DashboardWalletAnalysisJobData>);
```

**Add new method:**
```typescript
async processDashboardWalletAnalysis(job: Job<DashboardWalletAnalysisJobData>): Promise<any> {
  const { walletAddress, forceRefresh, enrichMetadata } = job.data;
  const timeoutMs = JobTimeouts['dashboard-wallet-analysis'].timeout || 15 * 60 * 1000;
  const startTime = Date.now();
  
  // Apply deduplication strategy
  const expectedJobId = generateJobId.dashboardWalletAnalysis(walletAddress, job.data.requestId);
  if (job.id !== expectedJobId) {
    throw new Error(`Job ID mismatch - possible duplicate: expected ${expectedJobId}, got ${job.id}`);
  }

  // Acquire Redis lock to prevent concurrent processing
  const lockKey = RedisLockService.createWalletLockKey(walletAddress, 'dashboard-analysis');
  const lockAcquired = await this.redisLockService.acquireLock(lockKey, job.id!, timeoutMs);
  
  if (!lockAcquired) {
    throw new Error(`Dashboard analysis already in progress for wallet ${walletAddress}`);
  }

  try {
    await job.updateProgress(5);
    this.logger.debug(`Processing dashboard analysis for ${walletAddress}`);

    // 1. Check wallet status (smart sync detection)
    await job.updateProgress(10);
    const walletStatuses = await this.databaseService.getWalletsStatus([walletAddress]);
    const needsSync = walletStatuses.statuses[0].status === 'STALE' || 
                     walletStatuses.statuses[0].status === 'MISSING' || 
                     forceRefresh;
    
    // 2. Sync if needed (reuse existing sync logic)
    if (needsSync) {
      await job.updateProgress(15);
      this.logger.debug(`Wallet ${walletAddress} needs sync, starting sync process`);
      
      // Use HeliusSyncService directly (like similarity processor)
      const syncOptions: SyncOptions = {
        limit: 100,
        fetchAll: true,
        skipApi: false,
        fetchOlder: true,
        maxSignatures: ANALYSIS_EXECUTION_CONFIG.DASHBOARD_MAX_SIGNATURES,
        smartFetch: true,
      };
      
      await this.heliusSyncService.syncWalletData(walletAddress, syncOptions);
      await job.updateProgress(40);
    } else {
      await job.updateProgress(40);
      this.logger.debug(`Wallet ${walletAddress} is current, skipping sync`);
    }
    
    // 3. Run analysis sequentially (NOT in parallel to avoid race conditions)
    await job.updateProgress(50);
    this.logger.debug(`Starting PNL and behavior analysis for ${walletAddress}`);
    
    // Run PNL analysis first
    await this.pnlAnalysisService.analyzeWalletPnl(walletAddress);
    await job.updateProgress(65);
    
    // Then run behavior analysis
    const behaviorResult = await this.behaviorService.getWalletBehavior(
      walletAddress, 
      this.behaviorService.getDefaultBehaviorAnalysisConfig()
    );
    
    await job.updateProgress(80);
    
    // 4. Queue enrichment if requested (background processing) THIS SHOULD HAPPEN NOT DURING REQUEST BUT IN PARALLEL, so when analysis is done there is chance the enrichment is done also and they populate at the same time, if not we don't wait for it but incrementally update the frontend
    let enrichmentJobId;
    if (enrichMetadata) {
      await job.updateProgress(85);
      this.logger.debug(`Queueing token enrichment for ${walletAddress}`);
      
      // Fetch current balances for enrichment
      const walletBalanceService = new WalletBalanceService(this.heliusApiClient, this.databaseService);
      const balanceResult = await walletBalanceService.fetchWalletBalances([walletAddress]);
      
      const enrichmentJob = await this.enrichmentOperationsQueue.addEnrichTokenBalances({
        walletBalances: Object.fromEntries(balanceResult),
        requestId: job.data.requestId,
        priority: 3
      });
      enrichmentJobId = enrichmentJob.id;
    }
    
    await job.updateProgress(100);
    
    const result = {
      success: true,
      walletAddress,
      behaviorResult,
      enrichmentJobId,
      timestamp: Date.now(),
      processingTimeMs: Date.now() - startTime
    };

    this.logger.log(`Dashboard analysis completed for ${walletAddress}`);
    return result;

  } catch (error) {
    this.logger.error(`Dashboard analysis failed for ${walletAddress}:`, error);
    
    const result = {
      success: false,
      walletAddress,
      error: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
      processingTimeMs: Date.now() - startTime
    };
    
    throw error;
  } finally {
    // Always release lock
    await this.redisLockService.releaseLock(lockKey, job.id!);
  }
}
```

#### 1.3 Add Job to AnalysisOperationsQueue
**File**: `src/queues/queues/analysis-operations.queue.ts`

**Add new method:**
```typescript
async addDashboardWalletAnalysisJob(data: DashboardWalletAnalysisJobData, options?: { priority?: number; delay?: number }) {
  const jobId = generateJobId.dashboardWalletAnalysis(data.walletAddress, data.requestId);
  
  return this.queue.add('dashboard-wallet-analysis', data, {
    jobId,
    priority: options?.priority || JobPriority.CRITICAL, // High priority for user-initiated requests
    delay: options?.delay || 0,
  });
}
```

#### 1.4 Add Job ID Generator
**File**: `src/queues/utils/job-id-generator.ts`

**Add to generateJobId object:**
```typescript
dashboardWalletAnalysis: (walletAddress: string, requestId: string) => {
  const hashInput = `dashboard-${walletAddress}-${requestId}`;
  return `dashboard-${crypto.createHash('md5').update(hashInput).digest('hex').slice(0, 8)}`;
},
```

#### 1.5 Add Job Timeout Configuration
**File**: `src/queues/config/queue.config.ts`

**Add to JobTimeouts:**
```typescript
'dashboard-wallet-analysis': {
  timeout: 15 * 60 * 1000,        // 15 minutes max
  staleAfter: 20 * 60 * 1000,     // 20 minutes = stale
  retryBackoff: 'exponential' as const
},
```

### Phase 2: Create DTOs and Update Controller Endpoint

#### 2.1 Create Dashboard Analysis DTO
**File**: `src/api/analyses/dto/dashboard-analysis.dto.ts`
```typescript
import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { IsSolanaAddress } from '../../pipes/solana-address.pipe';
import { ApiProperty } from '@nestjs/swagger';

export class DashboardAnalysisRequestDto {
  @ApiProperty({
    description: 'The Solana wallet address to analyze',
    example: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
  })
  @IsString()
  @IsSolanaAddress()
  walletAddress: string;
  
  @ApiProperty({
    description: 'Force refresh even if wallet data is current',
    required: false,
    default: false
  })
  @IsOptional()
  @IsBoolean()
  forceRefresh?: boolean;
  
  @ApiProperty({
    description: 'Enable token metadata enrichment',
    required: false,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  enrichMetadata?: boolean;
}

export class DashboardAnalysisResponseDto {
  @ApiProperty({ description: 'Unique job identifier for tracking' })
  jobId: string;
  
  @ApiProperty({ description: 'Request identifier for this analysis' })
  requestId: string;
  
  @ApiProperty({ description: 'Initial job status', enum: ['queued'] })
  status: string;
  
  @ApiProperty({ description: 'Queue name', example: 'analysis-operations' })
  queueName: string;
  
  @ApiProperty({ description: 'Estimated processing time' })
  estimatedProcessingTime: string;
  
  @ApiProperty({ description: 'URL to monitor job status' })
  monitoringUrl: string;
}
```

#### 2.2 Add New Endpoint to AnalysesController
**File**: `src/api/analyses/analyses.controller.ts`

**Add imports:**
```typescript
import { AnalysisOperationsQueue } from '../../queues/queues/analysis-operations.queue';
import { JobPriority } from '../../queues/config/queue.config';
import { DashboardAnalysisRequestDto, DashboardAnalysisResponseDto } from './dto/dashboard-analysis.dto';
import { DashboardWalletAnalysisJobData } from '../../queues/jobs/types';
```

**Add to constructor:**
```typescript
constructor(
  // ... existing dependencies ...
  private readonly analysisOperationsQueue: AnalysisOperationsQueue,
) {}
```

**Add new method:**
```typescript
@Post('/wallets/dashboard-analysis')
@Throttle({ default: { limit: 5, ttl: 60000 } })
@ApiOperation({ 
  summary: 'Queue dashboard wallet analysis job',
  description: 'Queues a comprehensive wallet analysis job for dashboard display. Returns job ID for monitoring via the Jobs API.'
})
@ApiResponse({ 
  status: 202, 
  description: 'Dashboard analysis job queued successfully',
  type: DashboardAnalysisResponseDto
})
@ApiResponse({ status: 400, description: 'Invalid wallet address or request parameters' })
@ApiResponse({ status: 503, description: 'Analysis already in progress for this wallet' })
@HttpCode(202)
async queueDashboardWalletAnalysis(
  @Body() dto: DashboardAnalysisRequestDto,
): Promise<DashboardAnalysisResponseDto> {
  this.logger.log(`Received request to queue dashboard analysis for wallet: ${dto.walletAddress}`);

  try {
    // Generate request ID
    const requestId = `dashboard-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Check wallet status to estimate processing time
    const walletStatuses = await this.databaseService.getWalletsStatus([dto.walletAddress]);
    const needsSync = walletStatuses.statuses[0].status === 'STALE' || 
                     walletStatuses.statuses[0].status === 'MISSING' || 
                     dto.forceRefresh;

    // Prepare job data
    const jobData: DashboardWalletAnalysisJobData = {
      walletAddress: dto.walletAddress,
      requestId,
      forceRefresh: dto.forceRefresh || false,
      enrichMetadata: dto.enrichMetadata !== false, // Default to true
      timeoutMinutes: needsSync ? 15 : 8, // Longer timeout if sync is needed
    };

    // Add job to analysis operations queue
    const job = await this.analysisOperationsQueue.addDashboardWalletAnalysisJob(jobData, {
      priority: JobPriority.CRITICAL, // High priority for user-initiated requests
      delay: 0
    });

    // Calculate estimated processing time
    const baseTimeMinutes = 3; // Base analysis time
    const syncTimeMinutes = needsSync ? 10 : 0; // Additional time if sync needed
    const estimatedMinutes = baseTimeMinutes + syncTimeMinutes;
    const estimatedTime = estimatedMinutes > 60 
      ? `${Math.round(estimatedMinutes / 60)} hour(s)`
      : `${estimatedMinutes} minute(s)`;

    this.logger.log(`Queued dashboard analysis job ${job.id} for wallet ${dto.walletAddress}`);

    return {
      jobId: job.id!,
      requestId,
      status: 'queued',
      queueName: 'analysis-operations',
      estimatedProcessingTime: estimatedTime,
      monitoringUrl: `/jobs/${job.id}`
    };

  } catch (error) {
    this.logger.error(`Failed to queue dashboard analysis:`, error);
    if (error instanceof BadRequestException) {
      throw error;
    }
    throw new InternalServerErrorException('Failed to queue dashboard analysis job');
  }
}
```

#### 2.3 Update Existing Endpoint for Backward Compatibility
**File**: `src/api/analyses/analyses.controller.ts`

**Add deprecation warning and feature flag:**
```typescript
@Post('/wallets/trigger-analysis')
@Deprecated('Use /analyses/wallets/dashboard-analysis instead')
@ApiOperation({ 
  summary: 'Triggers a full analysis for multiple wallets (DEPRECATED)',
  description: 'DEPRECATED: Use /analyses/wallets/dashboard-analysis for new implementations. This endpoint will be removed in a future version.'
})
@ApiBody({ type: TriggerAnalysisDto })
async triggerAnalyses(
  @Body() triggerAnalysisDto: TriggerAnalysisDto,
): Promise<{ message: string; triggeredAnalyses: string[]; skippedAnalyses: string[] }> {
  // Check feature flag for gradual rollout
  const useJobSystem = process.env.USE_DASHBOARD_JOB_SYSTEM === 'true';
  
  if (useJobSystem && triggerAnalysisDto.walletAddresses.length === 1) {
    // Redirect single wallet to new job-based endpoint
    this.logger.warn('Deprecated endpoint /analyses/wallets/trigger-analysis called. Redirecting to new job-based endpoint.');
    
    try {
      const jobResponse = await this.queueDashboardWalletAnalysis({
        walletAddress: triggerAnalysisDto.walletAddresses[0],
        forceRefresh: false,
        enrichMetadata: true
      });
      
      return {
        message: `Analysis job queued successfully. Job ID: ${jobResponse.jobId}`,
        triggeredAnalyses: [triggerAnalysisDto.walletAddresses[0]],
        skippedAnalyses: []
      };
    } catch (error) {
      this.logger.error('Failed to redirect to job-based endpoint:', error);
      // Fall back to old implementation
    }
  }
  
  // Use old synchronous processing for backward compatibility
  this.logger.warn('Using deprecated synchronous processing for /analyses/wallets/trigger-analysis');
  
  // ... existing synchronous implementation ...
  const { walletAddresses } = triggerAnalysisDto;
  this.logger.log(`Received request to trigger analysis for wallets: ${walletAddresses.join(', ')}`);

  const invalidWallets = walletAddresses.filter(w => !isValidSolanaAddress(w));
  if (invalidWallets.length > 0) {
    throw new BadRequestException(`Invalid Solana address(es) provided: ${invalidWallets.join(', ')}`);
  }

  const analysesToRun: string[] = [];
  const skippedAnalyses: string[] = [];

  for (const walletAddress of walletAddresses) {
    if (this.runningAnalyses.has(walletAddress)) {
      this.logger.warn(`An analysis for ${walletAddress} is already in progress. Request skipped for this wallet.`);
      skippedAnalyses.push(walletAddress);
    } else {
      analysesToRun.push(walletAddress);
    }
  }

  // Run analysis in the background for each wallet without waiting for all to complete
  analysesToRun.forEach(walletAddress => {
    (async () => {
      try {
        this.runningAnalyses.add(walletAddress);
        this.logger.debug(`Lock acquired for analysis of wallet: ${walletAddress}.`);
        
        const initialWalletState: Wallet | null = await this.databaseService.getWallet(walletAddress);
        const isNewWalletFlow = !initialWalletState;

        if (isNewWalletFlow) {
          this.logger.debug(`Wallet ${walletAddress} appears new or not yet in DB. Proceeding with comprehensive sync and analysis.`);
        } else {
          this.logger.debug(`Wallet ${walletAddress} exists. Proceeding with update sync and full re-analysis.`);
        }

        const syncOptions: SyncOptions = {
          limit: 100,
          fetchAll: true,
          skipApi: false,
          fetchOlder: true,
          maxSignatures: ANALYSIS_EXECUTION_CONFIG.DASHBOARD_MAX_SIGNATURES,
          smartFetch: true,
        };

        this.logger.debug(`Calling HeliusSyncService.syncWalletData for ${walletAddress} with options: ${JSON.stringify(syncOptions)}`);
        
        // Auto-classify wallet and notify if high-frequency
        try {
          const finalClassification = await this.smartFetchService.getOrAutoClassifyWallet(walletAddress);
          if (finalClassification === 'high_frequency') {
            // Send WebSocket notification about limited analysis
            const message = `High-frequency wallet detected. Analysis limited to ${syncOptions.maxSignatures} recent transactions for optimal performance.`;
            // TODO: Add WebSocket broadcast here when WebSocket service is available
            this.logger.log(`🤖 [Analysis] ${message} - Wallet: ${walletAddress}`);
          }
        } catch (error) {
          this.logger.warn(`Failed to auto-classify wallet ${walletAddress}:`, error);
        }
        
        await this.heliusSyncService.syncWalletData(walletAddress, syncOptions);
        this.logger.debug(`Helius sync process completed for ${walletAddress}.`);

        const currentWallet: Wallet | null = await this.databaseService.ensureWalletExists(walletAddress);
        if (!currentWallet) {
          this.logger.error(`Failed to find or create wallet ${walletAddress}. Aborting analysis for this wallet.`);
          return;
        }

        this.logger.debug('Wallet data synced, proceeding to PNL and Behavior analysis.');
        await this.pnlAnalysisService.analyzeWalletPnl(walletAddress);
        this.logger.debug(`PNL analysis completed for ${walletAddress}.`);

        this.logger.debug(`Starting Behavior analysis for wallet: ${walletAddress}.`);
        const behaviorConfig = this.behaviorService.getDefaultBehaviorAnalysisConfig();
        const behaviorMetrics = await this.behaviorService.getWalletBehavior(walletAddress, behaviorConfig);
        this.logger.debug(`Behavior analysis completed for ${walletAddress}.`);

        // Smart fetch classification is now handled in HeliusSyncService

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        this.logger.error(`Unexpected error during async analysis for ${walletAddress}: ${errorMessage}`, errorStack, String(error));
      } finally {
        this.runningAnalyses.delete(walletAddress);
        this.logger.debug(`Lock released after analysis of wallet: ${walletAddress}.`);
      }
    })();
  });

  const message = `Analysis for ${analysesToRun.length} wallet(s) has been triggered successfully. ${skippedAnalyses.length} were skipped as they were already in progress.`;
  this.logger.log(message);
  return { message, triggeredAnalyses: analysesToRun, skippedAnalyses };
}
```

### Phase 3: Update Frontend Integration

#### 3.1 Add Frontend TypeScript Types
**File**: `dashboard/src/types/api.ts`
```typescript
// Add to existing types
export interface DashboardAnalysisRequest {
  walletAddress: string;
  forceRefresh?: boolean;
  enrichMetadata?: boolean;
}

export interface DashboardAnalysisResponse {
  jobId: string;
  requestId: string;
  status: string;
  queueName: string;
  estimatedProcessingTime: string;
  monitoringUrl: string;
}

export interface JobProgressEvent {
  jobId: string;
  progress: number;
  status: 'processing' | 'completed' | 'failed' | 'cancelled';
  message?: string;
  error?: string;
}
```

#### 3.2 Update WalletProfileLayout
**File**: `dashboard/src/components/layout/WalletProfileLayout.tsx`

**Add imports:**
```typescript
import { DashboardAnalysisRequest, DashboardAnalysisResponse, JobProgressEvent } from '../../types/api';
```

**Replace handleTriggerAnalysis method:**
```typescript
const handleTriggerAnalysis = async () => {
  if (!isValidSolanaAddress(walletAddress)) {
    toast.error("Invalid Wallet Address", {
      description: "The address in the URL is not a valid Solana wallet address.",
    });
    return;
  }

  if (isAnalyzing) {
    toast.warning("Analysis Already Running", {
      description: "An analysis is already in progress. Please wait for it to complete.",
    });
    return;
  }

  const { isDemo } = useApiKeyStore.getState();
  if (isDemo) {
    toast.info("This is a demo account", {
      description: "Triggering a new analysis is not available for demo accounts.",
      action: {
        label: "OK",
        onClick: () => {},
      },
    });
    return;
  }

  if (!walletAddress) {
    toast.error("Wallet Address Missing", {
      description: "Cannot trigger analysis without a wallet address.",
    });
    return;
  }

  setIsAnalyzing(true);
  setAnalysisRequestTime(new Date());
  toast.info("Analysis Queued", {
    description: `Analysis job submitted for ${truncateWalletAddress(walletAddress)}. You'll receive real-time updates.`,
  });

  try {
    // Use new job-based endpoint
    const response: DashboardAnalysisResponse = await fetcher('/analyses/wallets/dashboard-analysis', {
      method: 'POST',
      body: JSON.stringify({ 
        walletAddress,
        forceRefresh: false,
        enrichMetadata: true
      } as DashboardAnalysisRequest),
    });
    
    if (response.jobId && wsConnected) {
      // Subscribe to job progress via WebSocket
      subscribeToJob(response.jobId);
      setAnalysisJobId(response.jobId);
      setIsPolling(true); // Start polling for summary updates
    } else {
      throw new Error('Failed to get job ID or WebSocket not connected');
    }

  } catch (err: any) {
    console.error("Error triggering analysis:", err);
    setLastAnalysisStatus('error');
    setIsAnalyzing(false);
    
    if (err.status === 503) {
      toast.warning("Analysis Already Running", {
        description: "An analysis is already in progress. Please wait for it to complete before starting a new one.",
      });
    } else {
      toast.error("Analysis Failed to Trigger", {
        description: err.message || "An unexpected error occurred. Please check the console for details.",
      });
    }
  }
};
```

#### 3.3 Add WebSocket Integration
**File**: `dashboard/src/components/layout/WalletProfileLayout.tsx`

**Add WebSocket subscription logic:**
```typescript
// Add state for job progress
const [jobProgress, setJobProgress] = useState<number>(0);
const [jobStatus, setJobStatus] = useState<string>('');

// Add WebSocket subscription function
const subscribeToJob = (jobId: string) => {
  if (wsConnected && socket) {
    socket.emit('subscribe', { jobId, type: 'dashboard-analysis' });
    console.log(`Subscribed to job progress for ${jobId}`);
  }
};

// Add WebSocket event handler
useEffect(() => {
  if (socket) {
    const handleJobProgress = (data: JobProgressEvent) => {
      if (data.jobId === analysisJobId) {
        setJobProgress(data.progress);
        setJobStatus(data.status);
        
        if (data.status === 'completed') {
          setIsAnalyzing(false);
          setIsPolling(true);
          toast.success("Analysis Complete", {
            description: "Wallet data has been successfully updated.",
          });
        } else if (data.status === 'failed') {
          setIsAnalyzing(false);
          setLastAnalysisStatus('error');
          toast.error("Analysis Failed", {
            description: data.error || "The analysis job failed. Please try again.",
          });
        } else if (data.status === 'cancelled') {
          setIsAnalyzing(false);
          setLastAnalysisStatus('cancelled');
          toast.warning("Analysis Cancelled", {
            description: "The analysis job was cancelled.",
          });
        }
      }
    };

    socket.on('job-progress', handleJobProgress);

    return () => {
      socket.off('job-progress', handleJobProgress);
    };
  }
}, [socket, analysisJobId]);

// Add progress display in UI
const renderAnalysisProgress = () => {
  if (isAnalyzing && jobProgress > 0) {
    return (
      <div className="flex items-center space-x-2">
        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <span className="text-sm text-muted-foreground">
          Analyzing... {jobProgress}%
        </span>
      </div>
    );
  }
  return null;
};
```

#### 3.4 Update Job Completion Handling
**File**: `dashboard/src/components/layout/WalletProfileLayout.tsx`

**Update useEffect for job completion:**
```typescript
useEffect(() => {
  // This effect handles the completion of polling
  if (isPolling && walletSummary && analysisRequestTime) {
    const lastAnalyzedDate = walletSummary.lastAnalyzedAt ? new Date(walletSummary.lastAnalyzedAt) : null;
    if (lastAnalyzedDate && lastAnalyzedDate > analysisRequestTime) {
      setIsPolling(false);
      setIsAnalyzing(false);
      setAnalysisRequestTime(null);
      setLastAnalysisStatus('success');
      setLastAnalysisTimestamp(lastAnalyzedDate);
      
      // Manually revalidate other wallet-related data
      if (cache instanceof Map) {
        for (const key of cache.keys()) {
          if (
            typeof key === 'string' &&
            key.startsWith(`/wallets/${walletAddress}`) &&
            key !== walletSummaryKey
          ) {
            globalMutate(key);
          }
        }
      }
    }
  }
}, [walletSummary, isPolling, analysisRequestTime, cache, globalMutate, walletAddress, walletSummaryKey]);
```

### Phase 4: Update Module Dependencies

#### 4.1 Update AnalysesModule
**File**: `src/api/analyses/analyses.module.ts`

**Ensure AnalysisOperationsQueue is available:**
```typescript
@Module({
  imports: [
    // ... existing imports ...
    QueueModule, // Provides AnalysisOperationsQueue
  ],
  controllers: [AnalysesController],
  providers: [
    EnrichmentStrategyService,
    // ... existing providers ...
  ],
})
export class AnalysesModule {}
```

#### 4.2 Update QueueModule
**File**: `src/queues/queue.module.ts`

**Ensure AnalysisOperationsQueue is exported:**
```typescript
@Module({
  providers: [
    // ... existing providers ...
    AnalysisOperationsQueue,
  ],
  exports: [
    // ... existing exports ...
    AnalysisOperationsQueue,
  ],
})
export class QueueModule {}
```

### Phase 5: Environment Configuration

#### 5.1 Add Feature Flag
**File**: `.env.example`
```bash
# Dashboard Job System Feature Flag
USE_DASHBOARD_JOB_SYSTEM=false
```

**File**: `.env.production`
```bash
# Dashboard Job System Feature Flag
USE_DASHBOARD_JOB_SYSTEM=true
```

#### 5.2 Add Job System Configuration
**File**: `src/config/constants.ts`
```typescript
// Add to existing constants
export const DASHBOARD_JOB_CONFIG = {
  DEFAULT_TIMEOUT_MINUTES: 15,
  SYNC_TIMEOUT_MINUTES: 20,
  ENRICHMENT_TIMEOUT_MINUTES: 10,
  MAX_RETRIES: 3,
  PROGRESS_UPDATE_INTERVAL: 5000, // 5 seconds
} as const;
```

## Testing Strategy

### 1. Unit Tests
- Test job processor logic
- Test job ID generation
- Test Redis lock acquisition/release
- Test error handling
- Test DTO validation

### 2. Integration Tests
- Test job submission and processing
- Test WebSocket progress updates
- Test frontend integration
- Test error scenarios
- Test backward compatibility

### 3. Load Tests
- Test concurrent job processing
- Test Redis lock contention
- Test worker scaling
- Test memory usage under load

### 4. Feature Flag Tests
- Test gradual rollout functionality
- Test fallback to synchronous processing
- Test environment variable handling

## Rollback Plan

### If Issues Arise:
1. **Keep old endpoint** - don't remove synchronous processing immediately
2. **Feature flag** - add toggle to switch between sync/async processing
3. **Gradual rollout** - test with subset of users first
4. **Monitor metrics** - track job success/failure rates
5. **Quick rollback** - set `USE_DASHBOARD_JOB_SYSTEM=false` to revert

### Rollback Steps:
```bash
# 1. Set feature flag to false
export USE_DASHBOARD_JOB_SYSTEM=false

# 2. Restart application
npm run start:prod

# 3. Monitor logs for any issues
tail -f logs/app.log
```

## Success Metrics

### Performance Metrics:
- **Response time**: < 1 second for job submission
- **Processing time**: < 15 minutes for full analysis
- **Success rate**: > 95% job completion rate
- **Error rate**: < 5% job failure rate
- **WebSocket latency**: < 100ms for progress updates

### User Experience Metrics:
- **User satisfaction**: No complaints about blocking UI
- **Progress feedback**: Users receive real-time updates
- **Error handling**: Clear error messages and recovery options
- **Backward compatibility**: Existing integrations continue to work

### System Metrics:
- **Redis lock efficiency**: < 1% lock contention
- **Worker utilization**: 60-80% average CPU usage
- **Memory usage**: Stable memory consumption
- **Queue depth**: < 10 jobs waiting in queue

## Future Enhancements

### Phase 6: Advanced Features (Post-Migration)
0. Think of Redis cache for the whole wallet stuff to avoid refetching when the window is refreshed. 
1. **Job cancellation** - allow users to cancel running jobs
2. **Job prioritization** - premium users get higher priority
3. **Batch processing** - analyze multiple wallets simultaneously
4. **Scheduled analysis** - automatic periodic analysis
5. **Job history** - view past analysis jobs and results
6. **Advanced progress tracking** - detailed step-by-step progress
7. **Job dependencies** - chain multiple analysis types
8. **Resource optimization** - dynamic worker scaling

### Phase 7: Monitoring and Alerting
1. **Job monitoring dashboard** - real-time job status
2. **Performance alerts** - notify on slow jobs
3. **Error tracking** - detailed error analysis
4. **Usage analytics** - track job usage patterns
5. **Cost optimization** - monitor resource usage

## Conclusion

This migration plan provides a non-destructive, value-adding approach to converting the dashboard from synchronous to asynchronous processing. By following the proven pattern from the similarity lab and using direct service calls within a single job, we achieve:

- **Performance**: Fast execution with minimal overhead
- **Scalability**: Worker-based scaling for future growth
- **Reliability**: Redis locks and error handling
- **User Experience**: Non-blocking UI with real-time progress
- **Maintainability**: Consistent architecture with existing patterns
- **Backward Compatibility**: Gradual rollout with feature flags
- **Production Ready**: Comprehensive error handling and monitoring

The implementation is minimal, focused, and leverages existing infrastructure while providing immediate value to users. The feature flag approach ensures a safe rollout with easy rollback capabilities.

### Key Success Factors:
1. **Proven Pattern**: Reusing similarity lab architecture
2. **Gradual Rollout**: Feature flag for safe deployment
3. **Backward Compatibility**: Old endpoint continues to work
4. **Comprehensive Testing**: Unit, integration, and load tests
5. **Monitoring**: Real-time metrics and alerting
6. **Documentation**: Clear implementation guide

This plan ensures a smooth transition to the job system while maintaining system stability and user satisfaction.
