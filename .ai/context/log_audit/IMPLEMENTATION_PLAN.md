# Log Refactor — Implementation Plan

> Based on INFO_VERDICT.md audit (94 calls: 27 KEEP / 54 DEBUG / 13 REMOVE)
> SmartFetch completion (helius-sync-service.ts:324 + 432) confirmed KEEP by operator.

---

## Changes by file

### database-service.ts
| Line | Action | Message |
|------|--------|---------|
| 248 | INFO → REMOVE | `Mapping activity log saved with ID: ${logId} for wallet ${walletAddress}` |
| 2086 | INFO → REMOVE | `Created AnalysisRun with ID: ${id}` |
| 2552 | INFO → REMOVE | `Successfully batch upserted ${N} AnalysisResult records.` |
| 679 | INFO → DEBUG | `User created with ID: ${id}` |
| 728 | INFO → DEBUG | `Retrieved ${N} users.` |
| 850 | INFO → DEBUG | `User ${userId} activated successfully.` |
| 875 | INFO → DEBUG | `User ${userId} deactivated successfully.` |
| 934 | INFO → DEBUG | `User ${userId} and all related data deleted.` |
| 961 | INFO → DEBUG | `User ${userId} demo status updated.` |
| 1097 | INFO → DEBUG | `Wallet added to favorites` |
| 1131 | INFO → DEBUG | `Wallet removed from favorites` |
| 1156 | INFO → DEBUG | `Cleared ${N} favorite wallets` |
| 1220 | INFO → DEBUG | `Favorite wallet updated` |
| 2142 | INFO → DEBUG | `AnalysisResult save complete.` |
| 2319 | INFO → DEBUG | `Found ${N} AnalysisResult records for ${walletAddress} on page ${page}` |
| 2968 | INFO → DEBUG | `Successfully upserted ${N} token info records after ${attempts} attempts.` |

### helius-sync-service.ts
| Line | Action | Message |
|------|--------|---------|
| 72 | INFO → REMOVE | `HeliusSyncService instantiated...` |
| 113 | INFO → DEBUG | `[Sync] Wallet entry ensured for ${walletAddress}. Proceeding with sync.` |
| 234 | INFO → DEBUG | `[Sync] SmartFetch Phase 1 (Newer): Completed processing ${N} newer transactions` |
| 287 | INFO → DEBUG | `[Sync] SmartFetch Phase 2 (Older): Completed processing ${N} older transactions` |
| 397 | INFO → DEBUG | `[Sync] Standard Fetch: Completed processing ${N} transactions` |
| 324 | **KEEP** | `[Sync] 🎉 SmartFetch completed for ${walletAddress}: ${finalCount} transactions` |
| 432 | **KEEP** | `[Sync] Standard Fetch completed for ${walletAddress}: ${finalCount} transactions` |

### helius-api-client.ts
| Line | Action | Message |
|------|--------|---------|
| 107 | INFO → REMOVE | `Updated global rate limit interval to ${ms}ms` |
| 110 | INFO → REMOVE | `Initializing HeliusApiClient: Target RPS=...` |
| 902 | INFO → DEBUG | `Phase 1 Telemetry: Pages=${N}, Credits=${C}, Duration=${ms}ms` |
| 1171 | INFO → DEBUG | `Filtered combined transactions down to ${N}` |
| 1924 | INFO → DEBUG | `Fetching all transactions for mint ${mintAddress}` |
| 1926 | INFO → DEBUG | `Time filters: ${JSON.stringify(timeFilters)}` |
| 1940 | **KEEP** | `Fetched ${N} total transactions for mint ${mintAddress} (time-filtered)` |
| 1969 | **KEEP** | `Fetched ${N} total transactions for mint ${mintAddress}` |

### pnl-analysis-service.ts (core)
| Line | Action | Message |
|------|--------|---------|
| 64 | INFO → REMOVE | `PnlAnalysisService instantiated with HeliusApiClient...` |
| 67 | INFO → REMOVE | `PnlAnalysisService instantiated without HeliusApiClient...` |
| 123 | INFO → DEBUG | `[PnlAnalysis] Skipping PnL for registry wallet` |
| 132 | INFO → DEBUG | `[PnlAnalysis] Skipping PnL for detected system wallet` |
| 198 | INFO → DEBUG | `[PnlAnalysis] Retrieved stored balance data for ${walletAddress}` |
| 211 | INFO → DEBUG | `[PnlAnalysis] Using pre-fetched wallet state for ${walletAddress}` |
| 220 | INFO → DEBUG | `[PnlAnalysis] Successfully fetched wallet state for ${walletAddress}` |
| 672 | INFO → DEBUG | `[PnlAnalysis] Upserted WalletPnlSummary (no advanced stats)` |
| 750 | INFO → DEBUG | `[PnlAnalysis] Successfully marked AnalysisRun ${runId} as COMPLETED.` |
| 755 | **KEEP** | `[PnlAnalysis] Analysis completed for ${walletAddress}: ${N} transactions → ${M} tokens, Net PNL: ${P} SOL` |

### wallet-balance-service.ts
| Line | Action | Message |
|------|--------|---------|
| 68 | INFO → DEBUG | `Fetching RAW wallet balances for ${N} addresses.` |
| 247 | INFO → DEBUG | `Address ${address}: Found ${N} missing tokens, attempting recovery...` |
| 284 | INFO → DEBUG | `Address ${address}: Successfully recovered ${N}/${M} missing tokens` |
| 312 | INFO → DEBUG | `Successfully processed RAW wallet balance fetching for ${N} addresses` |
| 381 | INFO → DEBUG | `Enriching ${N} unique tokens with metadata` |
| 406 | INFO → DEBUG | `Successfully enriched wallet balances with metadata for ${N} wallets` |

### analysis-operations.processor.ts
| Line | Action | Message |
|------|--------|---------|
| 85 | INFO → DEBUG | `AnalysisOperationsProcessor has been initialized` |
| 149 | INFO → DEBUG | `Starting PnL analysis for ${walletAddress}` |
| 282 | INFO → DEBUG | `Starting behavior analysis for ${walletAddress}` |
| 577 | INFO → DEBUG | `Using cached SOL price fallback for PNL analysis` |
| 863 | INFO → DEBUG | `Queued follow-up ${scope} analysis job` |
| 1168 | INFO → DEBUG | `Skipped analysis for ${N} known wallets` |
| 1334 | INFO → DEBUG | `Streaming ${N} cached holder profiles immediately` |
| 1357 | INFO → DEBUG | `Batch fetching balances for ${N} stale wallets` |
| 1360 | INFO → DEBUG | `Batch balance fetch complete` |
| 1374 | INFO → DEBUG | `Using priority ${jobPriority} for topN=${topN}` |
| 1410 | INFO → DEBUG | `Queueing ${N} wallet analysis jobs for token ${tokenMint}` |
| 1411 | INFO → REMOVE | `Waiting for ${N} wallet jobs to complete (80% threshold)...` |
| 1607 | INFO → DEBUG | `Skipped holder profile for ${walletAddress} (${knownType})` |
| 1620 | INFO → DEBUG | `Starting holder profile analysis for wallet ${walletAddress}` |
| 1663 | INFO → DEBUG | `Returning cached holder profile for wallet ${walletAddress}` |
| 1729 | INFO → DEBUG | `Syncing wallet ${walletAddress} for holder profile analysis` |
| 1739 | INFO → DEBUG | `Wallet sync completed for ${walletAddress}` |
| 1819 | INFO → DEBUG | `Holder profile analysis for wallet ${walletAddress} completed in ${ms}ms` |
| 2555 | INFO → DEBUG | `Shutting down AnalysisOperationsProcessor worker...` |

### enrichment-operations.processor.ts
| Line | Action | Message |
|------|--------|---------|
| 35 | INFO → REMOVE | `Job ${job.id} completed successfully` (BullMQ worker event) |
| 52 | INFO → DEBUG | `Processing ${jobName} job ${job.id}` |
| 115 | INFO → DEBUG | `Skipping cache write for request ${requestId}` |
| 280 | INFO → DEBUG | `Large wallet: ${address} has ${N} tokens` — wait, this is KEEP per verdict |
| 285 | INFO → DEBUG | `Starting enrichment for ${N} mapped tokens` |
| 287 | INFO → DEBUG | `Starting enrichment for ${N} unique tokens` |
| 355 | INFO → DEBUG | `Processing ${N} mapped tokens for dashboard analysis` |
| 357 | INFO → DEBUG | `Filtered to ${N} meaningful tokens` |
| 367 | INFO → DEBUG | `Found ${N} existing mapped tokens, need to fetch ${M} new/stale` |
| 369 | INFO → DEBUG | `Found ${N} existing tokens, need to fetch ${M} new/stale` |
| 373 | INFO → DEBUG | `Breakdown: ${N} new mapped tokens, ${M} stale mapped tokens` |
| 375 | INFO → DEBUG | `Breakdown: ${N} new tokens, ${M} stale tokens` |
| 403 | INFO → DEBUG | `Enriched batch N of M (X/Y tokens)` |
| 502 | INFO → DEBUG | `Background enrichment completed for ${N} tokens` |
| 544 | INFO → DEBUG | `Shutting down EnrichmentOperationsProcessor worker...` |

### similarity-operations.processor.ts
| Line | Action | Message |
|------|--------|---------|
| 68 | INFO → REMOVE | `Job ${job.id} completed successfully` (BullMQ worker event) |
| 139 | INFO → DEBUG | `Running system wallet detection for ${N} wallets...` |
| 146 | INFO → DEBUG | `System wallet detection complete: ${N} valid, ${M} invalid` |
| 160 | INFO → DEBUG | `Starting sync and balance fetch in TRUE PARALLEL...` |
| 177 | INFO → REMOVE | `Waiting for BOTH sync and balance fetch to complete...` |
| 207 | INFO → DEBUG | `PARALLEL COMPLETION: Sync done, balances for ${N} wallets fetched` |
| 214 | INFO → DEBUG | `Triggering background enrichment job for request: ${requestId}` |
| 219 | INFO → DEBUG | `Enrichment already scheduled for request: ${requestId}. Skipping duplicate.` |
| 239 | INFO → DEBUG | `Background enrichment job queued: ${job.id}` |
| 255 | INFO → DEBUG | `Using valid wallets for similarity calculation: ${N} wallets` |
| 261 | INFO → DEBUG | `Starting final similarity calculation...` |
| 284 | INFO → REMOVE | `Similarity analysis completed successfully.` (redundant with L329) |
| 369 | INFO → DEBUG | `No wallets need sync - skipping deep sync operation.` |
| 373 | INFO → DEBUG | `Orchestrating deep sync for ${N} wallets...` |
| 478 | INFO → REMOVE | `System wallet detection: Using SystemWalletDetectionService (thresholds: 15k LARGE, 70k SYSTEM)` |
| 527 | INFO → DEBUG | `System wallet detection complete: ${N} valid wallets, ${M} wallets filtered` |
| 543 | INFO → DEBUG | `Shutting down SimilarityOperationsProcessor worker...` |

### behavior.service.ts (API layer)
| Line | Action | Message |
|------|--------|---------|
| 33 | INFO → DEBUG | `Skipping behavior analysis for registry wallet` |
| 43 | INFO → DEBUG | `Skipping behavior analysis for detected system wallet` |
| 73 | INFO → DEBUG | `Behavior Cache HIT: ${walletAddress} (fresh)` |
| 79 | INFO → DEBUG | `Behavior Cache STALE: ${walletAddress} - re-analyzing` |
| 87 | INFO → DEBUG | `Behavior Cache HIT: ${walletAddress} (TTL fallback)` |

### core/behavior-service.ts
| Line | Action | Message |
|------|--------|---------|
| 183 | INFO → DEBUG | `Skipping WalletBehaviorProfile upsert...` |
| 187 | INFO → REMOVE | `Completed behavior analysis for ${walletAddress}` (duplicate of processor L354) |

### analyzer.ts (core/analysis/behavior/)
| Line | Action | Message |
|------|--------|---------|
| 1512 | INFO → DEBUG | `Scam token filtering: Processed ${N} tokens, filtered out ${M} scam tokens` |

### similarity.service.ts (API)
| Line | Action | Message |
|------|--------|---------|
| 28 | INFO → DEBUG | `Received request to run comprehensive similarity analysis` |

### token-info.service.ts
| Line | Action | Message |
|------|--------|---------|
| 41 | INFO → REMOVE | `TokenInfoService initialized with price caching` |
| 114 | INFO → DEBUG | `[Token Supply] Fetched and cached ${tokenMint}` |
| 393 | INFO → DEBUG | `All tokens already have recent metadata` |
| 401 | INFO → DEBUG | `Enriching ${N} tokens (onchain: ${M}, prices: ${P})` |
| 437 | INFO → DEBUG | `DexScreener Stage complete` |
| 462 | INFO → DEBUG | `Token enrichment INITIATED in ${ms}ms` |
| 514 | INFO → DEBUG | `Batch saved ${N} new + ${M} updated tokens` |
| 576 | INFO → DEBUG | `Upserting ${N} token info records.` |
| 580 | INFO → DEBUG | `Successfully upserted ${N} token info records.` |

### holder-profiles-cache.service.ts
| Line | Action | Message |
|------|--------|---------|
| 87 | INFO → DEBUG | `Redis connected for holder profiles cache` |
| 88 | INFO → DEBUG | `Redis ready for holder profiles cache operations` |
| 90 | INFO → DEBUG | `Redis reconnecting for holder profiles cache...` |
| 157 | INFO → DEBUG | `Invalidated wallet holder profile cache` |
| 201 | INFO → DEBUG | `Invalidated ${N} token holder profile cache(s)` |
| 217 | INFO → DEBUG | `Invalidated ${N} holder profile cache(s) for token` |
| 229 | INFO → DEBUG | `Cleared ${N} holder profile cache entries` |
| 452 | INFO → DEBUG | `Snapshot check for ${tokenMint}: ${N} fresh, ${M} stale` |
| 485 | INFO → DEBUG | `Serving cached holder snapshot for wallet ${walletAddress}` |
| 588 | INFO → REMOVE | `Cache metrics reset` |

### dexscreener-service.ts
| Line | Action | Message |
|------|--------|---------|
| 81 | INFO → DEBUG | `Pre-filtered ${N} tokens likely not in DexScreener` |
| 85 | INFO → DEBUG | `All tokens were pre-filtered as unlikely to be in DexScreener` |
| 126 | INFO → DEBUG | `DexScreener progress: ${X}%` |
| 427 | INFO → DEBUG | `Pre-filter: After scam filter - ${N} tokens remain` |

### onchain-metadata.service.ts
| Line | Action | Message |
|------|--------|---------|
| 216 | INFO → DEBUG | `Fetching basic metadata for ${N} tokens via DAS API` |
| 234 | INFO → DEBUG | `Successfully fetched basic metadata for ${N}/${M} tokens` |

---

## What INFO looks like after (golden reference)

For a 20-wallet holder-profiles job, all INFO output:

```
[AnalysisOperationsProcessor] Starting token holder orchestration for <mint> [topN=20]

# Per wallet (×20, one PnL outcome each):
[PnlAnalysisService] [PnlAnalysis] Analysis completed for <wallet>: 1479 txns → 85 tokens, Net PNL: -11.25 SOL
[HeliusSyncService] [Sync] 🎉 SmartFetch completed for <wallet>: 792 transactions processed and saved to database.

[AnalysisOperationsProcessor] Token holder orchestration for <mint> completed: 17 analyzed, 2 skipped, 1 failed in 142000ms
```

Total: ~42 INFO lines for 20 wallets (vs 900+ before).

For a single-wallet dashboard analysis through all 3 scopes:

```
[AnalysisOperationsProcessor] Starting dashboard analysis for <wallet> [scope=flash, trigger=user]
[HeliusSyncService] [Sync] 🎉 SmartFetch completed for <wallet>: 249 transactions processed and saved.
[PnlAnalysisService] [PnlAnalysis] Analysis completed for <wallet>: 1479 txns → 85 tokens, Net PNL: -11.25 SOL
[AnalysisOperationsProcessor] Dashboard analysis for <wallet> [scope=flash] completed in 4200ms. Follow-ups queued: working, deep

[AnalysisOperationsProcessor] Starting dashboard analysis for <wallet> [scope=working, trigger=system]
[HeliusSyncService] [Sync] 🎉 SmartFetch completed for <wallet>: 477 transactions processed and saved.
[PnlAnalysisService] [PnlAnalysis] Analysis completed for <wallet>: 2728 txns → 165 tokens, Net PNL: 80.43 SOL
[AnalysisOperationsProcessor] Dashboard analysis for <wallet> [scope=working] completed in 6800ms. Follow-ups queued: deep

[AnalysisOperationsProcessor] Starting dashboard analysis for <wallet> [scope=deep, trigger=system]
[HeliusSyncService] [Sync] 🎉 SmartFetch completed for <wallet>: 748 transactions processed and saved.
[PnlAnalysisService] [PnlAnalysis] Analysis completed for <wallet>: 3403 txns → 202 tokens, Net PNL: 187.08 SOL
[AnalysisOperationsProcessor] Dashboard analysis for <wallet> [scope=deep] completed in 9100ms. Follow-ups queued: none
```

---

## Implementation order

1. `database-service.ts` — biggest noise source (3 REMOVEs + 13 DEBUGs)
2. `helius-api-client.ts` + `helius-sync-service.ts` — phase telemetry cleanup
3. `pnl-analysis-service.ts` — balance state + run ID cleanup
4. `wallet-balance-service.ts` — all 6 → DEBUG
5. `analysis-operations.processor.ts` — per-wallet sub-steps → DEBUG/REMOVE
6. `enrichment-operations.processor.ts` + `similarity-operations.processor.ts` — BullMQ event noise
7. `behavior.service.ts` + `core/behavior-service.ts` + `analyzer.ts` — behavior layer cleanup
8. `token-info.service.ts` + `holder-profiles-cache.service.ts` + `dexscreener-service.ts` + `onchain-metadata.service.ts` — support services

---

## Phase 2 — LLM-native observability (after Phase 1 lands)

This is the target architecture once the noise is cleaned up. Do NOT implement during Phase 1.

### Principle: INFO is a prompt-ready event stream

After Phase 1, INFO is clean enough to hand to an LLM as context. The next step makes it
machine-queryable without string parsing.

### 2a — Structured metadata on all INFO calls

Replace string interpolation with structured second-arg metadata on every KEEP line:

```ts
// Before (current)
logger.info(`[PnlAnalysis] Analysis completed for ${walletAddress}: ${txCount} transactions → ${tokenCount} tokens, Net PNL: ${netPnl} SOL`);

// After (LLM-native)
logger.info('analysis.pnl.completed', {
  wallet: walletAddress,
  txCount,
  tokenCount,
  netPnlSol: netPnl,
  scope,
  durationMs,
  runId,
});
```

The message becomes a stable event key. Fields are queryable. No string parsing needed.
Apply to all 27 KEEP lines. Event key naming convention: `<domain>.<entity>.<outcome>`.

### 2b — LogEventSchema (static contract, enforced in CI)

Extend `scripts/extract-log-statements.ts` to validate INFO calls against an allowlist.
Define `src/config/log-events.ts`:

```ts
export const LOG_EVENT_SCHEMA = {
  // job entry/exit — fires once per job
  'job.holder_profiles.started':   { fields: ['tokenMint', 'topN'] },
  'job.holder_profiles.completed': { fields: ['tokenMint', 'analyzedCount', 'skippedCount', 'failedCount', 'durationMs'] },
  'job.dashboard_analysis.started':   { fields: ['wallet', 'scope', 'trigger'] },
  'job.dashboard_analysis.completed': { fields: ['wallet', 'scope', 'durationMs'] },

  // per-wallet outcomes
  'analysis.pnl.completed':   { fields: ['wallet', 'txCount', 'tokenCount', 'netPnlSol', 'scope', 'runId'] },
  'analysis.pnl.skipped':     { fields: ['wallet', 'reason'] },
  'sync.smartfetch.completed': { fields: ['wallet', 'txCount'] },
  'sync.standardfetch.completed': { fields: ['wallet', 'txCount'] },

  // fast-path / cache outcomes
  'cache.holder_profiles.hit':      { fields: ['tokenMint', 'topN'] },
  'cache.holder_profiles.recompute': { fields: ['tokenMint', 'topN', 'reason'] },

  // error recovery
  'job.enrichment.cancelled': { fields: ['jobId', 'reason'] },
  'job.similarity.cancelled': { fields: ['jobId', 'reason'] },

  // degraded processing signals
  'wallet.large_wallet_detected': { fields: ['wallet', 'tokenCount'] },
  'sync.deep_sync.completed':     { fields: ['successCount', 'totalCount', 'successRate'] },
} as const;
```

CI check: any `logger.info()` call whose message key is not in this schema → build fails.
Prevents INFO level regression without running the app.

### 2c — Dynamic golden contract (log shape validator)

Script at `scripts/validate-log-shape.ts`. After a real job run, parses the log file and asserts:

```ts
// For a holder-profiles job with N wallets:
assertEventCount('job.holder_profiles.started', { eq: 1 });
assertEventCount('analysis.pnl.completed', { eq: N });
assertEventCount('job.holder_profiles.completed', { eq: 1 });
assertNoBannedPatterns([
  /AnalysisRun.*ID:/,
  /Mapping activity log saved/,
  /batch upserted.*AnalysisResult/,
  /Wallet entry ensured/,
  /Fetching RAW wallet balances/,
]);
```

Run manually after deploy or as a smoke test against a staging job.

### 2d — Log-driven alerting (no external tooling required)

With structured events, wire alerts off log patterns using the existing BullMQ/Redis infrastructure:

```ts
// In a log transport or job-events-bridge.service.ts
if (event === 'analysis.pnl.completed' && Date.now() - jobStartTs > 300_000) {
  telegramAlerts.send(`⚠️ Slow job: ${wallet} took ${durationMs}ms`);
}
// Missing completion after timeout:
if (started_wallets.has(wallet) && !completed_wallets.has(wallet) && age > 10min) {
  telegramAlerts.send(`❌ Wallet ${wallet} analysis appears stuck`);
}
```

No Datadog, no external APM. Uses the already-existing `TelegramAlertsService`.

---

## Verification approach

### After Phase 1 (immediate)
- Redeploy backend
- Trigger a holder-profiles job for 20 wallets
- `pm2 logs sova-backend-api | grep " INFO "` — count lines, read them, verify they match the golden reference in this file
- Expected: ~42 INFO lines total (not 900+)

### After Phase 2 (structured events)
- Run `scripts/validate-log-shape.ts` against the log file
- All assertions pass = golden contract confirmed
- Wire into CI: `extract-log-statements.ts --validate` fails on any unregistered INFO call
