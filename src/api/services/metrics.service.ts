import { Injectable, OnModuleInit } from '@nestjs/common';
import { register, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  // HTTP metrics
  public readonly httpRequestsTotal: Counter;
  public readonly httpRequestDuration: Histogram;

  // System metrics
  public readonly memoryUsage: Gauge;
  public readonly activeConnections: Gauge;

  // Business metrics
  public readonly analysisJobsTotal: Counter;
  public readonly analysisJobDuration: Histogram;

  constructor() {
    // HTTP request counter
    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
    });

    // HTTP request duration
    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.1, 0.5, 1, 2, 5, 10],
    });

    // Memory usage gauge
    this.memoryUsage = new Gauge({
      name: 'nodejs_memory_usage_bytes',
      help: 'Node.js memory usage in bytes',
      labelNames: ['type'],
    });

    // Active connections
    this.activeConnections = new Gauge({
      name: 'active_connections',
      help: 'Number of active connections',
    });

    // Analysis jobs counter
    this.analysisJobsTotal = new Counter({
      name: 'analysis_jobs_total',
      help: 'Total number of analysis jobs processed',
      labelNames: ['type', 'status'],
    });

    // Analysis job duration
    this.analysisJobDuration = new Histogram({
      name: 'analysis_job_duration_seconds',
      help: 'Duration of analysis jobs in seconds',
      labelNames: ['type'],
      buckets: [1, 5, 10, 30, 60, 120, 300],
    });
  }

  onModuleInit() {
    // Collect default metrics (CPU, memory, event loop, etc.)
    collectDefaultMetrics({ register });

    // Update memory usage periodically
    setInterval(() => {
      const usage = process.memoryUsage();
      this.memoryUsage.set({ type: 'heapUsed' }, usage.heapUsed);
      this.memoryUsage.set({ type: 'heapTotal' }, usage.heapTotal);
      this.memoryUsage.set({ type: 'rss' }, usage.rss);
      this.memoryUsage.set({ type: 'external' }, usage.external);
    }, 10000); // Update every 10 seconds
  }

  /**
   * Get all metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return register.metrics();
  }

  /**
   * Clear all metrics (useful for testing)
   */
  clearMetrics(): void {
    register.clear();
  }
}
