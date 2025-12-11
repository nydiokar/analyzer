import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis, RedisOptions } from 'ioredis';
import { redisConfig } from '../config/redis.config';

export interface QueueHealthStatus {
  queueName: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  stats: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  };
  details: {
    isRunning: boolean;
    isPaused: boolean;
    processingCapacity: number;
    avgProcessingTime?: number;
    errorRate?: number;
    lastJobProcessed?: Date;
  };
  issues: string[];
}

export interface RedisHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'error';
  responseTime?: number;
  memory?: {
    used: string;
    peak: string;
  };
  clients?: number;
  uptime?: number;
  issues: string[];
}

export interface OverallHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  redis: RedisHealthStatus;
  queues: QueueHealthStatus[];
  summary: {
    totalQueues: number;
    healthyQueues: number;
    degradedQueues: number;
    unhealthyQueues: number;
    totalJobs: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
    };
  };
  issues: string[];
}

@Injectable()
export class QueueHealthService implements OnModuleInit {
  private readonly logger = new Logger(QueueHealthService.name);
  private readonly redis: Redis;
  private readonly monitoredQueues = new Map<string, Queue>();
  
  // Health thresholds
  private readonly QUEUE_HEALTH_THRESHOLDS = {
    maxWaitingJobs: 1000,
    maxActiveJobs: 50,
    maxFailureRate: 0.1, // 10%
    maxResponseTime: 5000, // 5 seconds
    staleJobThreshold: 30 * 60 * 1000, // 30 minutes
  };

  // Performance optimization settings
  private readonly HEALTH_CHECK_INTERVAL = 30000; // 30 seconds (was implicit)
  private readonly STALE_JOB_THRESHOLD = 15 * 60 * 1000; // 15 minutes
  private readonly BATCH_SIZE = 100; // Limit job fetching
  private healthCheckTimer?: NodeJS.Timeout;

  constructor() {
    // Create Redis instance using environment variables directly for type safety
    const ioredisOptions: RedisOptions = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
      // Enhanced reconnection strategy
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000); // Exponential backoff, max 2s
        return delay;
      },
      connectTimeout: 10000, // 10 seconds
      keepAlive: 30000, // 30 seconds
      enableOfflineQueue: false, // Disable offline queue for health checks (fail fast)
    };

    this.redis = new Redis(ioredisOptions);

    // Add event listeners for health monitoring
    this.redis.on('error', (err) => {
      if (!err.message.includes('ECONNREFUSED') && !err.message.includes('LOADING')) {
        this.logger.error('Health check Redis error:', err.message);
      }
    });

    this.redis.on('connect', () => {
      this.logger.log('Health check Redis connected');
    });

    this.redis.on('ready', () => {
      this.logger.log('Health check Redis ready');
    });
  }

  /**
   * Register a queue for health monitoring
   */
  registerQueue(queueName: string, queue: Queue): void {
    this.monitoredQueues.set(queueName, queue);
    this.logger.log(`Registered queue for health monitoring: ${queueName}`);
  }

  /**
   * Get health status for a specific queue
   */
  async getQueueHealth(queueName: string): Promise<QueueHealthStatus> {
    const queue = this.monitoredQueues.get(queueName);
    if (!queue) {
      return {
        queueName,
        status: 'unhealthy',
        stats: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 },
        details: {
          isRunning: false,
          isPaused: false,
          processingCapacity: 0,
        },
        issues: [`Queue ${queueName} not found or not registered`],
      };
    }

    try {
      // Get queue statistics using lightweight count methods (no job objects loaded!)
      const [waiting, active, completed, failed, delayed, isPaused] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
        queue.isPaused(),
      ]);

      const stats = {
        waiting,
        active,
        completed,
        failed,
        delayed,
        paused: isPaused ? 1 : 0,
      };

      // Calculate health metrics
      const totalJobs = stats.waiting + stats.active + stats.completed + stats.failed;
      const failureRate = totalJobs > 0 ? stats.failed / totalJobs : 0;

      // Check for issues
      const issues: string[] = [];

      if (stats.waiting > this.QUEUE_HEALTH_THRESHOLDS.maxWaitingJobs) {
        issues.push(`Too many waiting jobs: ${stats.waiting}`);
      }

      if (stats.active > this.QUEUE_HEALTH_THRESHOLDS.maxActiveJobs) {
        issues.push(`Too many active jobs: ${stats.active}`);
      }

      if (failureRate > this.QUEUE_HEALTH_THRESHOLDS.maxFailureRate) {
        issues.push(`High failure rate: ${(failureRate * 100).toFixed(1)}%`);
      }

      if (isPaused) {
        issues.push('Queue is paused');
      }

      // Determine overall status
      let status: 'healthy' | 'degraded' | 'unhealthy';
      if (issues.length === 0) {
        status = 'healthy';
      } else if (issues.some(issue => issue.includes('paused'))) {
        status = 'unhealthy';
      } else {
        status = 'degraded';
      }

      return {
        queueName,
        status,
        stats,
        details: {
          isRunning: !isPaused && stats.active >= 0,
          isPaused,
          processingCapacity: this.QUEUE_HEALTH_THRESHOLDS.maxActiveJobs,
          errorRate: failureRate,
          // avgProcessingTime and lastJobProcessed removed (would require fetching job objects)
        },
        issues,
      };

    } catch (error) {
      this.logger.error(`Error checking health for queue ${queueName}:`, error);
      return {
        queueName,
        status: 'unhealthy',
        stats: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 },
        details: {
          isRunning: false,
          isPaused: false,
          processingCapacity: 0,
        },
        issues: [`Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  /**
   * Get Redis health status
   */
  async getRedisHealth(): Promise<RedisHealthStatus> {
    const issues: string[] = [];
    const startTime = Date.now();

    try {
      // Test Redis connectivity with a simple ping
      const pingResult = await this.redis.ping();
      const responseTime = Date.now() - startTime;

      if (pingResult !== 'PONG') {
        issues.push('Redis ping failed');
      }

      // Get Redis info
      const info = await this.redis.info('memory,clients,server');
      const infoLines = info.split('\r\n');
      const infoObj: Record<string, string> = {};
      
      for (const line of infoLines) {
        if (line.includes(':')) {
          const [key, value] = line.split(':');
          infoObj[key] = value;
        }
      }

      // Parse memory info
      const memory = {
        used: infoObj.used_memory_human || 'unknown',
        peak: infoObj.used_memory_peak_human || 'unknown',
      };

      const clients = parseInt(infoObj.connected_clients || '0', 10);
      const uptime = parseInt(infoObj.uptime_in_seconds || '0', 10);

      // Check for issues
      if (responseTime > this.QUEUE_HEALTH_THRESHOLDS.maxResponseTime) {
        issues.push(`High response time: ${responseTime}ms`);
      }

      if (clients > 100) { // Arbitrary threshold
        issues.push(`High number of clients: ${clients}`);
      }

      // Determine status
      const connectionStatus = this.redis.status as 'connected' | 'connecting' | 'disconnected' | 'error';
      let status: 'healthy' | 'degraded' | 'unhealthy';

      if (connectionStatus !== 'connected') {
        status = 'unhealthy';
        issues.push(`Redis connection status: ${connectionStatus}`);
      } else if (issues.length === 0) {
        status = 'healthy';
      } else {
        status = 'degraded';
      }

      return {
        status,
        connectionStatus,
        responseTime,
        memory,
        clients,
        uptime,
        issues,
      };

    } catch (error) {
      this.logger.error('Redis health check failed:', error);
      return {
        status: 'unhealthy',
        connectionStatus: 'error',
        issues: [`Redis health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  /**
   * Get overall system health status
   */
  async getOverallHealth(): Promise<OverallHealthStatus> {
    const timestamp = new Date().toISOString();
    
    // Get Redis health
    const redis = await this.getRedisHealth();

    // Get health for all registered queues
    const queueNames = Array.from(this.monitoredQueues.keys());
    const queues = await Promise.all(
      queueNames.map(name => this.getQueueHealth(name))
    );

    // Calculate summary statistics
    const summary = {
      totalQueues: queues.length,
      healthyQueues: queues.filter(q => q.status === 'healthy').length,
      degradedQueues: queues.filter(q => q.status === 'degraded').length,
      unhealthyQueues: queues.filter(q => q.status === 'unhealthy').length,
      totalJobs: {
        waiting: queues.reduce((sum, q) => sum + q.stats.waiting, 0),
        active: queues.reduce((sum, q) => sum + q.stats.active, 0),
        completed: queues.reduce((sum, q) => sum + q.stats.completed, 0),
        failed: queues.reduce((sum, q) => sum + q.stats.failed, 0),
      },
    };

    // Collect all issues
    const issues: string[] = [];
    if (redis.issues.length > 0) {
      issues.push(...redis.issues.map(issue => `Redis: ${issue}`));
    }
    
    for (const queue of queues) {
      if (queue.issues.length > 0) {
        issues.push(...queue.issues.map(issue => `${queue.queueName}: ${issue}`));
      }
    }

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (redis.status === 'unhealthy' || summary.unhealthyQueues > 0) {
      status = 'unhealthy';
    } else if (redis.status === 'degraded' || summary.degradedQueues > 0) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    return {
      status,
      timestamp,
      redis,
      queues,
      summary,
      issues,
    };
  }

  /**
   * Get a simplified health status for basic monitoring
   */
  async getSimpleHealthStatus(): Promise<{ status: string; message: string }> {
    try {
      const health = await this.getOverallHealth();
      
      let message: string;
      switch (health.status) {
        case 'healthy':
          message = `All systems operational - ${health.summary.totalQueues} queues, ${health.summary.totalJobs.active} active jobs`;
          break;
        case 'degraded':
          message = `System degraded - ${health.issues.length} issues detected`;
          break;
        case 'unhealthy':
          message = `System unhealthy - ${health.summary.unhealthyQueues} queues down, Redis: ${health.redis.status}`;
          break;
      }

      return {
        status: health.status,
        message,
      };
    } catch (error) {
      this.logger.error('Simple health check failed:', error);
      return {
        status: 'unhealthy',
        message: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  async onModuleInit() {
    // Health checks now run ON-DEMAND only (via API endpoint)
    // Removed automatic polling to prevent memory accumulation from fetching 760+ job objects every 30s
    this.logger.log('QueueHealthService initialized (on-demand mode). Access via /health/queues endpoint.');
  }

  async onModuleDestroy() {
    // Cleanup timer if it was ever set (future-proofing)
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    // Close Redis connection
    await this.redis.quit();
  }
} 