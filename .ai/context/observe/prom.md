PHASE 0 — TARGET STATE (what “done” means)

You must end with 5 scrape targets in Prometheus:

App API metrics (/api/v1/metrics)

BullMQ worker metrics (same or separate port)

Node exporter (host)

Postgres exporter

Redis exporter
(+ optional Nginx exporter)

Grafana dashboards must answer:

Is the host bottlenecked?

Is Node.js unhealthy?

Are HTTP requests slow/failing?

Are jobs stuck, slow, or failing?

Is Postgres / Redis the cause?

PHASE 1 — FIX WHAT YOU ALREADY EXPORT (CRITICAL)

Your metrics exist but are dead. Revive them.

1. HTTP metrics (mandatory)

You already declared:

http_requests_total

http_request_duration_seconds

Required wiring (Express example)
app.use((req, res, next) => {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    httpRequestsTotal
      .labels(req.method, req.route?.path ?? "unknown", res.statusCode)
      .inc();

    const duration =
      Number(process.hrtime.bigint() - start) / 1e9;

    httpRequestDuration
      .labels(req.method, req.route?.path ?? "unknown", res.statusCode)
      .observe(duration);
  });

  next();
});


Labels REQUIRED:

method

route

status

Without labels → useless.

2. Analysis / job metrics (mandatory)

You declared:

analysis_jobs_total

analysis_job_duration_seconds

You must increment them.

analysisJobsTotal.labels("success").inc();
analysisJobsTotal.labels("failed").inc();

analysisJobDuration.observe(durationSeconds);


Add label:

result = success|failed

3. Validation gate

After wiring:

curl /api/v1/metrics | grep http_
curl /api/v1/metrics | grep analysis_


You must see numbers, not just HELP/TYPE.

If zero → not wired.

PHASE 2 — BULLMQ METRICS (NON-NEGOTIABLE)

Redis metrics are NOT queue metrics. You must export queue state explicitly.

Required metrics (per queue)
Gauges

bullmq_jobs_waiting

bullmq_jobs_active

bullmq_jobs_failed

bullmq_jobs_completed

bullmq_jobs_delayed

bullmq_jobs_stalled

Label:

queue

Histogram

bullmq_job_duration_seconds
Label:

queue

Implementation
setInterval(async () => {
  const counts = await queue.getJobCounts();

  waiting.set({ queue: name }, counts.waiting);
  active.set({ queue: name }, counts.active);
  failed.set({ queue: name }, counts.failed);
  completed.set({ queue: name }, counts.completed);
  delayed.set({ queue: name }, counts.delayed);
  stalled.set({ queue: name }, counts.stalled);
}, 5000);


For workers:

const start = Date.now();
// job processing
jobDuration.observe((Date.now() - start) / 1000);

PHASE 3 — HOST VISIBILITY (NODE EXPORTER)

You currently see only process, not machine.

Install node_exporter (Pi)
node_exporter --web.listen-address=":9100"


Scrape:

PI_IP:9100/metrics


This unlocks:

CPU load

IO wait

Disk usage

Memory pressure

Network

Thermal throttling

Without this you cannot debug performance.

PHASE 4 — POSTGRES VISIBILITY
Enable stats (once)
CREATE EXTENSION pg_stat_statements;

Run postgres_exporter
:9187/metrics


Unlocks:

Slow queries

Locks

Connection pressure

Cache hit ratio

WAL pressure

PHASE 5 — REDIS VISIBILITY
Run redis_exporter
:9121/metrics


Unlocks:

Evictions

Memory fragmentation

Hit ratio

Blocked clients

Ops/sec

PHASE 6 — PROMETHEUS CONFIG (SINGLE SOURCE OF TRUTH)
scrape_configs:
  - job_name: app
    static_configs:
      - targets: ["sova-intel.duckdns.org"]

  - job_name: bullmq
    static_configs:
      - targets: ["PI_IP:PORT"]

  - job_name: node
    static_configs:
      - targets: ["PI_IP:9100"]

  - job_name: postgres
    static_configs:
      - targets: ["PI_IP:9187"]

  - job_name: redis
    static_configs:
      - targets: ["PI_IP:9121"]


Reload Prometheus.

Verify:

/targets → all UP

PHASE 7 — DASHBOARDS TO BUILD (ORDER MATTERS)
1. Host Dashboard

CPU, load, disk, memory, IO wait, temp.

2. Node.js Runtime

Heap, RSS, GC, event loop lag, restarts.

3. HTTP API

RPS, error rate, latency p95/p99.

4. BullMQ

Queue depth, failure rate, processing time, stalled jobs.

5. Postgres

Connections, slow queries, locks.

6. Redis

Memory, evictions, latency.

FAILURE CONDITIONS (AUTO-REJECT)

The setup is invalid if:

Metrics exist but counters never change

BullMQ metrics inferred from Redis only

No node_exporter

No labels on HTTP metrics

Grafana built before Prometheus targets are UP

FINAL STATE

At completion:

Every metric has meaning

Every dashboard answers a why

No blind spots

LLM can extend safely without guessing