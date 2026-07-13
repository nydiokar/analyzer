# Metrics ↔ Vector Fidelity Audit — the 32-dim wallet behavior vector

**Date:** 2026-07-12
**Type:** read-only audit (no vector code / migration / materializer touched). Every number below
is reproducible with a single `psql` read against the real-data copy.
**DB:** `analyzer-postgres-pg17` (:5434, `sova_analyzer`),
`DATABASE_URL="postgresql://postgres:postgres@localhost:5434/sova_analyzer?schema=public"`
**Source of truth:** `src/core/representations/wallet-feature-vector.ts` (`buildWalletSourceVector`,
32 source dims → padded to 64, standardized), `prisma/schema.prisma` model `WalletBehaviorProfile`
(55 metric columns). Backfill: `scripts/spec001-backfill-wallet-vectors.ts`. Prior maps:
`docs/2. metrics_map.md` + `docs/3.metrics_compact_map.md` (they catalog the ~55 fields and their
math but **do not** map field→vector-dim — that map did not exist before this doc).

**Population:** 64,378 `WalletBehaviorProfile` rows = 64,378 `WalletVector` rows (1:1). Each
`WalletVector.sourceVector` is the raw pre-standardization 32-vector (jsonb) — used for all
descriptive stats here. `WalletVector.vector` is the standardized+zero-padded vector(64) with an
HNSW cosine index — used for all neighbor/purity queries.

---

## TL;DR — the three headline findings

1. **6 of 32 dims are DEAD due to a key-name schema drift (genuine bug, filed, not fixed).**
   Dims 16–19, 25, 26 read `mcapDistribution` with legacy keys (`nano/micro/small/mid/large/mega`).
   The DB actually stores dollar-range keys (`0-10k … 1m+`). Overlap = **34 wallets out of 64,378
   (0.05%)**. So the entire market-cap axis the vector was *meant* to carry is ~99.95% zeros /
   ~zero variance. The vector is structurally blind to mcap positioning. → `MCAP-VEC-BUG` filed.

2. **The vector is lopsided: strong on the active-trading axis, weak on the holding/distribution
   axis — and now we know the mechanism.** Properly sampled (100 seeds/type), top-20 neighbor
   purity: FAST_TRADER 0.90, LOW_ACTIVITY 0.80, DAY_TRADER 0.68, ACCUMULATOR 0.64, SWING 0.50,
   POSITION 0.39, PURE_HOLDER 0.25, DISTRIBUTOR 0.25, BALANCED 0.06. Confusion matrix proves *why*:
   **DISTRIBUTOR neighbors land 53% in FAST_TRADER** (no sell-side-skew dim to separate a
   distributor from a flipper), **PURE_HOLDER lands 72% in LOW_ACTIVITY** (no holding-conviction /
   magnitude dim to separate "holds a real position" from "barely trades").

3. **~8 of the 32 dims are near-collinear encodings of one axis ("trades fast").** dim8 (%<1h) ↔
   dim32 (%<1h × flipper) r=**0.98**; dim8 ↔ dim9 (%<4h) r=0.94; dim2 (flipperScore) ↔
   dim8 r≈0.90 in the source field (`flipperScore` vs `percentTradesUnder1Hour` r=**0.895**);
   dim21 ↔ dim29 r=**−0.95** (mechanically complementary). The fast-trading bloc dominates the
   geometry and drowns the holding/distribution signal, which explains finding #2.

---

## PART 1 — The metrics ↔ vectors map

### 1A. The 32 vector dimensions (in build order)

Dim = 1-based index into `buildWalletSourceVector` return array. "Transform" is what the code does
to the source field. Per-dim descriptive stats are on the raw sourceVector across all 64,378 wallets.

| Dim | Source field (`WalletBehaviorProfile` unless noted) | Transform | mean | stddev | frac_zero | Verdict |
|:--:|:--|:--|--:|--:|--:|:--|
| 1  | `buySellSymmetry` | clamp01 | 0.726 | 0.227 | 0.05 | keep |
| 2  | `flipperScore` | clamp01 | 0.796 | 0.281 | 0.05 | **re-weight/drop** — 0.895 corr w/ dim8 |
| 3  | `medianHoldTime` | log1p | 0.683 | 1.212 | 0.05 | keep |
| 4  | `averageFlipDurationHours` | log1p | 1.674 | 1.687 | 0.05 | keep (corr 0.78 w/ dim3) |
| 5  | `advancedStats.tokenWinRatePercent` /100 | clamp01 | 0.279 | 0.187 | 0.11 | keep (only PnL-ish signal) |
| 6  | `buySellRatio` | clamp 0..10 /10 | 0.153 | 0.132 | 0.05 | **keep + re-weight up** (only sell-skew signal) |
| 7  | `sequenceConsistency` | clamp01 | 0.946 | 0.226 | 0.05 | re-weight down — 0.93 corr w/ dim14 |
| 8  | `percentTradesUnder1Hour` | clamp01 | 0.657 | 0.327 | 0.07 | keep (canonical fast signal) |
| 9  | `percentTradesUnder4Hours` | clamp01 | 0.749 | 0.306 | 0.06 | **drop/merge** — 0.94 corr w/ dim8 |
| 10 | `reentryRate` | clamp01 | 0.461 | 0.249 | 0.09 | keep |
| 11 | `sessionCount` | log1p | 3.051 | 1.368 | 0.00 | keep |
| 12 | `avgTradesPerSession` | log1p | 2.572 | 1.178 | 0.00 | keep |
| 13 | `uniqueTokensTraded` | log1p | 4.074 | 1.602 | 0.00 | keep (a soft activity-magnitude proxy) |
| 14 | `completePairsCount`/`uniqueTokensTraded` | ratio, clamp01 | 0.930 | 0.238 | 0.05 | re-weight down — 0.93 corr w/ dim7 |
| 15 | `averageTradesPerToken` | log1p | 1.553 | 0.571 | 0.05 | keep |
| 16 | `mcapDistribution.nano` | clamp01 | 0.00001 | 0.0011 | **0.9998** | **DEAD (bug)** |
| 17 | `mcapDistribution.micro` | clamp01 | 0.00009 | 0.0056 | **0.9996** | **DEAD (bug)** |
| 18 | `mcapDistribution.small` | clamp01 | 0.00014 | 0.0083 | **0.9996** | **DEAD (bug)** |
| 19 | `mcapDistribution.mid` | clamp01 | 0.00005 | 0.0040 | **0.9997** | **DEAD (bug)** |
| 20 | `velocityScore` /100 | /100 | 0.918 | 0.165 | 0.01 | re-weight down — 0.87 corr w/ dim3 |
| 21 | `tokensWithBothBuyAndSell`/`uniqueTokensTraded` | ratio, clamp01 | 0.855 | 0.249 | 0.05 | keep (but −0.95 w/ dim29) |
| 22 | `percentageOfUnpairedTokens` | clamp01 | 0.849 | 0.325 | 0.11 | keep |
| 23 | `averageSessionDurationMinutes` | log1p | 4.169 | 1.380 | 0.04 | keep |
| 24 | `percentOfValueInCurrentHoldings` | clamp01 | 0.706 | 0.379 | 0.08 | keep (see caveat below) |
| 25 | `mcapDistribution['ultra-micro'/ultraMicro]` | clamp01 | 0.00022 | 0.0122 | **0.9995** | **DEAD (bug)** |
| 26 | `mcapDistribution.large + .mega` | clamp01 sum | 0.00002 | 0.0013 | **0.9997** | **DEAD (bug)** |
| 27 | `dominantEntryMcapBucketShare` | clamp01 | 0.387 | 0.306 | 0.24 | keep — this mcap field IS populated |
| 28 | `avgEntryMcap` | log1p(x+1) | 8.971 | 5.155 | 0.00 | keep — populated; note unbounded scale |
| 29 | `tokensWithOnlyBuys`/`uniqueTokensTraded` | ratio, clamp01 | 0.129 | 0.240 | 0.13 | keep (accumulation signal) |
| 30 | `medianActiveHoldingHours` | log1p | 2.251 | 1.426 | 0.15 | **keep** (open-position axis) + **ADD** `medianCompletedHoldTimeHours` as a separate dim (see 1E) |
| 31 | `activeTradingDays` | log1p | 2.397 | 2.460 | 0.08 | keep |
| 32 | `percentTradesUnder1Hour` × `flipperScore` | product | 0.605 | 0.362 | 0.07 | **drop** — 0.98 corr w/ dim8 |

Reproduce the stats block:
```sql
SELECT ord AS dim, round(avg(v)::numeric,5) mean, round(stddev_pop(v)::numeric,5) stddev,
       round((count(*) FILTER (WHERE v=0)::numeric/count(*)),4) frac_zero
FROM "WalletVector" wv
CROSS JOIN LATERAL jsonb_array_elements_text(wv."sourceVector") WITH ORDINALITY e(val,ord)
CROSS JOIN LATERAL (SELECT (e.val)::float8 v) x
GROUP BY ord ORDER BY ord;
```

### 1B. The mcap DEAD-DIMS bug (dims 16–19, 25, 26) — quantified

`readMcapDistribution()` in `wallet-feature-vector.ts` reads keys
`nano / ultra-micro / ultraMicro / micro / small / mid / large / mega`. The DB stores different keys:

```sql
SELECT key, count(*) FROM "WalletBehaviorProfile", LATERAL jsonb_object_keys("mcapDistribution") key
WHERE jsonb_typeof("mcapDistribution")='object' GROUP BY key ORDER BY count(*) DESC;
```
Actual keys → wallets: `0-10k`(47,927) `10-20k`(44,965) `20-30k`(40,845) `30-50k`(39,356)
`50-100k`(37,660) `100-200k`(34,010) `200-500k`(30,342) `1m+`(24,565) `500k-1m`(22,577);
legacy keys the code reads → wallets: `ultra-micro`(34) `micro`(28) `small`(28) `mid`(19)
`nano`(18) `mega`(17) `large`(11).

```sql
SELECT count(*) FROM "WalletBehaviorProfile"
WHERE jsonb_typeof("mcapDistribution")='object'
  AND "mcapDistribution" ?| array['nano','ultra-micro','ultraMicro','micro','small','mid','large','mega'];
-- 34
```
**34 / 64,378 = 0.05%.** The 6 mcap dims are dead. Note dims **27** (`dominantEntryMcapBucketShare`,
frac_zero 0.24) and **28** (`avgEntryMcap`, frac_zero 0.00) read *different* fields that ARE
populated — so the vector has a *weak* mcap toe-hold, but the intended distribution shape is absent.

### 1C. Every `WalletBehaviorProfile` metric → in-vector / frontend / unused / dead

Frontend column verified by grep of `dashboard/src` (holder-profiles + `BehavioralPatternsTab.tsx` +
`wallet-siblings` + `discover`). "FE" = rendered to a user = operator's "proven to matter."

| Metric | In vector? | Frontend? | Classification |
|:--|:--|:--|:--|
| `buySellRatio` | dim6 | — | used (under-weighted; see Part 2) |
| `buySellSymmetry` | dim1 | FE | used |
| `averageFlipDurationHours` | dim4 | — | used |
| `medianHoldTime` | dim3 | — | used |
| `sequenceConsistency` | dim7 | FE | used (redundant w/ dim14) |
| `flipperScore` | dim2 | FE (fallback) | used (blunt proxy — see 1D) |
| `uniqueTokensTraded` | dim13 | — | used |
| `tokensWithBothBuyAndSell` | dim21 (ratio) | — | used |
| `tokensWithOnlyBuys` | dim29 (ratio) | — | used |
| `tokensWithOnlySells` | **excluded** | — | **derived-but-unused** — the missing DISTRIBUTOR signal |
| `totalTradeCount` | **excluded** | — | excluded by design (no magnitude axis) |
| `totalBuyCount` / `totalSellCount` | **excluded** | — | excluded (magnitude) |
| `completePairsCount` | dim14 (ratio) | — | used |
| `averageTradesPerToken` | dim15 | — | used |
| `tradingTimeDistribution` (json) | **excluded** | — | derived-but-unused (dims 8/9 cover part) |
| `percentTradesUnder1Hour` | dim8 (+dim32) | FE | used |
| `percentTradesUnder4Hours` | dim9 | — | used (redundant w/ dim8) |
| `tradingStyle` | **excluded** | FE (fallback) | derived label — unused in vector |
| `confidenceScore` | **excluded** | FE | derived-but-unused — **should weight, not be a dim** |
| `tradingFrequency` (json) | **excluded** | — | derived-but-unused (proportional to sessions) |
| `tokenPreferences` (json) | **excluded** | — | not a behavior axis (token identities) |
| `riskMetrics` (json: avg/largest tx SOL) | **excluded** | — | **derived-but-unused (magnitude)** — candidate money axis |
| `reentryRate` | dim10 | FE | used |
| `percentageOfUnpairedTokens` | dim22 | — | used |
| `sessionCount` | dim11 | — | used |
| `avgTradesPerSession` | dim12 | — | used |
| `activeTradingPeriods` (json) | **excluded** | FE (via start hour) | derived-but-unused |
| `averageSessionStartHour` | **excluded** | FE | **derived-but-unused** — timezone/bot-schedule signal |
| `averageSessionDurationMinutes` | dim23 | — | used |
| `activeTradingDays` | dim31 | — | used |
| `medianActiveHoldingHours` | dim30 | — | used — legit open-position axis, KEEP (see 1E correction) |
| `medianCompletedHoldTimeHours` | **excluded** | FE (primary!) | **derived-but-unused — ADD as a separate dim (orthogonal to dim30, r=0.11)** |
| `averageCurrentHoldingDurationHours` | **excluded** | FE | derived-but-unused |
| `medianCurrentHoldingDurationHours` | **excluded** | FE | derived-but-unused |
| `percentOfValueInCurrentHoldings` | dim24 | FE | used (symptom risk — see Part 2 caveat) |
| `percentOfCurrentPortfolioValue` | **excluded** | — | derived-but-unused |
| `flowPattern` | **excluded** | FE | derived label — unused in vector |
| `speedCategory` | **excluded** | FE | derived label — unused in vector |
| `strategyType` | **excluded** | FE | derived label — the ground-truth we test purity against |
| `exitPattern` | **excluded** | FE | **derived-but-unused** — direct DISTRIBUTOR/holder signal |
| `velocityScore` | dim20 | FE | used (redundant w/ dim3/dim8) |
| `avgEntryMcap` | dim28 | — | used |
| `mcapDistribution` (json) | dims16-19,25,26 | — | **DEAD (key bug)** |
| `dominantEntryMcapBucketShare` | dim27 | — | used |
| `dominantEntryMcapBucket` | **excluded** | — | derived-but-unused (categorical) |
| `preferredMcapBucket` | **excluded** | — | derived-but-unused (categorical) |
| `mcapBucketPnl` (json) | **excluded** | — | derived-but-unused (rich mcap×PnL) |
| `typicalEntryMcapUsd` | **excluded** | FE | derived-but-unused |
| `entryMcapP25Usd` / `entryMcapP75Usd` | **excluded** | — | derived-but-unused (mcap spread) |
| `entryMcapDistributionByCount` (json) | **excluded** | — | derived-but-unused — **populated alt to dead dims** |
| `entryMcapSampleSizeBuys/Tokens` | **excluded** | — | metadata, not behavior |
| `preferredMcapBucket`,`firstTransactionTimestamp`,`lastTransactionTimestamp`,`updatedAt`,`holdTimeTokenMap`,`enrichedHoldTimeDistribution` | **excluded** | partial | metadata / not a stable behavior axis |

### 1D. `flipperScore` is a blunt proxy — confirmed

```sql
SELECT round(corr("flipperScore","percentTradesUnder1Hour")::numeric,3) AS flip_vs_pct1h,
       round(corr("flipperScore","medianHoldTime")::numeric,3)          AS flip_vs_medhold,
       round(corr("velocityScore","percentTradesUnder1Hour")::numeric,3) AS velocity_vs_pct1h
FROM "WalletBehaviorProfile" WHERE "flipperScore" IS NOT NULL AND "velocityScore" IS NOT NULL;
-- flip_vs_pct1h=0.895 | flip_vs_medhold=-0.070 | velocity_vs_pct1h=0.604
```
`flipperScore` correlates 0.895 with the sub-1-hour trade fraction (which the vector also carries
directly as dim8) and only −0.07 with the actual `medianHoldTime`. It is a repackaged "trades fast"
score, **not** a hold-time measure. The vector spends **three** dims on this one axis: dim2
(`flipperScore`), dim8 (`percentTradesUnder1Hour`), dim32 (`dim8 × flipperScore`). `velocityScore`
(dim20) is a fourth encoding of the same short-hold idea.

### 1E. `medianActiveHoldingHours` vs `medianCompletedHoldTimeHours` — TWO ORTHOGONAL AXES, not a wrong-field swap

**CORRECTION (2026-07-12, post-review):** an earlier draft of this section called dim30 a "wrong
field, replace with `medianCompletedHoldTimeHours`." **That was a category error.** These two fields
measure **different token universes** and are complementary, not substitutes:

- `medianCompletedHoldTimeHours` = median duration of **closed round-trips** (bought→fully sold). It
  answers *"when this wallet exits, how long did it hold?"* — historical exit tempo.
- `medianActiveHoldingHours` = median age of **currently-open positions** that still hold value. It
  answers *"how long is this wallet sitting on its live bags right now?"* — present holding conviction.

They are orthogonal by construction (disjoint token sets: closed vs open) and empirically:

```sql
SELECT round(corr("medianActiveHoldingHours","medianCompletedHoldTimeHours")::numeric,3) corr,
       count(*) FILTER (WHERE "medianActiveHoldingHours">0 AND ("medianCompletedHoldTimeHours" IS NULL OR "medianCompletedHoldTimeHours"=0)) active_only,
       count(*) FILTER (WHERE "medianCompletedHoldTimeHours">0 AND ("medianActiveHoldingHours" IS NULL OR "medianActiveHoldingHours"=0)) completed_only,
       count(*) FILTER (WHERE "medianActiveHoldingHours">0 AND "medianCompletedHoldTimeHours">0) both
FROM "WalletBehaviorProfile";
-- corr=0.109 | active_only=6358 | completed_only=3946 | both=52778
```
r=**0.109** (nearly independent). **6,358** wallets carry only the open-position signal, **3,946** only
the closed signal — neither field can stand in for the other. Replacing dim30 would delete the
open-position (conviction) axis entirely.

**Corrected finding:** dim30 (`medianActiveHoldingHours`) is a legitimate axis and should **stay**. The
bug is that `medianCompletedHoldTimeHours` — the FE-*primary* hold-time
(`BehavioralPatternsTab.tsx:561,605`), and the true exit-tempo axis — is **missing entirely** from the
vector. The fix is **ADD a second hold-time dim**, not replace. Note dim3 (`medianHoldTime`) is a
flip-based hold time and is yet a third, related-but-distinct notion; §Part-1B of the axis map (below /
in the companion behavioral-axis doc) disentangles the three. For wallets with `active` populated but
no `completed`, dim30 fires on a signal
the dashboard would show as null.

---

## PART 2 — Dimension significance

### 2A. Per-type neighbor purity — properly sampled (100 seeds/type, top-20, HNSW cosine)

Extends the prior single-seed probe. `ef_search=100`.

| strategyType | n (pop) | prevalence | **mean purity** | median | lift (purity/prevalence) |
|:--|--:|--:|--:|--:|--:|
| FAST_TRADER | 34,394 | 0.535 | **0.898** | 0.950 | 1.7× |
| LOW_ACTIVITY | 7,357 | 0.115 | **0.798** | 0.900 | 6.9× |
| DAY_TRADER | 9,688 | 0.151 | **0.679** | 0.725 | 4.5× |
| ACCUMULATOR | 9,665 | 0.150 | **0.636** | 0.650 | 4.2× |
| SWING_TRADER | 988 | 0.015 | **0.495** | 0.500 | 32× |
| POSITION_TRADER | 249 | 0.004 | **0.385** | 0.400 | 99× |
| PURE_HOLDER | 313 | 0.005 | **0.252** | 0.100 | 51× |
| DISTRIBUTOR | 1,457 | 0.023 | **0.249** | 0.200 | 11× |
| BALANCED_TRADER | 145 | 0.002 | **0.060** | 0.050 | 26× |

**Confirms the prior finding and adds nuance:** absolute purity is strong on the active-trading axis
and weak on holding/distribution. But on a *lift-over-chance* basis PURE_HOLDER (51×) and
POSITION_TRADER (99×) do cluster — their low absolute purity is partly class-rarity, not total
blindness. BALANCED_TRADER (lift 26× but absolute 0.06) is the genuinely diffuse class. For a kNN
*product*, absolute purity is what the user feels, so the holding/distribution axis is the real gap.

### 2B. Confusion matrix — *where* the weak types' neighbors actually land (the mechanism)

40 seeds/type, top-20 neighbors, grouped by neighbor strategyType:

| seed_type | dominant neighbor type(s) | share |
|:--|:--|--:|
| **DISTRIBUTOR** | **FAST_TRADER** | **0.529** |
| DISTRIBUTOR | DISTRIBUTOR (self) | 0.274 |
| DISTRIBUTOR | DAY_TRADER | 0.104 |
| **PURE_HOLDER** | **LOW_ACTIVITY** | **0.724** |
| PURE_HOLDER | PURE_HOLDER (self) | 0.276 |
| POSITION_TRADER | POSITION_TRADER (self) | 0.375 |
| POSITION_TRADER | SWING_TRADER | 0.363 |
| POSITION_TRADER | ACCUMULATOR | 0.165 |

- **DISTRIBUTOR → 53% FAST_TRADER.** Per-type dim means show why: a distributor looks identical to a
  flipper on the dominant fast-trade dims. The only separating field, `buySellRatio` (dim6), is 0.035
  for distributors vs 0.117 for fast-traders — a real gap, but *one weakly-scaled dim* against ~8
  correlated fast-trade dims. **`tokensWithOnlySells` and `exitPattern` — the direct sell-skew
  signals — are excluded from the vector.**
- **PURE_HOLDER → 72% LOW_ACTIVITY.** The vector conflates "holds and won't sell" with "barely
  trades." A holder's distinguishing dims *exist and are extreme* (onlyBuys ratio dim29=1.0,
  pctInHoldings dim24=1.0, medHoldTime dim3=0.0) but are outnumbered by the fast-trade bloc, and
  there is **no holding-conviction/magnitude dim** to say "holds a *valued* position" vs "has
  nothing."

Per-type dim means (reproduce):
```sql
SELECT wbp."strategyType", count(*),
  round(avg((wv."sourceVector"->>7)::float8)::numeric,3)  d8_pct1h,
  round(avg((wv."sourceVector"->>20)::float8)::numeric,3) d21_bothbuysell,
  round(avg((wv."sourceVector"->>28)::float8)::numeric,3) d29_onlybuys,
  round(avg((wv."sourceVector"->>5)::float8)::numeric,3)  d6_buysellratio
FROM "WalletVector" wv JOIN "WalletBehaviorProfile" wbp ON wbp."walletAddress"=wv."walletAddress"
WHERE wbp."strategyType" IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;
```

### 2C. Redundancy — near-collinear dim pairs (|r| ≥ 0.5, computed over all 64,378)

Top of the list (full 496-pair scan; abbreviated):

| pair | r | meaning |
|:--|--:|:--|
| dim8 ↔ dim32 | **0.980** | dim32 = dim8 × flipper ≈ duplicate of dim8 |
| dim21 ↔ dim29 | **−0.951** | both-buy/sell vs only-buys — mechanically complementary |
| dim8 ↔ dim9 | **0.944** | %<1h vs %<4h — nested thresholds |
| dim7 ↔ dim14 | **0.931** | sequenceConsistency vs completePairsRatio |
| dim9 ↔ dim32 | 0.900 | fast-trade bloc |
| dim2 ↔ dim32 | 0.898 | flipper × its own components |
| dim2 ↔ dim8 | 0.896 | flipperScore ≈ %<1h |
| dim3 ↔ dim20 | −0.867 | medianHoldTime vs velocityScore (velocity is inverse-hold) |
| dim3 ↔ dim4 | 0.775 | two hold-duration encodings |
| dim11 ↔ dim13 | 0.726 | sessionCount vs uniqueTokens (activity magnitude) |
| dim16↔25, 17↔18, 17↔26, 18↔19 | 0.45–0.50 | the DEAD mcap dims correlate only with *each other* |

The dead mcap dims form an isolated island (correlate with nothing but each other). The fast-trading
bloc — dims {2,7,8,9,14,20,21,29,32} — is a tangle of 0.6–0.98 correlations; effectively ~2–3
independent axes carried by ~9 dims. **That is the over-weighting that drowns the holding axis.**

### 2D. Ranked "which dims earn their place"

**Earn their place (distinct, populated, load-bearing):** dim3 (medianHoldTime), dim5 (winRate — the
only PnL-ish signal), dim6 (buySellRatio — the *only* sell-skew signal, under-weighted), dim8 (%<1h,
canonical fast), dim10 (reentryRate), dim11 (sessionCount), dim12 (avgTradesPerSession), dim13
(uniqueTokens), dim15 (avgTradesPerToken), dim22 (unpairedTokens), dim23 (sessionDuration), dim24
(pctInHoldings — with caveat), dim27 (dominantMcapBucketShare — populated mcap toe-hold), dim28
(avgEntryMcap — populated), dim29 (onlyBuys — accumulation), dim31 (activeTradingDays).

**Redundant (collapse/re-weight down):** dim2 (flipperScore, 0.90 w/ dim8), dim7 (0.93 w/ dim14),
dim9 (0.94 w/ dim8), dim14 (0.93 w/ dim7), dim20 (velocityScore, 0.87 w/ dim3), dim32 (0.98 w/ dim8).
Six dims encoding ~two ideas.

**Dead (bug):** dim16, 17, 18, 19, 25, 26 (mcapDistribution key drift).

**Missing complementary axis (NOT a wrong field):** dim30 (`medianActiveHoldingHours`, open-position
conviction) is legit and stays; `medianCompletedHoldTimeHours` (closed-round-trip exit tempo, r=0.11)
is missing and should be ADDED as its own dim. See 1E correction.

**Missing (the holding/distribution blindness):** no sell-skew dim (`tokensWithOnlySells` / sell
fraction / `exitPattern`), no holding-conviction/magnitude dim, no `averageSessionStartHour`
(schedule), no populated mcap-distribution shape (`entryMcapDistributionByCount` exists and is
populated).

### 2E. `percentOfValueInCurrentHoldings` (dim24) — symptom-not-trait caveat (confirmed direction)

Per-type means: FAST_TRADER 0.645 vs PURE_HOLDER 1.000 vs BALANCED 0.963. The dim reads *low* for a
high-churn wallet largely **because** it churns (little value ever sits in holdings), so it partly
re-encodes churn rather than an independent "holds value" trait. It still separates the extremes, so
keep it — but do not treat it as an independent holding-conviction axis; a dedicated magnitude-aware
dim would be cleaner.

---

## PART 3 — Recommendation (recommend, don't decide)

### 3A. Per-dim action

| Dim(s) | Action | Reason |
|:--|:--|:--|
| 16,17,18,19,25,26 | **DROP or FIX-then-KEEP** | Dead via key drift. Either delete the 6 mcap-distribution dims, or fix `readMcapDistribution` to read the real `0-10k…1m+` keys (or `entryMcapDistributionByCount`) — then they become a real mcap axis. **Fixing is the higher-value option** since it restores the intended mcap axis for free. (Bug filed; not fixed here.) |
| 30 | **KEEP + ADD sibling** | `medianActiveHoldingHours` (open-position conviction) stays; ADD `medianCompletedHoldTimeHours` (closed round-trip exit tempo) as a **separate** dim. r=0.11 → orthogonal universes (open vs closed tokens), not substitutes. Earlier "replace" call was a category error (corrected §1E). |
| 32 | **DROP** | 0.98 corr w/ dim8; adds no independent signal. |
| 9 | **DROP or MERGE** | 0.94 corr w/ dim8; keep one fast-threshold dim, not two. |
| 2, 20 | **RE-WEIGHT DOWN or DROP** | flipperScore & velocityScore are repackagings of dim8/dim3. |
| 7 or 14 | **DROP one** | 0.93 correlated; keep one. |
| 6 | **RE-WEIGHT UP** | The only sell-skew signal, currently drowned; central to fixing DISTRIBUTOR. |
| all | **CONSIDER SUPERVISED WEIGHTS** | The geometry is unweighted post-standardization; the fast-trade bloc's sheer count dominates. Even a hand-set per-axis weight (down-weight the fast bloc, up-weight sell-skew/holding) would raise DISTRIBUTOR/PURE_HOLDER purity. Descriptive-only here; no ML performed. |

### 3B. Excluded metrics that deserve dimensionality (with behavioral reason)

1. **`tokensWithOnlySells` (as a ratio) — HIGHEST VALUE.** Directly separates DISTRIBUTOR (sell-only
   skew) from FAST_TRADER (balanced). This single dim most directly fixes the 53% DISTRIBUTOR→FAST
   confusion. The vector has `tokensWithOnlyBuys` (dim29) but not its sell-side mirror.
2. **`exitPattern` (encoded ordinal) or a sell-concentration metric.** Distinguishes gradual
   distribution vs all-at-once dumps — a real behavior axis the vector cannot express.
3. **`medianCompletedHoldTimeHours`** — ADD as a dim alongside dim30 (not replacing it); closed
   round-trip exit tempo, orthogonal to the open-position conviction dim30 already carries (r=0.11).
4. **`averageSessionStartHour` (as sin/cos pair).** Timezone / bot-schedule signal; currently the
   vector cannot tell a US-hours human from a 24/7 bot with identical trade stats. Cheap, orthogonal.
5. **`entryMcapDistributionByCount` (populated) or fixed `mcapDistribution`.** Restores the intended
   mcap-positioning axis — nano-cap degen vs large-cap rotator is a first-order behavioral difference.
6. **`confidenceScore` — as a similarity *weight*, not a dim.** Down-weight low-confidence profiles
   in kNN rather than embedding certainty into the geometry.

### 3C. The open question — should a bounded magnitude/money axis exist?

**Recommend, don't decide.** Today the vector is pure-behavior: no portfolio value, trade size, or
PnL magnitude (only dim5 winRate, a *rate* not a magnitude). Consequence: PURE_HOLDER (holds a real
bag) is indistinguishable from LOW_ACTIVITY (holds nothing) — 72% confusion — because the separating
fact is *magnitude of holdings*, which the vector structurally cannot encode.

- **For a bounded magnitude axis:** it would fix the single worst confusion (holder vs inactive) and
  let cohort/reputation surfaces ask "big holder like X" without a second query. Bounded (log +
  clamp) so a whale doesn't dominate cosine geometry. `riskMetrics.averageTransactionValueSol` and
  `percentOfCurrentPortfolioValue` are populated candidates.
- **Against:** it dilutes the clean "judge by *what they do*, not *who they are*" thesis, is
  vulnerable to inter-wallet-transfer distortion (money-magnitude is exactly where the untracked-flow
  problem bites), and money questions are already answerable from PnL tables per-query.

**My lean:** keep the *core* vector pure-behavior, but add **one bounded holding-conviction dim** (a
clamped magnitude proxy) specifically to break the PURE_HOLDER/LOW_ACTIVITY tie — the minimum
magnitude signal that fixes the worst blindness without turning the vector into a portfolio-value
embedding. Answer richer money questions from PnL tables separately. This is a recommendation for the
owner to rule on, not a decision.

---

## Reproduce everything
All queries above run as single `psql` reads against :5434. No temp objects persist; each `CREATE
TEMP TABLE` is scoped to its session. No vector code, migration, or materializer was touched. The
`sourceVector` jsonb (raw 32) drives descriptive stats; the `vector` column (standardized, HNSW)
drives neighbor/purity queries.
