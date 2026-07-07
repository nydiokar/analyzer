# AGENT 3 - SPEC002_T02: formation replay and densification design

Lane: RESEARCH + BUILD / temporal coordination. This job turns SPEC-002 Act 2.2 into a backtested detector before any live alerting.

## 0. Boot

Read in order:

1. `.ai/CONTEXT.md`.
2. `.ai/dispatch/DISPATCH_LOG.md` and the completed SPEC002_T00 verdict.
3. `documentation/specs/SPEC-001-wallet-representation-layer.md` - Phase 2 graph tables and pruning rules.
4. `documentation/specs/SPEC-002-temporal-intelligence-and-the-learned-metric.md` - Act 2.2.
5. `prisma/schema.prisma` - `WalletHuntSnapshot`, `SwapAnalysisInput`, and any SPEC-001 graph tables if landed.
6. `src/api/services/wallet-hunt.service.ts` - current analyst-confirmed holder-set capture.
7. Current correlation/similarity code that scores shared tokens and clusters.

## 1. Task

Build the replay harness and, only if it passes, the minimal densification projection:

- Use `WalletHuntSnapshot.holders` as after-the-fact confirmed rings.
- For each snapshot token, reconstruct what was knowable at earlier times from `SwapAnalysisInput.timestamp` and SPEC-001 graph/edge tables.
- Measure whether a dense subgraph would have formed before the analyst snapshot was captured.
- Report lead time, precision/false-positive controls, and cost.
- Only after replay evidence is acceptable, implement or propose the batch monitor that computes formation candidates.

## 2. Root-cause framing

Current wallet hunts compute candidates from saved holder snapshots and current source pulls. That is useful for forensics, but not a leading indicator. SPEC-002's value claim depends on proving that the same related-wallet signal appears before or during formation, not only after the analyst saved it.

## 3. Hard guards

- Do not ship live alerts before replay/backtest evidence.
- Do not scan all wallet pairs. Candidate generation must be mint-first and pruned by non-obvious-token logic from SPEC-001/current correlation config.
- Do not create a second graph serving model if SPEC-001 graph tables exist.
- Do not treat popular/spam mints as coordination evidence.
- Do not mutate or delete `WalletHuntSnapshot`; it is label evidence.

## 4. Likely files

Depends on SPEC-001 Phase 2 state. Likely:

- A read-only script under `scripts/` for replay/backtest.
- SPEC-001 graph materializer files, if they exist.
- `src/api/services/wallet-hunt.service.ts` only if adding label metadata or a read helper.
- Additive Prisma model only if SPEC002_T00 approves storing formation candidates.

## 5. Deliverables

Phase A, mandatory first:

- Replay script/report with:
  - number of hunt snapshots;
  - number usable for replay;
  - candidate formation lead-time distribution;
  - false-positive sampling strategy;
  - largest mint/wallet fanout observed;
  - estimated edge row counts.

Phase B, only if Phase A passes:

- Minimal persisted formation-candidate projection or design-ready spec:
  - tokenMint, candidateWallets/count, score, firstObservedAt, lastObservedAt, evidence mints/edges, computedAt.
- Batch monitor design using existing queue/cron patterns.

## 6. Acceptance

- Replay runs read-only and is deterministic.
- The script does not materialize unbounded O(wallets squared) pairs.
- The report names a concrete threshold for false-positive control before live alerting.
- If code is added, `pnpm run verify` passes and focused tests cover densification scoring.

## 7. Service boundary checklist

If adding an endpoint/handler:

- Concurrency: formation monitor must run as one bounded batch/queue job, not per-request recompute.
- Memory at scale: mint fanout must be capped or chunked; document N=100 young-token windows.
- Request size: any replay endpoint must be admin/internal only with bounded date/token filters.
- Timeout: long replay belongs in a script or BullMQ job, not HTTP.
- Malformed input: validate token mint, date ranges, and max windows.
- Backing resources: DB failure fails the job; no partial alert publication without persisted evidence.

