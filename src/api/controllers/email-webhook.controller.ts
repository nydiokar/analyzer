import { Body, Controller, Headers, HttpCode, HttpStatus, Logger, Post, UnauthorizedException } from '@nestjs/common';
import { EmailEventService, EmailEventType } from '../shared/services/email-event.service';
import { ConfigService } from '@nestjs/config';

@Controller('webhooks/email')
export class EmailWebhookController {
  private readonly logger = new Logger(EmailWebhookController.name);
  private readonly webhookSecret: string | undefined;

  constructor(
    private readonly emailEventService: EmailEventService,
    private readonly configService: ConfigService,
  ) {
    this.webhookSecret = this.configService.get<string>('MAIL_WEBHOOK_SECRET');
  }

  @Post('resend')
  @HttpCode(HttpStatus.OK)
  async handleResendWebhook(
    @Headers('x-webhook-secret') secret: string | undefined,
    @Body() body: any,
  ): Promise<{ received: boolean }> {
    if (this.webhookSecret && this.webhookSecret !== secret) {
      throw new UnauthorizedException('Invalid webhook secret');
    }

    const eventType = this.mapResendEventType(body?.type);
    const recipient = this.extractRecipient(body);

    if (!recipient) {
      this.logger.warn('Resend webhook received without recipient');
      return { received: false };
    }

    const payload = body || {};
    const reason = body?.data?.reason || body?.data?.error || body?.error || body?.data?.delivery_status;

    // Record the event for observability
    await this.emailEventService.recordEvent({
      email: recipient,
      type: eventType,
      reason,
      ts: this.extractTimestamp(body),
      provider: 'resend',
      payload,
    });

    // Suppress on bounce/complaint
    if (eventType === 'bounced' || eventType === 'complained') {
      await this.emailEventService.suppress(recipient, reason || eventType, { provider: 'resend', eventType, payload });
    }

    return { received: true };
  }

  private mapResendEventType(type?: string): EmailEventType {
    if (!type) return 'other';
    const normalized = type.toLowerCase();
    if (normalized === 'email.bounced' || normalized.includes('bounce')) return 'bounced';
    if (normalized === 'email.complained' || normalized.includes('complaint')) return 'complained';
    if (
      normalized === 'email.delivered' ||
      normalized === 'email.sent' ||
      normalized === 'email.received' ||
      normalized === 'email.delivery_delayed' ||
      normalized.includes('delivered') ||
      normalized.includes('sent')
    ) {
      return 'delivered';
    }
    return 'other';
  }

  private extractRecipient(body: any): string | undefined {
    const data = body?.data;
    const candidate =
      data?.to ||
      data?.email?.to ||
      data?.recipient ||
      body?.to ||
      body?.recipient ||
      data?.email?.to ||
      (typeof data?.email?.recipient === 'string' ? data?.email?.recipient : undefined);
    if (Array.isArray(candidate)) {
      return candidate[0];
    }
    return typeof candidate === 'string' ? candidate : undefined;
  }

  private extractTimestamp(body: any): number {
    const createdAt = body?.created_at || body?.createdAt || body?.data?.created_at || body?.data?.createdAt;
    const ts = createdAt ? Date.parse(createdAt) : Date.now();
    return Number.isNaN(ts) ? Date.now() : ts;
  }
}
