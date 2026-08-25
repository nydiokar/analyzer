# SPEC-003 — Capital Trajectory & Drift-Precedence (the moat)

**Status:** DRAFT · **Filed:** 2026-07-14 · **Lane:** RESEARCH → BUILD (own spec, NOT an AGENT_13 task)
**Origin:** the transformational move in `.ai/context/ADVANCED_APPLICATIONS_2026-07-13.md` §F, promoted to
its own spec per the owner review (`.ai/context/AGENT_13_DELIVERABLES_CONSOLIDATED_2026-07-14.md` §5).

## 1. The thesis
The representation program broke one assumption ("a wallet = one vector") by splitting behavior from
capital. This spec breaks the next: **"both vectors are static."** We already version behavior
(`WalletVectorHistory`, ~64k+ rows, self-populating). We do NOT version capital (`WalletCapitalVector`
is a snapshot, no history table). Add capital history → each wallet becomes TWO trajectories through
two spaces over time.

The killer question this unlocks — the deepest, least-copyable asset in the program:
> **Does a DRIFT in a wallet's BEHAVIOR vector PRECEDE a change in its CAPITAL outcome?**

If yes, we detect a pro going cold (or a wallet leveling up) **before the PnL confirms it** — a leading
indicator, not a lagging report. This is SPEC-002's "several steps ahead" (Act 2) made concrete, and the
part competitors cannot cheaply copy: they can replicate features, not a longitudinal two-space history.

## 2. Why it's its own spec (not folded into AGENT_13)
- It requires NEW additive substrate (`WalletCapitalVectorHistory`), a live-write-path extension, and
  time — AGENT_13 is descriptive-only and read-mostly.
- Its payoff is temporal and needs a forward window; it can only be proven properly after history
  accumulates (see §5).

## 3. Substrate (additive, mirrors the behavior lane)
- `WalletCapitalVectorHistory` — mirror `WalletVectorHistory`: `(wallet, schemaVersion, hash,
  driftFromPrevious, snapshottedAt, sourceVector)`, index by wallet newest-first, idempotent on
  `(wallet, schemaVersion, hash)`. Reuse the proven behavior-history machinery — do NOT invent new.
- Extend the capital live-write-path (the `WalletCapitalVector` upsert) to append history on
  source-change, exactly as `upsertWalletBehaviorProfile → appendWalletVectorHistory` does.
- Drift computed over the **raw source capital vector**, population-invariant — carry the SPEC002_T01
  adversarial fix forward (drift over raw, not the standardized storage vector) or repeat the bug.

## 4. Research questions (once history exists)
- R1 **Behavior-drift → capital-outcome precedence:** cross-correlate behavior `driftFromPrevious` at t
  against capital-outcome change at t+k. Is there a positive lead? At what lag k?
- R2 **Regime-change detection:** does a spike in behavior drift mark a wallet changing strategy, and
  does the capital trajectory bend after it?
- R3 **Capital drift as its own signal:** does capital-vector drift (magnitude/consistency shifting)
  flag a wallet entering/leaving the skilled quadrant (ties to AGENT_13's 2×2)?

## 5. Data reality (operator, 2026-07-14)
- The :5434 copy is real prod data; server is live and gathering; a fresh backfill is coming.
- Behavior history already accumulates. Capital history starts accumulating the day §3 lands — so the
  precedence study (§4) is **gated on elapsed time / the next backfill**. That is expected. Land the
  substrate EARLY so the clock starts; run the research when the window exists. Backfilling capital
  history retroactively is possible only where prior capital snapshots are reconstructable — note the
  limits, don't assume full retro history.

## 6. Guards
- Additive-only substrate. Descriptive/statistical research first — NO learned metric (SPEC-002 Act 3
  stays label-NO-GO per SPEC002_T03).
- Every capital point carries `dataQuality`; drift on transfer-distorted PnL is not signal.
- "behavioral fingerprint" / "coordinated" language only — never "same person".

## 7. Sequencing
Substrate (§3) can land any time — cheap, additive, unblocks the clock. Research (§4) waits on the
window. This spec is DOWNSTREAM of AGENT_13 (which establishes the honest static picture first) but the
§3 substrate need not wait for AGENT_13 to finish.
