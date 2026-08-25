
import {
  WebSocketGateway,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Inject, Logger, forwardRef } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../queues/config/redis.provider';
import { getErrorMessage, getErrorDetails } from '../../core/utils/error-utils';
import { JobsService } from '../services/jobs.service';


// --- Event Interfaces ---
interface JobProgressEvent {
  jobId: string;
  progress: number | object;
  details?: string;
  timestamp: number;
  queue: string;
  userId?: string; // For room-based broadcasting
}

interface JobCompletedEvent {
  jobId: string;
  result: any;
  timestamp: number;
  queue: string;
  processingTime: number;
  totalTime?: number; // Total time from queue to completion
  userId?: string; // For room-based broadcasting
}

interface JobFailedEvent {
  jobId: string;
  error: string;
  timestamp: number;
  queue: string;
  attempts: number;
  maxAttempts: number;
  userId?: string; // For room-based broadcasting
}

interface JobQueueToStartEvent {
  jobId: string;
  queueToStartTime: number;
  timestamp: number;
  queue: string;
  userId?: string; // For room-based broadcasting
}

type JobEventCounter = {
  progress: number;
  completed: number;
  failed: number;
  queueToStart: number;
};

@WebSocketGateway({
  namespace: '/jobs',
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: [ 'websocket', 'polling'],
})
export class JobProgressGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(JobProgressGateway.name);
  private readonly debugJobBridge = process.env.JOB_SOCKET_DEBUG === 'true';
  private readonly redisSubscriber: Redis;
  private isSubscribed = false;
  private subscriptionRetryCount = 0;
  private subscriptionRetryTimer?: NodeJS.Timeout;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redisPublisher: Redis,
    @Inject(forwardRef(() => JobsService)) private readonly jobsService: JobsService,
  ) {
    // The publisher is injected. We create a dedicated subscriber from it.
    this.redisSubscriber = this.redisPublisher.duplicate();

    // Explicitly connect since we use lazyConnect: true
    this.redisSubscriber.connect().catch((err) => {
      this.logger.warn(`Failed to connect Redis subscriber: ${err.message}`);
    });

    // Track subscriber errors to avoid spam
    let lastSubscriberError: string | null = null;
    let subscriberErrorCount = 0;

    this.redisSubscriber.on('error', (err) => {
      const errorMessage = err.message || 'Unknown Redis subscriber error';
      const isConnectionError = errorMessage.includes('ECONNREFUSED') ||
                               errorMessage.includes('ECONNRESET') ||
                               errorMessage.includes('ECONNABORTED') ||
                               errorMessage.includes('ENOTFOUND');

      if (isConnectionError) {
        // Only log subscriber connection errors once every 30 seconds
        if (lastSubscriberError !== errorMessage || subscriberErrorCount === 0) {
          this.logger.warn(`⚠️  WebSocket Redis subscriber: ${errorMessage}`);
          lastSubscriberError = errorMessage;
          subscriberErrorCount = 1;
        } else {
          subscriberErrorCount++;
        }

        // Mark as not subscribed so we can retry
        this.isSubscribed = false;
      } else {
        // Non-connection errors still get full logging
        this.logger.error(`🔥 Redis subscriber error: ${errorMessage}`);
      }
    });

    // Monitor Redis reconnection to re-establish subscriptions
    this.redisSubscriber.on('connect', () => {
      this.logger.log('✅ Redis subscriber connected');
    });

    this.redisSubscriber.on('ready', () => {
      this.logger.log('🚀 Redis subscriber is ready');
      // If we lost subscription, re-establish it
      if (!this.isSubscribed) {
        this.logger.log('🔄 Re-establishing Redis subscriptions after reconnect...');
        this.setupRedisSubscriptions();
      }
    });

    this.redisSubscriber.on('close', () => {
      this.logger.warn('⚠️  Redis subscriber connection closed');
      this.isSubscribed = false;
    });

    this.redisSubscriber.on('reconnecting', () => {
      this.logger.log('🔄 Redis subscriber reconnecting...');
    });
  }

  afterInit(server: Server) {
    this.server = server;
    this.logger.log('WebSocket Gateway initialized');

    // Set up server-level event handlers (only once)
    this.server.on('connection_error', (err) => {
      this.logger.error(`Socket.IO connection error: ${err.message}`, getErrorMessage(err));
    });

    // Start attempting Redis subscriptions with retry logic
    this.attemptRedisSubscription();
  }

  handleConnection(client: Socket) {
    const clientId = client.id;

    // Extract userId from socket handshake auth (passed from frontend)
    const userId = client.handshake.auth?.userId;

    if (userId) {
      // Join user-specific room for automatic job propagation
      const userRoom = `user-${userId}`;
      client.join(userRoom);
      this.logger.log(`Client ${clientId} connected and joined room: ${userRoom}`);
    } else {
      this.logger.log(`Client connected: ${clientId} (no userId provided)`);
    }

    client.emit('connected', {
      message: 'Connected to job progress updates',
      clientId,
      userId,
      room: userId ? `user-${userId}` : null,
      timestamp: Date.now()
    });
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  private attemptRedisSubscription() {
    // Clear any existing retry timer
    if (this.subscriptionRetryTimer) {
      clearTimeout(this.subscriptionRetryTimer);
      this.subscriptionRetryTimer = undefined;
    }

    // Check if Redis subscriber is ready
    if (this.redisSubscriber.status !== 'ready') {
      // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
      const delay = Math.min(1000 * Math.pow(2, this.subscriptionRetryCount), 30000);
      this.subscriptionRetryCount++;

      this.logger.warn(
        `⏳ Redis subscriber not ready (status: ${this.redisSubscriber.status}). ` +
        `Retrying in ${delay}ms (attempt ${this.subscriptionRetryCount})...`
      );

      this.subscriptionRetryTimer = setTimeout(() => {
        this.attemptRedisSubscription();
      }, delay);

      return;
    }

    // Redis is ready, attempt to set up subscriptions
    this.setupRedisSubscriptions();
  }

  private setupRedisSubscriptions() {
    const pattern = 'job-events:*';

    // Prevent duplicate subscriptions
    if (this.isSubscribed) {
      this.logger.warn('Already subscribed to Redis, skipping duplicate subscription');
      return;
    }

    try {
      this.redisSubscriber.psubscribe(pattern, (err) => {
        if (err) {
          const errorMessage = err.message || 'Unknown subscription error';
          if (errorMessage.includes('enableOfflineQueue') || errorMessage.includes('writeable')) {
            this.logger.warn(`⚠️  Redis not ready for WebSocket subscriptions. Retrying...`);
            // Retry with exponential backoff
            this.attemptRedisSubscription();
          } else {
            this.logger.error(`Failed to subscribe to ${pattern}:`, getErrorMessage(err));
            // Retry for other errors too
            this.attemptRedisSubscription();
          }
        } else {
          this.logger.log(`📡 Subscribed to Redis pattern: ${pattern}`);
          this.isSubscribed = true;
          this.subscriptionRetryCount = 0; // Reset retry count on success
        }
      });
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      if (errorMessage.includes('enableOfflineQueue') || errorMessage.includes('writeable')) {
        this.logger.warn(`⚠️  Cannot setup Redis subscriptions - Redis not connected. Retrying...`);
      } else {
        this.logger.error(`Failed to setup Redis subscriptions:`, getErrorMessage(error));
      }
      // Retry with exponential backoff
      this.attemptRedisSubscription();
      return;
    }

    this.redisSubscriber.on('pmessage', (pattern, channel, message) => {
      try {
        this.handleRedisMessage(channel, message);
      } catch (error) {
        this.logger.error(`Error handling Redis message from ${channel}:`, getErrorMessage(error));
      }
    });
  }

  private handleRedisMessage(channel: string, message: string) {
    try {
      const data = JSON.parse(message);
      if (channel === 'job-events:progress') {
        this.broadcastToSubscribers('job-progress', data, data.jobId, data.queue);
      } else if (channel === 'job-events:completed') {
        this.broadcastToSubscribers('job-completed', data, data.jobId, data.queue);
      } else if (channel === 'job-events:failed') {
        this.broadcastToSubscribers('job-failed', data, data.jobId, data.queue);
      } else if (channel === 'job-events:queue-to-start') {
        this.broadcastToSubscribers('job-queue-to-start', data, data.jobId, data.queue);
      }
    } catch (error) {
      this.logger.warn(`Failed to parse Redis message from ${channel}:`, getErrorMessage(error));
    }
  }

  private broadcastToSubscribers(event: string, data: any, jobId?: string, queue?: string) {
    if (!this.server) return;
    if (data.userId) {
      const userRoom = `user-${data.userId}`;
      this.server.to(userRoom).emit(event, data);
    } else {
      this.logger.warn(`Received ${event} without userId; event dropped (job: ${jobId}, queue: ${queue})`);
    }
  }
  
  async publishProgressEvent(jobId: string, queue: string, progress: number | object, details?: string, userId?: string) {
    const event: JobProgressEvent = { jobId, queue, progress, details, userId, timestamp: Date.now() };
    await this.redisPublisher.publish('job-events:progress', JSON.stringify(event));
  }

  async publishCompletedEvent(jobId: string, queue: string, result: any, processingTime: number, totalTime?: number, userId?: string) {
    const event: JobCompletedEvent = { jobId, queue, result, processingTime, totalTime, userId, timestamp: Date.now() };
    await this.redisPublisher.publish('job-events:completed', JSON.stringify(event));
  }

  async publishFailedEvent(jobId: string, queue: string, error: string, attempts: number, maxAttempts: number, userId?: string) {
    const event: JobFailedEvent = { jobId, queue, error, attempts, maxAttempts, userId, timestamp: Date.now() };
    await this.redisPublisher.publish('job-events:failed', JSON.stringify(event));
  }

  async publishQueueToStartEvent(jobId: string, queue: string, queueToStartTime: number, userId?: string) {
    const event: JobQueueToStartEvent = { jobId, queue, queueToStartTime, userId, timestamp: Date.now() };
    await this.redisPublisher.publish('job-events:queue-to-start', JSON.stringify(event));
  }
  
  /**
   * Client emits this on connect/reconnect for any job it's still waiting on.
   * If the job already completed (missed due to disconnect), re-emit job-completed
   * directly to that socket so the frontend picks up the result without polling.
   */
  @SubscribeMessage('subscribe-job')
  async handleSubscribeJob(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { jobId: string },
  ): Promise<void> {
    const jobId = payload?.jobId;
    if (!jobId) return;

    try {
      const job = await this.jobsService.getJobStatus(jobId);

      if (job.status === 'completed') {
        client.emit('job-completed', {
          jobId: job.id,
          queue: job.queue,
          result: job.result, // raw returnvalue — frontend hydrates the resultKey pointer as normal
          timestamp: job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now(),
          processingTime: job.finishedAt && job.processedAt
            ? new Date(job.finishedAt).getTime() - new Date(job.processedAt).getTime()
            : 0,
        });
        this.logger.debug(`Replayed job-completed for ${jobId} to reconnected socket ${client.id}`);
      } else if (job.status === 'failed') {
        client.emit('job-failed', {
          jobId: job.id,
          queue: job.queue,
          error: job.error ?? 'Job failed',
          timestamp: Date.now(),
          attempts: 1,
          maxAttempts: 1,
        });
        this.logger.debug(`Replayed job-failed for ${jobId} to reconnected socket ${client.id}`);
      }
      // still active → do nothing, normal room broadcast will deliver completion
    } catch {
      // job not found or BullMQ error — silent, frontend polling is the fallback
    }
  }

  async onModuleDestroy() {
    this.logger.log('Closing WebSocket Gateway connections...');

    // Clear retry timer if active
    if (this.subscriptionRetryTimer) {
      clearTimeout(this.subscriptionRetryTimer);
      this.subscriptionRetryTimer = undefined;
    }

    // We only quit the duplicated subscriber connection.
    // The injected publisher connection is managed by the central provider.
    if (this.redisSubscriber) {
      await this.redisSubscriber.quit();
    }
    if (this.server) {
      this.server.close();
    }
  }
}
