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
import { Inject, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../queues/config/redis.provider';

// --- Event Interfaces ---
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

interface ClientSubscription {
  jobIds: Set<string>;
}

interface JobQueueToStartEvent {
  jobId: string;
  queueToStartTime: number;
  timestamp: number;
  queue: string;
}

@WebSocketGateway({
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: [ 'websocket', 'polling'],
  path: "/socket.io/jobs",
})
export class JobProgressGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(JobProgressGateway.name);
  private readonly redisSubscriber: Redis;
  private readonly clientSubscriptions = new Map<string, ClientSubscription>();

  constructor(@Inject(REDIS_CLIENT) private readonly redisPublisher: Redis) {
    // The publisher is injected. We create a dedicated subscriber from it.
    this.redisSubscriber = this.redisPublisher.duplicate();
    
    this.redisSubscriber.on('error', (err) => this.logger.error('Redis subscriber connection error:', err));
  }

  afterInit(server: Server) {
    this.server = server;
    this.logger.log('WebSocket Gateway initialized');
    
    // Set up server-level event handlers (only once)
    this.server.on('connection_error', (err) => {
      this.logger.error(`Socket.IO connection error: ${err.message}`, err);
    });
    
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
      } else if (channel === 'job-events:queue-to-start') {
        this.broadcastToSubscribers('job-queue-to-start', data, data.jobId, data.queue);
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
  
  async publishProgressEvent(jobId: string, queue: string, progress: number | object, details?: string) {
    const event: JobProgressEvent = { jobId, queue, progress, details, timestamp: Date.now() };
    await this.redisPublisher.publish('job-events:progress', JSON.stringify(event));
  }

  async publishCompletedEvent(jobId: string, queue: string, result: any, processingTime: number, totalTime?: number) {
    const event: JobCompletedEvent = { jobId, queue, result, processingTime, totalTime, timestamp: Date.now() };
    await this.redisPublisher.publish('job-events:completed', JSON.stringify(event));
  }

  async publishFailedEvent(jobId: string, queue: string, error: string, attempts: number, maxAttempts: number) {
    const event: JobFailedEvent = { jobId, queue, error, attempts, maxAttempts, timestamp: Date.now() };
    await this.redisPublisher.publish('job-events:failed', JSON.stringify(event));
  }

  async publishQueueToStartEvent(jobId: string, queue: string, queueToStartTime: number) {
    const event: JobQueueToStartEvent = { jobId, queue, queueToStartTime, timestamp: Date.now() };
    await this.redisPublisher.publish('job-events:queue-to-start', JSON.stringify(event));
  }
  
  async onModuleDestroy() {
    this.logger.log('Closing WebSocket Gateway connections...');
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