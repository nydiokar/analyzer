# AGENT 6 - SPEC002_T04: label-capture ledger build (moat)

Lane: BUILD / label loop. This is the designated next dispatch from the SPEC002_T03 verdict
(§7, §8). It is the only forward-build track that does NOT need the remote DB and is the moat
work per SPEC-002 Act 3.

## 0. Boot

Read in order:

1. `.ai/CONTEXT.md` (see WRL-2 — provenance + hunt-archive hygiene already landed).
2. `.ai/context/SPEC002_LABEL_READINESS_2026-07-07.md` — §4 pair contract, §5 split, §6
   thresholds, §7 remaining item.
3. `.ai/dispatch/AGENT_4_SPEC002_LABEL_LEDGER_METRIC_READINESS.md`.
4. `prisma/schema.prisma` — `RadarHolding` (reviewerId/reviewSource at :902-903),
   `WalletHuntSnapshot` (archivedAt/archiveReason at :789-790), `WalletVector`.
5. `src/api/services/wallet-hunt.service.ts` (`computeCandidates`), `radar.controller.ts`,
   `radar-snapshot.service.ts`.

## 1. State check (already done — do NOT redo)

From T03 §7, items 1 and 2 are **already implemented** (WRL-2):

- `RadarHolding.reviewerId` + `reviewSource` columns exist AND all three write paths set them:
  `analyst` (radar.controller.ts:155-156), `wallet_removal` (:96), `dust_auto`
  (radar-snapshot.service.ts:84).
- Hunt hard-delete replaced by archive (`archivedAt`/`archiveReason`).

⇒ This job is **only item 3**: the additive, append-only `MetricLearningLabel` ledger plus the
read-only extractor that populates it from the §4 P1/N1 rules. **No model. No embedding. No
metric training.**

## 2. Task

1. **Additive `MetricLearningLabel` migration** (non-breaking, new table only):
   `(id, walletA, walletB, label ∈ {positive|negative|ambiguous}, source, huntId?, reviewerId?,
   confidence?, createdAt)`, with a **unique idempotency key on the unordered wallet pair +
   source** (canonicalize so walletA < walletB before insert). Index `huntId`, `label`.
2. **Read-only extractor script** under `scripts/` that materializes labels from existing data
   per the T03 contract:
   - **P1 positives** — hunt cross-token co-occurrence (both wallets in ≥2 of a hunt's tokens),
     weight = `min(appearanceCount)/uniqueTokenCount`, mirroring `computeCandidates`.
   - **N1 negatives** — cross-hunt disjoint pairs (hunts sharing no tokens, wallets never
     co-occurring), sampled to balance positives; hard-negative-mine by preferring pairs the
     engineered cosine currently rates as similar.
   - Exclude: single-snapshot hunts, `unreviewed`, and `ignored` where `reviewSource != 'analyst'`
     (only analyst-negatives are usable; dust/housekeeping stay ambiguous).
   - Idempotent upsert on the pair+source key so re-running does not duplicate.
3. Emit a summary: #positive, #negative, #ambiguous, distinct wallets/hunts, hard-negative share,
   and whether the §6 thresholds pass (requires the real-data counts from AGENT_5).

## 3. Root-cause framing

SPEC-002 §3.3 calls for a "training-ready label ledger." The labels exist as operational fields;
what is missing is the append-only, leakage-safe, idempotent ledger that a future (gated) metric
job would consume. Building the ledger is the last piece that makes the moat *measurable* without
committing to any ML.

## 4. Hard guards

- **No metric/embedding training, no model-serving dependency** (unchanged from T03).
- **Do not** treat non-analyst `ignored` as a negative — filter by `reviewSource='analyst'`.
- **Do not** create pairs that leak the outcome (no engineered-metric-only "far" pairs as
  ground-truth negatives; hard-negative mining is a *sampling* preference, the *label* still
  comes from cross-hunt disjointness).
- Extractor SQL is read-only against source tables; only the ledger table is written.
- Split unit is HUNT with a time-based OOS holdout (T03 §5) — bake the split-bucket assignment
  into the ledger row or a companion view so a future job cannot straddle the boundary.

## 5. Deliverables

- `prisma/migrations/<ts>_metric_learning_label/` additive migration + schema model.
- `scripts/spec002-extract-labels.ts` idempotent extractor.
- Ledger population summary + threshold pass/fail (pending AGENT_5 real counts).
- Update `.ai/dispatch/DISPATCH_LOG.md`: SPEC002_T04 status and whether the learned-metric lane
  (a hypothetical SPEC002_T05) is unblocked.

## 6. Acceptance

- Migration is additive-only; `prisma migrate status` clean; no existing table altered.
- Re-running the extractor produces zero duplicate ledger rows (idempotency key verified).
- Every emitted pair traces to an explicit P1/N1 rule; no leakage-class pair present.
- Summary states GO/NO-GO for a future metric job strictly against the §6 thresholds.

## 7. Service boundary checklist

- Concurrency: extractor is a single-owner script; the ledger write is one transaction per batch
  with the idempotency key preventing double-insert on concurrent runs.
- Memory at scale: stream hunts/holdings; do not build the full O(n²) pair space in memory —
  generate pairs per-hunt and sample negatives with a bounded reservoir.
- Request size / export: no HTTP surface in this job; exports are scripts only.
- Malformed input: validate wallet addresses and hunt integrity before emitting a pair; skip
  malformed rows with a counted warning, never crash the batch.
- Backing resources: on DB failure, reject the batch with a structured error; never silently drop
  a label.
