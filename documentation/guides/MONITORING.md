# 📊 System Monitoring Guide

## Overview

This guide explains how to monitor the Sova Backend API in production, including queue health, memory usage, and job failures.

## On-Demand Health Checks

Starting from **December 2025**, automatic health checks were disabled to reduce memory overhead. Health monitoring is now available **on-demand via API**.

### Why the Change?

**Before (Automatic):**
- ❌ setInterval polled every 30 seconds
- ❌ Fetched 760 full job objects per check (190 × 4 queues)
- ❌ Baseline memory: 470MB idle
- ❌ CPU spikes to 60% every 30s
- ❌ 41 active handles (Redis connections)

**After (On-Demand):**
- ✅ Health checks only when requested
- ✅ Lightweight count queries (no job objects)
- ✅ Baseline memory: 140MB idle (~70% reduction)
- ✅ No CPU spikes
- ✅ 36 active handles

---

## Queue Health Monitoring

### Check Overall Health

```bash
curl http://localhost:3001/api/v1/health/queues
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-12-05T18:41:00.000Z",
  "redis": {
    "status": "healthy",
    "connectionStatus": "connected",
    "responseTime": 2
  },
  "queues": [
    {
      "queueName": "wallet-operations",
      "status": "healthy",
      "stats": {
        "waiting": 0,
        "active": 2,
        "completed": 1523,
        "failed": 12,
        "delayed": 0,
        "paused": 0
      },
      "details": {
        "isRunning": true,
        "isPaused": false,
        "processingCapacity": 50,
        "errorRate": 0.0078
      },
      "issues": []
    }
    // ... more queues
  ],
  "summary": {
    "totalQueues": 4,
    "healthyQueues": 4,
    "degradedQueues": 0,
    "unhealthyQueues": 0,
    "totalJobs": {
      "waiting": 0,
      "active": 3,
      "completed": 5234,
      "failed": 45
    }
  },
  "issues": []
}
```

### Health Status Levels

- **`healthy`**: All systems operational, no issues
- **`degraded`**: Some issues detected but system functional
  - High waiting jobs (>1000)
  - High active jobs (>50)
  - High failure rate (>10%)
- **`unhealthy`**: Critical issues requiring immediate attention
  - Queue paused
  - Redis disconnected
  - Multiple queues degraded

---

## Failed Job Monitoring

### Dead Letter Queue (Manual Mode)

Starting from December 2025, automatic failure tracking is disabled (JobEventsBridge already handles events). Use these endpoints for manual inspection:

#### Get Recent Failed Jobs

```bash
curl http://localhost:3001/api/v1/jobs/failed/recent?limit=50
```

#### Get Failed Job Stats

```bash
curl http://localhost:3001/api/v1/jobs/failed/stats
```

**Response:**
```json
{
  "queueName": "failed-jobs",
  "waiting": 0,
  "active": 0,
  "completed": 245,
  "failed": 3,
  "delayed": 0,
  "paused": 0,
  "monitoredQueues": []
}
```

---

## Memory Monitoring

### Check Current Memory Usage

```bash
# Via PM2
pm2 describe sova-backend-api | grep memory

# Via ps
ps aux | grep "node.*analyzer" | grep -v grep
```

### Expected Memory Ranges

| State | Expected Memory | Action if Exceeded |
|-------|----------------|-------------------|
| **Idle (no jobs)** | 140-200 MB | Investigate if >250MB |
| **Single job running** | 300-500 MB | Normal, should drop after completion |
| **Multiple jobs** | 500-700 MB | Normal, monitor recovery |
| **Memory leak** | Stays >500MB idle | Check logs, restart if needed |
| **Critical** | >900 MB | PM2 auto-restart at 1GB |

### Memory Leak Indicators

**Healthy Pattern:**
```
Idle: 150MB → Job: 450MB → Complete: 200MB (recovers!)
```

**Memory Leak Pattern:**
```
Idle: 150MB → Job: 450MB → Complete: 450MB (doesn't recover)
Next job: 650MB → Complete: 650MB
```

If you see the leak pattern:
1. Check logs for continuous errors
2. Check for stuck jobs: `curl http://localhost:3001/api/v1/health/queues`
3. Restart: `pm2 restart sova-backend-api`

---

## CPU Monitoring

### Check CPU Usage

```bash
pm2 monit
```

### Expected CPU Patterns

- **Idle**: 0-2%
- **Job processing**: 20-60% (spikes are normal)
- **Problem**: Sustained >80% when idle

### Troubleshooting High CPU

1. Check active jobs: `curl http://localhost:3001/api/v1/health/queues`
2. Check for stuck jobs: Look for jobs with high `active` count
3. Check logs: `pm2 logs sova-backend-api --lines 100`

---

## Setting Up External Monitoring

### Option 1: Simple Cron Job

```bash
# Add to crontab (every 5 minutes)
*/5 * * * * curl -s http://localhost:3001/api/v1/health/queues | jq '.status' | grep -v "healthy" && echo "ALERT: Queue health degraded"
```

### Option 2: Prometheus + Grafana

**1. Install Prometheus**
```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'sova-api'
    scrape_interval: 5m
    metrics_path: '/api/v1/health/queues'
    static_configs:
      - targets: ['localhost:3001']
```

**2. Alert Rules**
```yaml
# alerts.yml
groups:
  - name: sova_alerts
    rules:
      - alert: QueueHealthDegraded
        expr: sova_queue_status != 1
        for: 5m
        annotations:
          summary: "Queue {{ $labels.queue_name }} is degraded"
```

### Option 3: Uptime Monitoring (UptimeRobot, Better Uptime)

Configure HTTP monitor:
- **URL**: `http://your-server:3001/api/v1/health/queues`
- **Interval**: 5 minutes
- **Alert**: If response doesn't contain `"status":"healthy"`

---

## Job Progress Monitoring

### WebSocket Connection

Connect to real-time job updates:

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3001', { path: '/job-progress' });

socket.on('connected', (data) => {
  console.log('Connected:', data);
});

// Subscribe to job
socket.emit('subscribe-to-job', { jobId: 'holder-profiles-xxx' });

socket.on('job-progress', ({ jobId, progress }) => {
  console.log(`Job ${jobId}: ${progress}%`);
});

socket.on('job-completed', ({ jobId, result }) => {
  console.log(`Job ${jobId} completed!`, result);
});
```

### REST API Polling

```bash
# Check job status
curl http://localhost:3001/api/v1/jobs/{jobId}

# Get job progress
curl http://localhost:3001/api/v1/jobs/{jobId}/progress

# Get job result
curl http://localhost:3001/api/v1/jobs/{jobId}/result
```

---

## Troubleshooting Guide

### Issue: Memory Keeps Growing

**Symptoms:**
- Idle memory >250MB
- Memory doesn't drop after jobs complete
- Frequent PM2 restarts

**Diagnosis:**
```bash
# Check memory trend
watch -n 5 'ps aux | grep "node.*analyzer"'

# Check for stuck jobs
curl http://localhost:3001/api/v1/health/queues | jq '.summary.totalJobs.active'

# Check active handles
lsof -p $(pgrep -f "node.*analyzer") | wc -l
```

**Solutions:**
1. Restart: `pm2 restart sova-backend-api`
2. Check logs for errors: `pm2 logs --lines 200`
3. If persists: File issue with memory dump

---

### Issue: Jobs Not Processing

**Symptoms:**
- Jobs stuck in "waiting" state
- No progress updates

**Diagnosis:**
```bash
# Check queue health
curl http://localhost:3001/api/v1/health/queues

# Check if queue is paused
curl http://localhost:3001/api/v1/jobs/queue/analysis-operations/stats
```

**Solutions:**
1. Check Redis: `redis-cli ping`
2. Check workers: Queue stats should show `"isRunning": true`
3. Restart if needed: `pm2 restart sova-backend-api`

---

### Issue: High Failure Rate

**Symptoms:**
- `errorRate > 0.1` in health check
- Many jobs in failed state

**Diagnosis:**
```bash
# Get recent failures
curl http://localhost:3001/api/v1/jobs/failed/recent

# Check specific job
curl http://localhost:3001/api/v1/jobs/{jobId}
```

**Solutions:**
1. Check logs for error patterns
2. Check external dependencies (Helius API, Dexscreener)
3. Check database connectivity
4. Increase retry attempts if transient failures

---

## Best Practices

### 1. Regular Health Checks
- Poll `/health/queues` every 5 minutes
- Alert on `status: "degraded"` or `status: "unhealthy"`
- Monitor memory trends hourly

### 2. Log Aggregation
- Centralize PM2 logs (Logtail, Papertrail, CloudWatch)
- Set up alerts for ERROR level logs
- Retain logs for 7+ days

### 3. Automated Alerting
- Set up alerts for queue health degradation
- Alert on sustained high memory (>500MB idle)
- Alert on frequent restarts (>3 per hour)

### 4. Capacity Planning
- Monitor job queue depth trends
- Scale workers if `waiting` jobs consistently >100
- Add Redis memory if cache hit rate drops

---

## Useful Commands Cheat Sheet

```bash
# Health check
curl http://localhost:3001/api/v1/health/queues | jq '.status'

# Memory usage
ps aux | grep "node.*analyzer" | awk '{print $6/1024 " MB"}'

# Active jobs
curl -s http://localhost:3001/api/v1/health/queues | jq '.summary.totalJobs.active'

# Failed jobs count
curl -s http://localhost:3001/api/v1/health/queues | jq '.summary.totalJobs.failed'

# PM2 status
pm2 status sova-backend-api

# PM2 logs (real-time)
pm2 logs sova-backend-api

# Restart
pm2 restart sova-backend-api

# Redis health
redis-cli ping
redis-cli info memory
```

---

**Last Updated**: December 2025
**Document Owner**: DevOps Team
**Related Docs**: `ARCHITECTURE_DECISIONS.md`, `troubleshooting.md`
