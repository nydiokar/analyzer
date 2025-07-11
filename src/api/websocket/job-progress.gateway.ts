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

// --- Event Interfaces ---
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
}

@WebSocketGateway({
  cors: {
    origin: '*',
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
    const ioredisOptions: RedisOptions = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
      connectTimeout: 5000,
    };
    
    this.redisSubscriber = new Redis(ioredisOptions);
    this.redisPublisher = new Redis(ioredisOptions);
    
    this.redisSubscriber.on('error', (err) => this.logger.error('Redis subscriber connection error:', err));
    this.redisPublisher.on('error', (err) => this.logger.error('Redis publisher connection error:', err));
  }

  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway initialized');
    setImmediate(() => this.setupRedisSubscriptions());
  }

  handleConnection(client: Socket) {
    const clientId = client.id;
    this.logger.log(`Client connected: ${clientId}`);
    this.clientSubscriptions.set(clientId, { jobIds: new Set() });
    client.emit('connected', { message: 'Connected to job progress updates', clientId, timestamp: Date.now() });
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.clientSubscriptions.delete(client.id);
  }

  private setupRedisSubscriptions() {
    const pattern = 'job-events:*';
    this.redisSubscriber.psubscribe(pattern, (err) => {
      if (err) {
        this.logger.error(`Failed to subscribe to ${pattern}:`, err);
      } else {
        this.logger.log(`Subscribed to Redis pattern: ${pattern}`);
      }
    });

    this.redisSubscriber.on('pmessage', (pattern, channel, message) => {
      try {
        this.handleRedisMessage(channel, message);
      } catch (error) {
        this.logger.error(`Error handling Redis message from ${channel}:`, error);
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
      }
    } catch (error) {
      this.logger.warn(`Failed to parse Redis message from ${channel}:`, error);
    }
  }

  private broadcastToSubscribers(event: string, data: any, jobId?: string, queue?: string) {
    for (const [clientId, subscription] of this.clientSubscriptions) {
      if (jobId && subscription.jobIds.has(jobId)) {
        this.server.to(clientId).emit(event, data);
        // The following line is the source of the excessive log messages.
        // this.logger.debug(`Broadcasted ${event} to client ${clientId} for job ${jobId}`);
      }
    }
  }

  @SubscribeMessage('subscribe-to-job')
  handleSubscribeToJob(@MessageBody() data: { jobId: string }, @ConnectedSocket() client: Socket) {
    const { jobId } = data;
    if (jobId) {
      const subscription = this.clientSubscriptions.get(client.id);
      if (subscription) {
        subscription.jobIds.add(jobId);
        this.logger.log(`Client ${client.id} subscribed to job: ${jobId}`);
      }
    }
  }

  @SubscribeMessage('unsubscribe-from-job')
  handleUnsubscribeFromJob(@MessageBody() data: { jobId: string }, @ConnectedSocket() client: Socket) {
     const { jobId } = data;
    if (jobId) {
      const subscription = this.clientSubscriptions.get(client.id);
      if (subscription) {
        subscription.jobIds.delete(jobId);
        this.logger.log(`Client ${client.id} unsubscribed from job: ${jobId}`);
      }
    }
  }
  
  async publishProgressEvent(jobId: string, queue: string, progress: number | object) {
    const event: JobProgressEvent = { jobId, queue, progress, timestamp: Date.now() };
    await this.redisPublisher.publish('job-events:progress', JSON.stringify(event));
  }

  async publishCompletedEvent(jobId: string, queue: string, result: any, processingTime: number) {
    const event: JobCompletedEvent = { jobId, queue, result, processingTime, timestamp: Date.now() };
    await this.redisPublisher.publish('job-events:completed', JSON.stringify(event));
  }

  async publishFailedEvent(jobId: string, queue: string, error: string, attempts: number, maxAttempts: number) {
    const event: JobFailedEvent = { jobId, queue, error, attempts, maxAttempts, timestamp: Date.now() };
    await this.redisPublisher.publish('job-events:failed', JSON.stringify(event));
  }
  
  async onModuleDestroy() {
    this.logger.log('Closing WebSocket Gateway connections...');
    if (this.redisSubscriber) await this.redisSubscriber.quit();
    if (this.redisPublisher) await this.redisPublisher.quit();
    if (this.server) this.server.close();
  }
}