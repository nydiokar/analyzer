import { Injectable, Logger } from '@nestjs/common';

export interface AlertMessage {
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  context?: Record<string, any>;
  timestamp?: number;
}

export interface MetricEvent {
  name: string;
  value: number;
  tags?: Record<string, string>;
  timestamp?: number;
}

@Injectable()
export class AlertingService {
  private readonly logger = new Logger(AlertingService.name);

  /**
   * Send an alert - for now logs at appropriate level, 
   * can be extended to integrate with external alerting systems
   */
  async sendAlert(alert: AlertMessage): Promise<void> {
    const timestamp = alert.timestamp || Date.now();
    const alertWithTimestamp = {
      ...alert,
      timestamp: new Date(timestamp).toISOString(),
    };

    // Log at appropriate level based on severity
    switch (alert.severity) {
      case 'critical':
        this.logger.error(`🚨 CRITICAL ALERT: ${alert.title}`, alertWithTimestamp);
        break;
      case 'high':
        this.logger.error(`⚠️ HIGH ALERT: ${alert.title}`, alertWithTimestamp);
        break;
      case 'medium':
        this.logger.warn(`⚡ MEDIUM ALERT: ${alert.title}`, alertWithTimestamp);
        break;
      case 'low':
        this.logger.log(`ℹ️ LOW ALERT: ${alert.title}`, alertWithTimestamp);
        break;
    }

    // TODO: Future integrations:
    // - Slack webhook notifications for high/critical alerts
    // - Email notifications 
    // - Discord webhooks
    // - PagerDuty integration
    // - Integration with monitoring platforms (DataDog, New Relic, etc.)
  }

  /**
   * Emit a metric event - for now logs, can be extended to integrate with metrics systems
   */
  async emitMetric(metric: MetricEvent): Promise<void> {
    const timestamp = metric.timestamp || Date.now();
    
    // Only log meaningful metrics, not every counter increment
    if (this.isImportantMetric(metric)) {
      this.logger.log(`📊 ${metric.name}: ${metric.value}${metric.tags ? ' | ' + Object.entries(metric.tags).map(([k,v]) => `${k}:${v}`).join(', ') : ''}`);
    }

    // TODO: Future integrations:
    // - Prometheus metrics export
    // - StatsD integration
    // - Custom metrics API
    // - Time-series database storage
  }

  /**
   * Determine if a metric is important enough to log
   */
  private isImportantMetric(metric: MetricEvent): boolean {
    // Log important metrics only
    const importantMetrics = [
      'job_failures_total',
      'queue_processing_time_ms',
      'dead_letter_queue_size',
      'redis_connection_failures',
      'memory_usage_mb',
      'api_request_duration_ms'
    ];
    
    // Log if it's an important metric or if the value is significant
    return importantMetrics.some(important => metric.name.includes(important)) || 
           metric.value > 100; // Only log large values
  }

  /**
   * Increment a counter metric
   */
  async incrementCounter(name: string, tags?: Record<string, string>): Promise<void> {
    await this.emitMetric({
      name,
      value: 1,
      tags,
    });
  }

  /**
   * Set a gauge metric value
   */
  async setGauge(name: string, value: number, tags?: Record<string, string>): Promise<void> {
    await this.emitMetric({
      name,
      value,
      tags,
    });
  }

  /**
   * Record a timing metric (in milliseconds)
   */
  async recordTiming(name: string, timeMs: number, tags?: Record<string, string>): Promise<void> {
    await this.emitMetric({
      name: `${name}.duration_ms`,
      value: timeMs,
      tags,
    });
  }
} 