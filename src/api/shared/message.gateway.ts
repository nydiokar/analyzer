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

  async publishGlobal(event: any) {
    await this.redisPublisher.publish('message-events:global', JSON.stringify(event));
  }

  async publishToken(address: string, event: any) {
    await this.redisPublisher.publish(`message-events:token:${address}`, JSON.stringify(event));
  }

  async publishEdited(event: any) {
    await this.redisPublisher.publish('message-events:edited', JSON.stringify(event));
  }

  async publishDeleted(event: any) {
    await this.redisPublisher.publish('message-events:deleted', JSON.stringify(event));
  }

  async publishPinned(event: any) {
    await this.redisPublisher.publish('message-events:pinned', JSON.stringify(event));
  }

  async publishReaction(event: any) {
    await this.redisPublisher.publish('message-events:reaction', JSON.stringify(event));
  }
}


