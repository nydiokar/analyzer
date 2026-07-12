# Collections Vector Validation — do the vectors recover KNOWN-connected wallets?

**Date:** 2026-07-12
**DB:** real-data copy `analyzer-postgres-pg17` (:5434, `sova_analyzer`)
**Ground truth:** hand-labeled favorite-wallet collections of user `justio9999@gmail.com`
(`User.id = cmk1e8ru000bxlb2lpqthg1py`, 97 favorites). These are the strongest label we have:
wallets the operator *personally verified* as connected, named with a shared prefix + a number
(`Solomon1..4`, `FLORKw/2/3`, `STELLAR67/77`) = "this is the same person / operation."

**Question asked:** does the NEW vector + edge + cluster methodology independently reproduce
these known connections — with equal or higher confidence than the old similarity flow?

**Answer:** **Yes for operational sibling fleets, and it found more than the labels had.**
And it correctly *declined* to link a same-owner pair that has no behavioral/on-chain signal —
which is the more important, more subtle result.

---

## 1. The three ground-truth groups

| Collection | Wallets (nickname) | Meaning |
|---|---|---|
| `king_solomon` | Solomon1, Solomon2, Solomon3, Solomon4 | one operator, 4-wallet fleet |
| `multi-FLORKw` | FLORKw, FLORKw2, FLORKw3 | one operator, `*w` fleet |
| `known` | STELLAR67, STELLAR77 | same owner, 2 wallets |

All 9 wallets have a behavior profile AND a vector AND ≥1,500 swaps — no coverage excuse.

## 2. Result per group

### king_solomon — PERFECT (4/4), clustered exactly
- All 4 are in **one coordination cluster**, and the cluster is *precisely* those 4 addresses —
  no strangers pulled in, none missed. Precision 100%, recall 100%.
- Pairwise cosine distance **0.044–0.201**; shared tokens **493–1,052**. Both signals fire.

### multi-FLORKw — PERFECT + BONUS (3/3, found a 4th)
- All 3 are in **one cluster** — which contains a **4th member** the `multi-FLORKw` collection
  did not: `GCXhNRRm…` = **MEOWw**, a wallet the operator *had* favorited (as part of the `*w`
  family) but filed in a different collection. The clustering **unified wallets the human had
  split across collections.**
- Pairwise cosine **0.021–0.062**; shared tokens **456–1,129**.
- DB-wide nearest-neighbor check on a FLORK seed returned, in the top 8 of **64,378** wallets:
  `INUw (0.006)`, `17w (0.020)`, `FLORKw2 (0.021)`, `MEOWw (0.032)`, `CHIw (0.035)` — **all
  `*w`-family wallets the operator had independently labeled.** The vector space reproduced the
  manual labeling and ranked it at the very top.

### known-STELLAR — CORRECTLY NOT LINKED (this is the important one)
- Both have vectors, but **neither is in any cluster**, and they are **far apart**: cosine
  **0.585**, only **12 shared tokens**.
- This is **not a failure.** STELLAR67 and STELLAR77 are the same *owner* but run *different
  strategies on different tokens*. There is no behavioral signal and no token-coordination signal
  to find. The methodology is behavioral + on-chain-coordination; it cannot (and should not)
  claim two wallets are one person from *nothing*.

## 3. The two insights that matter for building on this

### 3.1 "Same person" is two different things — don't conflate them
The ground truth silently mixed two relationship types:

- **Operational sibling fleet** (Solomon, FLORK): one owner, *same* strategy, *same* tokens,
  executed in parallel across wallets. → Vectors are near AND tokens overlap massively → both
  signals agree → clusters nail it with high confidence. **This is the substrate's sweet spot.**
- **Same-owner, different-role** (STELLAR): one owner, *different* purposes per wallet. → No
  behavioral proximity, no token overlap → invisible to vectors and edges *by construction*.

**Product consequence:** any surface that labels siblings/clusters as **"same person"** is
overclaiming and will eventually embarrass us on a STELLAR-type pair. The honest, defensible
label is **"same behavioral fingerprint"** (kNN) and **"coordinated on-chain"** (cluster). Ship
that language.

### 3.2 kNN and clusters are COMPLEMENTARY — you need both, and here's the proof
Each Solomon wallet has only **1 of its 3** siblings in its *top-10* nearest neighbors — the
top-10 is crowded with *other* behaviorally-identical wallets. Pure kNN would **under-recall the
fleet** (surface 1 of 3). The **cluster** (built from shared-token WW edges) is what recovered
**4/4**. Conversely, the cluster layer is silent on STELLAR, where only behavior *could* speak
(and it correctly stayed silent too).

**Build consequence:** a holder-row "siblings" chip (kNN) and a "cluster" chip (edges) answer
**different questions** and must both be present — one is "who trades like this," the other is
"who trades *with* this." SURFACE-1's design already carries both; this validation is *why* that
is the right call, not an accident.

## 4. Several-steps-ahead: what STELLAR unlocks (a NEW capability, flagged not built)
The one case the substrate can't solve — same owner, different behavior — is exactly the case a
**funding/transfer graph** solves: two wallets funded by a common source, or that transfer to
each other, are linked regardless of behavior. That signal is **orthogonal** to everything we
built and would be the natural *third* edge type (`WalletWalletEdge` today is behavior/token-
coordination; a `funding` edge type would catch STELLAR). This is not in scope now — but the
STELLAR result is the concrete evidence for *why* a funding edge is the highest-value next
substrate addition after the current catalog is surfaced. **Flagged for a future spec, not built.**

## 5. Verdict
The vector methodology **passes** the known-connected test decisively: it recovers operator-
verified fleets at 100%, ranks them above 64k wallets, finds members the human missed, and —
critically — **does not fabricate links it has no evidence for.** Confidence in the substrate as
a similarity/coordination engine is *higher* after this test, with two guardrails for whoever
surfaces it: (1) call it "behavioral fingerprint / coordination," not "same person"; (2) always
present kNN + cluster together, because each alone under-recalls.

## 6. Reproduce
All queries are single `psql` reads against :5434; the seeds are the addresses in §1 (pull live
via `SELECT collections, nickname, "walletAddress" FROM "UserFavoriteWallet" WHERE "userId" =
'cmk1e8ru000bxlb2lpqthg1py'`). Pairwise distance = `v1.vector <=> v2.vector`; shared tokens =
`INTERSECT` over `WalletTokenEdge.mint`; cluster = `WalletClusterMembership.clusterId`.
