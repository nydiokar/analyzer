import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';

@Injectable()
export class TelegramAlertsService {
  private readonly logger = new Logger(TelegramAlertsService.name);
  private readonly bot: Telegraf | null;
  private readonly defaultChats: number[] = [];

  constructor(private readonly configService: ConfigService) {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      this.bot = null;
      this.logger.warn('TELEGRAM_BOT_TOKEN not set; Telegram alerts are disabled.');
      return;
    }
    this.bot = new Telegraf(token);

    const groupIdStr = (this.configService.get<string>('TELEGRAM_ALERTS_GROUP_ID') || '').trim();
    const adminIdStr = (this.configService.get<string>('ADMIN_TELEGRAM_ID') || '').trim();
    const allowedStr = (this.configService.get<string>('ALLOWED_TELEGRAM_USER_IDS') || '').trim();

    const chatIds = new Set<number>();
    if (groupIdStr) {
      const n = parseInt(groupIdStr, 10);
      if (!Number.isNaN(n)) chatIds.add(n);
    }
    if (adminIdStr) {
      const n = parseInt(adminIdStr, 10);
      if (!Number.isNaN(n)) chatIds.add(n);
    }
    if (allowedStr) {
      for (const part of allowedStr.split(',')) {
        const n = parseInt(part.trim(), 10);
        if (!Number.isNaN(n)) chatIds.add(n);
      }
    }
    this.defaultChats = Array.from(chatIds);
  }

  /**
   * Broadcast a message to the configured alert channels (group + admin + allowed users).
   * No-ops safely if Telegram is not configured.
   */
  async broadcast(text: string, opts?: { html?: boolean; disableNotification?: boolean }): Promise<void> {
    if (!this.bot) return; // disabled
    if (this.defaultChats.length === 0) {
      this.logger.warn('No Telegram alert chat IDs configured; skipping broadcast.');
      return;
    }
    const parse_mode = opts?.html ? 'HTML' : undefined;
    const disable_notification = opts?.disableNotification ?? false;
    const telegram = this.bot.telegram;
    for (const chatId of this.defaultChats) {
      try {
        await telegram.sendMessage(chatId, text, { parse_mode, disable_notification });
      } catch (err) {
        this.logger.warn(`Failed to send Telegram alert to chat ${chatId}: ${(err as Error).message}`);
      }
    }
  }
}


