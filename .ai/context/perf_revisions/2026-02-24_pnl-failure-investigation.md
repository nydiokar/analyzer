# PnL Failure Investigation
Date: 2026-02-24
Scope: Last 10-day performance/failure review from DB report and PM2 logs

## Trigger
- `db:perf-report --days 10` showed:
  - `AnalysisRun`: 3,889 total, 5 failed
  - Failure signature: `Unknown error, service exited prematurely` (all 5)

## Failed Runs (Exact)
All in `serviceInvoked = PnlAnalysisService`:

1. `id=9162`  
   `runTimestamp=2026-02-20T16:34:47.381Z`  
   `wallet=66T4v43X9yt6TRjBkLwhptt3SPxvdEUqJjiCkFWAqL2f`  
   `durationMs=93`

2. `id=9177`  
   `runTimestamp=2026-02-20T16:35:25.952Z`  
   `wallet=66T4v43X9yt6TRjBkLwhptt3SPxvdEUqJjiCkFWAqL2f`  
   `durationMs=52`

3. `id=10472`  
   `runTimestamp=2026-02-23T13:51:52.236Z`  
   `wallet=EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm`  
   `durationMs=5`

4. `id=10865`  
   `runTimestamp=2026-02-24T01:23:16.193Z`  
   `wallet=2rGrCAmFaNcq4oCGjmD8gDJTtRtHM1T9bgWV3HVDtbKV`  
   `durationMs=9`

5. `id=10883`  
   `runTimestamp=2026-02-24T01:23:43.086Z`  
   `wallet=2rGrCAmFaNcq4oCGjmD8gDJTtRtHM1T9bgWV3HVDtbKV`  
   `durationMs=5`

## PM2 Log Correlation
Relevant log patterns for these wallets/timestamps:
- `No results from SwapAnalyzer for wallet ... Returning empty summary.`
- `No swap analysis input records found for ...`
- Then run persisted as failed with generic message.

Observed in:
- `~/.pm2/logs/sova-backend-api-out.log.4.gz` (Feb 20 wallet)
- `~/.pm2/logs/sova-backend-api-out.log.1` (Feb 23/24 wallets)

No evidence of process crash required to explain these 5 rows.

## Root Cause
In `src/core/services/pnl-analysis-service.ts`, two early-return branches did not set the local run state to `COMPLETED`:
- `swapInputs.length === 0`
- `swapAnalysisResultsFromAnalyzer.length === 0`

`finally` block interprets unresolved `IN_PROGRESS` as failure and writes:
- `status='FAILED'`
- `errorMessage='Unknown error, service exited prematurely'`

Result: false-failure records polluting reliability metrics.

## Fix Implemented
File changed:
- `src/core/services/pnl-analysis-service.ts`

Changes:
- Set `analysisRunStatus = 'COMPLETED'` before return in both early-return branches.
- Explicitly update `analysisRun` as completed in the `No results from SwapAnalyzer` path (duration/signatures/error cleared).

Verification:
- User confirmed `npm run verify` compiles successfully after patch.

## Interpretation Impact
For this 10-day window, the 5 failures are likely misclassified benign/empty-result runs, not true runtime crashes.

## Follow-ups (Recommended)
1. Add explicit queue timing metadata to run notes (`enqueuedAt`, `startedAt`, `waitMs`) to separate queue delay from execution time.
2. Add structured outcome field for benign empty runs (e.g. `NO_SWAP_INPUTS`, `NO_ANALYZABLE_RESULTS`) to avoid generic failure signatures.
3. Add report section for probable redundant recomputes (same wallet repeatedly recomputed with near-identical signature volume).

