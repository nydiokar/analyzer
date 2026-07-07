# AGENT 4 - SPEC002_T03: label ledger and learned-metric readiness

Lane: RESEARCH / metric-learning gate. This job protects the project from premature embeddings by measuring whether the proprietary label loop is actually ready.

## 0. Boot

Read in order:

1. `.ai/CONTEXT.md`.
2. `.ai/dispatch/DISPATCH_LOG.md` and the completed SPEC002_T00 verdict.
3. `documentation/specs/SPEC-001-wallet-representation-layer.md` - engineered vector and graph contracts.
4. `documentation/specs/SPEC-002-temporal-intelligence-and-the-learned-metric.md` - Act 3 and label prerequisites.
5. `prisma/schema.prisma` - `RadarHolding`, `WalletHuntSnapshot`, `CreditTransaction`, `User`, `Wallet`.
6. `src/api/services/radar-snapshot.service.ts` and radar controllers/DTOs.
7. `src/api/services/wallet-hunt.service.ts`.

## 1. Task

Create the label-readiness layer for the learned metric:

- Count and profile current label volume:
  - `RadarHolding.reviewStatus` by status, reviewer/time if available, active/inactive, token age if derivable;
  - `WalletHuntSnapshot` holder-set sizes, repeated wallets, repeated tokens, source types;
  - `CreditTransaction.reason` demand signals by endpoint.
- Define the label contract for future metric learning:
  - positive pairs from same confirmed hunt/ring;
  - negative pairs construction rules that avoid trivial negatives and leakage;
  - ambiguous/ignored labels handling;
  - train/dev/OOS split unit (wallet, token, hunt, or time) to prevent leakage.
- Identify UI/backend changes needed to capture better labels if current volume is sparse.

## 2. Root-cause framing

SPEC-002 says analyst labels are the moat, but the current schema stores them as operational fields, not as a training-ready label ledger. Before any learned metric or embedding, the project needs to know whether labels are numerous, balanced, timestamped, and clean enough to evaluate a metric.

## 3. Hard guards

- Do not train an embedding or metric model in this job.
- Do not add a model-serving dependency.
- Do not reinterpret `reviewStatus='ignored'` as a clean negative without verifying semantics in UI/service code.
- Do not use user demand (`CreditTransaction`) as truth labels; it is prioritization/demand only.
- Do not create labels that leak the outcome being evaluated.

## 4. Likely files

- A read-only script under `scripts/` for label inventory.
- Optional additive Prisma model/spec for a future `MetricLearningLabel` ledger, only if SPEC002_T00 approves.
- Radar and wallet-hunt service/controller files only if adding explicit label capture is approved.
- `documentation/specs/SPEC-002...` or `.ai/context/...` for the readiness report.

## 5. Deliverables

- Label-readiness report with:
  - counts and sparsity;
  - positive/negative pair construction;
  - split strategy;
  - minimum label thresholds for metric-learning dispatch;
  - UI capture gaps if labels are too sparse.
- Optional additive label-ledger migration proposal, not implementation, unless explicitly approved by SPEC002_T00.
- Update `.ai/dispatch/DISPATCH_LOG.md` with whether learned metric work remains blocked.

## 6. Acceptance

- Counts are produced from the canonical DB target if DB work is needed:
  - `docker exec analyzer-postgres psql -U postgres -d sova_analyzer -c "<SQL>"`
- All SQL is read-only.
- The report explicitly says GO/NO-GO for learned metric training.
- If labels are sparse, the recommended next job is label capture instrumentation, not ML.

## 7. Service boundary checklist

If label-capture endpoints or handlers are proposed or added later:

- Concurrency: label writes are small but can be called repeatedly; use idempotent keys where possible.
- Memory at scale: no unbounded label export through HTTP.
- Request size: cap batch label payloads.
- Timeout: label writes should be one DB transaction; exports should be scripts/jobs.
- Malformed input: validate wallet/token addresses, allowed statuses, and ownership/admin permissions.
- Backing resources: DB failure should reject the write with a structured error; never silently drop analyst labels.

