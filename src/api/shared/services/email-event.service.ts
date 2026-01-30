import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export type EmailEventType = 'delivered' | 'bounced' | 'complained' | 'other';

export interface EmailEvent {
  email: string;
  type: EmailEventType;
  reason?: string;
  ts: number;
  provider?: string;
  payload?: Record<string, any>;
}

@Injectable()
export class EmailEventService {
  private readonly logger = new Logger(EmailEventService.name);
  private readonly redis: Redis;
  private readonly SUPPRESS_PREFIX = 'email_suppression:';
  private readonly EVENT_PREFIX = 'email_event:';
  private readonly TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 3, lazyConnect: true });

    this.redis.on('error', (error) => this.logger.error('Redis error (EmailEventService):', error));
    this.redis.on('connect', () => this.logger.log('Redis connected (EmailEventService)'));
  }

  async isSuppressed(email: string): Promise<boolean> {
    const key = this.SUPPRESS_PREFIX + email.toLowerCase();
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  async suppress(email: string, reason: string, payload?: Record<string, any>): Promise<void> {
    const key = this.SUPPRESS_PREFIX + email.toLowerCase();
    const record: EmailEvent = { email, type: 'bounced', reason, ts: Date.now(), provider: payload?.provider, payload };
    await this.redis.setex(key, this.TTL_SECONDS, JSON.stringify(record));
    this.logger.warn(`Suppressed email ${email} (${reason})`);
  }

  async recordEvent(event: EmailEvent): Promise<void> {
    const key = this.EVENT_PREFIX + event.email.toLowerCase();
    await this.redis.setex(key, this.TTL_SECONDS, JSON.stringify(event));
  }

  async onModuleDestroy() {
    await this.redis.disconnect();
  }
}
