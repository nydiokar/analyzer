import {
  WebSocketGateway,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Inject, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../queues/config/redis.provider';

@WebSocketGateway({
  cors: { origin: true, methods: ['GET', 'POST'], credentials: true },
  transports: ['websocket', 'polling'],
  path: '/socket.io/messages',
})
export class MessageGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MessageGateway.name);
  private readonly redisSubscriber: Redis;

  constructor(@Inject(REDIS_CLIENT) private readonly redisPublisher: Redis) {
    this.redisSubscriber = this.redisPublisher.duplicate();
    this.redisSubscriber.on('error', (err) => this.logger.error('Redis subscriber error:', err));
  }

  afterInit(server: Server) {
    this.server = server;
    this.logger.log('MessageGateway initialized');
    setImmediate(() => this.setupRedisSubscriptions());
  }

  handleConnection() {}
  handleDisconnect() {}

  @SubscribeMessage('join-global')
  async handleJoinGlobal(@ConnectedSocket() client: any) {
    await client.join('global-chat');
  }

  @SubscribeMessage('join-token-thread')
  async handleJoinToken(@MessageBody() data: { tokenAddress: string }, @ConnectedSocket() client: any) {
    const address = (data?.tokenAddress ?? '').trim();
    if (!address) return;
    await client.join(`token-thread:${address}`);
  }

  private setupRedisSubscriptions() {
    const pattern = 'message-events:*';
    this.redisSubscriber.psubscribe(pattern, (err) => {
      if (err) this.logger.error(`Failed to psubscribe ${pattern}`, err);
    });
    this.redisSubscriber.on('pmessage', (_pattern, channel, message) => {
      try {
        const payload = JSON.parse(message);
        if (channel === 'message-events:global') {
          this.server.emit('message.created', payload);
        } else if (channel.startsWith('message-events:token:')) {
          const address = channel.split(':')[2];
          this.server.to(`token-thread:${address}`).emit('message.created', payload);
        } else if (channel === 'message-events:edited') {
          this.server.emit('message.edited', payload);
        } else if (channel === 'message-events:deleted') {
          this.server.emit('message.deleted', payload);
        } else if (channel === 'message-events:pinned') {
          this.server.emit('message.pinned', payload);
        } else if (channel === 'message-events:reaction') {
          this.server.emit('reaction.updated', payload);
        }
      } catch (e) {
        this.logger.warn('Failed to parse message event', e as any);
      }
    });
  }

  private async publishWithRetry(channel: string, payload: any, retries = 3, delayMs = 100): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.redisPublisher.publish(channel, JSON.stringify(payload));
        return; // Success
      } catch (error) {
        this.logger.warn(`Redis publish failed (attempt ${attempt}/${retries}) on channel ${channel}:`, error);
        if (attempt === retries) {
          this.logger.error(`Redis publish failed after ${retries} attempts on channel ${channel}. Event lost:`, payload);
          throw error; // Rethrow after final attempt
        }
        // Exponential backoff: 100ms, 200ms, 400ms
        await new Promise((resolve) => setTimeout(resolve, delayMs * Math.pow(2, attempt - 1)));
      }
    }
  }

  async publishGlobal(event: any) {
    await this.publishWithRetry('message-events:global', event);
  }

  async publishToken(address: string, event: any) {
    await this.publishWithRetry(`message-events:token:${address}`, event);
  }

  async publishEdited(event: any) {
    await this.publishWithRetry('message-events:edited', event);
  }

  async publishDeleted(event: any) {
    await this.publishWithRetry('message-events:deleted', event);
  }

  async publishPinned(event: any) {
    await this.publishWithRetry('message-events:pinned', event);
  }

  async publishReaction(event: any) {
    await this.publishWithRetry('message-events:reaction', event);
  }
}


