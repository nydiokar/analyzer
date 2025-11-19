# Current State: Onchain Metadata Enrichment

**Branch:** `feature`
**Date:** November 19, 2025
**Status:** Holder Risk profiles

---

## What Just Happened
PERFECT! I see exactly what you're saying:

  The Current Problem:

  Holder Profiles (Our New System):

  - Shows: N/A for wallets with <3 completed exits
  - Uses: Only EXITED tokens (completed buy-sell cycles)
  - Ignores: Tokens still held

  Behavioral Patterns (Existing System):

  - Shows: AVG CURRENT HOLD DURATION: 1013.56 hours
  - Shows: MEDIAN CURRENT HOLD TIME: 1355.49 hours
  - Includes: Currently held tokens with their current hold duration
  - Shows: 66.5% VALUE STILL HELD

  ---
  The Real Issue:

  Wallet with 0 completed exits but 13 tokens still held:
  - Holder Profiles: Shows N/A (useless!)
  - Behavioral Patterns: Shows 1355 hours median current hold (useful!)

  We have TWO SYSTEMS doing similar things, but one includes still-held and one doesn't!

  ---
  The Solution:

  We should merge both approaches in Holder Profiles:

  1. Primary Metric: "Typical Hold Time" (includes currently held)
    - Combines completed exits + still-held tokens
    - For completed: use actual exit duration
    - For still-held: use current hold duration
  2. Secondary Metric: "Realized Hold Time" (only completed)
    - Only tokens that were exited
    - Shows actual trading behavior (not buy-and-forget)
  3. Remove "Flip Ratio" entirely or replace with:
    - "Exit Rate": % of tokens that have been fully exited
    - "Turnover": How often they trade (trades per day/week)

  ---
  Let me check the legacy system to see how it calculates current holdings:

● Search(pattern: "averageFlipDurationHours", output_mode: "content")
  ⎿  Found 868 lines (ctrl+o to expand)

● Perfect! I found it. The legacy averageFlipDurationHours and current holdings metrics are in the old
  BehaviorAnalyzer (lines 1169+ in the code).

  Let me find where current holdings are calculated:

● Search(pattern: "averageCurrentHoldingDurationHours|medianCurrentHoldingDurationHours", path:
        "src\core\analysis\behavior\analyzer.ts", output_mode: "content", head_limit: 50)
  ⎿  Found 35 lines (ctrl+o to expand)



  QUESTION: > and this legacy system it says that it;s unweighted ... isn't this gonna contradxcict, should we align it with the
  other system or keep it this way - because in the other as I remember it's considering the weight in each cycle. 