# Dispatch Log - SPEC-002 operational job-state table

Source-of-truth for SPEC-002 dispatch state. One row per task, exactly one status.

Legend: ready = file written, not launched; blocked = waiting on named dependency; done = landed; dead = killed or reframed.

---

## Active + Ready-To-Dispatch

| Job | File | Lane / task | Status | Depends on / what's left |
|---|---|---|---|---|
| SPEC001_T01 - representation substrate | `documentation/specs/SPEC-001-wallet-representation-layer.md` | BUILD / wallet vectors + graph substrate | in_progress | Additive migration, feature-vector builder, vector backfill script, kNN DB read helper, Gate-0 ledger script, wallet-token edge materializer, pruned wallet-wallet edge materializer, cluster materializer, and label-capture fixes landed locally. Remaining: run against non-empty developer/server data, fill Gate-0/Gate-2 counts, then expose public endpoints behind service-boundary checklist. |
| SPEC002_T01 - vector history and drift pilot | `AGENT_2_SPEC002_VECTOR_HISTORY_DRIFT.md` | BUILD / temporal vectors | blocked | SPEC002_T00 verdict: keep blocked until SPEC-001 Gate-0/Gate-1 land and current-version `WalletVector` rows are backfilled. Schema substrate now exists; do not build a second representation layer. |
| SPEC002_T02 - formation replay and densification design | `AGENT_3_SPEC002_FORMATION_REPLAY.md` | RESEARCH + BUILD / cluster formation | blocked | SPEC002_T00 verdict: keep build blocked until SPEC-001 graph-table direction is concrete and `WalletWalletEdge`/`WalletClusterMembership` exist or are being built. Read-only design only; no live alerting or second serving model. |
| SPEC002_T03 - label ledger and learned-metric readiness | `AGENT_4_SPEC002_LABEL_LEDGER_METRIC_READINESS.md` | RESEARCH / moat gate | done | Read-only readiness report + inventory script delivered (2026-07-07). Verdict: **NO-GO** for metric training/embeddings (blocked on missing SPEC-001 `WalletVector` substrate AND unproven/impure labels). GO only for inventory + pair/split contract + threshold gate. Report: `.ai/context/SPEC002_LABEL_READINESS_2026-07-07.md`; script: `scripts/spec002-label-inventory.ts`. Next: SPEC002_T04 label-capture instrumentation, not ML. |

---

## Completed

| Job | File | Verdict | Key artifact |
|---|---|---|---|
| SPEC002_T00 - manager gate and spec hardening | `AGENT_1_SPEC002_MANAGER_GATE.md` | Completed. SPEC-002 is consistent only as post-SPEC-001 direction; Act 2 build work is blocked until representation substrate exists. SPEC002_T03 may run read-only now. | `documentation/specs/SPEC-002-temporal-intelligence-and-the-learned-metric.md` §7 |
| SPEC002_T03 - label ledger and learned-metric readiness | `AGENT_4_SPEC002_LABEL_LEDGER_METRIC_READINESS.md` | **NO-GO** for learned metric (blocked: no `WalletVector` substrate + unproven/impure labels). Read-only inventory, pair/split contract, and threshold gate delivered. Learned-metric work **remains blocked**. Recommended next: label-capture instrumentation (SPEC002_T04), not ML. | `.ai/context/SPEC002_LABEL_READINESS_2026-07-07.md`, `scripts/spec002-label-inventory.ts` |

---

## Dead / Reframed

| Job | Task | Status | Why |
|---|---|---|---|
| - | - | - | - |

---

## Sequencing Notes

SPEC-002 is not a single implementation ticket. It is gated by SPEC-001 because the current repo has ephemeral token-space similarity vectors and current-state label tables, but no persisted `WalletVector`, `WalletWalletEdge`, or `WalletClusterMembership` substrate yet.

Implementation order:

1. Run SPEC002_T00 first.
2. Only after SPEC-001 representation substrate is real, run SPEC002_T01 and SPEC002_T02 in parallel if T00 allows it.
3. Run SPEC002_T03 any time after T00 as a read-mostly readiness job, but do not train a learned metric until label volume and negative-pair construction are proven.

Budget guard: no sequence model, graph embedding, autoencoder, or learned metric should be dispatched from SPEC-002 until the cheap temporal wins and label-readiness gates pass.
