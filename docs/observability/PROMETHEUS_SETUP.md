# Prometheus Setup Guide

Complete guide for setting up Prometheus to scrape metrics from your Sova Intel Wallet Analyzer application.

## Prerequisites

- All exporters installed ([See Exporter Installation Guide](./EXPORTER_INSTALLATION.md))
- Your application running with metrics endpoint at `/api/v1/metrics`
- Raspberry Pi or VPS with at least 1GB RAM and 10GB disk space

## Table of Contents

- [Prometheus Installation](#prometheus-installation)
- [Configuration](#configuration)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)
- [Retention Policy](#retention-policy)

---

## Prometheus Installation

### Option 1: Install via apt (Debian/Ubuntu/Pi OS)

```bash
# Install Prometheus
sudo apt update
sudo apt install prometheus -y

# Service will start automatically
sudo systemctl status prometheus
```

### Option 2: Install from Binary

```bash
# Download latest release
VERSION="2.49.0"  # Check https://prometheus.io/download/ for latest
ARCH=$(uname -m)
case $ARCH in
  x86_64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  armv7l) ARCH="armv7" ;;
esac

wget https://github.com/prometheus/prometheus/releases/download/v${VERSION}/prometheus-${VERSION}.linux-${ARCH}.tar.gz

# Extract
tar xvfz prometheus-${VERSION}.linux-${ARCH}.tar.gz
cd prometheus-${VERSION}.linux-${ARCH}

# Move binaries to system path
sudo mv prometheus promtool /usr/local/bin/
sudo mv consoles console_libraries /etc/prometheus/

# Create directories
sudo mkdir -p /etc/prometheus /var/lib/prometheus
sudo chown -R prometheus:prometheus /etc/prometheus /var/lib/prometheus

# Create prometheus user
sudo useradd --no-create-home --shell /bin/false prometheus

# Create systemd service
sudo tee /etc/systemd/system/prometheus.service > /dev/null <<'EOF'
[Unit]
Description=Prometheus Time Series Collection and Storage
Wants=network-online.target
After=network-online.target

[Service]
User=prometheus
Group=prometheus
Type=simple
ExecStart=/usr/local/bin/prometheus \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path=/var/lib/prometheus/ \
  --storage.tsdb.retention.time=30d \
  --storage.tsdb.retention.size=50GB \
  --web.console.templates=/etc/prometheus/consoles \
  --web.console.libraries=/etc/prometheus/console_libraries \
  --web.listen-address=0.0.0.0:9090

Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and start Prometheus
sudo systemctl daemon-reload
sudo systemctl enable prometheus
sudo systemctl start prometheus
```

### Option 3: Install via Docker

```bash
# Create persistent volume for Prometheus data
docker volume create prometheus_data

# Create network for exporters
docker network create monitoring || true

# Run Prometheus
docker run -d \
  --name prometheus \
  --restart unless-stopped \
  --network monitoring \
  -p 9090:9090 \
  -v prometheus_data:/prometheus \
  -v $(pwd)/prometheus.yml:/etc/prometheus/prometheus.yml:ro \
  prom/prometheus:latest \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path=/prometheus \
  --storage.tsdb.retention.time=30d \
  --web.console.libraries=/etc/prometheus/console_libraries \
  --web.console.templates=/etc/prometheus/consoles
```

---

## Configuration

### Step 1: Copy Configuration File

```bash
# Copy the provided prometheus.yml to Prometheus config directory
sudo cp docs/observability/prometheus.yml /etc/prometheus/prometheus.yml

# Set correct permissions
sudo chown prometheus:prometheus /etc/prometheus/prometheus.yml
sudo chmod 644 /etc/prometheus/prometheus.yml
```

### Step 2: Edit Configuration

Open the configuration file and replace placeholders:

```bash
sudo nano /etc/prometheus/prometheus.yml
```

**Required Changes:**

1. Replace `REPLACE_WITH_YOUR_APP_HOST:3001` with your app's actual address:
   - Local development: `localhost:3001`
   - Production domain: `sova-intel.duckdns.org` (or your domain)
   - LAN IP: `192.168.1.10:3001`

2. Replace `REPLACE_WITH_YOUR_HOST_IP:9100` with your host IP (for node_exporter)

3. Replace `REPLACE_WITH_YOUR_HOST_IP:9187` with your host IP (for postgres_exporter)

4. Replace `REPLACE_WITH_YOUR_HOST_IP:9121` with your host IP (for redis_exporter)

**Example Configuration (Pi 5 at 192.168.1.10):**

```yaml
scrape_configs:
  - job_name: 'app'
    static_configs:
      - targets: ['192.168.1.10:3001']
    metrics_path: '/api/v1/metrics'

  - job_name: 'bullmq'
    scrape_interval: 5s
    static_configs:
      - targets: ['192.168.1.10:3001']
    metrics_path: '/api/v1/metrics'

  - job_name: 'node'
    static_configs:
      - targets: ['192.168.1.10:9100']

  - job_name: 'postgres'
    static_configs:
      - targets: ['192.168.1.10:9187']

  - job_name: 'redis'
    static_configs:
      - targets: ['192.168.1.10:9121']
```

### Step 3: Validate Configuration

```bash
# Check configuration syntax
promtool check config /etc/prometheus/prometheus.yml

# Should output: "SUCCESS: ... is valid prometheus config file syntax"
```

### Step 4: Reload Prometheus

```bash
# Option 1: Reload configuration (no downtime)
sudo systemctl reload prometheus

# Option 2: Restart service (brief downtime)
sudo systemctl restart prometheus

# Option 3: Send SIGHUP signal
kill -HUP $(pidof prometheus)

# Check status
sudo systemctl status prometheus
```

---

## Verification

### 1. Check Prometheus Web UI

Open your browser and navigate to:

```
http://YOUR_PROMETHEUS_HOST:9090
```

Examples:
- Local: http://localhost:9090
- Pi: http://192.168.1.10:9090

### 2. Verify Targets

Navigate to **Status → Targets** in Prometheus UI:

```
http://YOUR_PROMETHEUS_HOST:9090/targets
```

**All targets should show "UP" status:**
- `app (1/1 up)` - Application metrics
- `bullmq (1/1 up)` - BullMQ queue metrics
- `node (1/1 up)` - Host metrics
- `postgres (1/1 up)` - Database metrics
- `redis (1/1 up)` - Cache metrics
- `prometheus (1/1 up)` - Prometheus self-monitoring

**If any target shows "DOWN":**
1. Click the target to see error message
2. Common issues:
   - Connection refused: Service not running
   - Timeout: Firewall blocking connection
   - 404 Not Found: Wrong metrics path
   - Authentication required: Missing credentials

### 3. Test Queries

Go to **Graph** tab and run test queries:

```promql
# Check HTTP request rate
rate(http_requests_total[5m])

# Check BullMQ queue depth
bullmq_jobs_waiting

# Check analysis job duration
rate(analysis_jobs_total[5m])

# Check host CPU usage
100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# Check Postgres connections
pg_stat_database_numbackends

# Check Redis memory usage
redis_memory_used_bytes
```

**All queries should return data.** If you get "No data", check that:
1. Metrics are being collected (curl the endpoint manually)
2. Target is in "UP" state
3. Query syntax is correct

---

## Troubleshooting

### Prometheus Won't Start

```bash
# Check logs
sudo journalctl -u prometheus -f

# Common issues:
# - "permission denied": Check file ownership
sudo chown -R prometheus:prometheus /etc/prometheus /var/lib/prometheus

# - "bind: address already in use": Port 9090 is taken
sudo lsof -i :9090
# Kill the process or change --web.listen-address

# - "invalid config": Syntax error in YAML
promtool check config /etc/prometheus/prometheus.yml
```

### Target Shows "DOWN"

```bash
# Test endpoint manually
curl http://TARGET_HOST:TARGET_PORT/metrics

# Examples:
curl http://localhost:3001/api/v1/metrics
curl http://localhost:9100/metrics
curl http://localhost:9187/metrics
curl http://localhost:9121/metrics

# If curl fails:
# - Connection refused: Service not running
sudo systemctl status node_exporter postgres_exporter redis_exporter

# - Timeout: Firewall blocking
sudo ufw allow 9100/tcp
sudo ufw allow 9187/tcp
sudo ufw allow 9121/tcp

# - Certificate errors: Check TLS configuration
```

### No Data in Graphs

```bash
# Check if scrapes are successful
# In Prometheus UI: Status → Targets
# Look for "Last Scrape" timestamp and "Error" field

# Check retention period (data might be purged)
# Default: 15 days, configured with --storage.tsdb.retention.time

# Check disk space
df -h /var/lib/prometheus

# If disk is full, data cannot be written
```

### High Memory Usage

Prometheus memory usage grows with:
- Number of time series (unique metric + label combinations)
- Scrape frequency
- Retention period

**Optimization strategies:**

1. **Drop high-cardinality metrics:**

```yaml
scrape_configs:
  - job_name: 'app'
    metric_relabel_configs:
      # Drop metrics with wallet addresses (infinite cardinality)
      - source_labels: [wallet_address]
        action: labeldrop
```

2. **Reduce scrape frequency:**

```yaml
global:
  scrape_interval: 30s  # Increase from 15s
```

3. **Reduce retention period:**

```bash
# Edit systemd service
sudo systemctl edit prometheus

# Add:
[Service]
Environment="PROMETHEUS_RETENTION=15d"
```

4. **Enable compression (Prometheus 2.26+):**

```yaml
global:
  external_labels:
    compaction: true
```

---

## Retention Policy

Prometheus stores metrics in a time-series database (TSDB) on disk.

### Retention Configuration

Retention can be configured by **time** or **size**:

```bash
# Time-based retention (recommended)
--storage.tsdb.retention.time=30d  # Keep 30 days of data

# Size-based retention
--storage.tsdb.retention.size=50GB  # Keep up to 50GB of data

# Combine both (whichever limit is hit first)
--storage.tsdb.retention.time=30d \
--storage.tsdb.retention.size=50GB
```

### Recommended Retention by Environment

| Environment | Retention Time | Retention Size | Disk Space Needed |
|-------------|----------------|----------------|-------------------|
| Development | 7d | 5GB | 10GB |
| Staging | 15d | 20GB | 30GB |
| Production | 30d | 50GB | 75GB |
| Production (Pi) | 15d | 20GB | 30GB |

### Estimate Disk Usage

Rule of thumb: **1-2 bytes per sample**

Calculate samples per day:
```
samples_per_day = time_series_count × (86400 / scrape_interval_seconds)

Example:
- 500 unique time series
- 15s scrape interval
= 500 × (86400 / 15)
= 500 × 5760
= 2,880,000 samples/day
= ~5.76 MB/day (at 2 bytes/sample)
= ~173 MB/month
```

With 30-day retention and typical cardinality (~1000 time series), expect **5-10GB** storage usage.

### Manual Cleanup

Prometheus automatically deletes old data based on retention policy. To manually trigger cleanup:

```bash
# Delete data older than retention period
curl -X POST http://localhost:9090/api/v1/admin/tsdb/delete_series?match[]={__name__=~".+"}

# Clean up tombstones
curl -X POST http://localhost:9090/api/v1/admin/tsdb/clean_tombstones
```

⚠️ **Warning:** Manual cleanup is rarely needed and can corrupt data if done incorrectly.

---

## Next Steps

1. ✅ Prometheus is running and scraping all targets
2. [Set up Grafana dashboards](./GRAFANA_DASHBOARDS.md) to visualize metrics
3. [Configure alerts](./ALERTING.md) for critical issues
4. [Optimize queries](./QUERY_OPTIMIZATION.md) for dashboard performance

---

## Security Recommendations

### 1. Enable Authentication

Prometheus does not have built-in authentication. Use a reverse proxy:

```nginx
# Nginx configuration
location /prometheus/ {
    auth_basic "Prometheus";
    auth_basic_user_file /etc/nginx/.htpasswd;
    proxy_pass http://localhost:9090/;
}
```

### 2. Firewall Rules

Only allow access from trusted IPs:

```bash
# Allow only from your IP
sudo ufw allow from YOUR_IP to any port 9090

# Or use VPN and allow only from VPN subnet
sudo ufw allow from 10.8.0.0/24 to any port 9090
```

### 3. Disable Remote Write (if not needed)

```yaml
# prometheus.yml
# Comment out or remove remote_write section if present
# remote_write:
#   - url: http://remote-storage:9009/api/v1/push
```

### 4. Regular Backups

Backup Prometheus data directory:

```bash
# Create backup
sudo tar -czf prometheus-backup-$(date +%Y%m%d).tar.gz /var/lib/prometheus

# Or use Prometheus's built-in snapshot API
curl -X POST http://localhost:9090/api/v1/admin/tsdb/snapshot
# Snapshot will be in /var/lib/prometheus/snapshots/
```

---

## References

- [Prometheus Official Documentation](https://prometheus.io/docs/introduction/overview/)
- [Prometheus Configuration Reference](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)
- [PromQL Query Language](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [Best Practices](https://prometheus.io/docs/practices/naming/)
