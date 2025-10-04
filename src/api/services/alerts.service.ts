import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from './database.service';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(private readonly db: DatabaseService) {}

  async createAlert(userId: string, data: {
    tokenAddress: string;
    label?: string;
    condition: any;
    channels?: string[];
    cooldownMinutes?: number;
  }) {
    // Ensure token exists (creates stub if not present) - centralized method
    await this.db.ensureTokenExists(data.tokenAddress);

    // Check for duplicate alert (same user, token, and condition)
    const existingAlert = await this.db.tokenAlert.findFirst({
      where: {
        userId,
        tokenAddress: data.tokenAddress,
        condition: { equals: data.condition },
        isActive: true,
      },
      include: { TokenInfo: true }
    });

    if (existingAlert) {
      this.logger.log(`Alert already exists for user ${userId}, token ${data.tokenAddress}, condition ${JSON.stringify(data.condition)}`);
      // Update existing alert instead of creating duplicate
      const updated = await this.db.tokenAlert.update({
        where: { id: existingAlert.id },
        data: {
          label: data.label,
          channels: data.channels || existingAlert.channels,
          cooldownMinutes: data.cooldownMinutes ?? existingAlert.cooldownMinutes,
        },
        include: { TokenInfo: true }
      });
      return this.serializeBigInt(updated);
    }

    // For percentage alerts, store the current price as baseline
    let baselinePrice: string | null = null;
    if (data.condition.type === 'percentage') {
      try {
        const tokenInfo = await this.db.tokenInfo.findUnique({
          where: { tokenAddress: data.tokenAddress },
          select: { priceUsd: true },
        });
        baselinePrice = tokenInfo?.priceUsd || null;

        if (!baselinePrice) {
          this.logger.warn(`Creating percentage alert but no current price available for ${data.tokenAddress}`);
        } else {
          this.logger.log(`Percentage alert baseline price: ${baselinePrice} for ${data.tokenAddress}`);
        }
      } catch (error) {
        this.logger.error(`Failed to fetch baseline price for ${data.tokenAddress}:`, error);
      }
    }

    const alert = await this.db.tokenAlert.create({
      data: {
        userId,
        tokenAddress: data.tokenAddress,
        label: data.label,
        condition: data.condition,
        channels: data.channels || ['in_app'],
        cooldownMinutes: data.cooldownMinutes || 60,
        ...(baselinePrice ? { baselinePrice } : {}),
      },
      include: { TokenInfo: true }
    });

    // Convert BigInt to string for JSON serialization
    return this.serializeBigInt(alert);
  }

  private serializeBigInt(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return obj.toString();
    if (Array.isArray(obj)) return obj.map(item => this.serializeBigInt(item));
    if (typeof obj === 'object') {
      const result: any = {};
      for (const key in obj) {
        result[key] = this.serializeBigInt(obj[key]);
      }
      return result;
    }
    return obj;
  }

  async listUserAlerts(userId: string, tokenAddress?: string) {
    const alerts = await this.db.tokenAlert.findMany({
      where: {
        userId,
        isActive: true, // Only show active alerts
        ...(tokenAddress ? { tokenAddress } : {}),
      },
      include: { TokenInfo: true },
      orderBy: { createdAt: 'desc' },
    });
    return alerts.map(alert => this.serializeBigInt(alert));
  }

  async getAlert(alertId: string) {
    const alert = await this.db.tokenAlert.findUnique({
      where: { id: alertId },
      include: { TokenInfo: true },
    });
    return alert ? this.serializeBigInt(alert) : null;
  }

  async updateAlert(alertId: string, data: {
    label?: string;
    isActive?: boolean;
    condition?: any;
    cooldownMinutes?: number;
  }) {
    return this.db.tokenAlert.update({
      where: { id: alertId },
      data,
    });
  }

  async deleteAlert(alertId: string) {
    return this.db.tokenAlert.delete({
      where: { id: alertId },
    });
  }

  // Trigger alert (called by evaluation job)
  async triggerAlert(alert: any, snapshot: any) {
    // Create notification
    await this.db.alertNotification.create({
      data: {
        alertId: alert.id,
        userId: alert.userId,
        snapshot,
        delivered: true, // Will be set by delivery service
      },
    });

    // Update alert state
    await this.db.tokenAlert.update({
      where: { id: alert.id },
      data: {
        lastTriggeredAt: new Date(),
        triggerCount: { increment: 1 },
      },
    });
  }

  // Get user notifications
  async getUserNotifications(userId: string, unreadOnly = false) {
    const notifications = await this.db.alertNotification.findMany({
      where: {
        userId,
        ...(unreadOnly ? { isRead: false } : {}),
      },
      include: {
        Alert: {
          include: { TokenInfo: true }
        }
      },
      orderBy: { triggeredAt: 'desc' },
      take: 50,
    });
    return notifications.map(notification => this.serializeBigInt(notification));
  }

  async markNotificationRead(notificationId: string) {
    return this.db.alertNotification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async markAllNotificationsRead(userId: string) {
    const result = await this.db.alertNotification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    this.logger.log(`Marked ${result.count} notifications as read for user ${userId}`);
    return { count: result.count };
  }
}
