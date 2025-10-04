import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../../api/services/database.service';
import { AlertsService } from '../../api/services/alerts.service';
import { MessageGateway } from '../../api/shared/message.gateway';

@Injectable()
export class AlertEvaluatorJob {
  private readonly logger = new Logger(AlertEvaluatorJob.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly alertsService: AlertsService,
    private readonly messageGateway: MessageGateway,
  ) {}

  @Cron('*/30 * * * * *') // Every 30 seconds
  async evaluateAlerts() {
    const startTime = Date.now();
    this.logger.log('🔔 AlertEvaluatorJob started');

    try {
      // Fetch active alerts
      const alerts = await this.db.tokenAlert.findMany({
        where: { isActive: true },
        include: { TokenInfo: true },
        take: 500, // Max 500 per run
      });

      this.logger.log(`Found ${alerts.length} active alerts to evaluate`);

      if (alerts.length === 0) {
        this.logger.debug('No active alerts to evaluate');
        return;
      }

      let triggered = 0;
      let evaluated = 0;

      for (const alert of alerts) {
        try {
          // Check cooldown
          if (alert.lastTriggeredAt) {
            const cooldownMs = alert.cooldownMinutes * 60 * 1000;
            const timeSince = Date.now() - alert.lastTriggeredAt.getTime();
            if (timeSince < cooldownMs) continue; // Still in cooldown
          }

          // Evaluate condition (MVP: price only)
          const shouldTrigger = await this.evaluateCondition(alert.condition, alert.TokenInfo);
          evaluated++;

          this.logger.debug(`Alert ${alert.id}: condition=${JSON.stringify(alert.condition)}, priceUsd=${alert.TokenInfo?.priceUsd}, shouldTrigger=${shouldTrigger}`);

          if (shouldTrigger) {
            // Trigger alert
            await this.triggerAlert(alert, alert.TokenInfo);
            triggered++;
            this.logger.log(`✅ Alert ${alert.id} triggered for user ${alert.userId}`);
          }
        } catch (error) {
          this.logger.error(`Failed to evaluate alert ${alert.id}:`, error);
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(`Alert evaluation complete: ${evaluated} evaluated, ${triggered} triggered in ${duration}ms`);

    } catch (error) {
      this.logger.error('Alert evaluator job failed:', error);
    }
  }

  private async evaluateCondition(condition: any, tokenInfo: any): Promise<boolean> {
    if (!tokenInfo) return false;

    // MVP: Simple price comparison
    if (condition.type === 'price') {
      const value = parseFloat(tokenInfo[condition.field] || '0');
      const target = condition.value;

      switch (condition.operator) {
        case 'gt':
          return value > target;
        case 'gte':
          return value >= target;
        case 'lt':
          return value < target;
        case 'lte':
          return value <= target;
        default:
          return false;
      }
    }

    return false;
  }

  private async triggerAlert(alert: any, tokenInfo: any) {
    const snapshot = {
      tokenAddress: alert.tokenAddress,
      symbol: tokenInfo?.symbol,
      name: tokenInfo?.name,
      priceUsd: tokenInfo?.priceUsd,
      marketCapUsd: tokenInfo?.marketCapUsd,
      timestamp: new Date().toISOString(),
    };

    // Create notification
    await this.alertsService.triggerAlert(alert, snapshot);

    // Deliver via socket (in-app notification)
    try {
      this.messageGateway.server.emit(`user:${alert.userId}:alert`, {
        alertId: alert.id,
        label: alert.label || 'Price Alert',
        tokenAddress: alert.tokenAddress,
        snapshot,
      });

      this.logger.log(`Alert ${alert.id} triggered for user ${alert.userId}`);
    } catch (error) {
      this.logger.error(`Failed to deliver alert ${alert.id}:`, error);
    }
  }
}
