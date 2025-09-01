import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../config/redis.provider';

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
  private lastConnectionClosedLogAt: number | null = null;
  
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

  constructor(@Inject(REDIS_CLIENT) redisClient: Redis) {
    this.redis = redisClient;
  }

  private isRedisConnected(): boolean {
    return this.redis && (this.redis.status as string) === 'connected';
  }

  private shouldLogConnectionClosed(): boolean {
    const now = Date.now();
    const cooldownMs = 60_000; // 1 minute
    if (!this.lastConnectionClosedLogAt || now - this.lastConnectionClosedLogAt > cooldownMs) {
      this.lastConnectionClosedLogAt = now;
      return true;
    }
    return false;
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
      // If Redis is not connected, avoid calling queue methods that will throw
      if (!this.isRedisConnected()) {
        return {
          queueName,
          status: 'unhealthy',
          stats: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 },
          details: {
            isRunning: false,
            isPaused: false,
            processingCapacity: 0,
          },
          issues: ['Redis not connected; skipping queue metrics'],
        };
      }

      // Get queue statistics (optimized with batch limits)
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaiting(0, this.BATCH_SIZE), // Limit to first 100 waiting jobs
        queue.getActive(0, 50), // Limit to first 50 active jobs
        queue.getCompleted(0, 20), // Limit to first 20 completed jobs for metrics
        queue.getFailed(0, 20), // Limit to first 20 failed jobs for metrics
        queue.getDelayed(0, 10), // Limit to first 10 delayed jobs
      ]);

      const stats = {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
        paused: await queue.isPaused() ? 1 : 0,
      };

      // Calculate health metrics
      const totalJobs = stats.waiting + stats.active + stats.completed + stats.failed;
      const failureRate = totalJobs > 0 ? stats.failed / totalJobs : 0;
      const isPaused = stats.paused > 0;

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

      // Check for stale active jobs (optimized - check only first 20 jobs)
      const now = Date.now();
      let staleJobs = 0;
      let lastJobProcessed: Date | undefined;

      const jobsToCheck = active.slice(0, 20); // Only check first 20 active jobs for performance
      for (const job of jobsToCheck) {
        if (job.processedOn && (now - job.processedOn) > this.STALE_JOB_THRESHOLD) {
          staleJobs++;
        }
        if (job.processedOn && (!lastJobProcessed || job.processedOn > lastJobProcessed.getTime())) {
          lastJobProcessed = new Date(job.processedOn);
        }
      }

      if (staleJobs > 0) {
        issues.push(`${staleJobs} stale active jobs detected`);
      }

      // Determine overall status
      let status: 'healthy' | 'degraded' | 'unhealthy';
      if (issues.length === 0) {
        status = 'healthy';
      } else if (issues.some(issue => issue.includes('paused') || issue.includes('stale'))) {
        status = 'unhealthy';
      } else {
        status = 'degraded';
      }

      // Calculate average processing time from recent completed jobs (optimized sample size)
      let avgProcessingTime: number | undefined;
      if (completed.length > 0) {
        const recentCompleted = completed.slice(0, 5); // Only last 5 jobs for performance
        const processingTimes = recentCompleted
          .filter(job => job.processedOn && job.finishedOn)
          .map(job => job.finishedOn! - job.processedOn!);
        
        if (processingTimes.length > 0) {
          avgProcessingTime = processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length;
        }
      }

      return {
        queueName,
        status,
        stats,
        details: {
          isRunning: !isPaused && stats.active >= 0,
          isPaused,
          processingCapacity: this.QUEUE_HEALTH_THRESHOLDS.maxActiveJobs,
          avgProcessingTime,
          errorRate: failureRate,
          lastJobProcessed,
        },
        issues,
      };

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Connection is closed') || message.includes('ECONNREFUSED')) {
        if (this.shouldLogConnectionClosed()) {
          this.logger.warn(`Queue health check suppressed repeated errors for ${queueName}: ${message}`);
        }
      } else {
        this.logger.error(`Error checking health for queue ${queueName}:`, error);
      }
      return {
        queueName,
        status: 'unhealthy',
        stats: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 },
        details: {
          isRunning: false,
          isPaused: false,
          processingCapacity: 0,
        },
        issues: [`Health check failed: ${message}`],
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
      // If connection isn't established, avoid ping to reduce noise
      const connectionStatus = this.redis.status as 'connected' | 'connecting' | 'disconnected' | 'error';
      if (connectionStatus !== 'connected') {
        return {
          status: 'unhealthy',
          connectionStatus,
          issues: ['Redis not connected'],
        };
      }

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
      const connectionStatusAfter = this.redis.status as 'connected' | 'connecting' | 'disconnected' | 'error';
      let status: 'healthy' | 'degraded' | 'unhealthy';

      if (connectionStatusAfter !== 'connected') {
        status = 'unhealthy';
        issues.push(`Redis connection status: ${connectionStatusAfter}`);
      } else if (issues.length === 0) {
        status = 'healthy';
      } else {
        status = 'degraded';
      }

      return {
        status,
        connectionStatus: connectionStatusAfter,
        responseTime,
        memory,
        clients,
        uptime,
        issues,
      };

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Connection is closed') || message.includes('ECONNREFUSED')) {
        if (this.shouldLogConnectionClosed()) {
          this.logger.warn(`Redis health check suppressed repeated errors: ${message}`);
        }
      } else {
        this.logger.error('Redis health check failed:', error);
      }
      return {
        status: 'unhealthy',
        connectionStatus: 'error',
        issues: [`Redis health check failed: ${message}`],
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
    this.healthCheckTimer = setInterval(async () => {
      await this.getOverallHealth();
    }, this.HEALTH_CHECK_INTERVAL);
  }
} 