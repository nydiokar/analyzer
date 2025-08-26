# 🔄 Job Queue System - Deep Dive

## 🎯 Overview

The Job Queue System is the **backbone and heartbeat** of the Wallet Analysis System, built on **BullMQ** with **Redis** as the persistence layer. It orchestrates all background processing, from wallet synchronization to complex analysis operations, while providing real-time progress tracking, distributed locking, and intelligent job management.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    JOB QUEUE SYSTEM                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   Queue Layer   │  │  Processor      │  │   Redis Layer   │  │
│  │                 │  │   Layer         │  │                 │  │
│  │ • Wallet Ops    │  │ • Analysis      │  │ • Job Storage   │  │
│  │ • Analysis Ops  │  │   Processor     │  │ • Lock Service  │  │
│  │ • Similarity    │  │ • Similarity    │  │ • Progress      │  │
│  │   Ops           │  │   Processor     │  │   Tracking      │  │
│  │ • Enrichment    │  │ • Enrichment    │  │ • Health        │  │
│  │   Ops           │  │   Processor     │  │   Monitoring    │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   Services      │  │   WebSocket     │  │   Monitoring    │  │
│  │                 │  │   Gateway       │  │                 │  │
│  │ • Redis Lock    │  │ • Real-time     │  │ • Queue Health  │  │
│  │ • Alerting      │  │   Progress      │  │ • Performance   │  │
│  │ • Dead Letter   │  │ • Job Events    │  │   Metrics       │  │
│  │ • Job Bridge    │  │ • Client Mgmt   │  │ • Error         │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 📁 Directory Structure

```
src/queues/
├── config/                          # Configuration files
│   ├── queue.config.ts              # Queue definitions and settings
│   ├── redis.config.ts              # Redis connection configuration
│   ├── redis.module.ts              # Redis module setup
│   └── redis.provider.ts            # Redis client provider
├── queues/                          # Queue service implementations
│   ├── wallet-operations.queue.ts   # Wallet sync and balance operations
│   ├── analysis-operations.queue.ts # P&L and behavior analysis
│   ├── similarity-operations.queue.ts # Multi-wallet similarity
│   └── enrichment-operations.queue.ts # Token metadata enrichment
├── processors/                      # Job processing logic
│   ├── wallet-operations.processor.ts # Wallet operation processor
│   ├── analysis-operations.processor.ts # Analysis processor (417 lines)
│   ├── similarity-operations.processor.ts # Similarity processor
│   └── enrichment-operations.processor.ts # Enrichment processor
├── services/                        # Core queue services
│   ├── redis-lock.service.ts        # Distributed locking (330 lines)
│   ├── alerting.service.ts          # Error alerting and notifications
│   ├── dead-letter-queue.service.ts # Failed job handling
│   ├── queue-health.service.ts      # Queue health monitoring
│   └── job-events-bridge.service.ts # Job event bridging
├── jobs/                            # Job type definitions
│   └── types/                       # TypeScript interfaces
│       └── index.ts                 # Job data structures (130 lines)
├── utils/                           # Utility functions
│   ├── batch-processor.ts           # Batch processing utilities
│   └── job-id-generator.ts          # Job ID generation
├── workers/                         # Worker implementations
│   └── similarity.worker.ts         # Similarity analysis worker
└── queue.module.ts                  # Main queue module (132 lines)
```

## 🔧 **Core Queue Configuration**

### **Queue Types & Specialization**

The system uses **four specialized queues** for optimal control and clear separation of concerns:

```typescript
export enum QueueNames {
  WALLET_OPERATIONS = 'wallet-operations',      // Sync, balance fetching
  ANALYSIS_OPERATIONS = 'analysis-operations',  // PNL, behavior analysis  
  SIMILARITY_OPERATIONS = 'similarity-operations', // Multi-wallet similarity
  ENRICHMENT_OPERATIONS = 'enrichment-operations'  // Token metadata, DexScreener
}
```

### **Queue-Specific Configurations**

Each queue has optimized settings for its specific workload:

#### **1. Wallet Operations Queue**
```typescript
[QueueNames.WALLET_OPERATIONS]: {
  queueOptions: {
    connection: redisConnection,
    defaultJobOptions: {
      removeOnComplete: 50,      // Keep recent successes
      removeOnFail: 100,         // Keep failures for debugging
      attempts: 3,               // Retry failed API calls
      backoff: {
        type: 'exponential',     // Exponential backoff
        delay: 2000              // 2 second initial delay
      }
    }
  },
  workerOptions: {
    connection: redisConnection,
    concurrency: 3,              // Process 3 jobs simultaneously
  }
}
```

#### **2. Analysis Operations Queue**
```typescript
[QueueNames.ANALYSIS_OPERATIONS]: {
  queueOptions: {
    connection: redisConnection,
    defaultJobOptions: {
      removeOnComplete: 100,     // Increased for better scaling
      removeOnFail: 200,         // Increased for error analysis
      attempts: 3,
      backoff: {
        type: 'exponential',     // Better for dashboard jobs
        delay: 3000              // 3 second initial delay
      }
    }
  },
  workerOptions: {
    connection: redisConnection,
    concurrency: 8,              // High concurrency for analysis
    maxStalledCount: 3,          // Prevent stuck jobs
    stalledInterval: 30000,      // 30 second stall check
  }
}
```

#### **3. Similarity Operations Queue**
```typescript
[QueueNames.SIMILARITY_OPERATIONS]: {
  queueOptions: {
    connection: redisConnection,
    defaultJobOptions: {
      removeOnComplete: 50,
      removeOnFail: 100,
      attempts: 3,
      backoff: {
        type: 'exponential',     // Exponential for similarity
        delay: 3000
      }
    }
  },
  workerOptions: {
    connection: redisConnection,
    concurrency: 2,              // Lower concurrency (CPU intensive)
  }
}
```

#### **4. Enrichment Operations Queue**
```typescript
[QueueNames.ENRICHMENT_OPERATIONS]: {
  queueOptions: {
    connection: redisConnection,
    defaultJobOptions: {
      removeOnComplete: 50,
      removeOnFail: 100,
      attempts: 3,
      backoff: {
        type: 'fixed',           // Fixed delay for enrichment
        delay: 2000
      }
    }
  },
  workerOptions: {
    connection: redisConnection,
    concurrency: 3,              // Moderate concurrency
  }
}
```

## ⏱️ **Job Timeout & Retry Strategy**

### **Job-Specific Timeouts**
```typescript
export const JobTimeouts = {
  'sync-wallet': {
    timeout: 10 * 60 * 1000,        // 10 minutes max
    staleAfter: 15 * 60 * 1000,     // 15 minutes = stale
    retryBackoff: 'exponential' as const
  },
  'analyze-pnl': {
    timeout: 5 * 60 * 1000,         // 5 minutes max
    staleAfter: 8 * 60 * 1000,      // 8 minutes = stale
    retryBackoff: 'fixed' as const
  },
  'analyze-behavior': {
    timeout: 5 * 60 * 1000,         // 5 minutes max
    staleAfter: 8 * 60 * 1000,      // 8 minutes = stale
    retryBackoff: 'fixed' as const
  },
  'calculate-similarity': {
    timeout: 30 * 60 * 1000,        // 30 minutes max (multi-wallet)
    staleAfter: 45 * 60 * 1000,     // 45 minutes = stale
    retryBackoff: 'exponential' as const
  },
  'enrich-token-balances': {
    timeout: 20 * 60 * 1000,        // 20 minutes max
    staleAfter: 30 * 60 * 1000,     // 30 minutes = stale
    retryBackoff: 'fixed' as const
  },
  'dashboard-wallet-analysis': {
    timeout: 15 * 60 * 1000,        // 15 minutes max
    staleAfter: 20 * 60 * 1000,     // 20 minutes = stale
    retryBackoff: 'exponential' as const
  }
};
```

### **Priority System**
```typescript
export enum JobPriority {
  CRITICAL = 10,      // User-initiated dashboard requests
  HIGH = 7,           // Similarity analysis for active users
  NORMAL = 5,         // Regular analysis requests  
  LOW = 3,            // Background metadata enrichment
  MAINTENANCE = 1     // Cleanup, batch processing
}
```

## 🔒 **Distributed Locking System**

### **Redis Lock Service**

The system implements **distributed locking** to prevent duplicate processing and ensure data consistency:

```typescript
@Injectable()
export class RedisLockService {
  /**
   * Acquire a distributed lock using Redis NX (SET IF NOT EXISTS)
   * @param lockKey - The key to lock on
   * @param lockValue - Unique identifier for this lock (usually job ID)
   * @param ttlMs - Time to live in milliseconds (default: 5 minutes)
   * @returns Promise<boolean> - true if lock acquired, false if already locked
   */
  async acquireLock(lockKey: string, lockValue: string, ttlMs = 5 * 60 * 1000): Promise<boolean> {
    try {
      // Use SET with NX (Not eXist) and PX (Expire in milliseconds)
      const result = await this.redis.set(lockKey, lockValue, 'PX', ttlMs, 'NX');
      
      if (result === 'OK') {
        this.logger.debug(`Lock acquired: ${truncate(lockKey)} with value: ${truncate(lockValue)}`);
        return true;
      } else {
        this.logger.debug(`Lock already exists: ${truncate(lockKey)}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Failed to acquire lock ${truncate(lockKey)}:`, error);
      return false;
    }
  }

  /**
   * Release a distributed lock safely (only if we own it)
   * @param lockKey - The key to unlock
   * @param lockValue - The unique identifier that was used to acquire the lock
   * @returns Promise<boolean> - true if lock was released, false otherwise
   */
  async releaseLock(lockKey: string, lockValue: string): Promise<boolean> {
    try {
      // Lua script to atomically check and delete the lock
      // This ensures we only delete the lock if we own it
      const luaScript = `
        local current = redis.call('GET', KEYS[1])
        if current == ARGV[1] then
          return redis.call('DEL', KEYS[1])
        else
          return 0
        end
      `;

      const result = await this.redis.eval(luaScript, 1, lockKey, lockValue) as number;
      
      if (result === 1) {
        this.logger.debug(`Lock released: ${truncate(lockKey)}`);
        return true;
      } else {
        this.logger.debug(`Lock not owned or doesn't exist: ${truncate(lockKey)}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Failed to release lock ${truncate(lockKey)}:`, error);
      return false;
    }
  }
}
```

### **Lock Key Generation**
```typescript
// Lock keys for different operations
export class RedisLockService {
  static createWalletLockKey(walletAddress: string, operation: string): string {
    return `lock:wallet:${walletAddress}:${operation}`;
  }

  static createAnalysisLockKey(walletAddress: string, analysisType: string): string {
    return `lock:analysis:${walletAddress}:${analysisType}`;
  }

  static createSimilarityLockKey(requestId: string): string {
    return `lock:similarity:${requestId}`;
  }
}
```

## 📊 **Job Processing Architecture**

### **Analysis Operations Processor**

The **Analysis Operations Processor** (417 lines) handles P&L and behavioral analysis with comprehensive error handling and progress tracking:

```typescript
@Injectable()
export class AnalysisOperationsProcessor {
  private readonly worker: Worker;

  constructor(
    private readonly redisLockService: RedisLockService,
    private readonly pnlAnalysisService: PnlAnalysisService,
    private readonly behaviorService: BehaviorService,
    private readonly databaseService: DatabaseService,
    private readonly heliusSyncService: HeliusSyncService,
    private readonly enrichmentOperationsQueue: EnrichmentOperationsQueue,
    private readonly heliusApiClient: HeliusApiClient,
    private readonly jobProgressGateway: JobProgressGateway,
    private readonly tokenInfoService: TokenInfoService
  ) {
    const config = QueueConfigs[QueueNames.ANALYSIS_OPERATIONS];
    
    this.worker = new Worker(
      QueueNames.ANALYSIS_OPERATIONS,
      async (job: Job) => this.processJob(job),
      config.workerOptions
    );

    // Event handlers for monitoring
    this.worker.on('completed', (job) => {
      this.logger.log(`Job ${job.id} from queue ${job.queueName} completed successfully`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} from queue ${job?.queueName} failed:`, err);
    });
  }

  private async processJob(job: Job): Promise<any> {
    const jobName = job.name;
    this.logger.log(`Processing job '${jobName}' with ID ${job.id}`);
    
    switch (jobName) {
      case 'analyze-pnl':
        return this.processAnalyzePnl(job as Job<AnalyzePnlJobData>);
      case 'analyze-behavior':
        return this.processAnalyzeBehavior(job as Job<AnalyzeBehaviorJobData>);
      case 'dashboard-wallet-analysis':
        return this.processDashboardWalletAnalysis(job as Job<DashboardWalletAnalysisJobData>);
      default:
        this.logger.error(`Unknown job name: ${jobName} for job ID ${job.id}`);
        throw new Error(`Unknown job type: ${jobName}`);
    }
  }
}
```

### **PnL Analysis Processing**

```typescript
async processAnalyzePnl(job: Job<AnalyzePnlJobData>): Promise<AnalysisResult> {
  const { walletAddress, forceRefresh, requestId } = job.data;
  const timeoutMs = JobTimeouts['analyze-pnl'].timeout;
  const startTime = Date.now();
  
  // Deduplication check
  const expectedJobId = generateJobId.analyzePnl(walletAddress, requestId);
  if (job.id !== expectedJobId) {
    this.logger.warn(`Job ID mismatch - possible duplicate: expected ${expectedJobId}, got ${job.id}`);
    throw new Error(`Job ID mismatch - possible duplicate`);
  }

  // Acquire lock
  const lockKey = RedisLockService.createWalletLockKey(walletAddress, 'pnl');
  const lockAcquired = await this.redisLockService.acquireLock(lockKey, job.id!, timeoutMs);
  
  if (!lockAcquired) {
    this.logger.warn(`Could not acquire lock for PnL analysis on ${walletAddress}, job ${job.id} will be retried.`);
    throw new Error(`PnL analysis already in progress for wallet ${walletAddress}`);
  }

  try {
    await job.updateProgress(5);
    this.logger.log(`Starting PnL analysis for ${walletAddress}`);

    // Idempotency check
    if (!forceRefresh) {
      const wallet = await this.databaseService.getWallet(walletAddress);
      const lastAnalysisAge = wallet?.analyzedTimestampEnd 
        ? Date.now() - wallet.analyzedTimestampEnd * 1000
        : Infinity;
      
      if (lastAnalysisAge < 10 * 60 * 1000) { // 10 minutes idempotency threshold
        await job.updateProgress(100);
        this.logger.log(`Skipping PnL analysis for ${walletAddress} as recent data exists.`);
        return { 
          success: true, 
          walletAddress, 
          analysisType: 'pnl', 
          timestamp: Date.now(), 
          processingTimeMs: Date.now() - startTime 
        };
      }
    }

    // Execute analysis
    await job.updateProgress(20);
    this.checkTimeout(startTime, timeoutMs, 'Starting PnL analysis');

    const pnlResult = await this.pnlAnalysisService.analyzeWalletPnl(walletAddress);
    
    await job.updateProgress(90);
    this.checkTimeout(startTime, timeoutMs, 'Completing PnL analysis');

    if (!pnlResult) {
      throw new Error(`PnL analysis returned no results for wallet ${walletAddress}`);
    }

    await job.updateProgress(100);

    const result: AnalysisResult = {
      success: true,
      walletAddress,
      analysisType: 'pnl',
      resultId: pnlResult.runId?.toString(),
      timestamp: Date.now(),
      processingTimeMs: Date.now() - startTime
    };

    this.logger.log(`PnL analysis completed for ${walletAddress}. RunId: ${pnlResult.runId}`);
    return result;

  } catch (error) {
    this.logger.error(`PnL analysis failed for ${walletAddress}:`, error);
    throw error;
  } finally {
    await this.redisLockService.releaseLock(lockKey, job.id!);
  }
}
```

## 🌐 **Real-Time Progress Tracking**

### **WebSocket Gateway**

The **Job Progress Gateway** provides real-time updates to clients through WebSocket connections:

```typescript
@WebSocketGateway({
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  path: "/socket.io/",
})
export class JobProgressGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(JobProgressGateway.name);
  private readonly redisSubscriber: Redis;
  private readonly clientSubscriptions = new Map<string, ClientSubscription>();

  constructor(@Inject(REDIS_CLIENT) private readonly redisPublisher: Redis) {
    // Create dedicated subscriber for Redis events
    this.redisSubscriber = this.redisPublisher.duplicate();
    
    this.redisSubscriber.on('error', (err) => 
      this.logger.error('Redis subscriber connection error:', err)
    );
  }

  afterInit(server: Server) {
    this.server = server;
    this.logger.log('WebSocket Gateway initialized');
    
    // Set up server-level event handlers
    this.server.on('connection_error', (err) => {
      this.logger.error(`Socket.IO connection error: ${err.message}`, err);
    });
    
    setImmediate(() => this.setupRedisSubscriptions());
  }

  handleConnection(client: Socket) {
    const clientId = client.id;
    this.logger.log(`Client connected: ${clientId}`);
    this.clientSubscriptions.set(clientId, { jobIds: new Set() });
    client.emit('connected', { 
      message: 'Connected to job progress updates', 
      clientId, 
      timestamp: Date.now() 
    });
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.clientSubscriptions.delete(client.id);
  }
}
```

### **Progress Event Types**
```typescript
interface JobProgressEvent {
  jobId: string;
  progress: number | object;
  details?: string;
  timestamp: number;
  queue: string;
}

interface JobCompletedEvent {
  jobId: string;
  result: any;
  timestamp: number;
  queue: string;
  processingTime: number;
  totalTime?: number; // Total time from queue to completion
}

interface JobFailedEvent {
  jobId: string;
  error: string;
  timestamp: number;
  queue: string;
  attempts: number;
  maxAttempts: number;
}

interface JobQueueToStartEvent {
  jobId: string;
  queueToStartTime: number;
  timestamp: number;
  queue: string;
}
```

## 📋 **Job Data Structures**

### **Core Job Types**

The system defines comprehensive job data structures for different operations:

```typescript
// Wallet Operations Job Data
export interface SyncWalletJobData {
  walletAddress: string;
  syncOptions: {
    fetchAll?: boolean;
    forceRefresh?: boolean;
    fetchOlder?: boolean;
  };
  priority?: number;
  requestId?: string;        // For tracking/correlation
}

export interface FetchBalanceJobData {
  walletAddress: string;
  requestId?: string;
}

// Analysis Operations Job Data
export interface AnalyzePnlJobData {
  walletAddress: string;
  dependsOnSyncJob?: string; // Job ID dependency
  forceRefresh?: boolean;
  requestId?: string;
}

export interface AnalyzeBehaviorJobData {
  walletAddress: string;
  dependsOnSyncJob?: string; // Job ID dependency
  config?: {
    timeRange?: {
      from?: Date;
      to?: Date;
    };
    excludeMints?: string[];
    minTradingVolume?: number;
  };
  requestId?: string;
}

// Dashboard Wallet Analysis Job Data
export interface DashboardWalletAnalysisJobData {
  walletAddress: string;
  requestId: string;
  forceRefresh?: boolean;
  enrichMetadata?: boolean;
  failureThreshold?: number;    // Partial failure tolerance (default 0.8)
  timeoutMinutes?: number;
}

// Comprehensive Similarity Flow
export interface ComprehensiveSimilarityFlowData {
  walletAddresses: string[];
  requestId: string;
  walletsNeedingSync?: string[]; // Specific wallets that need sync
  enrichMetadata?: boolean;     // Whether to enrich token metadata
  failureThreshold?: number;    // Partial failure tolerance (default 0.8)
  timeoutMinutes?: number;      // Job-level timeout (default 45)
  similarityConfig?: {
    vectorType?: 'capital' | 'binary';
    minSharedTokens?: number;
    timeRange?: {
      from?: Date;
      to?: Date;
    };
    excludeMints?: string[];
  };
}

// Enrichment Operations Job Data
export interface EnrichTokenBalancesJobData {
  walletBalances: Record<string, { tokenBalances: { mint: string, uiBalance: number }[] }>;
  requestId: string;
  priority?: number;
  optimizationHint?: 'small' | 'large' | 'massive'; // For smart batching
  enrichmentContext?: 'dashboard-analysis' | 'similarity-analysis' | 'manual';
}
```

### **Job Result Types**
```typescript
export interface JobResult {
  success: boolean;
  data?: any;
  error?: string;
  timestamp: number;
  processingTimeMs?: number;
}

export interface WalletSyncResult extends JobResult {
  walletAddress: string;
  status: 'synced' | 'already-current' | 'failed';
  lastSync?: Date;
}

export interface AnalysisResult extends JobResult {
  walletAddress: string;
  analysisType: 'pnl' | 'behavior';
  resultId?: string; // Reference to stored analysis result
}

export interface SimilarityFlowResult extends JobResult {
  requestId: string;
  enrichmentJobId?: string; // Job ID for background enrichment
  metadata: {
    requestedWallets: number;
    processedWallets: number;
    failedWallets: number;
    invalidWallets?: string[];
    systemWallets?: string[];
    systemWalletDetails?: Array<{ address: string; tokenCount: number; reason: string }>;
    successRate: number;
    processingTimeMs: number;
  };
  similarityResultId?: string; // Reference to stored similarity result
}

export interface EnrichTokenBalancesResult extends JobResult {
  enrichedBalances: Record<string, any>;
  metadata: {
    totalTokens: number;
    enrichedTokens: number;
    backgroundProcessedTokens: number;
    processingStrategy: 'sync' | 'background' | 'hybrid';
  };
}
```

## 🔧 **Redis Configuration**

### **Connection Settings**
```typescript
export const redisConfig: ConnectionOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0', 10),
  maxRetriesPerRequest: null, // Required by BullMQ
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  lazyConnect: true,
};

export const redisConnection = redisConfig;
```

### **BullMQ Integration**
```typescript
@Module({
  imports: [
    ConfigModule,
    RedisModule,
    
    // Register BullMQ queues with NestJS
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        connection: redisConnection,
      }),
      inject: [ConfigService],
    }),

    // Register individual queues
    BullModule.registerQueue(
      { name: QueueNames.WALLET_OPERATIONS },
      { name: QueueNames.ANALYSIS_OPERATIONS },
      { name: QueueNames.SIMILARITY_OPERATIONS },
      { name: QueueNames.ENRICHMENT_OPERATIONS }
    ),
  ],
  // ... rest of module configuration
})
```

## 📊 **Monitoring & Health**

### **Queue Health Service**
```typescript
@Injectable()
export class QueueHealthService {
  private readonly logger = new Logger(QueueHealthService.name);
  private readonly registeredQueues = new Map<string, Queue>();

  registerQueue(queueName: string, queue: Queue) {
    this.registeredQueues.set(queueName, queue);
    this.logger.log(`Registered queue for health monitoring: ${queueName}`);
  }

  async getQueueHealth(): Promise<QueueHealthStatus[]> {
    const healthStatuses: QueueHealthStatus[] = [];

    for (const [queueName, queue] of this.registeredQueues) {
      try {
        const waiting = await queue.getWaiting();
        const active = await queue.getActive();
        const completed = await queue.getCompleted();
        const failed = await queue.getFailed();
        const delayed = await queue.getDelayed();

        healthStatuses.push({
          queueName,
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          delayed: delayed.length,
          timestamp: Date.now()
        });
      } catch (error) {
        this.logger.error(`Failed to get health status for queue ${queueName}:`, error);
        healthStatuses.push({
          queueName,
          error: error.message,
          timestamp: Date.now()
        });
      }
    }

    return healthStatuses;
  }
}
```

### **Alerting Service**
```typescript
@Injectable()
export class AlertingService {
  private readonly logger = new Logger(AlertingService.name);

  async alertJobFailure(job: Job, error: Error): Promise<void> {
    const alert = {
      type: 'JOB_FAILURE',
      queue: job.queueName,
      jobId: job.id,
      jobName: job.name,
      error: error.message,
      stack: error.stack,
      timestamp: Date.now(),
      attempts: job.attemptsMade,
      maxAttempts: job.opts.attempts || 3
    };

    this.logger.error('Job failure alert:', alert);
    
    // Send to monitoring system, Slack, etc.
    await this.sendAlert(alert);
  }

  async alertQueueStall(queueName: string, stalledJobs: Job[]): Promise<void> {
    const alert = {
      type: 'QUEUE_STALL',
      queue: queueName,
      stalledJobCount: stalledJobs.length,
      stalledJobIds: stalledJobs.map(j => j.id),
      timestamp: Date.now()
    };

    this.logger.warn('Queue stall alert:', alert);
    await this.sendAlert(alert);
  }
}
```

## 🚀 **Performance Optimization**

### **Concurrency Tuning**
```typescript
// Analysis Operations: High concurrency for CPU-bound tasks
workerOptions: {
  connection: redisConnection,
  concurrency: 8,               // Process 8 jobs simultaneously
  maxStalledCount: 3,           // Prevent stuck jobs
  stalledInterval: 30000,       // 30 second stall check
}

// Similarity Operations: Lower concurrency for memory-intensive tasks
workerOptions: {
  connection: redisConnection,
  concurrency: 2,               // Lower concurrency (CPU intensive)
}

// Wallet Operations: Moderate concurrency for I/O-bound tasks
workerOptions: {
  connection: redisConnection,
  concurrency: 3,               // Moderate concurrency
}
```

### **Job Cleanup Strategy**
```typescript
defaultJobOptions: {
  removeOnComplete: 100,        // Keep recent successes for debugging
  removeOnFail: 200,            // Keep failures for error analysis
  attempts: 3,                  // Retry failed jobs
  backoff: {
    type: 'exponential',        // Exponential backoff for better failure handling
    delay: 3000                 // 3 second initial delay
  }
}
```

## 🔄 **Job Dependencies & Workflows**

### **Sequential Processing**
```typescript
// Example: PnL analysis depends on wallet sync
export interface AnalyzePnlJobData {
  walletAddress: string;
  dependsOnSyncJob?: string; // Job ID dependency
  forceRefresh?: boolean;
  requestId?: string;
}

// In the processor
if (job.data.dependsOnSyncJob) {
  const syncJob = await this.walletOperationsQueue.getJob(job.data.dependsOnSyncJob);
  if (!syncJob || syncJob.finishedOn === undefined) {
    throw new Error(`Dependency job ${job.data.dependsOnSyncJob} not completed`);
  }
}
```

### **Batch Processing**
```typescript
// Enrichment operations with smart batching
export interface EnrichTokenBalancesJobData {
  walletBalances: Record<string, { tokenBalances: { mint: string, uiBalance: number }[] }>;
  requestId: string;
  priority?: number;
  optimizationHint?: 'small' | 'large' | 'massive'; // For smart batching
  enrichmentContext?: 'dashboard-analysis' | 'similarity-analysis' | 'manual';
}
```

## 🛠️ **Development & Debugging**

### **Job ID Generation**
```typescript
export const generateJobId = {
  analyzePnl: (walletAddress: string, requestId: string): string => {
    return `pnl_${walletAddress}_${requestId}_${Date.now()}`;
  },
  
  analyzeBehavior: (walletAddress: string, requestId: string): string => {
    return `behavior_${walletAddress}_${requestId}_${Date.now()}`;
  },
  
  syncWallet: (walletAddress: string, requestId: string): string => {
    return `sync_${walletAddress}_${requestId}_${Date.now()}`;
  }
};
```

### **Timeout Checking**
```typescript
private checkTimeout(startTime: number, timeoutMs: number, operation: string): void {
  const elapsed = Date.now() - startTime;
  if (elapsed > timeoutMs) {
    throw new Error(`Operation ${operation} exceeded timeout of ${timeoutMs}ms (elapsed: ${elapsed}ms)`);
  }
}
```

## 🔮 **Future Enhancements**

### **Planned Features**
- **Dynamic Concurrency**: Auto-adjust concurrency based on system load
- **Job Prioritization**: Intelligent job scheduling based on user activity
- **Circuit Breaker**: Automatic queue isolation on repeated failures
- **Metrics Dashboard**: Real-time queue performance visualization

### **Scaling Strategies**
- **Horizontal Scaling**: Multiple worker instances across servers
- **Queue Partitioning**: Split large queues by wallet address ranges
- **Load Balancing**: Distribute jobs across worker pools
- **Caching Layer**: Redis-based job result caching

---

## 📚 **Related Documentation**

- **[Core Analysis Engine](./../core/README.md)** - Business logic implementation
- **[Backend API](./../api/README.md)** - REST API endpoints
- **[Database Schema](./../database/README.md)** - Data structures
- **[Performance Tuning](./../performance/README.md)** - Optimization strategies
- **[Deployment Guide](./../deployment/README.md)** - Production deployment
