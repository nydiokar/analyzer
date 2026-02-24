# INFO Log Verdict

> Audit of live backend INFO-level logs. Target: INFO tells job lifecycle only.
> DEBUG is untouched. No code changes — verdicts only.
>
> **Scope:** Live backend path only — processors, core services, API services called by processors.
> Excludes: pft-bot_v2, scripts, display-utils, formatters, core/index.ts / bot.ts / commands.ts.
>
> **NestJS note:** `this.logger.log(...)` emits at INFO. `logger.info(...)` (createLogger) also emits at INFO.

---

## Summary
- Total INFO calls audited: 94
- KEEP: 27
- DEBUG: 54
- REMOVE: 13

---

## Verdicts

### analysis-operations.processor.ts

| File (short) | Line | Current message (truncated) | Verdict | Reason |
|---|---|---|---|---|
| analysis-operations.processor.ts | 85 | `AnalysisOperationsProcessor has been initialized` | DEBUG | Instantiation log; no diagnostic value after boot |
| analysis-operations.processor.ts | 149 | `Starting PnL analysis for ${walletAddress}` | DEBUG | Start log whose completion (L221) already fires at INFO; this is implied by the job entry |
| analysis-operations.processor.ts | 156–159 | `Skipping PnL analysis for known wallet...` | KEEP | Outcome: job skip with explicit reason — visible once per job |
| analysis-operations.processor.ts | 187 | `Skipping PnL analysis for ${walletAddress} as recent data exists.` | KEEP | Idempotency outcome — tells operator why job was a no-op |
| analysis-operations.processor.ts | 221 | `PnL analysis completed for ${walletAddress}. RunId: ${pnlResult.runId}` | KEEP | Job completion with result ID |
| analysis-operations.processor.ts | 282 | `Starting behavior analysis for ${walletAddress}` | DEBUG | Start log; completion at L354 already at INFO |
| analysis-operations.processor.ts | 289–292 | `Skipping behavior analysis for known wallet...` | KEEP | Outcome: job skip with explicit reason |
| analysis-operations.processor.ts | 354 | `Behavior analysis completed for ${walletAddress}` | KEEP | Job completion boundary |
| analysis-operations.processor.ts | 451–453 | `Starting dashboard analysis for wallet ${walletAddress} [scope=..., trigger=...]` | KEEP | Job entry with all meaningful context (scope + trigger) |
| analysis-operations.processor.ts | 470–473 | `Skipping dashboard analysis for known wallet...` | KEEP | Outcome: job skip |
| analysis-operations.processor.ts | 577 | `Using cached SOL price fallback for PNL analysis: $${solPriceUsd}` | DEBUG | Internal fallback detail; not a job lifecycle event |
| analysis-operations.processor.ts | 752–755 | `Dashboard analysis for ${walletAddress} [scope=...] completed in ${processingTimeMs}ms. Follow-ups queued: ...` | KEEP | Job completion with timing and follow-up chain — key operator signal |
| analysis-operations.processor.ts | 790 | `Cancelling enrichment job ${enrichmentJob.id} due to main analysis failure.` | KEEP | Error recovery action on job failure path |
| analysis-operations.processor.ts | 863–865 | `Queued follow-up ${scope} analysis job ${job.id} for wallet ${walletAddress}` | DEBUG | Internal orchestration detail; the follow-ups are already listed in the completion log at L752 |
| analysis-operations.processor.ts | 1012 | `Starting token holder orchestration for ${tokenMint} [topN=${topN}]` | KEEP | Job entry for holder-profiles job |
| analysis-operations.processor.ts | 1168 | `Skipped analysis for ${knownWalletProfiles.length} known wallets (${tokenMint})` | DEBUG | Internal filtering stat; implied by final completion log |
| analysis-operations.processor.ts | 1194 | `Processing ${largeWallets.length} large wallet(s) (15k-70k tokens)` | KEEP | Operational signal: processing degraded/slow holders; worth knowing |
| analysis-operations.processor.ts | 1265 | `Returning cached holder profiles for ${tokenMint} (topN=${topN})` | KEEP | Cache hit outcome — explains why job is fast |
| analysis-operations.processor.ts | 1269 | `Cached holder profiles incomplete for ${tokenMint}; recomputing` | KEEP | Cache validation failure → recompute; useful diagnostic |
| analysis-operations.processor.ts | 1334 | `Streaming ${readyWallets.length} cached holder profiles immediately` | DEBUG | Internal sub-step detail; implied by final completion log |
| analysis-operations.processor.ts | 1357 | `Batch fetching balances for ${walletsNeedingJobs.length} stale wallets...` | DEBUG | Internal optimization step; not a lifecycle boundary |
| analysis-operations.processor.ts | 1360 | `Batch balance fetch complete - all balances now cached for child jobs` | DEBUG | Sub-step completion implied by job progression |
| analysis-operations.processor.ts | 1374 | `Using priority ${jobPriority} for topN=${topN} (lower=higher priority)` | DEBUG | Internal scheduling parameter |
| analysis-operations.processor.ts | 1410 | `Queueing ${childJobIds.length} wallet analysis jobs for token ${tokenMint}` | DEBUG | Internal batch spawn; final count covered by completion log |
| analysis-operations.processor.ts | 1411 | `Waiting for ${childJobIds.length} wallet jobs to complete (80% threshold)...` | REMOVE | Duplicates L1410 context with zero added signal; pure noise |
| analysis-operations.processor.ts | 1502 | `All holder profiles served from cache; no wallet jobs queued` | KEEP | Meaningful cache-hit outcome (fast path) |
| analysis-operations.processor.ts | 1540–1541 | `Token holder orchestration for ${tokenMint} completed: ${analyzedCount} analyzed, ${skippedCount} skipped, ${failedCount} failed in ${processingTimeMs}ms` | KEEP | Job completion with all metrics |
| analysis-operations.processor.ts | 1607 | `Skipped holder profile for ${walletAddress} (${knownType})` | DEBUG | Per-wallet skip inside token-mode job; fires up to topN times; implied by orchestration skipped count |
| analysis-operations.processor.ts | 1620 | `Starting holder profile analysis for wallet ${walletAddress}` | DEBUG | Per-wallet start; fires once per scope per wallet (3x per 20-wallet job = 60 lines); completion at L1819 is sufficient |
| analysis-operations.processor.ts | 1663 | `Returning cached holder profile for wallet ${walletAddress}` | DEBUG | Per-wallet cache hit; fires N times inside a job |
| analysis-operations.processor.ts | 1729 | `Syncing wallet ${walletAddress} for holder profile analysis (status: ${walletStatus})` | DEBUG | Per-wallet sub-step; sync completion at L1739 is also INFO (both should be DEBUG) |
| analysis-operations.processor.ts | 1739 | `Wallet sync completed for ${walletAddress}` | DEBUG | Per-wallet sub-step completion inside a parent job; fires N times; sync is implied by job completion |
| analysis-operations.processor.ts | 1819 | `Holder profile analysis for wallet ${walletAddress} completed in ${processingTimeMs}ms` | DEBUG | Per-wallet child job completion; fires once per wallet per scope — the primary source of repetition the operator complained about; the token-level completion at L1540 is sufficient |
| analysis-operations.processor.ts | 2555 | `Shutting down AnalysisOperationsProcessor worker...` | DEBUG | Shutdown log; not relevant to job lifecycle |

### wallet-operations.processor.ts

| File (short) | Line | Current message (truncated) | Verdict | Reason |
|---|---|---|---|---|
| wallet-operations.processor.ts | 160 | `Wallet sync completed for ${walletAddress}.` | KEEP | Job completion for sync-wallet job type |

### enrichment-operations.processor.ts

| File (short) | Line | Current message (truncated) | Verdict | Reason |
|---|---|---|---|---|
| enrichment-operations.processor.ts | 35 | `Job ${job.id} completed successfully` (worker 'completed' event) | REMOVE | BullMQ worker event fires for every job; no wallet/token context; pure noise |
| enrichment-operations.processor.ts | 52 | `Processing ${jobName} job ${job.id}` | DEBUG | Entry log with no domain context; job ID alone is not useful to operators |
| enrichment-operations.processor.ts | 101 | `Processing parallel enrichment for ${N} wallets, requestId: ${requestId}` | KEEP | Job entry with domain context |
| enrichment-operations.processor.ts | 115 | `Skipping cache write for request ${requestId} as no new token metadata was fetched.` | DEBUG | Internal optimization detail |
| enrichment-operations.processor.ts | 117 | `Parallel enrichment completed for requestId: ${requestId} (no-op).` | KEEP | Job completion: no-op outcome is worth knowing |
| enrichment-operations.processor.ts | 127 | `Parallel enrichment completed for requestId: ${requestId}. Total processing time: ${ms}ms` | KEEP | Job completion with timing |
| enrichment-operations.processor.ts | 162 | `Job ${job.id} was gracefully cancelled` | KEEP | Explicit cancellation event — error path visibility |
| enrichment-operations.processor.ts | 271 | `Large wallet: ${address} has ${tokenCount} tokens` | KEEP | Operational warning: large wallet processing; helps diagnose slow jobs |
| enrichment-operations.processor.ts | 285 | `Starting enrichment for ${N} mapped tokens (dashboard analysis context)` | DEBUG | Sub-step start with count; implied by job completion |
| enrichment-operations.processor.ts | 287 | `Starting enrichment for ${N} unique tokens` | DEBUG | Sub-step start; same pattern — fires per enrichment job |
| enrichment-operations.processor.ts | 355 | `Processing ${N} mapped tokens for dashboard analysis...` | DEBUG | Sub-step detail; same info as L285/287 |
| enrichment-operations.processor.ts | 357 | `Filtered to ${N} meaningful tokens (${M} filtered out...)` | DEBUG | Internal filter stat |
| enrichment-operations.processor.ts | 367 | `Found ${N} existing mapped tokens, need to fetch ${M} new/stale mapped tokens` | DEBUG | Internal staleness plan; bookkeeping |
| enrichment-operations.processor.ts | 369 | `Found ${N} existing tokens, need to fetch ${M} new/stale tokens` | DEBUG | Duplicate of L367 for non-dashboard context |
| enrichment-operations.processor.ts | 373 | `Breakdown: ${N} new mapped tokens, ${M} stale mapped tokens` | DEBUG | Further breakdown of L367; internal bookkeeping |
| enrichment-operations.processor.ts | 375 | `Breakdown: ${N} new tokens, ${M} stale tokens` | DEBUG | Duplicate of L373 for non-dashboard context |
| enrichment-operations.processor.ts | 403 | `Enriched batch N of M (X/Y tokens)` | DEBUG | Per-batch progress counter inside enrichment loop; fires many times |
| enrichment-operations.processor.ts | 416 | `All mapped tokens already have recent metadata, no API calls needed` | KEEP | Fast-path outcome — explains why job is instant |
| enrichment-operations.processor.ts | 418 | `All tokens already have recent metadata, no API calls needed` | KEEP | Same as L416 for non-dashboard context |
| enrichment-operations.processor.ts | 502 | `Background enrichment completed for ${N} tokens` | DEBUG | Sub-function completion; not a job-level boundary |
| enrichment-operations.processor.ts | 544 | `Shutting down EnrichmentOperationsProcessor worker...` | DEBUG | Shutdown; not job lifecycle |

### similarity-operations.processor.ts

| File (short) | Line | Current message (truncated) | Verdict | Reason |
|---|---|---|---|---|
| similarity-operations.processor.ts | 68 | `Job ${job.id} completed successfully` (worker 'completed' event) | REMOVE | BullMQ event with no domain context; pure noise |
| similarity-operations.processor.ts | 130 | `Starting ADVANCED similarity analysis for ${N} wallets.` | KEEP | Job entry |
| similarity-operations.processor.ts | 139 | `Running system wallet detection for ${N} wallets...` | DEBUG | Sub-step start; outcome at L146 is sufficient |
| similarity-operations.processor.ts | 146 | `System wallet detection complete: ${N} valid, ${M} invalid` | DEBUG | Sub-step completion; result is folded into job completion metadata |
| similarity-operations.processor.ts | 160 | `Starting sync and balance fetch in TRUE PARALLEL...` | DEBUG | Internal implementation detail |
| similarity-operations.processor.ts | 177 | `Waiting for BOTH sync and balance fetch to complete...` | REMOVE | Redundant with L160; zero added signal |
| similarity-operations.processor.ts | 196 | `Recovered ${N} valid wallets after balance fetch error` | KEEP | Error recovery outcome with meaningful context |
| similarity-operations.processor.ts | 207 | `PARALLEL COMPLETION: Sync done, balances for ${N} wallets fetched` | DEBUG | Intermediate milestone; not a job boundary |
| similarity-operations.processor.ts | 214 | `Triggering background enrichment job for request: ${requestId}.` | DEBUG | Sub-step start |
| similarity-operations.processor.ts | 219 | `Enrichment already scheduled for request: ${requestId}. Skipping duplicate.` | DEBUG | Internal dedup bookkeeping |
| similarity-operations.processor.ts | 239 | `Background enrichment job queued: ${job.id} for request: ${requestId}.` | DEBUG | Sub-step completion |
| similarity-operations.processor.ts | 246 | `Enrichment disabled by DISABLE_ENRICHMENT environment variable` | KEEP | Feature flag state — useful for diagnosing missing enrichment |
| similarity-operations.processor.ts | 255 | `Using valid wallets for similarity calculation: ${N} wallets` | DEBUG | Intermediate filter result |
| similarity-operations.processor.ts | 261 | `Starting final similarity calculation...` | DEBUG | Sub-step inside the job |
| similarity-operations.processor.ts | 284 | `Similarity analysis completed successfully.` | REMOVE | Redundant with L329 which includes timing; this fires 2 lines before it |
| similarity-operations.processor.ts | 329 | `Advanced similarity analysis completed successfully in ${ms}ms. Mode: ${mode}` | KEEP | Job completion with timing |
| similarity-operations.processor.ts | 338 | `Cancelling enrichment job ${job.id} due to similarity analysis failure` | KEEP | Error recovery action |
| similarity-operations.processor.ts | 369 | `No wallets need sync - skipping deep sync operation.` | DEBUG | Fast-path note inside deep sync helper |
| similarity-operations.processor.ts | 373 | `Orchestrating deep sync for ${N} wallets with concurrency limit of ${C}...` | DEBUG | Sub-step start inside helper |
| similarity-operations.processor.ts | 430 | `Deep sync completed: ${N}/${M} wallets successful (X%)` | KEEP | Deep sync completion with success rate |
| similarity-operations.processor.ts | 478 | `System wallet detection: Using SystemWalletDetectionService (thresholds: 15k LARGE, 70k SYSTEM)` | REMOVE | Static string with no dynamic data; describes behavior, not event |
| similarity-operations.processor.ts | 524 | `Processing ${N} large wallet(s) (15k-70k tokens)` | KEEP | Operational signal: degraded processing |
| similarity-operations.processor.ts | 527 | `System wallet detection complete: ${N} valid wallets, ${M} wallets filtered` | DEBUG | Duplicate of L146 (same detection, different caller path) |
| similarity-operations.processor.ts | 543 | `Shutting down SimilarityOperationsProcessor worker...` | DEBUG | Shutdown; not job lifecycle |

### helius-sync-service.ts

| File (short) | Line | Current message (truncated) | Verdict | Reason |
|---|---|---|---|---|
| helius-sync-service.ts | 72 | `HeliusSyncService instantiated with provided HeliusApiClient and SmartFetchService.` | REMOVE | Instantiation log; fires at startup; not a job event |
| helius-sync-service.ts | 113 | `[Sync] Wallet entry ensured for ${walletAddress}. Proceeding with sync.` | DEBUG | Sub-step before actual sync; fires 3x per wallet (once per scope); implied by SmartFetch completed |
| helius-sync-service.ts | 152–153 | `[SmartFetch] Limiting fetch for...` (inside disabled block) | REMOVE | Dead code — inside commented-out block; never executes |
| helius-sync-service.ts | 234 | `[Sync] SmartFetch Phase 1 (Newer): Completed processing ${N} newer transactions for ${walletAddress}.` | DEBUG | Phase sub-step; fires per wallet per scope (3x per wallet in holder-profiles); final SmartFetch completion at L324 is sufficient |
| helius-sync-service.ts | 287 | `[Sync] SmartFetch Phase 2 (Older): Completed processing ${N} older transactions...` | DEBUG | Phase sub-step; same reasoning as L234 |
| helius-sync-service.ts | 324 | `[Sync] SmartFetch completed for ${walletAddress}: ${finalCount} transactions processed and saved to database.` | KEEP | Final per-sync completion with total count — the one meaningful sync summary |
| helius-sync-service.ts | 397 | `[Sync] Standard Fetch: Completed processing ${N} transactions for ${walletAddress}.` | DEBUG | Intermediate count; L432 is the final summary |
| helius-sync-service.ts | 432 | `[Sync] Standard Fetch completed for ${walletAddress}: ${finalCount} transactions processed and saved to database.` | KEEP | Final per-sync completion (standard path equivalent of L324) |

### helius-api-client.ts

| File (short) | Line | Current message (truncated) | Verdict | Reason |
|---|---|---|---|---|
| helius-api-client.ts | 107 | `Updated global rate limit interval to ${ms}ms...` | REMOVE | Startup config; fires on every process restart; not a job event |
| helius-api-client.ts | 110 | `Initializing HeliusApiClient: Target RPS=..., Min Request Interval=...ms` | REMOVE | Startup/instantiation log |
| helius-api-client.ts | 902 | `Phase 1 Telemetry: Pages=${N}, Credits=${C}, Duration=${ms}ms, Signatures=${S}` | DEBUG | Mid-pipeline telemetry; fires per wallet per scope; internal mechanics |
| helius-api-client.ts | 1171 | `Filtered combined transactions down to ${N} involving the target address (kept: ${K}, filtered: ${F}).` | DEBUG | Filter stat per wallet per scope; internal mechanics |
| helius-api-client.ts | 1924 | `Fetching all transactions for mint ${mintAddress} (max: ${N}, type: ${type})` | DEBUG | Start log for mint fetch (mint-participants path) |
| helius-api-client.ts | 1926 | `Time filters: ${JSON.stringify(timeFilters)}` | DEBUG | Config detail for mint fetch |
| helius-api-client.ts | 1940 | `Fetched ${N} total transactions for mint ${mintAddress} (time-filtered)` | KEEP | Completion of mint fetch with count |
| helius-api-client.ts | 1969 | `Fetched ${N} total transactions for mint ${mintAddress}` | KEEP | Completion of mint fetch (non-time-filtered path) |

### pnl-analysis-service.ts (core)

| File (short) | Line | Current message (truncated) | Verdict | Reason |
|---|---|---|---|---|
| pnl-analysis-service.ts | 64 | `PnlAnalysisService instantiated with HeliusApiClient and TokenInfoService. WalletBalanceService active.` | REMOVE | Instantiation log |
| pnl-analysis-service.ts | 67 | `PnlAnalysisService instantiated without HeliusApiClient. WalletBalanceService inactive.` | REMOVE | Instantiation log |
| pnl-analysis-service.ts | 123 | `[PnlAnalysis] Skipping PnL for registry wallet ${walletAddress} (${knownEntry.type})` | DEBUG | Per-wallet skip inside service; the processor already logs the skip at its level |
| pnl-analysis-service.ts | 132 | `[PnlAnalysis] Skipping PnL for detected system wallet ${walletAddress} (${wallet.knownType})` | DEBUG | Same as above — service-level duplicate of processor-level skip log |
| pnl-analysis-service.ts | 198 | `[PnlAnalysis] Retrieved stored balance data for ${walletAddress}. SOL: ${X}, Tokens: ${N}` | DEBUG | Internal balance bookkeeping; balance path detail |
| pnl-analysis-service.ts | 211 | `[PnlAnalysis] Using pre-fetched wallet state for ${walletAddress}. SOL: ${X}, FetchedAt: ${ts}` | DEBUG | Internal balance source; fires per wallet per scope (3x per wallet); matches the live sample log |
| pnl-analysis-service.ts | 220 | `[PnlAnalysis] Successfully fetched wallet state for ${walletAddress}. SOL: ${X}, Tokens: ${N}, FetchedAt: ${ts}` | DEBUG | Same category as L211 |
| pnl-analysis-service.ts | 672 | `[PnlAnalysis] Upserted WalletPnlSummary (no advanced stats) for ${walletAddress}.` | DEBUG | DB bookkeeping; sub-step |
| pnl-analysis-service.ts | 750 | `[PnlAnalysis] Successfully marked AnalysisRun ${runId} as COMPLETED.` | DEBUG | DB state update; bookkeeping; the completion line at L755 already covers this |
| pnl-analysis-service.ts | 755 | `[PnlAnalysis] Analysis completed for ${walletAddress}: ${N} transactions → ${M} tokens, Net PNL: ${P} SOL` | KEEP | Core PnL outcome with all signal metrics — keep at INFO |

### wallet-balance-service.ts

| File (short) | Line | Current message (truncated) | Verdict | Reason |
|---|---|---|---|---|
| wallet-balance-service.ts | 68 | `Fetching RAW wallet balances for ${N} addresses. Commitment: ${commitment}` | DEBUG | Start log for balance fetch; fires per wallet per scope; completion at L312 is sufficient |
| wallet-balance-service.ts | 247 | `Address ${address}: Found ${N} missing tokens, attempting recovery...` | DEBUG | Per-address internal recovery step |
| wallet-balance-service.ts | 284 | `Address ${address}: Successfully recovered ${N}/${M} missing tokens` | DEBUG | Per-address recovery detail |
| wallet-balance-service.ts | 312 | `Successfully processed RAW wallet balance fetching for ${N} addresses (no metadata).` | DEBUG | Completion of balance fetch sub-step; fires per-scope per wallet; not a job boundary |
| wallet-balance-service.ts | 381 | `Enriching ${N} unique tokens with metadata` | DEBUG | Sub-step start |
| wallet-balance-service.ts | 406 | `Successfully enriched wallet balances with metadata for ${N} wallets` | DEBUG | Sub-step completion |

### database-service.ts

| File (short) | Line | Current message (truncated) | Verdict | Reason |
|---|---|---|---|---|
| database-service.ts | 248 | `Mapping activity log saved with ID: ${logId} for wallet ${walletAddress}` | REMOVE | DB record ID bookkeeping; fires per wallet per scope; zero operator value |
| database-service.ts | 679 | `User created with ID: ${id}` | DEBUG | Admin operation; not in the hot analysis path |
| database-service.ts | 728 | `Retrieved ${N} users.` | DEBUG | Read operation result |
| database-service.ts | 850 | `User ${userId} activated successfully.` | DEBUG | Admin operation |
| database-service.ts | 875 | `User ${userId} deactivated successfully.` | DEBUG | Admin operation |
| database-service.ts | 934 | `User ${userId} and all related data deleted successfully.` | DEBUG | Admin operation |
| database-service.ts | 961 | `User ${userId} demo status updated to ${isDemo}.` | DEBUG | Admin operation |
| database-service.ts | 1097 | `Wallet ${walletAddress} added to favorites for user ${userId}` | DEBUG | User action; not analysis path |
| database-service.ts | 1131 | `Wallet ${walletAddress} removed from favorites for user ${userId}` | DEBUG | User action |
| database-service.ts | 1156 | `Cleared ${N} favorite wallets for user ${userId}` | DEBUG | User action |
| database-service.ts | 1220 | `Favorite wallet ${walletAddress} updated for user ${userId}` | DEBUG | User action |
| database-service.ts | 2086 | `Created AnalysisRun with ID: ${id}` | REMOVE | DB record ID bookkeeping; fires per wallet per scope; matches live sample log "Created AnalysisRun with ID: 11017" |
| database-service.ts | 2142 | `AnalysisResult save complete. Attempted: ${N}, Added: ${M}.` | DEBUG | DB batch detail; implied by PnL completion log |
| database-service.ts | 2319 | `Found ${N} AnalysisResult records for ${walletAddress} on page ${page}...` | DEBUG | Read query result detail |
| database-service.ts | 2552 | `Successfully batch upserted ${N} AnalysisResult records.` | REMOVE | DB bookkeeping; fires per wallet per scope; matches live sample log "Successfully batch upserted 85 AnalysisResult records" |
| database-service.ts | 2968 | `Successfully upserted ${N} token info records after ${attempts} attempts.` | DEBUG | Retry-path upsert detail |

### behavior-service.ts (API layer)

| File (short) | Line | Current message (truncated) | Verdict | Reason |
|---|---|---|---|---|
| behavior.service.ts | 33 | `Skipping behavior analysis for registry wallet ${walletAddress} (${type})` | DEBUG | Service-level skip; processor already logs the skip; duplicate signal |
| behavior.service.ts | 43 | `Skipping behavior analysis for detected system wallet ${walletAddress} (${type})` | DEBUG | Same as above |
| behavior.service.ts | 73–75 | `Behavior Cache HIT: ${walletAddress} (${N}min old, fresh)` | DEBUG | Per-call cache hit; fires per wallet per scope; internal mechanics |
| behavior.service.ts | 79–81 | `Behavior Cache STALE: ${walletAddress} - wallet synced ${N}min ago, re-analyzing` | DEBUG | Per-call staleness check; internal mechanics |
| behavior.service.ts | 87 | `Behavior Cache HIT: ${walletAddress} (TTL fallback, ${N}min old)` | DEBUG | Per-call cache hit variant |

### behavior-service.ts (core, behavior-service.ts in core/analysis/behavior/)

| File (short) | Line | Current message (truncated) | Verdict | Reason |
|---|---|---|---|---|
| core/behavior-service.ts | 183 | `Skipping WalletBehaviorProfile upsert for ${walletAddress} because a specific timeRange was provided.` | DEBUG | Internal condition note; not a lifecycle boundary |
| core/behavior-service.ts | 187 | `Completed behavior analysis for ${walletAddress}` | REMOVE | Fires per wallet per scope; processor's "Behavior analysis completed" (L354) is the authoritative completion; this is a duplicate one layer down |

### analyzer.ts (core/analysis/behavior/)

| File (short) | Line | Current message (truncated) | Verdict | Reason |
|---|---|---|---|---|
| analyzer.ts | 1512 | `Scam token filtering: Processed ${N} tokens, filtered out ${M} scam tokens (X%)` | DEBUG | Internal pipeline stat; fires per wallet per scope; part of the 15-line repetition block the operator complained about |

### similarity.service.ts (API)

| File (short) | Line | Current message (truncated) | Verdict | Reason |
|---|---|---|---|---|
| similarity.service.ts | 28 | `Received request to run comprehensive similarity analysis for ${N} wallets.` | DEBUG | Entry log; the processor's "Starting ADVANCED similarity analysis" (L130) is the authoritative entry |

### token-info.service.ts

| File (short) | Line | Current message (truncated) | Verdict | Reason |
|---|---|---|---|---|
| token-info.service.ts | 41 | `TokenInfoService initialized with price caching (30s TTL) and onchain metadata enrichment` | REMOVE | Instantiation log |
| token-info.service.ts | 114 | `[Token Supply] Fetched and cached ${tokenMint}: ${supply} (permanent cache)` | DEBUG | Per-token cache-write detail |
| token-info.service.ts | 393 | `All tokens already have recent metadata` | DEBUG | Sub-function result; this path is also covered by enrichment-processor's "no API calls needed" |
| token-info.service.ts | 401 | `Enriching ${N} tokens (onchain: ${M}, prices: ${P})` | DEBUG | Sub-function start inside service |
| token-info.service.ts | 437 | `DexScreener Stage complete: ${N} tokens processed with fresh prices` | DEBUG | Sub-stage completion inside enrichment |
| token-info.service.ts | 462 | `Token enrichment INITIATED in ${ms}ms - Frontend has onchain data...` | DEBUG | Sub-function internal timing |
| token-info.service.ts | 514 | `Batch saved ${N} new + ${M} updated tokens` | DEBUG | DB batch detail |
| token-info.service.ts | 576 | `Upserting ${N} token info records.` | DEBUG | DB operation start |
| token-info.service.ts | 580 | `Successfully upserted ${N} token info records.` | DEBUG | DB operation completion |

### holder-profiles-cache.service.ts

| File (short) | Line | Current message (truncated) | Verdict | Reason |
|---|---|---|---|---|
| holder-profiles-cache.service.ts | 87 | `Redis connected for holder profiles cache` | DEBUG | Infrastructure connection event |
| holder-profiles-cache.service.ts | 88 | `Redis ready for holder profiles cache operations` | DEBUG | Infrastructure ready event |
| holder-profiles-cache.service.ts | 90 | `Redis reconnecting for holder profiles cache...` | DEBUG | Infrastructure reconnection event |
| holder-profiles-cache.service.ts | 157 | `Invalidated wallet holder profile cache for ${walletAddress}` | DEBUG | Cache management detail; fires after every analysis |
| holder-profiles-cache.service.ts | 201 | `Invalidated ${N} token holder profile cache(s) for wallet ${walletAddress}` | DEBUG | Cache management detail |
| holder-profiles-cache.service.ts | 217 | `Invalidated ${N} holder profile cache(s) for token ${tokenMint}` | DEBUG | Cache management detail |
| holder-profiles-cache.service.ts | 229 | `Cleared ${N} holder profile cache entries` | DEBUG | Cache management detail |
| holder-profiles-cache.service.ts | 452–453 | `Snapshot check for ${tokenMint}: ${N} fresh, ${M} stale` | DEBUG | Internal freshness check result |
| holder-profiles-cache.service.ts | 485 | `Serving cached holder snapshot for wallet ${walletAddress}` | DEBUG | Per-wallet cache hit; fires N times inside job |
| holder-profiles-cache.service.ts | 588 | `Cache metrics reset` | REMOVE | Admin/maintenance action; no diagnostic value |

### dexscreener-service.ts

| File (short) | Line | Current message (truncated) | Verdict | Reason |
|---|---|---|---|---|
| dexscreener-service.ts | 81 | `Pre-filtered ${N} tokens likely not in DexScreener (X% reduction)` | DEBUG | Internal filter stat |
| dexscreener-service.ts | 85 | `All tokens were pre-filtered as unlikely to be in DexScreener` | DEBUG | Internal filter outcome |
| dexscreener-service.ts | 126 | `DexScreener progress: ${X}% (${N}/${M} tokens)` | DEBUG | Per-batch progress counter; fires many times |
| dexscreener-service.ts | 136 | `DexScreener: Final results - ${N} API calls made, ${M} tokens processed out of ${T} requested` | KEEP | Final API call summary — cost/scope signal |
| dexscreener-service.ts | 427 | `Pre-filter: After scam filter - ${N} tokens remain (${M} filtered as scam)` | DEBUG | Internal filter stat |

### onchain-metadata.service.ts

| File (short) | Line | Current message (truncated) | Verdict | Reason |
|---|---|---|---|---|
| onchain-metadata.service.ts | 216 | `Fetching basic metadata for ${N} tokens via DAS API` | DEBUG | Sub-operation start |
| onchain-metadata.service.ts | 234 | `Successfully fetched basic metadata for ${N}/${M} tokens` | DEBUG | Sub-operation completion |

---

## What INFO should look like after

For ONE wallet (`Af8Zu4D...`) going through all 3 scopes (flash → standard → deep) in a 20-wallet holder-profiles job, the operator would see the following at INFO:

```
# Token-level job entry (once per holder-profiles job, not per wallet)
[AnalysisOperationsProcessor] Starting token holder orchestration for <tokenMint> [topN=20]

# Per wallet: only PnL outcome fires at INFO (inside child wallet-mode jobs)
[PnlAnalysisService] [PnlAnalysis] Analysis completed for Af8Zu4D...: 1479 transactions → 85 tokens, Net PNL: -11.25 SOL

# Sync completion fires once per wallet per scope (but this should move to DEBUG — see above)
# After applying verdicts, sync details are DEBUG-only.

# Dashboard analysis for single-wallet flows (not holder-profiles):
[AnalysisOperationsProcessor] Starting dashboard analysis for wallet Af8Zu4D... [scope=flash, trigger=system]
[AnalysisOperationsProcessor] ✅ Dashboard analysis for Af8Zu4D... [scope=flash] completed in 4200ms. Follow-ups queued: working:job-abc,deep:job-def

# Token-level completion (once per job, after all wallets)
[AnalysisOperationsProcessor] Token holder orchestration for <tokenMint> completed: 17 analyzed, 2 skipped (known wallets), 1 failed in 142000ms
```

For a 20-wallet holder-profiles job, applying the verdicts reduces the per-wallet block from ~15 INFO lines (×3 scopes = 45 lines per wallet, 900 lines for 20 wallets) to approximately **1 INFO line per wallet** (the PnL outcome), plus **2 job-level bookends** (orchestration start + completion). Total: ~22 INFO lines for a 20-wallet job instead of 900+.

---

## Notes on the live sample log

The sample log block shows the following calls that are audited above and all receive DEBUG or REMOVE:

| Live sample line | Maps to | Verdict |
|---|---|---|
| `[HeliusSyncService] [Sync] Wallet entry ensured for Af8Zu4D....` | helius-sync-service.ts:113 | DEBUG |
| `[HeliusApiClient] Phase 1 Telemetry: Pages=1, Credits=0, Duration=89ms...` | helius-api-client.ts:902 | DEBUG |
| `Fetching details: Processed ~100%...` | helius-api-client.ts:1023 (`process.stdout.write`) | Not a logger call — stdout only |
| `[HeliusApiClient] Filtered combined transactions down to 249...` | helius-api-client.ts:1171 | DEBUG |
| `[HeliusSyncService] [Sync] SmartFetch Phase 1 (Newer): ✅ Completed...` | helius-sync-service.ts:234 | DEBUG |
| `[DatabaseService] Mapping activity log saved with ID: cmm0f4kql...` | database-service.ts:248 | REMOVE |
| `[HeliusSyncService] [Sync] 🎉 SmartFetch completed for Af8Zu4D...: 792 transactions...` | helius-sync-service.ts:324 | KEEP |
| `[WalletBalanceService] Fetching RAW wallet balances for 1 addresses...` | wallet-balance-service.ts:68 | DEBUG |
| `[WalletBalanceService] Successfully processed RAW wallet balance fetching...` | wallet-balance-service.ts:312 | DEBUG |
| `[PnlAnalysisService] [PnlAnalysis] Using pre-fetched wallet state for Af8Zu4D....` | pnl-analysis-service.ts:211 | DEBUG |
| `[DatabaseService] Successfully batch upserted 85 AnalysisResult records.` | database-service.ts:2552 | REMOVE |
| `[PnlAnalysisService] [PnlAnalysis] Successfully marked AnalysisRun 11016 as COMPLETED.` | pnl-analysis-service.ts:750 | DEBUG |
| `[PnlAnalysisService] [PnlAnalysis] Analysis completed for Af8Zu4D...: 1479 transactions → 85 tokens, Net PNL: -11.25 SOL` | pnl-analysis-service.ts:755 | KEEP |
| `[BehaviorAnalyzer] Scam token filtering: Processed 84 tokens, filtered out 1 scam tokens` | analyzer.ts:1512 | DEBUG |
| `[BehaviorService] Completed behavior analysis for Af8Zu4D...` | core/behavior-service.ts:187 | REMOVE |
| `[DatabaseService] Created AnalysisRun with ID: 11017` | database-service.ts:2086 | REMOVE |

Of the 16 lines in the live sample, **1 is KEEP** (the PnL analysis completed line), **10 are DEBUG**, and **5 are REMOVE**. After applying verdicts, the 45-line block per wallet (3 scopes × 15 lines) collapses to 3 KEEP lines per wallet (one SmartFetch completion per scope, one PnL outcome per scope — and SmartFetch is borderline; scoping those to DEBUG too would reduce to 1 PnL line per wallet total).
