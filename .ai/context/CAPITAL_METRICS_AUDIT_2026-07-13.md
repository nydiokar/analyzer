# AGENT_11 Part A — Capital / Outcome Metrics Audit (read-only gate)

**Date:** 2026-07-13 · **DB:** `analyzer-postgres-pg17` (:5434) · every figure reproduced with `psql`.
**Gate verdict: 🟢 GREEN — build the capital vector (Part B), with a mandatory per-wallet
data-quality field.** The money data is 98–100% populated, the axes are largely independent, and
honest quality signals already exist to ride along. No dishonest-vector risk if the bounding + quality
flag below are respected.

## 1. Inventory + population (of 64,271 `WalletPnlSummary` / 63,228 `AdvancedTradeStats`)
All core money fields are **100% populated** (no null-rate problem, unlike the mcap keys in behavior):
- `WalletPnlSummary`: realizedPnl, netPnl, unrealizedPnl, totalVolume, realizedPnlToTotalVolumeRatio,
  averageRealizedPnlPerExecutedSwap, averageSwapSize, currentSolBalance, + USD mirrors — all 64,271/64,271.
- `AdvancedTradeStats`: tokenWinRatePercent, weightedEfficiencyScore, medianPnlPerToken,
  trimmedMeanPnlPerToken, standardDeviationPnl, profitConsistencyIndex, averagePnlPerDayActiveApprox —
  all 63,228/63,228.
- Coverage vs `WalletVector` (64,378): a capital vector keyed on `WalletPnlSummary` covers **64,271 =
  99.8%** of vectored wallets — clears the ≥99% acceptance bar.

## 2. Compaction test — redundancy correlations (on the PnlSummary⋈AdvancedStats join)
| Pair | r | Read |
|---|---:|---|
| realizedPnl ↔ netPnl | **0.076** | near-INDEPENDENT — net folds in unrealized (the honesty-risk part). Vector uses **realized** as the honest profitability signal; unrealized handled as a quality flag, not a profit dim. |
| medianPnlPerToken ↔ trimmedMeanPnlPerToken | **0.811** | REDUNDANT — keep ONE (trimmedMean, more robust). |
| ln\|realizedPnl\| ↔ ln(volume) | 0.771 | correlated-not-redundant (bigger traders → bigger abs PnL; expected). Magnitude and profitability stay separate dims. |
| realizedPnlToTotalVolumeRatio ↔ weightedEfficiencyScore | 0.174 | INDEPENDENT — two different efficiency notions; keep both or pick RVR (simpler). |
| tokenWinRatePercent ↔ profitConsistencyIndex | 0.009 | INDEPENDENT — win-rate ≠ consistency. Keep both. |
| RVR ↔ winRate | 0.590 | moderate; distinct enough. |
| ln(volume) ↔ ln(avgSwapSize) | 0.554 | both magnitude-ish; keep volume, avgSwapSize optional. |

## 3. Proposed capital AXES (~7 bounded dims — final list in Part B)
1. **Magnitude** — `ln(totalVolume+1)`, then z/winsorize. (how much capital moves)
2. **Profitability** — `signed-log(realizedPnl)` = `sign·ln(1+|realizedPnl|)`, winsorized. (honest net outcome)
3. **Efficiency** — `realizedPnlToTotalVolumeRatio`, clamped to a sane band. (PnL per unit volume)
4. **Per-trade efficiency** — `trimmedMeanPnlPerToken`, signed-log + winsorize. (skill per position)
5. **Win-rate** — `tokenWinRatePercent/100`, already [0,1]. (hit rate)
6. **Consistency** — `profitConsistencyIndex` (bounded) and/or inverse-volatility from `standardDeviationPnl`. (repeatability vs luck)
7. **Liquidity/holdings** — `ln(currentSolBalance+1)` winsorized OR a bounded balance rank. (dry powder)

## 4. The honesty flag — CRITICAL, unique to money (brief §A.3)
Money magnitude is corrupted by untracked inter-wallet transfers and paper gains. Quantified on :5434:
- **`confidenceScore`** (already on `WalletBehaviorProfile`): avg 0.906; **4,599 (7.2%) < 0.5**. Existing,
  reusable per-wallet quality signal.
- **Unrealized-vs-realized skew**: **1,663 (2.6%)** have `|unrealized| > 5·|realized|` — PnL dominated by
  un-exited paper positions, not realized skill.
- **Tiny volume**: **1,127 (1.8%)** have `totalVolume < 0.1 SOL` — PnL statistically meaningless.
- **NOT usable:** `Wallet.olderHistorySatisfiedTarget` is a target ROW COUNT (500–3000), NULL on 34,829
  — not a completeness boolean. Do not use it as a quality flag.

**Recommendation:** persist a bounded `dataQuality` ∈ [0,1] on `WalletCapitalVector` = f(confidenceScore,
skew penalty, tiny-volume penalty). It MUST ride with every capital-vector neighbor result so downstream
never treats a capital neighbor as ground-truth "skilled." Low-quality wallets still get a vector (so
they are placed) but are flagged so a consumer can filter.

## 5. Bounding (brief §A.4 — no dim may be unbounded)
Money scale is unbounded (whale PnL ≫ retail). Every magnitude/profit dim uses **signed-log +
winsorization** (clamp to a percentile band, e.g. p1–p99) BEFORE population standardization, so no whale
dominates cosine geometry — the failure the behavior audit found in the speed bloc, worse in money units.
Ratios/rates (RVR, winRate, PCI) are already bounded; still clamp RVR to a sane band (a 10000% ratio on a
0.01-SOL wallet is noise). **No raw PnL or raw portfolio value as a dim.**

## 6. Gate decision
🟢 **GREEN → proceed to Part B.** Data is honest enough to vectorize IF: (a) profitability uses realized
(not net) PnL, (b) all magnitude/profit dims are signed-log + winsorized, (c) a bounded `dataQuality`
field is persisted and returned with every neighbor. These three are hard requirements carried into Part B.
