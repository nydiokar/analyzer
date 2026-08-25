# AGENT 15 — Smart-money feed from a capital-defined cohort (+ coordination × capital)

Lane: RESEARCH → BUILD. **Filed 2026-07-14. DEFERRED — do not dispatch until AGENT_13 lands** (needs the
2×2 skilled-cohort definition) and until per-token timestamps are available for the live variant.
Origin: candidates B + E in `.ai/context/ADVANCED_APPLICATIONS_2026-07-13.md`. This is the most
**monetizable** artifact in the program.

**Anchor docs:**
1. `.ai/context/ADVANCED_APPLICATIONS_2026-07-13.md` §B (smart-money feed) + §E (coordination × capital).
2. `.ai/context/AGENT_13_DELIVERABLES_CONSOLIDATED_2026-07-14.md` §5 (why deferred).
3. AGENT_13's `BEHAVIOR_CAPITAL_TYPOLOGY_<date>.md` (the skilled+repeatable quadrant definition — this
   job consumes it, does not redefine it).

## 0. GATE
- AGENT_13 DONE (supplies the capital-defined skilled cohort — do NOT hand-curate a list).
- For the LIVE feed variant: per-token accumulation timestamps must exist. If they don't yet, deliver
  the static concentration signal first and flag the live feed as a follow-up.

## 1. Part B — smart-money concentration signal (static first)
- Take the **capital-DEFINED skilled+repeatable cohort** (from AGENT_13's 2×2, dataQuality-gated) — NOT
  a hand-picked list. The whole point is it's *derived* and self-maintaining via the live write-path.
- Surface what they concentrate in vs population. **Refinement the data already demands** (validated
  live): **exclude stablecoins / infra mints (USDC/USDT/pump.fun mint = ~1.5× = noise); rank by
  ENRICHMENT, not raw holder count.** The real tail is 4–7.5× over-represented — that's the signal.
- Deliverable: ranked token-enrichment list for the skilled cohort, infra-filtered, dq-gated.

## 2. Part B-live — "smart money is accumulating T" feed (needs timestamps)
With per-token accumulation timestamps: convert the static concentration into a **live feed** — when the
derived skilled cohort starts accumulating token T, emit it. Self-maintaining, dataQuality-filtered.
This is the sellable artifact. Gate on timestamp availability.

## 3. Part E — coordination × capital (fuses two owned assets)
We already materialize coordination clusters (`WalletCluster`/`WalletClusterMembership`) and now have
capital quality per wallet. **Condition the cluster rings on the cluster's capital quality:**
- a KNOWN-PROFITABLE cluster starting to co-buy a token = a leading indicator (epidemiology index-case
  transfer), qualitatively different from a random-wallet cluster co-buying.
- Deliverable: cluster-level capital-quality score + a "profitable ring is accumulating T" signal,
  distinct from noise-ring co-occurrence.

## 4. Deliverable file
`.ai/context/SMART_MONEY_FEED_<date>.md` + additive read helper/script on :5434 (no /intel contract
change without an explicit surfacing decision; mirror the `/wallets/...` off-contract posture used by
AGENT_10 if a dashboard/API surface is wanted).

## 5. Hard guards
- Cohort is DERIVED (behavior+capital), never a curated list. dataQuality-gated throughout.
- Infra/stablecoin filter is mandatory (raw holders = noise, proven).
- Descriptive. No metric learning. Additive-only.
- "coordinated" / "behavioral fingerprint" language — never "same person".

## 6. Cost
Research-Medium → BUILD-Small for the static signal; the live feed is a larger follow-up gated on
timestamps. Monetization-relevant — flag for product/GTM once the static signal proves out.
