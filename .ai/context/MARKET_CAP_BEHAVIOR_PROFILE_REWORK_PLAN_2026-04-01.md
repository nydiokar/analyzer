# Market Cap Behavior Profile Rework Plan

**Date:** 2026-04-01  
**Status:** Proposed implementation plan  
**Scope:** Wallet behavior profile, HUD/API contract, dashboard presentation, token-level mcap summaries  
**Goal:** Replace misleading market cap behavior signals with robust, persisted, future-proof summaries using the enriched swap data already in the system.

---

## 1. Problem Statement

The current market cap enrichment work is not failing at raw data collection. The raw data is already useful:

- `SwapAnalysisInput.marketCapUsd`
- `SwapAnalysisInput.mcapBucket`
- `SwapAnalysisInput.usdValue`

The failure is in the summary layer and how the product presents that summary.

Today the wallet HUD combines:

- `avgEntryMcap`: volume-weighted arithmetic mean of buy-side market cap
- `preferredMcapBucket`: bucket where the most buy-side USD was deployed

Those two values answer different questions, but the UI currently presents them together as though they describe the same thing. This produces misleading combinations such as:

- `$12.7M Avg Entry Mcap (Early Seed)`

That output is mathematically possible under the current code, but behaviorally misleading and product-wise unacceptable.

This is not a cosmetic issue. It makes the market cap profile practically unusable for:

- wallet HUD interpretation
- analyst trust
- filtering wallets by preferred market cap zone
- token-level holder behavior views
- future API/SDK usage

---

## 2. Current State Verified In Code

### 2.1 Raw enrichment is already correct enough to build on

Market context enrichment stores per-swap mcap data on `SwapAnalysisInput`. This is the correct foundation and should remain the foundation.

### 2.2 Wallet-level summary is where the distortion is introduced

Current wallet behavior profile logic computes:

- `avgEntryMcap` as buy-side USD-weighted arithmetic mean
- `preferredMcapBucket` as highest-volume bucket
- `mcapDistribution` as bucket share by USD
- `mcapBucketPnl` as per-bucket realized pnl summary

This means the system already stores some useful distribution data, but the surfaced metric is the wrong primary signal.

### 2.3 Token-level summary has the same weakness

`AnalysisResult.avgEntryMcap` and `AnalysisResult.avgExitMcap` are also arithmetic means weighted by USD. This creates the same distortion problem at token level.

### 2.4 The system already contains partial building blocks

We are not starting from zero. The system already has:

- raw enriched mcap data on swaps
- persisted bucket-level wallet distribution
- persisted bucket-level wallet pnl
- token-level avg entry/exit mcap
- HUD integration path for fast reads from persisted wallet profile

The problem is not lack of data. The problem is choosing and presenting the wrong summary.

---

## 3. Core Product Decision

For behavioral metrics, the primary question is:

> What market cap zone does this wallet typically trade in?

The current arithmetic mean does **not** answer that well.

The correct primary behavioral summary should be:

- **weighted median entry mcap**

And the correct supporting summary should be:

- **weighted percentile band** (`p25`, `p75`)
- **bucket distribution by USD**
- **bucket distribution by count**
- **dominant bucket share**

The arithmetic mean can still exist, but only as a secondary economic metric:

- where capital was deployed on average

It should no longer be presented as the wallet's main behavior signal.

---

## 4. Replace / Keep / Remove Decisions

This section explicitly answers:

- do we already do it and should we replace it
- what becomes unnecessary or toy-like
- are we treating this holistically

### 4.1 Keep

Keep these as the canonical raw/base data:

- `SwapAnalysisInput.marketCapUsd`
- `SwapAnalysisInput.mcapBucket`
- `SwapAnalysisInput.usdValue`

Keep these persisted structures because they are useful and future-facing:

- `WalletBehaviorProfile.mcapDistribution`
- `WalletBehaviorProfile.mcapBucketPnl`
- `AnalysisResult.avgEntryMcap`
- `AnalysisResult.avgExitMcap`

But some of them must be re-positioned, not treated as the main answer.

### 4.2 Replace as primary signals

Replace these as the primary behavior-facing summary:

- wallet HUD usage of `avgEntryMcap`
- wallet profile wording that treats mean mcap as "typical"
- token-level interpretation that assumes avg entry/exit mcap is behaviorally representative

### 4.3 Demote

Demote these to secondary/economic metrics:

- `avgEntryMcap`
- `avgExitMcap`

They remain valid, but should be named and used as capital-weighted averages, not as "typical behavior."

### 4.4 Add

Add these robust persisted summaries:

- `typicalEntryMcapUsd` (weighted median)
- `entryMcapP25Usd`
- `entryMcapP75Usd`
- `dominantEntryMcapBucket`
- `dominantEntryMcapBucketShare`
- `entryMcapDistributionByCount`
- `entryMcapSampleSizeBuys`
- `entryMcapSampleSizeTokens`

Wallet-level only at first:

- `marketCapProfile` API shape built from persisted fields

Token-level also, but with least-action discipline:

- `typicalEntryMcapUsd`
- `typicalExitMcapUsd`

Optional in the same rollout if implementation stays tight:

- `entryMcapP25Usd`
- `entryMcapP75Usd`
- `exitMcapP25Usd`
- `exitMcapP75Usd`

### 4.5 Remove or stop surfacing

These should stop being first-class product messaging:

- `Avg Entry Mcap` as the headline HUD value
- pairing a mean-based scalar with a bucket label as if they describe the same thing
- semantic bucket labels as the only visible label when numeric ranges are the real truth

This is where the current output crosses into "toy" territory. The data is real; the presentation is oversimplified.

---

## 5. Proposed Minimal Data Model Changes

The objective is additive schema changes, not a refactor of the enrichment pipeline.

### 5.1 `WalletBehaviorProfile`

Add:

- `typicalEntryMcapUsd Float?`
- `entryMcapP25Usd Float?`
- `entryMcapP75Usd Float?`
- `dominantEntryMcapBucket String?`
- `dominantEntryMcapBucketShare Float?`
- `entryMcapDistributionByCount Json?`
- `entryMcapSampleSizeBuys Int?`
- `entryMcapSampleSizeTokens Int?`

Keep existing:

- `preferredMcapBucket`
- `avgEntryMcap`
- `mcapDistribution`
- `mcapBucketPnl`

Transition plan:

- new code writes both old and new fields for one rollout cycle
- HUD/dashboard stop relying on `avgEntryMcap` as primary
- later we can decide whether `preferredMcapBucket` should be deprecated in favor of `dominantEntryMcapBucket`

### 5.2 `AnalysisResult`

Add:

- `typicalEntryMcapUsd Float?`
- `typicalExitMcapUsd Float?`

Optional in phase 1 if the write path remains simple:

- `entryMcapP25Usd Float?`
- `entryMcapP75Usd Float?`
- `exitMcapP25Usd Float?`
- `exitMcapP75Usd Float?`

Keep existing:

- `avgEntryMcap`
- `avgEntryMcapBucket`
- `avgExitMcap`
- `avgExitMcapBucket`

Reason:

- token-level surfaces will need robust summaries too
- this avoids a later "7th refactor" when token performance or holder views need the same quality standard
- but wallet-level correctness is the mandatory first-order fix, so token-level percentile persistence should not be allowed to bloat the rollout if it starts pulling in too much surrounding work

---

## 6. Calculation Method

### 6.1 Wallet-level primary metric

For buy-side rows with:

- `direction = 'in'`
- `usdValue != null`
- `marketCapUsd != null`
- excluded mints filtered out

Compute:

- weighted median of `marketCapUsd` using `usdValue` as the weight
- weighted 25th percentile
- weighted 75th percentile

This gives:

- a robust "typical" number
- a normal operating band
- resistance to a few very high market cap outliers

### 6.2 Wallet-level distribution

Compute both:

- bucket share by total buy-side USD
- bucket share by count of buy trades

Why both matter:

- USD share shows where capital conviction lives
- count share shows what the wallet does most often

### 6.3 Dominant bucket

Dominant bucket should come from buy-side USD share, because that aligns with deployed capital.

Also persist:

- dominant bucket share

This lets the product distinguish:

- strong profile: one bucket dominates
- mixed profile: no bucket dominates

Guardrail:

- do not present a bucket as the wallet's clean identity unless `dominantEntryMcapBucketShare` clears a concentration threshold
- recommended starting threshold: `>= 0.50` for a strong profile
- below that threshold, the HUD should present the profile as mixed

### 6.4 Token-level summary

Apply the same percentile logic to entry and exit rows per token.

### 6.5 Arithmetic mean

Keep computing the arithmetic mean if needed, but clearly treat it as:

- `capitalWeightedAvgEntryMcapUsd`
- `capitalWeightedAvgExitMcapUsd`

This is still useful for economic analysis, but it is not the behavior headline.

### 6.6 Sample quality and nullability rules

This was under-specified in the first draft and needs to be explicit.

Recommended rule set:

- if fewer than `3` eligible buy rows exist, do not persist or surface a market cap profile
- if fewer than `2` distinct tokens contribute, do not present strong behavioral wording
- always persist sample sizes alongside the summary
- HUD should avoid fake precision when sample size is weak

This is standard analytical hygiene and prevents another class of misleading outputs.

---

## 7. API Contract Direction

The HUD/API should stop exposing only isolated mcap fields and should expose a coherent object.

### 7.1 Additive HUD contract

Proposed additive object:

```ts
marketCapProfile?: {
  typicalEntryMcapUsd?: number;
  entryMcapP25Usd?: number;
  entryMcapP75Usd?: number;
  dominantBucket?: string;
  dominantBucketShare?: number;
  capitalWeightedAvgEntryMcapUsd?: number;
  distributionByVolume?: Record<string, number>;
  distributionByCount?: Record<string, number>;
  sampleSizeBuys?: number;
  sampleSizeTokens?: number;
  concentration?: 'strong' | 'moderate' | 'mixed';
}
```

Mapping from persisted data:

- `typicalEntryMcapUsd` <- new field
- `entryMcapP25Usd` <- new field
- `entryMcapP75Usd` <- new field
- `dominantBucket` <- new field or current `preferredMcapBucket`
- `dominantBucketShare` <- new field
- `capitalWeightedAvgEntryMcapUsd` <- current `avgEntryMcap`
- `distributionByVolume` <- current `mcapDistribution`
- `distributionByCount` <- new field
- `sampleSizeBuys` <- new field
- `sampleSizeTokens` <- new field
- `concentration` <- derived from dominant bucket share

### 7.2 Backward compatibility

Keep existing top-level HUD fields for one cycle:

- `preferredMcapBucket`
- `avgEntryMcap`

But mark them as legacy usage in code comments and stop using them as the main dashboard display.

### 7.3 SDK alignment

The SDK must be updated in the same rollout because it already lags behind backend mcap fields. If we do not update the SDK now, we repeat the same partial-shipping mistake.

---

## 8. Dashboard Presentation Direction

### 8.1 HUD headline

Replace:

- `Avg Entry Mcap: $12.7M (Early Seed)`

With:

- `Typical Entry Mcap: $28k`
- `Range: $14k-$62k`
- `Dominant Bucket: $10k-$20k (58% of buy volume)`

If the profile is mixed:

- `Entry Mcap Profile: Mixed`
- `Top Buckets: $10k-$20k 33%, $20k-$50k 29%`

### 8.2 Labeling

Primary visible label should be numeric range first:

- `$10k-$20k`

Optional semantic subtitle:

- `Early Seed`

The numeric range is the truth. The semantic name is interpretation.

Implementation guardrail:

- bucket label mapping should come from one shared source, not duplicated ad hoc in multiple frontend components
- the current duplicated mappings are a maintenance smell and part of how contradictory presentation slips in

### 8.3 Deeper views

The dashboard should later be able to show:

- bucket distribution bar
- dominant bucket
- percentile band
- per-bucket win rate / pnl

This plan deliberately preserves that future path without another data-model redesign.

---

## 9. Why This Is Holistic, Not Just Task Completion

This plan is intentionally broader than "fix the weird HUD string."

It addresses the full chain:

- raw data truth
- summary math
- persistence design
- API contract
- dashboard presentation
- token-level future use
- filtering and segmentation future use
- SDK consistency

If we only patch the label or only swap mean to median in one file, we will repeat the same failure pattern:

- fast local fix
- no coherent product contract
- partial data persisted
- future surfaces blocked
- another refactor later

That would be doing a task. This plan is not that.

---

## 10. Implementation Sequence

### Step 1

Add additive Prisma fields for wallet-level and token-level robust mcap summaries.

### Step 2

Update wallet behavior summary logic to compute:

- weighted median
- weighted p25/p75
- dominant bucket share
- count distribution

while still writing legacy fields.

### Step 3

Update token-level analysis result logic to compute robust entry/exit typical summaries.

If the code change remains contained, also persist token-level percentile bands in the same pass. If not, keep wallet-level percentile bands mandatory and defer only the token-level percentile extras.

### Step 4

Update HUD/API DTOs and service mapping to expose `marketCapProfile`.

### Step 5

Update dashboard HUD rendering to use the new profile object and stop presenting the misleading mean+bucket combination.

### Step 6

Update token/holder dashboard surfaces to use the robust token-level fields where relevant.

### Step 7

Update SDK and docs so the public contract matches the backend.

### Step 8

Rebuild downstream values by rerunning normal analysis paths on affected wallets. No redesign of the raw enrichment process is required.

---

## 11. Guardrails

- No rewrite of the enrichment pipeline
- No major architecture change
- No fabricated single-number behavior signal
- No removal of useful existing fields until the new contract is proven
- Persist the right summaries so HUD remains fast
- Prefer additive rollout over breaking changes
- Do not surface strong behavioral claims without sample-size and concentration checks
- Do not duplicate bucket-label logic across surfaces

---

## 12. Success Criteria

We are done when all of the following are true:

- no HUD can show a contradictory pairing like `$12.7M Avg Entry Mcap (Early Seed)`
- wallet market cap behavior has a robust "typical" persisted summary
- bucket distribution is available for both presentation and future filtering
- token-level market cap summaries are robust enough for future product use
- API, dashboard, and SDK all expose a coherent contract
- future usage of mcap data becomes a product question, not a refactor question

---

## 13. Decision Summary

The market cap enrichment work should not be thrown away. The raw data model is good enough.

What failed was the last-mile productization:

- wrong primary statistic
- misleading combination of metrics
- partial surfacing

The correct fix is a minimal but serious summary-layer rework:

- keep the enriched swaps
- add robust persisted summaries
- expose a coherent market cap profile
- stop pretending one arithmetic mean is "behavior"
