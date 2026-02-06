# Prometheus Exporter Installation Guide

This guide covers installation of all required exporters for full observability stack.

## Table of Contents

- [Node Exporter (Host Metrics)](#node-exporter-host-metrics)
- [Postgres Exporter (Database Metrics)](#postgres-exporter-database-metrics)
- [Redis Exporter (Cache Metrics)](#redis-exporter-cache-metrics)
- [Verification](#verification)

---

## Node Exporter (Host Metrics)

**Purpose:** Exposes hardware and OS metrics (CPU, memory, disk, network, temperature)

### Installation on Raspberry Pi / Debian/Ubuntu

```bash
# Install from apt repository
sudo apt update
sudo apt install prometheus-node-exporter -y

# Enable and start service
sudo systemctl enable prometheus-node-exporter
sudo systemctl start prometheus-node-exporter

# Verify service is running
sudo systemctl status prometheus-node-exporter
```

### Installation on Other Linux Distributions

```bash
# Download latest release
ARCH=$(uname -m)
case $ARCH in
  x86_64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  armv7l) ARCH="armv7" ;;
esac

VERSION="1.7.0"  # Check https://github.com/prometheus/node_exporter/releases for latest
wget https://github.com/prometheus/node_exporter/releases/download/v${VERSION}/node_exporter-${VERSION}.linux-${ARCH}.tar.gz

# Extract and install
tar xvfz node_exporter-${VERSION}.linux-${ARCH}.tar.gz
sudo mv node_exporter-${VERSION}.linux-${ARCH}/node_exporter /usr/local/bin/
rm -rf node_exporter-${VERSION}.linux-${ARCH}*

# Create systemd service
sudo tee /etc/systemd/system/node_exporter.service > /dev/null <<EOF
[Unit]
Description=Prometheus Node Exporter
After=network.target

[Service]
Type=simple
User=prometheus
ExecStart=/usr/local/bin/node_exporter
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

# Create prometheus user
sudo useradd --no-create-home --shell /bin/false prometheus

# Start service
sudo systemctl daemon-reload
sudo systemctl enable node_exporter
sudo systemctl start node_exporter
```

### Verification

```bash
# Test endpoint (should return metrics)
curl http://localhost:9100/metrics

# Should see output like:
# node_cpu_seconds_total{cpu="0",mode="idle"} 1234.56
# node_memory_MemAvailable_bytes 1.23456e+09
# ...
```

### Default Port

**9100**

---

## Postgres Exporter (Database Metrics)

**Purpose:** Exposes PostgreSQL performance metrics (queries, locks, cache hit ratio, connections)

### Prerequisites

Enable `pg_stat_statements` extension (run once):

```sql
-- Connect to your database as superuser
psql -U postgres -d your_database_name

-- Enable extension
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Verify extension is loaded
SELECT * FROM pg_stat_statements LIMIT 1;
```

### Installation via Docker (Recommended)

```bash
# Create Docker network if not exists
docker network create monitoring || true

# Get your database connection string
# Example: postgresql://user:password@localhost:5432/dbname

# Run postgres_exporter
docker run -d \
  --name postgres_exporter \
  --restart unless-stopped \
  --network monitoring \
  -p 9187:9187 \
  -e DATA_SOURCE_NAME="postgresql://YOUR_USER:YOUR_PASSWORD@YOUR_HOST:5432/YOUR_DB?sslmode=disable" \
  prometheuscommunity/postgres-exporter:latest
```

**IMPORTANT:** Replace `YOUR_USER`, `YOUR_PASSWORD`, `YOUR_HOST`, and `YOUR_DB` with your actual database credentials.

### Installation as Binary

```bash
# Download latest release
VERSION="0.15.0"  # Check https://github.com/prometheus-community/postgres_exporter/releases
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
wget https://github.com/prometheus-community/postgres_exporter/releases/download/v${VERSION}/postgres_exporter-${VERSION}.linux-${ARCH}.tar.gz

# Extract and install
tar xvfz postgres_exporter-${VERSION}.linux-${ARCH}.tar.gz
sudo mv postgres_exporter-${VERSION}.linux-${ARCH}/postgres_exporter /usr/local/bin/
rm -rf postgres_exporter-${VERSION}.linux-${ARCH}*

# Create environment file for database connection
sudo tee /etc/default/postgres_exporter > /dev/null <<EOF
DATA_SOURCE_NAME="postgresql://YOUR_USER:YOUR_PASSWORD@YOUR_HOST:5432/YOUR_DB?sslmode=disable"
EOF

# Secure the file (contains password)
sudo chmod 600 /etc/default/postgres_exporter

# Create systemd service
sudo tee /etc/systemd/system/postgres_exporter.service > /dev/null <<EOF
[Unit]
Description=Prometheus PostgreSQL Exporter
After=network.target

[Service]
Type=simple
User=postgres
EnvironmentFile=/etc/default/postgres_exporter
ExecStart=/usr/local/bin/postgres_exporter
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

# Start service
sudo systemctl daemon-reload
sudo systemctl enable postgres_exporter
sudo systemctl start postgres_exporter
```

### Verification

```bash
# Test endpoint
curl http://localhost:9187/metrics | grep pg_

# Should see output like:
# pg_stat_database_xact_commit{datname="your_db"} 12345
# pg_stat_database_blks_read{datname="your_db"} 6789
# pg_locks_count 3
# ...
```

### Default Port

**9187**

---

## Redis Exporter (Cache Metrics)

**Purpose:** Exposes Redis performance metrics (memory usage, hit ratio, evictions, ops/sec)

### Installation via Docker (Recommended)

```bash
# Get your Redis connection details
# If Redis has no password: redis://localhost:6379
# If Redis has password: redis://:your_password@localhost:6379

# Run redis_exporter
docker run -d \
  --name redis_exporter \
  --restart unless-stopped \
  --network monitoring \
  -p 9121:9121 \
  oliver006/redis_exporter:latest \
  --redis.addr=redis://YOUR_REDIS_HOST:6379
```

**With Redis password:**

```bash
docker run -d \
  --name redis_exporter \
  --restart unless-stopped \
  --network monitoring \
  -p 9121:9121 \
  -e REDIS_ADDR=redis://YOUR_REDIS_HOST:6379 \
  -e REDIS_PASSWORD=YOUR_REDIS_PASSWORD \
  oliver006/redis_exporter:latest
```

### Installation as Binary

```bash
# Download latest release
VERSION="1.56.0"  # Check https://github.com/oliver006/redis_exporter/releases
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
wget https://github.com/oliver006/redis_exporter/releases/download/v${VERSION}/redis_exporter-v${VERSION}.linux-${ARCH}.tar.gz

# Extract and install
tar xvfz redis_exporter-v${VERSION}.linux-${ARCH}.tar.gz
sudo mv redis_exporter-v${VERSION}.linux-${ARCH}/redis_exporter /usr/local/bin/
rm -rf redis_exporter-v${VERSION}.linux-${ARCH}*

# Create environment file
sudo tee /etc/default/redis_exporter > /dev/null <<EOF
REDIS_ADDR=redis://localhost:6379
REDIS_PASSWORD=YOUR_REDIS_PASSWORD
EOF

# Secure the file
sudo chmod 600 /etc/default/redis_exporter

# Create systemd service
sudo tee /etc/systemd/system/redis_exporter.service > /dev/null <<EOF
[Unit]
Description=Prometheus Redis Exporter
After=network.target redis.service

[Service]
Type=simple
User=redis
EnvironmentFile=/etc/default/redis_exporter
ExecStart=/usr/local/bin/redis_exporter
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

# Start service
sudo systemctl daemon-reload
sudo systemctl enable redis_exporter
sudo systemctl start redis_exporter
```

### Verification

```bash
# Test endpoint
curl http://localhost:9121/metrics | grep redis_

# Should see output like:
# redis_connected_clients 5
# redis_used_memory_bytes 1234567
# redis_keyspace_hits_total 98765
# redis_evicted_keys_total 0
# ...
```

### Default Port

**9121**

---

## Verification

After installing all exporters, verify they're accessible:

```bash
# Node exporter
curl -s http://localhost:9100/metrics | head -5

# Postgres exporter
curl -s http://localhost:9187/metrics | head -5

# Redis exporter
curl -s http://localhost:9121/metrics | head -5

# Your application metrics
curl -s http://localhost:3001/api/v1/metrics | head -5
```

All endpoints should return Prometheus-formatted metrics (plain text with `# HELP` and `# TYPE` comments).

---

## Troubleshooting

### Exporter not starting

```bash
# Check service status
sudo systemctl status node_exporter
sudo systemctl status postgres_exporter
sudo systemctl status redis_exporter

# Check logs
sudo journalctl -u node_exporter -f
sudo journalctl -u postgres_exporter -f
sudo journalctl -u redis_exporter -f
```

### Postgres exporter connection errors

```bash
# Test database connection manually
psql "postgresql://YOUR_USER:YOUR_PASSWORD@YOUR_HOST:5432/YOUR_DB?sslmode=disable"

# Common issues:
# - Wrong password: Check /etc/default/postgres_exporter
# - pg_hba.conf blocking connection: Add host entry for exporter
# - pg_stat_statements not enabled: Run CREATE EXTENSION
```

### Redis exporter connection errors

```bash
# Test Redis connection manually
redis-cli -h YOUR_HOST -p 6379 -a YOUR_PASSWORD PING

# Common issues:
# - Wrong password: Check /etc/default/redis_exporter
# - Redis not listening on network: Edit redis.conf bind directive
# - Firewall blocking: Check iptables/ufw rules
```

### Port conflicts

If default ports are already in use, you can change them:

```bash
# Node exporter (change --web.listen-address)
ExecStart=/usr/local/bin/node_exporter --web.listen-address=":9101"

# Postgres exporter (change --web.listen-address)
ExecStart=/usr/local/bin/postgres_exporter --web.listen-address=":9188"

# Redis exporter (change --web.listen-address)
ExecStart=/usr/local/bin/redis_exporter --web.listen-address=":9122"
```

Remember to update Prometheus scrape configuration if you change ports.

---

## Security Recommendations

### 1. Firewall Rules

Only allow Prometheus server to access exporter ports:

```bash
# Example: Allow only from Prometheus server (192.168.1.100)
sudo ufw allow from 192.168.1.100 to any port 9100
sudo ufw allow from 192.168.1.100 to any port 9187
sudo ufw allow from 192.168.1.100 to any port 9121
```

### 2. Database User Permissions

Create a dedicated read-only user for Postgres exporter:

```sql
-- Create monitoring user
CREATE USER prometheus_exporter WITH PASSWORD 'secure_password';

-- Grant minimal permissions
GRANT CONNECT ON DATABASE your_db TO prometheus_exporter;
GRANT pg_monitor TO prometheus_exporter;  -- PostgreSQL 10+

-- For older PostgreSQL versions:
-- GRANT SELECT ON pg_stat_database TO prometheus_exporter;
-- GRANT SELECT ON pg_stat_statements TO prometheus_exporter;
```

### 3. Protect Credential Files

```bash
# Ensure only root can read credential files
sudo chown root:root /etc/default/postgres_exporter
sudo chown root:root /etc/default/redis_exporter
sudo chmod 600 /etc/default/postgres_exporter
sudo chmod 600 /etc/default/redis_exporter
```

---

## Next Steps

After installing exporters:

1. [Configure Prometheus](./PROMETHEUS_SETUP.md) to scrape these targets
2. [Set up Grafana dashboards](./GRAFANA_DASHBOARDS.md) to visualize metrics
3. [Configure alerts](./ALERTING.md) for critical issues

---

## References

- [Node Exporter GitHub](https://github.com/prometheus/node_exporter)
- [Postgres Exporter GitHub](https://github.com/prometheus-community/postgres_exporter)
- [Redis Exporter GitHub](https://github.com/oliver006/redis_exporter)
- [Prometheus Documentation](https://prometheus.io/docs/introduction/overview/)
