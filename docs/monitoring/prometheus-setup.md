# Prometheus Monitoring Setup Guide

## Overview

Sova Intel exposes metrics in Prometheus format for comprehensive monitoring and alerting.

## Quick Start

### 1. Create Monitoring API Key

Generate a dedicated API key for Prometheus:
```bash
# Add to your .env
PROMETHEUS_API_KEY=your-secure-api-key-here
```

### 2. Configure Prometheus

Create `prometheus.yml`:
```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'sova-intel'
    metrics_path: '/health/metrics'
    scheme: 'https'
    static_configs:
      - targets: ['your-api-domain.com']
    headers:
      - "X-API-Key: ${PROMETHEUS_API_KEY}"
```

### 3. Run Prometheus

```bash
docker run -d \
  --name prometheus \
  -p 9090:9090 \
  -v $(pwd)/prometheus.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus
```

## Available Endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /health` | Public | Basic operational status |
| `GET /health/detailed` | Required | Database, cache, performance metrics |
| `GET /health/queues` | Required | BullMQ queue health and Redis status |
| `GET /health/cache` | Required | Cache statistics |
| `GET /health/metrics` | Required | Prometheus metrics (text format) |

## Exposed Metrics

### Database
- `sova_database_up` - Database availability (1=up, 0=down)
- `sova_database_response_time_ms` - Response time in ms

### Queues
- `sova_queues_healthy` - Number of healthy queues
- `sova_queues_total` - Total monitored queues
- `sova_redis_up` - Redis availability
- `sova_queue_{name}_waiting` - Jobs waiting per queue
- `sova_queue_{name}_active` - Active jobs per queue
- `sova_queue_{name}_failed` - Failed jobs per queue

### Cache
- `sova_cache_holder_profiles_total` - Cached profiles count

### System
- `sova_health_check_timestamp_seconds` - Last check timestamp

## Sample Alerts

Create `alert.rules.yml`:
```yaml
groups:
  - name: sova_alerts
    rules:
      - alert: DatabaseDown
        expr: sova_database_up == 0
        for: 1m
        annotations:
          summary: "Database is down"

      - alert: QueueBacklog
        expr: sova_queue_analysis_operations_waiting > 100
        for: 10m
        annotations:
          summary: "Queue backlog: {{ $value }} jobs waiting"
```

## Grafana Setup

1. Add Prometheus data source (URL: http://prometheus:9090)
2. Create dashboard with panels:
   - **Database Health**: `sova_database_up`
   - **Queue Depth**: `sum by (queue) (sova_queue_*_waiting)`
   - **Redis Status**: `sova_redis_up`

## Best Practices

- Scrape interval: 15-30s for production
- Retention: 15 days minimum
- Always use authentication (never expose metrics publicly)
- Set up alerting for critical metrics
- Monitor from external network (not same server)

## Troubleshooting

**401 Unauthorized**: Check API key in headers
**No data**: Verify target is reachable and API key is valid
**Stale metrics**: Check scrape interval and application health
