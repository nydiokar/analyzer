import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../queues/config/redis.provider';

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
  private readonly SUPPRESS_PREFIX = 'email_suppression:';
  private readonly EVENT_PREFIX = 'email_event:';
  private readonly TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

  constructor(
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.logger.log('EmailEventService initialized with shared Redis connection');
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
    // Shared Redis connection managed centrally by RedisProvider
    return;
  }
}
