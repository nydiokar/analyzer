# Prometheus Monitoring Setup

## Overview

The Sova Intel API exposes Prometheus-compatible metrics at the `/health/metrics` endpoint. This endpoint is **admin-only** and requires proper authentication.

## Security Architecture

### Endpoint Protection

All monitoring endpoints require admin privileges:
- `GET /health/detailed` - Comprehensive health check
- `GET /health/queues` - Queue and Redis status
- `GET /health/cache-metrics` - Cache statistics
- `GET /health/metrics` - Prometheus metrics (text format)

### Authentication Methods

**For Human Admins (via Browser/Postman):**
- Use JWT authentication (Bearer token)
- Your user ID or email must be in `ADMIN_USER_IDS` or `ADMIN_EMAILS` env variables

**For Prometheus Scraper (Recommended):**
- Use API key with `admin` or `full` scope
- API keys are more suitable for service-to-service authentication

## Creating an API Key for Prometheus

You'll need to create an API key via the API or database directly. Once you have it, configure Prometheus to use it.

### Prometheus Configuration

Add this to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'sova-intel'
    scrape_interval: 30s
    scrape_timeout: 10s
    metrics_path: /health/metrics
    scheme: https  # or http for local
    static_configs:
      - targets: ['your-api-domain.com']
    # Add API key authentication
    authorization:
      credentials: 'your-api-key-here'
    # Alternative: use custom header
    # headers:
    #   X-API-Key: 'your-api-key-here'
```

## Available Metrics

### Database Metrics
- `sova_database_up` - Database availability (1 = up, 0 = down)
- `sova_database_response_time_ms` - Database response time in milliseconds

### Redis Metrics
- `sova_redis_up` - Redis availability (1 = up, 0 = down)

### Queue Metrics
- `sova_queues_healthy` - Number of healthy queues
- `sova_queues_total` - Total monitored queues
- `sova_queue_{name}_waiting` - Jobs waiting per queue
- `sova_queue_{name}_active` - Active jobs per queue
- `sova_queue_{name}_failed` - Failed jobs per queue

### Cache Metrics
- `sova_cache_holder_profiles_total` - Total cached holder profiles

### System Metrics
- `sova_health_check_timestamp_seconds` - Timestamp of last health check

## Example Queries

### Alert on Database Down
```promql
sova_database_up == 0
```

### Alert on High Queue Backlog
```promql
sova_queue_analysis_waiting > 100
```

### Alert on Redis Down
```promql
sova_redis_up == 0
```

### Database Response Time (in seconds)
```promql
sova_database_response_time_ms / 1000
```

## Testing Locally

```bash
# Using JWT token (if you're admin)
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" http://localhost:3000/health/metrics

# Using API key
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/health/metrics
```

## Security Notes

- ✅ All endpoints protected by AdminGuard
- ✅ Regular users cannot access metrics (even with valid JWT)
- ✅ API keys support scope-based permissions
- ✅ JWT authentication for human admins checks ADMIN_USER_IDS/ADMIN_EMAILS
- ✅ Prevents infrastructure enumeration by unauthorized users

## Environment Variables

Ensure these are set in your `.env`:

```bash
# Admin access control
ADMIN_USER_IDS=your-user-id-here
ADMIN_EMAILS=admin@example.com

# For API key creation (if needed)
PASSWORD_PEPPER=your-32-char-pepper-here
```

## Next Steps

1. Create an API key with `admin` scope for Prometheus
2. Configure Prometheus with the API key
3. Set up Grafana dashboards (optional)
4. Configure alerting rules based on your SLOs
