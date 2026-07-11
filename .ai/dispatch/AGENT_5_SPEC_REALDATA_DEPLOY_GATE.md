# AGENT 5 - SPEC_T05: real-data / deploy gate for the representation substrate

Lane: OPS / verification gate. This job is the single shared blocker for `SPEC001_T01`,
`SPEC002_T01`, and `SPEC002_T02`. All substrate code has landed and is verified only against a
tiny synthetic Docker dataset. Nothing about the representation layer is *proven* until it runs
against real wallet volume. This job produces that proof.

## 0. Boot

Read in order:

1. `.ai/CONTEXT.md`.
2. `.ai/dispatch/DISPATCH_LOG.md` — every in_progress SPEC row names "run against real data" as
   the remaining step.
3. `documentation/specs/SPEC-001-wallet-representation-layer.md` — Gate-0 and Gate-2 definitions.
4. `.ai/context/SPEC002_LABEL_READINESS_2026-07-07.md` §3 — the empty sparsity table to fill.
5. `prisma/migrations/20260707000000_wallet_representation_layer/migration.sql` and
   `prisma/migrations/20260708000000_wallet_vector_history/migration.sql`.

## 1. Task

Prove the substrate on real data by exactly one of two paths (operator chooses):

- **Path A — copy server DB locally.** Operator restores a server DB dump into local
  `analyzer-postgres`. This job then runs migrations + materializers + backfills against real
  row counts with zero production risk.
- **Path B — deploy to server.** The migrations are **additive-only** (verified: `CREATE
  EXTENSION IF NOT EXISTS vector`, `CREATE TABLE`, `CREATE INDEX`; no `ALTER ... DROP`, no
  `DELETE`, no `TRUNCATE`; only FK `ON DELETE CASCADE` clauses on the new tables). Deploying
  cannot mutate or drop existing data. This job applies the migration on the server, then runs
  backfills as bounded background jobs.

Either path produces the same deliverable: **filled Gate-0, Gate-2, and label-sparsity counts.**

## 2. Root-cause framing

The project keeps hitting the same wall: descriptive substrate is built but its central claims
(global kNN similarity is meaningful, cluster fanout is bounded, labels are dense enough) are
all quantitative claims that require real row counts. The tiny 2-vector Docker set proves
plumbing, not truth. Until real counts exist, every downstream SPEC-002 build is speculative.

## 3. Hard guards

- **pgvector prerequisite:** confirm the server/target Postgres can load the `vector` extension
  BEFORE applying the migration. If it cannot, STOP and report — do not partially apply.
- **No `--force`.** Never force-push, force-migrate, or `prisma migrate reset` against any DB
  with real data.
- **Backfills are bounded background jobs**, not synchronous one-shots. Cap batch size, log
  progress, and make each backfill resumable/idempotent (the vector write-path is already
  idempotent per SPEC002_T01).
- **Read the target before writing.** Confirm the DB target (`docker ps`, `pm2 status`) before
  any migration or backfill, per the DB Growth Investigation Protocol in CONTEXT.md.
- Path B only: take a fresh DB backup before applying the migration, even though it is additive.

## 4. Likely files / commands

- `prisma migrate deploy` (NOT `migrate dev`) for the additive migrations on the target.
- `scripts/spec001-*.ts` — feature-vector builder, vector backfill, Gate-0 ledger, edge/cluster
  materializers.
- `scripts/spec002-label-inventory.ts` — fills the §3 sparsity table.
- Vector-history backfill script from SPEC002_T01.
- `docker exec analyzer-postgres psql -U postgres -d sova_analyzer -c "<read-only SQL>"` for
  count verification.

## 5. Deliverables

- **Gate-0 counts** (SPEC-001): total wallets eligible, wallets with a current-version vector,
  coverage %, vector build failure count/reasons.
- **Gate-2 counts** (SPEC-001): wallet-token edge count, wallet-wallet edge count after pruning,
  max/median edge fanout per wallet, cluster count and size distribution.
- **Label-sparsity table** filled (`SPEC002_LABEL_READINESS_2026-07-07.md` §3): reviewed
  holdings, distinct reviewed wallets, `reviewedAt` coverage, hunts with ≥2 snapshots, wallets
  in ≥2 hunts, distinct tokens.
- A short results note under `.ai/context/` recording which path was taken, the counts, and a
  GO/NO-GO verdict on each of: SPEC001_T01 close, SPEC002_T01 close, SPEC002_T02 un-gate,
  SPEC002_T04 ledger threshold (§6 of the T03 report).
- Update `.ai/dispatch/DISPATCH_LOG.md` statuses based on the counts.

## 6. Acceptance

- Migration applied on the chosen target with the `vector` extension present; `prisma migrate
  status` clean.
- All backfills completed or reported with a bounded remaining count.
- Every `<FILL>` cell in the T03 §3 table and the SPEC-001 Gate-0/Gate-2 tables has a real number.
- No existing table lost rows (Path B: row counts of a spot-check of pre-existing tables
  unchanged before/after migration).

## 7. Service boundary checklist

- Concurrency: backfills run as single-owner background jobs; do not launch two concurrent
  backfills over the same table.
- Memory at scale: stream/batch wallet reads for vector building; never load all wallets into
  memory at once.
- Timeout: each backfill batch commits independently so a crash resumes, not restarts.
- Backing resources: on DB/extension failure, STOP and report; never leave a half-applied
  migration.
