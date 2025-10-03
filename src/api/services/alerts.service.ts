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
    return this.db.tokenAlert.create({
      data: {
        userId,
        tokenAddress: data.tokenAddress,
        label: data.label,
        condition: data.condition,
        channels: data.channels || ['in_app'],
        cooldownMinutes: data.cooldownMinutes || 60,
      },
      include: { TokenInfo: true }
    });
  }

  async listUserAlerts(userId: string, tokenAddress?: string) {
    return this.db.tokenAlert.findMany({
      where: {
        userId,
        ...(tokenAddress ? { tokenAddress } : {}),
      },
      include: { TokenInfo: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAlert(alertId: string) {
    return this.db.tokenAlert.findUnique({
      where: { id: alertId },
      include: { TokenInfo: true },
    });
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
    return this.db.alertNotification.findMany({
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
}
