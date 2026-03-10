# Backend Memory Observability Runbook

This runbook matches the current production setup on this server.

## Current Setup

- Grafana container: `sova-grafana`
- Prometheus container: `sova-prometheus`
- Grafana URL: `http://127.0.0.1:3000`
- Prometheus URL: `http://127.0.0.1:9090`
- Backend metrics target: `job="app"` scraping `http://127.0.0.1:3001/api/v1/metrics`
- Grafana datasource name: `Prometheus`

## Verify Live Targets

From the server:

```bash
curl -fsS http://127.0.0.1:9090/api/v1/targets
```

Expected:

- `job="app"` is `health:"up"`
- `job="bullmq"` is `health:"up"`
- `job="node"` is `health:"up"`
- `job="postgres"` is `health:"up"`
- `job="redis"` is `health:"up"`

## Reload Observability After Config Changes

From `/home/luna/analyzer/ops/observability`:

```bash
docker compose --env-file /home/luna/analyzer/.env up -d
```

Use this after changing:

- `ops/observability/prometheus/prometheus.yml`
- `ops/observability/prometheus/alerts.yml`
- `docs/observability/dashboards/*.json`
- `ops/observability/grafana/provisioning/*`

Then verify:

```bash
docker compose --env-file /home/luna/analyzer/.env ps
curl -fsS http://127.0.0.1:9090/api/v1/targets
```

## Open Grafana

If accessing from your laptop:

```bash
ssh -L 3000:127.0.0.1:3000 -L 9090:127.0.0.1:9090 luna@<server_ip>
```

Then open:

- `http://127.0.0.1:3000`

The dashboards are provisioned into the folder:

- `Sova Observability`

The new dashboard file is:

- `docs/observability/dashboards/07-backend-memory-guardrails.json`

Dashboard title in Grafana:

- `Backend Memory Guardrails`

If Grafana login fails with the configured default, the password was changed after first boot. Reset it with:

```bash
docker exec -it sova-grafana grafana cli admin reset-admin-password 'NEW_STRONG_PASSWORD'
```

## What To Look At

Open `Backend Memory Guardrails` and inspect these panels:

1. `Backend Heap vs RSS`
2. `Heap Pressure Ratio`
3. `Heap Growth Slope (30m)`
4. `Unmatched Traffic Rate`
5. `Top Matched Routes`
6. `Current Route Cardinality`
7. `Current Backend Memory`

## Prometheus Alerts Added

Alert rules file:

- `ops/observability/prometheus/alerts.yml`

Alerts:

- `SovaBackendHighHeapRatio`
- `SovaBackendHighRSS`
- `SovaBackendHeapGrowth`
- `SovaBackendUnmatchedTrafficSpike`

To inspect loaded rules:

```bash
curl -fsS http://127.0.0.1:9090/api/v1/rules
```

To inspect active alerts:

```bash
curl -fsS http://127.0.0.1:9090/api/v1/alerts
```

## Exact PromQL Used By The New Dashboard

```promql
nodejs_memory_usage_bytes{job="app",type="heapUsed"}
```

```promql
nodejs_memory_usage_bytes{job="app",type="heapTotal"}
```

```promql
nodejs_memory_usage_bytes{job="app",type="rss"}
```

```promql
nodejs_memory_usage_bytes{job="app",type="heapUsed"} / nodejs_memory_usage_bytes{job="app",type="heapTotal"}
```

```promql
deriv(nodejs_memory_usage_bytes{job="app",type="heapUsed"}[30m])
```

```promql
deriv(nodejs_memory_usage_bytes{job="app",type="rss"}[30m])
```

```promql
sum(rate(http_requests_total{job="app",route="unmatched"}[5m]))
```

```promql
topk(10, sum(rate(http_requests_total{job="app",route!="unmatched"}[5m])) by (route))
```

```promql
count(count by (route) (http_requests_total{job="app"}))
```
