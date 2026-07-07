# SPEC002_T03 — Label Ledger & Learned-Metric Readiness Report

**Date:** 2026-07-07
**Lane:** RESEARCH / metric-learning gate (read-only)
**Dispatch:** `.ai/dispatch/AGENT_4_SPEC002_LABEL_LEDGER_METRIC_READINESS.md`
**Depends on verdict:** SPEC002_T00 (`SPEC-002 §7`) — GO for read-only inventory/report only; **no ML**.
**Branch:** `spec002-t03-label-readiness`

---

## 0. Scope & guards honored

This report measures whether the proprietary analyst-label loop (SPEC-002 Act 3, the moat)
is ready to justify a learned distance metric. Per the dispatch hard guards:

- **No** embedding or metric model trained. **No** model-serving dependency added.
- **No** schema/code changes beyond one **read-only** inventory script (`scripts/spec002-label-inventory.ts`).
- `CreditTransaction.reason` treated strictly as **demand/prioritization** signal, never a truth label.
- `reviewStatus='ignored'` is **not** assumed to be a clean negative — its semantics are
  polluted (see §2.1).
- No label is constructed that leaks the outcome being evaluated (see §4).

The optional additive `MetricLearningLabel` ledger migration is **proposal-only** (§7); it is
**not** implemented, because SPEC002_T00 did not pre-approve implementation.

---

## 1. Substrate reality check (why T01/T02 stay blocked, T03 runs)

`prisma/schema.prisma` grep confirms the SPEC-001 substrate tables **do not exist**:

- No `model WalletVector`, no `model WalletWalletEdge`, no `model WalletClusterMembership`.

Therefore vector-history/drift (SPEC002_T01) and formation-replay (SPEC002_T02) build work
**remain BLOCKED** — there is no persisted representation to diff or densify. This report only
inventories the **label** assets, which already exist as operational fields and can be read now.

Local dev machine has **no live DB** (`analyzer-postgres` container is not running here;
`docker ps` shows only `orchestrator-n8n-1`). Consistent with the standing note "DB runs on a
remote server; dev machine has schema/services but no live data." **Counts in §2–§3 must be
produced on the server** using the read-only SQL below (or by running the inventory script
against the server DB). This report ships the measurement contract + thresholds; the operator
fills the counts.

---

## 2. Label inventory — what to count and how

Run either:

```powershell
# From repo root, against a reachable DB:
npx ts-node -r tsconfig-paths/register scripts/spec002-label-inventory.ts
```

…or the equivalent read-only SQL (canonical target) below.

### 2.1 `RadarHolding.reviewStatus` — analyst verdict stream

**Schema** (`prisma/schema.prisma:780`): `reviewStatus String @default("unreviewed")`,
`reviewedAt DateTime?`, plus time-series `firstSeenAt` / `lastSeenAt` / `acquiredAt`,
`isActiveHolding`, unique `[wallet, tokenMint]`.

**Allowed statuses** (`radar.controller.ts:35`): `unreviewed | reviewed | ignored`.

**CRITICAL semantic finding — `ignored` is not a clean negative.**
`ignored` is produced by three different mechanisms with different meaning:

1. **Analyst intent** — analyst PATCHes a holding to `ignored` (`radar.controller.ts:138-149`).
2. **Dust auto-ignore** — snapshot re-run sets `ignored` when a holding falls below the
   `$80` dust threshold (`radar-snapshot.service.ts:77-84`). This is a *value* judgment, not a
   *coordination/similarity* verdict.
3. **Wallet removal cascade** — removing a radar wallet bulk-sets all its non-ignored holdings
   to `ignored` (`radar.controller.ts:92-96`). This is *feed housekeeping*, not a verdict.

⇒ Only `reviewed` is an affirmative analyst signal. `ignored` mixes analyst-negative,
dust, and housekeeping and **must not** be fed as a negative label without an added
provenance field (see §7). There is **no reviewer identity** column, so per-analyst
agreement / audit is impossible today.

**Read-only SQL:**

```sql
-- status distribution
SELECT "reviewStatus", COUNT(*) FROM "RadarHolding" GROUP BY "reviewStatus";

-- status x active
SELECT "reviewStatus", "isActiveHolding", COUNT(*)
FROM "RadarHolding" GROUP BY "reviewStatus", "isActiveHolding";

-- timestamp coverage of decisions (needed for time-based split)
SELECT COUNT(*) FILTER (WHERE "reviewStatus" <> 'unreviewed') AS reviewed_total,
       COUNT(*) FILTER (WHERE "reviewStatus" <> 'unreviewed' AND "reviewedAt" IS NOT NULL) AS reviewed_with_ts
FROM "RadarHolding";

-- split-unit cardinality
SELECT COUNT(DISTINCT wallet)    AS distinct_reviewed_wallets,
       COUNT(DISTINCT "tokenMint") AS distinct_reviewed_tokens
FROM "RadarHolding" WHERE "reviewStatus" <> 'unreviewed';

-- reviewed decisions over time (leakage-safe time-split feasibility)
SELECT date_trunc('week', "reviewedAt") AS wk, COUNT(*)
FROM "RadarHolding" WHERE "reviewStatus" = 'reviewed' AND "reviewedAt" IS NOT NULL
GROUP BY 1 ORDER BY 1;
```

### 2.2 `WalletHuntSnapshot` — hand-curated related-wallet ground truth

**Schema** (`prisma/schema.prisma:690`): `tokenMint`, `sourceType`, `holders String[]`,
`capturedAt`, unique `[huntId, tokenMint, sourceType]`.

**How "related" is actually confirmed** (`wallet-hunt.service.ts:232-279`, `computeCandidates`):
a wallet is a **candidate** only if it appears in **≥2 distinct tokens** within one hunt.
Confidence = `appearanceCount / uniqueTokenCount`. Consequences for label mass:

- A hunt with **1 snapshot** yields **no** confirmed cross-token relationship — every holder
  is trivially "appearanceCount=1". Such hunts contribute **zero** positive pairs.
- Only **hunts with ≥2 snapshots** produce confirmed cross-token co-occurrence.
- `holders` for `TOP_HOLDERS` source is the token's top holders (`wallet-hunt.service.ts:219-229`)
  — a raw candidate set, **not** yet an analyst-confirmed ring. The *hunt itself* (analyst chose
  to group these tokens) is the curation signal; the *cross-token overlap* is the positive
  evidence.

**Read-only SQL:**

```sql
SELECT COUNT(*) AS total_snapshots,
       COUNT(DISTINCT "huntId") AS distinct_hunts,
       COUNT(DISTINCT "tokenMint") AS distinct_tokens
FROM "WalletHuntSnapshot";

-- source-type mix
SELECT "sourceType", COUNT(*) FROM "WalletHuntSnapshot" GROUP BY "sourceType";

-- hunts with >=2 snapshots (the only positive-yielding hunts)
SELECT COUNT(*) FROM (
  SELECT "huntId" FROM "WalletHuntSnapshot" GROUP BY "huntId" HAVING COUNT(*) >= 2
) t;

-- holder-set size distribution
SELECT MIN(array_length(holders,1)) AS min_size,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY array_length(holders,1)) AS p50,
       percentile_disc(0.9) WITHIN GROUP (ORDER BY array_length(holders,1)) AS p90,
       MAX(array_length(holders,1)) AS max_size,
       ROUND(AVG(array_length(holders,1))::numeric,2) AS mean_size
FROM "WalletHuntSnapshot";

-- repeated wallets across hunts (positive-pair mass proxy)
SELECT COUNT(*) FROM (
  SELECT w FROM (SELECT "huntId", unnest(holders) AS w FROM "WalletHuntSnapshot") u
  GROUP BY w HAVING COUNT(DISTINCT "huntId") >= 2
) t;
```

### 2.3 `CreditTransaction.reason` — demand signal ONLY

**Schema** (`prisma/schema.prisma:752`): `reason String`, e.g. `endpoint:<Class>.<method>`.
**Format** (`credit.interceptor.ts:100-102`): `endpoint:${ClassName}.${handlerName}`; also
explicit strings like `endpoint:AnalysesController.queueSimilarityAnalysis`
(`analyses.controller.ts:245,697`). Non-endpoint reasons exist too (`purchase`,
`signup_bonus`, `x402_payment`).

Use only to **prioritize** which wallets/tokens are worth labeling (which behavior-analysis /
similarity endpoints are paid for most). **Never** a truth label or a pair.

```sql
SELECT reason, COUNT(*) FROM "CreditTransaction"
WHERE reason LIKE 'endpoint:%' GROUP BY reason ORDER BY COUNT(*) DESC;
```

---

## 3. Sparsity read (to be filled from server counts)

| Metric | Source | Value (server) | Threshold (see §6) |
|---|---|---|---|
| `reviewed` holdings (affirmative) | §2.1 | `<FILL>` | ≥ 2,000 |
| distinct reviewed wallets | §2.1 | `<FILL>` | ≥ 500 |
| `reviewedAt` timestamp coverage | §2.1 | `<FILL>` | ≥ 90% of reviewed |
| hunts with ≥2 snapshots | §2.2 | `<FILL>` | ≥ 50 |
| wallets appearing in ≥2 hunts | §2.2 | `<FILL>` | ≥ 300 |
| distinct tokens across snapshots | §2.2 | `<FILL>` | ≥ 100 |

Expectation from code + standing project notes: label volume is **currently sparse**
(radar review is a manual UI action with no reviewer identity; hunts cap at 5/user, 10
snapshots/hunt, and auto-delete after 21 days inactive — `wallet-hunt.service.ts:10-13,299-306`).
The 21-day auto-delete actively **destroys** the positive-pair ground truth over time, which is
itself a label-capture defect (see §7).

---

## 4. Label contract for future metric learning

Definitions below are the **contract**, not an implementation. They are what a future
(gated) metric-learning dispatch must consume.

### 4.1 Positive pairs (wallets that should be *close*)

- **P1 — Hunt cross-token co-occurrence (primary).** Within a single hunt with ≥2 distinct
  tokens, any two wallets that **both** appear in ≥2 of the hunt's tokens form a positive pair.
  Weight = min(their `appearanceCount`) / `uniqueTokenCount` (mirrors existing `confidence`).
  Rationale: this is exactly the signal an analyst already trusts (`computeCandidates`).
- **P2 — Same confirmed ring (if §7 ledger lands).** Two wallets an analyst explicitly marks
  as members of the same confirmed ring. Not available today (no such field).
- **Excluded as positive:** two wallets co-appearing in a **single** token's `TOP_HOLDERS`
  set with no cross-token overlap — that is mere co-holding, not confirmed relatedness, and
  would flood the positives with trivial pairs.

### 4.2 Negative pairs (wallets that should be *far*)

Negatives must avoid **trivial** negatives (already obviously far in engineered space) and
**leakage** (constructed from the same signal being evaluated):

- **N1 — Cross-hunt disjoint (primary).** One wallet from hunt A, one from hunt B, where the
  two hunts share **no** tokens and the wallets never co-occur in any snapshot. Sample to match
  positive count (balanced), and **hard-negative mine** by preferring pairs that engineered
  cosine currently rates as *similar* (so training corrects real errors, not easy wins).
- **N2 — Confirmed-unrelated (if §7 ledger lands).** Analyst explicitly marks two wallets as
  unrelated. Not available today.
- **PROHIBITED negatives:**
  - `reviewStatus='ignored'` → NOT a negative (dust + housekeeping pollution, §2.1).
  - Any pair where "far" was decided *by the engineered metric itself* without analyst
    grounding — that trains the model to imitate its own prior (leakage/degenerate).
  - Random wallet pairs with no behavioral overlap → **trivial** negatives; cap their share
    (e.g. ≤ 20% of negatives) so the metric learns the hard boundary, not the obvious gap.

### 4.3 Ambiguous / ignored handling

- `reviewStatus='unreviewed'` → **unlabeled**; excluded from train and eval entirely.
- `reviewStatus='ignored'` → **ambiguous**; excluded until provenance (analyst-negative vs
  dust vs housekeeping) is separable (§7).
- Single-snapshot hunts → **unlabeled** for pairing (no cross-token confirmation).
- Duplicate `(wallet,token)` conflicts resolve to the **latest** `reviewedAt`.

---

## 5. Leakage-safe train / dev / OOS split

**Split unit = HUNT (grouped), with a TIME-based OOS holdout.** Rationale:

- Splitting by **wallet** leaks: the same ring's wallets would straddle train/dev, so the
  model memorizes ring membership instead of learning a metric. Splitting by **hunt** keeps an
  entire confirmed ring on one side.
- Splitting by **token** is insufficient because a hunt spans multiple tokens; a hunt could
  straddle the split. Hunt is the smallest unit that fully contains a positive pair.
- **OOS = time.** Hold out the most recent *N* weeks of hunts/reviews (by `capturedAt` /
  `reviewedAt`) as an out-of-sample set the model never sees during train/dev. This is the only
  split that tests the real deployment claim ("gets better over time") and catches temporal
  leakage (a formation that spans the boundary).

Split procedure:

1. Assign each hunt to exactly one of {train, dev} by hash of `huntId` (≈ 80/20), **after**
   removing all hunts whose `capturedAt` falls in the OOS window.
2. OOS = all hunts + reviewed holdings in the final *N* weeks (recommend N=4; tune once §3
   counts are known).
3. RadarHolding `reviewed` labels join the same regime: group any wallet's reviewed holdings
   with the hunt(s) that wallet belongs to; wallets with no hunt go to the split by wallet-hash
   but are **never** paired across the train/dev boundary.
4. Any pair (positive or negative) spanning two different split buckets is **dropped**, not
   assigned — this is the concrete leakage guard.

Report per split: #positives, #negatives, positive:negative ratio, distinct wallets, distinct
hunts, and hard-negative share.

---

## 6. Minimum label thresholds for a metric-learning dispatch

A future learned-metric job may be dispatched **only if all** hold on server counts:

| Gate | Minimum |
|---|---|
| Affirmative `reviewed` holdings | ≥ 2,000 |
| Distinct reviewed wallets | ≥ 500 |
| Hunts with ≥2 snapshots | ≥ 50 |
| Wallets in ≥2 hunts (positive-pair mass) | ≥ 300 |
| Constructible balanced positive pairs (P1) | ≥ 5,000 after dedup |
| Hard negatives available (N1, cosine-similar) | ≥ 2,000 |
| `reviewedAt` timestamp coverage | ≥ 90% of reviewed |
| OOS window has ≥ | 10 hunts + 200 reviewed holdings |

These are deliberately conservative for a *metric* (not a deep net): metric learning on
engineered 32-dim features (SPEC-001) needs far fewer labeled pairs than end-to-end embedding,
but still needs a real OOS set to make the "measurably better" claim defensible.

---

## 7. If sparse: the next dispatch is label capture, not ML

Given the code-level evidence (manual review, no reviewer identity, polluted `ignored`,
21-day hunt auto-delete destroying ground truth), the expected verdict is that labels are
**too sparse and too impure** to train a metric today. **The recommended next dispatch is
label-capture instrumentation, not a model.** Proposed (additive, non-breaking) scope — to be
its own spec, gated by SPEC002_T00, NOT implemented here:

1. **Add label provenance to `RadarHolding`.** New nullable columns:
   `reviewerId String?`, `reviewSource String?` (`analyst | dust_auto | wallet_removal`).
   The two auto-`ignored` paths (`radar-snapshot.service.ts:84`, `radar.controller.ts:92`)
   set `reviewSource='dust_auto' | 'wallet_removal'`; analyst PATCH sets
   `reviewSource='analyst'` + `reviewerId`. This un-pollutes negatives at the source with a
   ~3-line change per path.
2. **Stop destroying hunt ground truth.** Change the 21-day hunt cascade delete
   (`wallet-hunt.service.ts:299-306`) to soft-archive, or snapshot confirmed candidates into
   a durable table before delete. Confirmed rings are the moat; deleting them is the single
   biggest label-capture defect.
3. **Optional additive `MetricLearningLabel` ledger** (proposal only): append-only
   `(walletA, walletB, label ∈ {positive,negative,ambiguous}, source, huntId?, reviewerId?, createdAt)`
   with a unique idempotency key on the unordered wallet pair + source. Populated by a
   read-only extractor from P1/N1 rules (§4) plus future explicit analyst marks. This is the
   "training-ready ledger" SPEC-002 §3.3 calls for. **Service-boundary checklist** (dispatch §7)
   applies to any write endpoint: idempotent pair keys, capped batch payloads, one-transaction
   writes, address/status validation + admin/ownership guard, structured reject on DB failure,
   no unbounded HTTP export (exports are scripts/jobs).

---

## 8. Verdict — GO / NO-GO

**Metric-learning training / embedding dispatch: NO-GO (blocked).**

- Hard blocker A: SPEC-001 substrate (`WalletVector`) does not exist — there is no engineered
  space to learn a metric *over*. Metric learning has nothing to re-weight.
- Hard blocker B: label readiness is unproven and, on code evidence, likely sparse and impure
  (`ignored` polluted, no reviewer identity, ground truth auto-deleted at 21 days). The §6
  thresholds cannot yet be shown to pass.

**GO (now):** the read-only inventory (this report + `scripts/spec002-label-inventory.ts`),
the pair/split contract (§4–§5), and the threshold gate (§6).

**Recommended next dispatch:** `SPEC002_T04 — label-capture instrumentation` (§7 items 1–2
first; item 3 ledger only after §6 counts justify it). **Do not** dispatch metric training,
embeddings, or any model-serving dependency until SPEC-001 Phase-1 vectors exist **and** §6
thresholds pass on server counts.
