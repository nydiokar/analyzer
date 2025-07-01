import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { Redis, RedisOptions } from 'ioredis';
import { redisConfig } from '../../queues/config/redis.config';

interface JobProgressEvent {
  jobId: string;
  progress: number | object;
  timestamp: number;
  queue: string;
}

interface JobCompletedEvent {
  jobId: string;
  result: any;
  timestamp: number;
  queue: string;
  processingTime: number;
}

interface JobFailedEvent {
  jobId: string;
  error: string;
  timestamp: number;
  queue: string;
  attempts: number;
  maxAttempts: number;
}

interface ClientSubscription {
  jobIds: Set<string>;
  queues: Set<string>;
  clientId: string;
}

@WebSocketGateway({
  cors: {
    origin: '*', // Configure based on your frontend URL in production
    methods: ['GET', 'POST'],
    credentials: true,
  },
  namespace: '/job-progress',
})
export class JobProgressGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(JobProgressGateway.name);
  private readonly redisSubscriber: Redis;
  private readonly redisPublisher: Redis;
  private readonly clientSubscriptions = new Map<string, ClientSubscription>();

  constructor() {
    // Create separate Redis connections for pub/sub to avoid blocking
    // Extract Redis configuration values directly (BullMQ and ioredis use same format)
    const ioredisOptions: RedisOptions = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
    };
    
    this.redisSubscriber = new Redis(ioredisOptions);
    this.redisPublisher = new Redis(ioredisOptions);
  }

  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway initialized');
    this.setupRedisSubscriptions();
  }

  handleConnection(client: Socket) {
    const clientId = client.id;
    this.logger.log(`Client connected: ${clientId}`);
    
    // Initialize client subscription tracking
    this.clientSubscriptions.set(clientId, {
      jobIds: new Set(),
      queues: new Set(),
      clientId,
    });

    // Send welcome message
    client.emit('connected', {
      message: 'Connected to job progress updates',
      clientId,
      timestamp: Date.now(),
    });
  }

  handleDisconnect(client: Socket) {
    const clientId = client.id;
    this.logger.log(`Client disconnected: ${clientId}`);
    
    // Clean up subscriptions
    this.clientSubscriptions.delete(clientId);
  }

  private setupRedisSubscriptions() {
    // Subscribe to BullMQ progress events
    const channels = [
      'bullmq:progress:*',
      'bullmq:completed:*', 
      'bullmq:failed:*',
      'job-progress:*', // Custom progress events
    ];

    channels.forEach(pattern => {
      this.redisSubscriber.psubscribe(pattern, (err, count) => {
        if (err) {
          this.logger.error(`Failed to subscribe to ${pattern}:`, err);
        } else {
          this.logger.log(`Subscribed to Redis pattern: ${pattern}`);
        }
      });
    });

    // Handle incoming Redis messages
    this.redisSubscriber.on('pmessage', (pattern, channel, message) => {
      try {
        this.handleRedisMessage(pattern, channel, message);
      } catch (error) {
        this.logger.error(`Error handling Redis message from ${channel}:`, error);
      }
    });

    this.redisSubscriber.on('error', (err) => {
      this.logger.error('Redis subscriber error:', err);
    });
  }

  private handleRedisMessage(pattern: string, channel: string, message: string) {
    try {
      const data = JSON.parse(message);
      
      if (channel.includes(':progress:')) {
        this.handleProgressEvent(data);
      } else if (channel.includes(':completed:')) {
        this.handleCompletedEvent(data);
      } else if (channel.includes(':failed:')) {
        this.handleFailedEvent(data);
      } else if (channel.startsWith('job-progress:')) {
        this.handleCustomProgressEvent(data);
      }
    } catch (error) {
      this.logger.warn(`Failed to parse Redis message from ${channel}:`, error);
    }
  }

  private handleProgressEvent(data: JobProgressEvent) {
    this.logger.debug(`Job progress: ${data.jobId} - ${JSON.stringify(data.progress)}`);
    
    // Broadcast to subscribed clients
    this.broadcastToSubscribers('job-progress', data, data.jobId, data.queue);
  }

  private handleCompletedEvent(data: JobCompletedEvent) {
    this.logger.log(`Job completed: ${data.jobId}`);
    
    // Broadcast to subscribed clients
    this.broadcastToSubscribers('job-completed', data, data.jobId, data.queue);
  }

  private handleFailedEvent(data: JobFailedEvent) {
    this.logger.warn(`Job failed: ${data.jobId} - ${data.error}`);
    
    // Broadcast to subscribed clients
    this.broadcastToSubscribers('job-failed', data, data.jobId, data.queue);
  }

  private handleCustomProgressEvent(data: any) {
    this.logger.debug(`Custom progress event: ${JSON.stringify(data)}`);
    
    // Broadcast custom events
    this.broadcastToSubscribers('custom-progress', data, data.jobId, data.queue);
  }

  private broadcastToSubscribers(event: string, data: any, jobId?: string, queue?: string) {
    let targetClients = new Set<string>();

    // Find clients subscribed to this job or queue
    for (const [clientId, subscription] of this.clientSubscriptions) {
      if (
        (jobId && subscription.jobIds.has(jobId)) ||
        (queue && subscription.queues.has(queue)) ||
        (subscription.jobIds.size === 0 && subscription.queues.size === 0) // Subscribed to all
      ) {
        targetClients.add(clientId);
      }
    }

    // Broadcast to target clients
    if (targetClients.size > 0) {
      targetClients.forEach(clientId => {
        this.server.to(clientId).emit(event, {
          ...data,
          timestamp: data.timestamp || Date.now(),
        });
      });
      
      this.logger.debug(`Broadcasted ${event} to ${targetClients.size} clients`);
    }
  }

  @SubscribeMessage('subscribe-to-job')
  handleSubscribeToJob(
    @MessageBody() data: { jobId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const clientId = client.id;
    const { jobId } = data;

    if (!jobId) {
      client.emit('subscription-error', { message: 'Job ID is required' });
      return;
    }

    const subscription = this.clientSubscriptions.get(clientId);
    if (subscription) {
      subscription.jobIds.add(jobId);
      this.logger.log(`Client ${clientId} subscribed to job: ${jobId}`);
      
      client.emit('subscription-success', {
        type: 'job',
        target: jobId,
        message: `Subscribed to job ${jobId} progress updates`,
      });
    }
  }

  @SubscribeMessage('subscribe-to-queue')
  handleSubscribeToQueue(
    @MessageBody() data: { queueName: string },
    @ConnectedSocket() client: Socket,
  ) {
    const clientId = client.id;
    const { queueName } = data;

    if (!queueName) {
      client.emit('subscription-error', { message: 'Queue name is required' });
      return;
    }

    const subscription = this.clientSubscriptions.get(clientId);
    if (subscription) {
      subscription.queues.add(queueName);
      this.logger.log(`Client ${clientId} subscribed to queue: ${queueName}`);
      
      client.emit('subscription-success', {
        type: 'queue',
        target: queueName,
        message: `Subscribed to queue ${queueName} progress updates`,
      });
    }
  }

  @SubscribeMessage('unsubscribe-from-job')
  handleUnsubscribeFromJob(
    @MessageBody() data: { jobId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const clientId = client.id;
    const { jobId } = data;

    const subscription = this.clientSubscriptions.get(clientId);
    if (subscription && subscription.jobIds.has(jobId)) {
      subscription.jobIds.delete(jobId);
      this.logger.log(`Client ${clientId} unsubscribed from job: ${jobId}`);
      
      client.emit('unsubscription-success', {
        type: 'job',
        target: jobId,
        message: `Unsubscribed from job ${jobId}`,
      });
    }
  }

  @SubscribeMessage('unsubscribe-from-queue')
  handleUnsubscribeFromQueue(
    @MessageBody() data: { queueName: string },
    @ConnectedSocket() client: Socket,
  ) {
    const clientId = client.id;
    const { queueName } = data;

    const subscription = this.clientSubscriptions.get(clientId);
    if (subscription && subscription.queues.has(queueName)) {
      subscription.queues.delete(queueName);
      this.logger.log(`Client ${clientId} unsubscribed from queue: ${queueName}`);
      
      client.emit('unsubscription-success', {
        type: 'queue',  
        target: queueName,
        message: `Unsubscribed from queue ${queueName}`,
      });
    }
  }

  @SubscribeMessage('get-subscriptions')
  handleGetSubscriptions(@ConnectedSocket() client: Socket) {
    const clientId = client.id;
    const subscription = this.clientSubscriptions.get(clientId);
    
    if (subscription) {
      client.emit('current-subscriptions', {
        jobIds: Array.from(subscription.jobIds),
        queues: Array.from(subscription.queues),
        clientId: subscription.clientId,
      });
    }
  }

  /**
   * Public method to publish progress events from job processors
   */
  async publishProgressEvent(jobId: string, queue: string, progress: number | object) {
    const event: JobProgressEvent = {
      jobId,
      progress,
      timestamp: Date.now(),
      queue,
    };

    await this.redisPublisher.publish(`job-progress:${jobId}`, JSON.stringify(event));
  }

  /**
   * Public method to publish job completion events
   */
  async publishCompletedEvent(jobId: string, queue: string, result: any, processingTime: number) {
    const event: JobCompletedEvent = {
      jobId,
      result,
      timestamp: Date.now(),
      queue,
      processingTime,
    };

    await this.redisPublisher.publish(`job-progress:${jobId}:completed`, JSON.stringify(event));
  }

  /**
   * Public method to publish job failure events
   */
  async publishFailedEvent(jobId: string, queue: string, error: string, attempts: number, maxAttempts: number) {
    const event: JobFailedEvent = {
      jobId,
      error,
      timestamp: Date.now(),
      queue,
      attempts,
      maxAttempts,
    };

    await this.redisPublisher.publish(`job-progress:${jobId}:failed`, JSON.stringify(event));
  }

  /**
   * Cleanup method for graceful shutdown
   */
  async onModuleDestroy() {
    this.logger.log('Shutting down WebSocket Gateway...');
    
    if (this.redisSubscriber) {
      await this.redisSubscriber.quit();
    }
    
    if (this.redisPublisher) {
      await this.redisPublisher.quit();
    }
  }
} 