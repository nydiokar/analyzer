# Grafana Dashboard Templates

Pre-built Grafana dashboards for monitoring your Sova Intel Wallet Analyzer application.

## Dashboard Overview

| # | Dashboard | Purpose | Priority |
|---|-----------|---------|----------|
| 01 | **Host Overview** | System resources (CPU, memory, disk, network) | High |
| 02 | **Node.js Runtime** | Application health (heap, GC, event loop) | High |
| 03 | **HTTP API** | Request performance (RPS, latency, errors) | Critical |
| 04 | **BullMQ Queues** | Job processing (queue depth, throughput, failures) | **Critical** |
| 05 | **PostgreSQL** | Database performance (connections, queries, cache hit rate) | High |
| 06 | **Redis** | Cache performance (memory, hit rate, evictions) | Medium |

---

## Installation

### Option 1: Import via Grafana UI (Recommended)

1. Open Grafana web interface: `http://your-grafana-host:3000`
2. Login (default: admin/admin)
3. Navigate to **Dashboards** → **Import**
4. For each dashboard JSON file:
   - Click **Upload JSON file**
   - Select the file (e.g., `01-host-overview.json`)
   - Choose your Prometheus data source
   - Click **Import**

### Option 2: Provisioning (Automated)

1. Create provisioning directory structure:

```bash
sudo mkdir -p /etc/grafana/provisioning/dashboards
```

2. Copy dashboard files:

```bash
sudo cp docs/observability/dashboards/*.json /etc/grafana/provisioning/dashboards/
```

3. Create provisioning config:

```bash
sudo tee /etc/grafana/provisioning/dashboards/prometheus.yml > /dev/null <<'EOF'
apiVersion: 1

providers:
  - name: 'Prometheus Dashboards'
    orgId: 1
    folder: 'Sova Intel'
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /etc/grafana/provisioning/dashboards
EOF
```

4. Restart Grafana:

```bash
sudo systemctl restart grafana-server
```

Dashboards will appear in the "Sova Intel" folder.

### Option 3: Docker Volume Mount

```bash
docker run -d \
  --name=grafana \
  -p 3000:3000 \
  -v grafana-data:/var/lib/grafana \
  -v $(pwd)/docs/observability/dashboards:/etc/grafana/provisioning/dashboards:ro \
  grafana/grafana:latest
```

---

## Dashboard Details

### 01 - Host Overview

**When to use:** Check if your Pi/VPS is the bottleneck

**Key panels:**
- **CPU Usage**: >80% sustained = CPU-bound, consider optimization or upgrade
- **Memory Usage**: >85% = risk of OOM killer, add more RAM
- **Disk Usage**: >90% = risk of crashes, clean up or expand storage
- **Load Average**: 1min > 5min > 15min = increasing load (bad trend)
- **Network Traffic**: Spikes correlated with job processing?
- **Disk I/O**: Bottleneck indicator (especially on Pi with SD card)

**Alerts:**
- CPU >80% for 10 minutes
- Memory >85%
- Disk >90%

**Migration value:** Compare Pi metrics vs VPS side-by-side to justify cost.

---

### 02 - Node.js Runtime

**When to use:** Check if your application is healthy

**Key panels:**
- **Heap Memory Usage**: Growing without dropping = memory leak
- **RSS Memory**: Total memory used (heap + code + stack)
- **Event Loop Lag**: >100ms = blocked event loop (performance impact)
- **Garbage Collection**: Frequent long pauses = heap pressure
- **Memory Leak Detection**: Heap growth over 1 hour (red = investigate)

**Alerts:**
- Heap growth >500MB/hour
- Event loop lag >100ms

**Troubleshooting:**
- Heap growing? Check for leaked subscriptions, unclosed connections
- High GC time? Reduce object allocation, use object pooling
- Event loop blocked? Offload CPU-intensive work to workers

---

### 03 - HTTP API

**When to use:** Diagnose slow or failing API requests

**Key panels:**
- **Request Rate (RPS)**: Traffic pattern, detect spikes
- **Error Rate %**: >1% = investigate immediately
- **Latency Percentiles**: p95 >2s = slow endpoints
- **Top Slowest Routes**: Focus optimization here
- **Requests by Route**: Which endpoints get most traffic?

**Alerts:**
- Error rate >1% for 5 minutes
- p95 latency >2 seconds

**Optimization workflow:**
1. Identify slow routes in "Top Slowest Routes"
2. Check if correlation with job queue backlog (BullMQ dashboard)
3. Check if database queries are slow (Postgres dashboard)
4. Profile the route handler, add caching if possible

---

### 04 - BullMQ Queues (CRITICAL)

**When to use:** Every day. This is your #1 bottleneck detector.

**Key panels:**
- **Queue Depth (Waiting)**: >100 = backlog building up
- **Active Jobs**: Compare to worker concurrency (configured in queue.config.ts)
- **Failed Jobs**: >0 = requires manual investigation
- **Job Throughput**: jobs/sec completing (higher = better)
- **Job Processing Duration p95**: How long jobs take
- **Queue Status Overview**: At-a-glance health check

**Alerts:**
- Waiting jobs >100 for 10 minutes
- Failed jobs >10
- Job processing time >120 seconds

**Troubleshooting guide:**

| Symptom | Possible Cause | Solution |
|---------|----------------|----------|
| Waiting jobs growing | Workers slower than ingest rate | Increase concurrency or add workers |
| Failed jobs accumulating | Code bugs, external API failures | Check logs, fix bugs, retry failed jobs |
| High job duration | Database slow, external API slow | Check Postgres/Redis dashboards |
| Stalled jobs >0 | Worker crashed mid-job | Restart workers, investigate crash |
| Low throughput | CPU-bound workers | Optimize code, reduce work per job |

**Critical actions:**
- Monitor "Job Success Rate %" - should be >99%
- Check failed jobs daily and fix root causes
- Adjust worker concurrency based on queue depth

---

### 05 - PostgreSQL

**When to use:** Diagnose slow queries or database bottlenecks

**Key panels:**
- **Connections**: Compare to max_connections setting
- **Cache Hit Ratio**: >99% is good, <95% = increase shared_buffers
- **Deadlocks**: >0 = investigate locking patterns (see CONTEXT.md Jan 26)
- **Locks**: Sudden spikes = contention, investigate queries
- **Slow Queries**: Top 10 queries by mean execution time (requires `pg_stat_statements`)

**Alerts:**
- Cache hit ratio <95%
- Deadlocks detected
- Connections >80% of max_connections

**Optimization workflow:**
1. Check cache hit ratio - if low, increase `shared_buffers`
2. Identify slow queries in table - add indexes
3. Check temp files - if non-zero, increase `work_mem`
4. Monitor deadlocks - ensure consistent lock acquisition order (see DATABASE_DEADLOCK_FIX.md)

---

### 06 - Redis

**When to use:** Diagnose cache performance issues

**Key panels:**
- **Memory Usage**: Compare to max memory limit
- **Hit Rate %**: >90% is good, <70% = cache misses (check TTL config)
- **Evicted Keys**: >0 = memory full, increase maxmemory
- **Memory Fragmentation Ratio**: 1.0-1.5 is normal, >2.0 = restart Redis
- **Blocked Clients**: >0 may indicate queue issues

**Alerts:**
- Hit rate <70%
- Evictions detected (maxmemory reached)
- Memory fragmentation >2.0

**Troubleshooting:**
- Evictions happening? Increase `maxmemory` or shorten TTLs
- Low hit rate? Check TTL configuration (cache expiring too quickly)
- High fragmentation? Restart Redis (`redis-cli shutdown; systemctl start redis`)

---

## Common Workflows

### Debugging Slow Job Processing

1. Open **BullMQ Queues** dashboard
   - Check "Queue Depth" - is backlog growing?
   - Check "Active Jobs" - are workers busy?
   - Check "Job Processing Duration" - which job types are slow?

2. Open **Postgres** dashboard
   - Is database the bottleneck? Check connections, locks, slow queries

3. Open **Redis** dashboard
   - Is cache thrashing? Check hit rate, evictions

4. Open **Node.js Runtime** dashboard
   - Is app memory-starved? Check heap usage, GC pauses

5. Open **Host Overview** dashboard
   - Is system resource-constrained? Check CPU, memory, disk I/O

### Investigating Errors

1. Open **HTTP API** dashboard
   - Check "Error Rate %" - when did spike start?
   - Check "Top Slowest Routes" - which endpoint?

2. Open **BullMQ Queues** dashboard
   - Check "Failed Jobs" - which queue has failures?
   - Check "Job Success Rate %" - trend

3. Check application logs:
   ```bash
   sudo journalctl -u your-app -f --since "10 minutes ago"
   ```

4. Check worker logs:
   ```bash
   grep ERROR /var/log/your-app/worker.log | tail -50
   ```

### Pre-VPS Migration Baseline

Before migrating to VPS, capture baseline metrics:

1. **Host Overview** - Note CPU, memory, disk I/O patterns
2. **BullMQ Queues** - Note job throughput (jobs/sec)
3. **HTTP API** - Note p95 latency, error rate
4. **Postgres** - Note cache hit ratio, TPS
5. **Redis** - Note hit rate, ops/sec

After migration, compare these metrics to justify cost and identify improvements.

---

## Customization

### Adjusting Thresholds

Edit JSON files and modify `thresholds` sections:

```json
"thresholds": {
  "mode": "absolute",
  "steps": [
    {"value": 0, "color": "green"},
    {"value": 80, "color": "yellow"},  // Adjust this
    {"value": 95, "color": "red"}      // And this
  ]
}
```

### Adding Custom Panels

1. Edit dashboard in Grafana UI
2. Export JSON: **Dashboard Settings** → **JSON Model** → Copy
3. Save to file and commit to repo

### Variables

Add dashboard variables for dynamic filtering:

```json
"templating": {
  "list": [
    {
      "name": "queue",
      "type": "query",
      "query": "label_values(bullmq_jobs_waiting, queue)",
      "multi": true
    }
  ]
}
```

Then use in queries: `bullmq_jobs_waiting{queue=~"$queue"}`

---

## Troubleshooting

### Dashboard shows "No data"

**Check Prometheus targets:**
```bash
curl http://localhost:9090/api/v1/targets
```

All targets should be "UP". If not, see [PROMETHEUS_SETUP.md](../PROMETHEUS_SETUP.md).

**Check data source in Grafana:**
1. Go to **Configuration** → **Data Sources**
2. Click your Prometheus data source
3. Click **Save & Test**
4. Should show "Data source is working"

### Panel shows error

**"Bad Gateway"** = Prometheus not reachable
- Check Prometheus is running: `systemctl status prometheus`
- Check data source URL in Grafana

**"Unsupported query"** = Metric doesn't exist
- Check metric exists: `curl http://localhost:9090/api/v1/label/__name__/values | grep metric_name`
- May be typo in query or exporter not running

**"No data points"** = Metric exists but no data
- Check scrape is working: Look for metric in Prometheus graph UI
- May be no traffic/activity yet (normal for new setup)

### Grafana login issues

**Default credentials:**
- Username: `admin`
- Password: `admin` (will prompt to change on first login)

**Forgot password?**
```bash
# Reset admin password
sudo grafana-cli admin reset-admin-password newpassword
```

---

## Best Practices

1. **Start with BullMQ dashboard** - It's your primary bottleneck detector
2. **Set up alerts** - Don't wait for users to report issues
3. **Review dashboards daily** - Spot trends before they become problems
4. **Correlate across dashboards** - Slow jobs? Check DB and Redis
5. **Baseline before changes** - Capture metrics before optimizations
6. **Use annotations** - Mark deployments, config changes on graphs
7. **Export/backup dashboards** - Save JSON to repo (already done!)

---

## Next Steps

1. ✅ Dashboards imported
2. [Set up alerts](../ALERTING.md) for critical metrics
3. [Configure Slack notifications](../ALERTING.md#slack-integration)
4. Create custom dashboard for business metrics (wallet analysis trends, user growth, etc.)

---

## References

- [Grafana Documentation](https://grafana.com/docs/)
- [PromQL Query Language](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [Dashboard Best Practices](https://grafana.com/docs/grafana/latest/best-practices/best-practices-for-creating-dashboards/)
- [Alerting Guide](https://grafana.com/docs/grafana/latest/alerting/)
