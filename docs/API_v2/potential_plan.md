Your API is read-heavy but compute-triggered. You already have queues and REST endpoints. You’re missing a serving tier with precomputed snapshots and a real streaming path. Replace “analyze-on-click” with “serve-from-cache + tail deltas”.

API v2 (contract changes)

Split into Ingest, Serve, Trigger, Observe. Keep NestJS. Keep API key auth.

Ingest (internal)

POST /ingest/webhook/helius
Body: Helius event. Action: dedupe by signature, normalize to event-facts, enqueue per-wallet update. 202 no body.
Storage target: ClickHouse events + Redis “hot” wallet snapshot.

Serve (read-fast, no queue touch)

GET /wallets/{addr}/summary?from&to → returns cached snapshot fields only: balances, PnL realized/unrealized, tx_count windows (1d/7d/30d), venues used, last_processed_slot, freshness_lag_sec. Strict <200 ms SLA. Cache-control: 60s; ETag. 

GET /wallets/{addr}/token-performance?sort=&page=&limit=&from=&to= → serve from last analysis result/materialized view; never blocks on compute. 

GET /wallets/{addr}/pnl-overview?from&to → same rule; no compute on request. 

GET /wallets/{addr}/behavior-analysis?from&to → same. 

GET /wallets/{addr}/classification → cheap classifier + fetch hints. 

Trigger (async only)

POST /analyses/wallets/dashboard-analysis → validate, enqueue, 202 + jobId. Do not compute inline. 

POST /analyses/similarity/queue → 202 + jobId. 

POST /analyses/wallets/status → FRESH/STALE/MISSING for a set. Use to decide whether to show “Refresh” in UI, not to block reads. 

Observe (jobs and queues)

Keep /jobs/{id}, /jobs/queue/* for visibility. Do not require clients to hit them for normal reads. 

Data plane (minimal but sufficient)

PostgreSQL → system of record for wallets, runs, notes, user keys, summaries. Migrate off SQLite; you already anticipated this. 

ClickHouse → event-facts + rollups for fast reads: events, wallet_agg_daily, wallet_top_tokens, flows. You listed analytical acceleration as “future”; make it “now” for reads. 

Redis → wallet_snapshot:{addr} (MessagePack), TTL 24–72 h; LFU eviction.

Tables (ClickHouse)

events(slot UInt64, sig String, wallet String, program LowCardinality(String), event Enum8(transfer,swap,stake,other), mint String, qty Float64, price Float64, fee Float64, counterparty String, ts DateTime64)

wallet_agg_daily(wallet String, date Date, tx_count UInt32, volume Float64, pnl_realized Float64, fees Float64, distinct_mints UInt16, venues Array(String))

wallet_snapshot_store(wallet String, last_slot UInt64, balances Map(String,Float64), pnl Map(String,Float64), winrate Float32, windows Map(String,UInt32), updated_at DateTime)

Postgres keeps: Wallet, AnalysisRun, AdvancedStatsResult, BehaviorMetrics, TokenPerformance rows, Users, ActivityLog. Your docs already map these reads. 

Compute plane

BullMQ is fine; expand topology and priorities.

Queues (final)

ingest-apply (high): idempotent per-signature → event rows + Redis snapshot delta.

wallet-reconcile (medium): rebuild snapshot from ClickHouse daily partition + deltas.

analysis-operations (low/medium): PnL/Behavior recompute, writes to Postgres result tables. 

similarity-operations, enrichment-operations remain. 

Sharding

Route jobs by hash(wallet) % N to keep per-wallet order.

Idempotency

HeliusTransactionCache(signature PK) stays in Postgres; SETNX in Redis before apply. You already have dedupe/locking; keep it. 

Request path changes (what users feel)

Dashboard hits Serve only. No synchronous analysis. Your own docs already commit to “API serves pre-calculated data”. Enforce it. 

“Analyze” button calls Trigger, UI watches /jobs/{id} opportunistically; the reads never block. 

Backfill and live delta

First view of a wallet → bounded REST backfill to ClickHouse, then immediate recompute snapshot into Redis, then return /summary.

Webhook deliveries update Redis snapshot in <200 ms and append to ClickHouse; periodic reconcile rebuilds exactness.

Use /analyses/wallets/status to decide if PnL/Behavior are stale before showing a “Refresh” control; never block. 

Concrete endpoint diffs to your current docs

Keep current /wallets/* endpoints but guarantee they read only precomputed state (AdvancedStatsResult, BehaviorMetrics, TokenPerformance). You already describe this; stop mixing compute in controllers. 

Make /analyses/* strictly async with BullMQ job submission; you already documented 202 responses. Enforce everywhere. 

Add /ingest/webhook/helius (internal) and remove any controller code that fetches from Helius inside user reads.

What to change in code (module-level)

WalletsController: read from SnapshotReadService (Redis→fallback Postgres/ClickHouse), never call analysis services inline.

AnalysesController: only enqueues; returns {jobId}. Remove sync paths you listed as “pilot/temporary”. 

JobsController: keep as is; it’s fine. 

DatabaseService: add logActivity already planned; keep API-key user context. 

Add SnapshotBuilder worker: consumes ingest-apply, updates Redis and wallet_agg_daily.

Scaling policy baked into API

Rate limit analysis triggers (5/min) is already in docs. Keep. 

Add per-user quotas on /analyses/*; write denials to ActivityLog. You already have the schema. 

Why your queues “are not enough”

They do too much per job and run only heavyweight analysis. You lack a fast-path delta worker that updates snapshots without rerunning full PnL/Behavior. Split: apply-delta (cheap, constant time) vs recompute (batch). Your docs emphasize precomputation; implement the split. 

Minimal migration steps

Move SQLite → Postgres (Prisma migrate). Dual-write then cutover. 

Stand up ClickHouse and create events and wallet_* tables; backfill last 30–90 days from your existing facts/results. 

Add SnapshotBuilder and IngestApply workers; introduce /ingest/webhook/helius.

Rewrite /wallets/* controllers to SnapshotReadService.

Lock /analyses/* to 202 + jobId; move any synchronous code into workers. 

This aligns the API with your own documented goals (async triggers, precomputed reads, queue-backed workers) and fixes the user-visible latency without inflating storage.






Resolve the read to a snapshot

Check Redis:wallet_snapshot:{addr}.

Hit → return in ≤200 ms with freshness_lag_sec.

Miss → synthesize snapshot from Postgres/ClickHouse aggregates if they exist; else return a minimal placeholder {addr, state: "WARMING_UP"}.

Start a bounded cold backfill (history source “before now”)

If Wallet.last_processed_sig exists → set backfill_cursor = last_processed_sig.

Else → backfill_cursor = now.

Launch an async job that pulls backwards up to a hard cap (e.g., 14 days or 2k signatures, whichever first) via getSignaturesForAddress.

For each page:

Normalize → write fact rows to ClickHouse events and append to wallet_agg_daily.

Apply deltas to the in-memory snapshot (balances, windows, PnL) and upsert Redis:wallet_snapshot:{addr}.

Stop when you hit a signature you already have (idempotent) or reach the cap.

Persist Wallet.last_processed_sig and Wallet.last_processed_slot.

Attach live tail (purpose of webhooks)

Ensure {addr} is in tracked_wallets (priority=favorite/open).

Webhook delivers forward deltas from the tip; each delivery: dedupe by signature → write facts → apply deltas to snapshot → push UI update over WS/SSE.

A tiny “tail repair” poll (every 1–2 min) queries from last_processed_sig → now to cover any missed webhook deliveries.

Expose older history on demand (the rest of the past)

UI shows “History loaded: last 14 days. Load older.”

If user scrolls or explicitly requests older:

Queue deep backfill job that continues backwards from the oldest known signature in storage, again in bounded chunks (e.g., +30 days or +5k sigs per run) until:

You reach user’s requested date, or

You hit a global ceiling (e.g., 365 days), or

You encounter the earliest tx.

Each deep-backfill chunk updates ClickHouse rollups and then recomputes/merges snapshot to keep KPIs consistent. No UI blocking.

State machine guarantees

UNSEEN → after step 2’s first pages: SEEN_PARTIAL(“last_14d_ready”).

SEEN_PARTIAL + live tail → user sees accurate “now” plus recent history.

Deep-backfill chunks move you toward SEEN_FULL without affecting interactivity.

Invariants:

Never compute synchronously in request handlers.

Snapshot is always derived from “facts_since_checkpoint + rollups_before_checkpoint”.

Exactly-once apply via signature_seen set (Redis/DB) for both backfill and webhook.

Where historical data “comes from”

It’s fetched on first view (bounded cold backfill), not pre-stored for every wallet on chain.

Once fetched, raw facts live in ClickHouse/Parquet partitions; aggregates and snapshots persist so subsequent opens are instant.

Older-than-window history is fetched only if requested or if the wallet is favorited and scheduled for overnight deep backfill.

Concurrency and races

Per-wallet shard key hash(addr) % N ensures backfill pages and webhook events serialize.

If webhook event arrives for a tx that your backward backfill will also reach, the dedupe short-circuits the later apply.

Snapshot writes use CAS (version or updated_at) to avoid lost updates.

API behaviors (no blocking)

GET /wallets/{addr}/summary: returns current snapshot (possibly partial) + freshness_lag_sec + history_span_days.

POST /analyses/wallets/dashboard-analysis: enqueues recompute; client never waits.

POST /wallets/{addr}/history/backfill?older=30d: enqueues deep-backfill chunk and returns jobId.

Webhook endpoint updates snapshots continuously; UI reflects deltas immediately.

SLAs and limits

TTFB ≤ 200 ms for summary on any subsequent open.

First-ever open: placeholder in ≤200 ms, first useful KPIs within 1–3 s as the first backfill page lands.

Backfill caps: initial 14d/2k sigs; deep-backfill chunks 30d/5k sigs per job.

Budget governor prevents tracking high-volume bots on webhooks; they fall back to periodic polling.

Minimal pseudocode (controller path)

// GET /wallets/:addr/summary
const snap = await redis.getSnapshot(addr);
if (snap) return snap;

const agg = await chOrPgSynthesizedSnapshot(addr);
if (agg) { redis.putSnapshot(addr, agg); return agg; }

enqueueBackfill(addr, {mode: "initial", windowDays: 14, maxTx: 2000});
ensureTracked(addr, {priority: "favorite"});
return { addr, state: "WARMING_UP", freshness_lag_sec: null, history_span_days: 0 };

// Backfill worker (initial or deep)
while (!capReached && !seenKnownSig) {
  const page = await helius.getSignaturesBackwards(addr, cursor);
  for (const sig of page) {
    if (sigSeen(sig)) continue;
    const facts = normalize(await helius.getTransaction(sig));
    await ch.insert('events', facts);
    await applyDeltasToSnapshot(addr, facts); // updates Redis
    markSigSeen(sig);
  }
  cursor = page.last; // older
}
persistWalletCursor(addr, cursor);

// Webhook handler
if (sigSeen(sig)) return 202;
const facts = normalize(body);
await ch.insert('events', facts);
await applyDeltasToSnapshot(addr, facts);
markSigSeen(sig);
return 202;


What you keep from your current system

The same analysis jobs, but moved off the request path.

The same queue framework, but split into cheap delta-appliers vs batch recomputes.

The same REST fetchers, but only for bounded initial/deep backfills and tail repair.

This yields instant reads, continuous freshness, and full history on demand without pre-indexing