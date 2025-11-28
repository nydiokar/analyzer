# Log Statements Map

This document maps all log statements across the codebase, organized by layer (Core, API, Dashboard).

> **Generated using AST-based extraction** - This ensures accurate parsing of TypeScript/JavaScript code.

## Layer: Core

### Component: analyzer.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| analyzer.ts | `'AdvancedStatsAnalyzer instantiated.'` | DEBUG | 16 | AdvancedStatsAnalyzer instantiated. |
| analyzer.ts | `'SwapAnalyzer instantiated.'` | DEBUG | 20 | SwapAnalyzer instantiated. |
| analyzer.ts | ``Starting similarity analysis for ${walletAddresses.length} wallets using ${vectorType} vectors.`` | INFO | 21 | Starting similarity analysis for ${...} |
| analyzer.ts | `'Less than 2 wallets provided, skipping similarity calculation.'` | WARN | 24 | Less than 2 wallets provided, |
| analyzer.ts | `'[AdvancedStatsAnalyzer] Cannot calculate advanced stats: No analysis results provided.'` | WARN | 30 | [AdvancedStatsAnalyzer] Cannot calculate advanced stats: |
| analyzer.ts | ``No relevant tokens found for vector type ${vectorType}. Skipping similarity.`` | WARN | 31 | No relevant tokens found for |
| analyzer.ts | ``[SwapAnalyzer] Analyzing ${swapInputs.length} pre-processed swap input records for wallet ${walletA` | DEBUG | 41 | [SwapAnalyzer] Analyzing ${...} pre-processed swap |
| analyzer.ts | `'Less than 2 wallets have valid vector data after creation. Skipping similarity matrix calculation.'` | WARN | 44 | Less than 2 wallets have |
| analyzer.ts | `"No transactions provided for global token stats calculation."` | WARN | 44 | No transactions provided for global |
| analyzer.ts | ``Filtered out ${swapInputs.length - filteredSwapInputs.length} records with 'BURN' interaction type ` | DEBUG | 46 | Filtered out ${...} records with |
| analyzer.ts | `'Similarity analysis completed.'` | INFO | 52 | Similarity analysis completed. |
| analyzer.ts | ``[AdvancedStatsAnalyzer] Median PnL Calc: Found ${nz_n} tokens with non-zero PnL out of ${n} total.`` | DEBUG | 60 | [AdvancedStatsAnalyzer] Median PnL Calc: Found |
| analyzer.ts | ``[SwapAnalyzer] Skipping input record for signature ${input.signature} belonging to unexpected walle` | WARN | 67 | [SwapAnalyzer] Skipping input record for |
| analyzer.ts | ``Global token analysis: ${globalStats.totalUniqueTokens} unique, ${globalStats.totalPopularTokens} p` | INFO | 68 | Global token analysis: ${...} unique, |
| analyzer.ts | `"All tokens identified as popular. Correlation based on non-obvious tokens might not yield results. ` | WARN | 70 | All tokens identified as popular. |
| analyzer.ts | `'[AdvancedStatsAnalyzer] Median PnL is 0 because no tokens with non-zero P/L were found.'` | INFO | 72 | [AdvancedStatsAnalyzer] Median PnL is 0 |
| analyzer.ts | `'[AdvancedStatsAnalyzer] Not enough data points to trim for mean PnL, using overall mean.'` | DEBUG | 83 | [AdvancedStatsAnalyzer] Not enough data points |
| analyzer.ts | ``Starting correlation analysis for ${wallets.length} wallets. Sync window: ${this.config.syncTimeWin` | INFO | 86 | Starting correlation analysis for ${...} |
| analyzer.ts | `'[createCapitalAllocationVectors] Creating vectors based on % capital allocation...'` | DEBUG | 99 | [createCapitalAllocationVectors] Creating vectors based on |
| analyzer.ts | ``- Wallet ${walletAddress}: No 'in' transactions for capital allocation vector.`` | DEBUG | 114 | - Wallet ${...}: No in |
| analyzer.ts | ``- Wallet ${walletAddress}: Total SOL invested is 0, capital allocation vector remains zeros.`` | DEBUG | 132 | - Wallet ${...}: Total SOL |
| analyzer.ts | ``[SwapAnalyzer] Aggregated data for ${analysisBySplMint.size} unique SPL tokens across ${processedSi` | DEBUG | 135 | [SwapAnalyzer] Aggregated data for ${...} |
| analyzer.ts | ``[AdvancedStatsAnalyzer] Trading Intensity: ${overallNetPnl.toFixed(2)} SOL / ${totalTokens} tokens ` | DEBUG | 135 | [AdvancedStatsAnalyzer] Trading Intensity: ${...} SOL |
| analyzer.ts | `'[AdvancedStatsAnalyzer] Calculated advanced trading stats.'` | DEBUG | 137 | [AdvancedStatsAnalyzer] Calculated advanced trading stats. |
| analyzer.ts | `'[createBinaryTokenVectors] Creating vectors based on token presence (1/0)...'` | DEBUG | 143 | [createBinaryTokenVectors] Creating vectors based on |
| analyzer.ts | ``[SwapAnalyzer] Stablecoin ${splMint}: Net amount = ${netAmountChange.toFixed(2)}, Value = ${stablec` | DEBUG | 161 | [SwapAnalyzer] Stablecoin ${...}: Net amount |
| analyzer.ts | `'Cannot calculate cosine similarity matrix with zero dimensions.'` | WARN | 164 | Cannot calculate cosine similarity matrix |
| analyzer.ts | ``Pairwise analysis completed. Found ${correlatedPairs.length} pairs meeting score > 0 threshold.`` | INFO | 168 | Pairwise analysis completed. Found ${...} |
| analyzer.ts | ``[SwapAnalyzer] Final analysis complete. Generated ${finalResults.length} results (after filtering W` | DEBUG | 186 | [SwapAnalyzer] Final analysis complete. Generated |
| analyzer.ts | ``[SwapAnalyzer] Total stablecoin value: ${totalStablecoinValue.toFixed(2)} SOL`` | DEBUG | 189 | [SwapAnalyzer] Total stablecoin value: ${...} |
| analyzer.ts | ``[SwapAnalyzer] Net SOL flow to stablecoins: ${totalStablecoinNetFlow.toFixed(2)} SOL`` | DEBUG | 190 | [SwapAnalyzer] Net SOL flow to |
| analyzer.ts | ``Built ${clusters.length} wallet clusters (>= 3 members, min pair score: ${this.config.minClusterSco` | INFO | 262 | Built ${...} wallet clusters (>= |
| analyzer.ts | `'[createHoldingsPresenceVectors] Creating binary vectors based on current token holdings...'` | DEBUG | 322 | [createHoldingsPresenceVectors] Creating binary vectors based |

### Component: behavior-service.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| behavior-service.ts | `'BehaviorService instantiated'` | DEBUG | 18 | BehaviorService instantiated |
| behavior-service.ts | ``Analyzing trading behavior for wallet ${walletAddress}`` | DEBUG | 35 | Analyzing trading behavior for wallet |
| behavior-service.ts | ``No swap records found for wallet ${walletAddress} within the specified time range.`` | WARN | 42 | No swap records found for |
| behavior-service.ts | ``Fetching full history for ${walletAddress} to calculate historical pattern independently of the req` | DEBUG | 50 | Fetching full history for ${...} |
| behavior-service.ts | ``Failed to upsert WalletBehaviorProfile for ${walletAddress}`` | ERROR | 146 | Failed to upsert WalletBehaviorProfile for |
| behavior-service.ts | ``Skipping WalletBehaviorProfile upsert for ${walletAddress} because a specific timeRange was provide` | INFO | 151 | Skipping WalletBehaviorProfile upsert for ${...} |
| behavior-service.ts | ``Completed behavior analysis for ${walletAddress}`` | INFO | 155 | Completed behavior analysis for ${...} |
| behavior-service.ts | ``Error analyzing behavior for wallet ${walletAddress}:`` | ERROR | 159 | Error analyzing behavior for wallet |

### Component: bot.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| bot.ts | `'WARN: ALLOWED_TELEGRAM_USER_IDS is not configured or empty in .env. ' + 'The bot will not respond t` | WARN | 19 | WARN: ALLOWED_TELEGRAM_USER_IDS is not configured |
| bot.ts | ``Bot access restricted to User IDs: ${ALLOWED_USER_IDS.join(', ')}`` | INFO | 25 | Bot access restricted to User |
| bot.ts | ``Admin notifications for unauthorized attempts will be sent to User ID: ${ADMIN_TELEGRAM_ID}`` | INFO | 29 | Admin notifications for unauthorized attempts |
| bot.ts | `'Initializing bot with token prefix:'` | INFO | 48 | Initializing bot with token prefix: |
| bot.ts | `'HELIUS_API_KEY is not configured. RPC fallback for transactions will not work.'` | WARN | 50 | HELIUS_API_KEY is not configured. RPC |
| bot.ts | `'Error in bot constructor:'` | ERROR | 62 | Error in bot constructor: |
| bot.ts | ``Authorized access by user: ${ctx.from.id} (${ctx.from.username})`` | DEBUG | 76 | Authorized access by user: ${...} |
| bot.ts | ``Unauthorized access attempt by User ID: ${userId} (${username})`` | WARN | 81 | Unauthorized access attempt by User |
| bot.ts | `"Failed to send unauthorized access notification to admin:"` | ERROR | 97 | Failed to send unauthorized access |
| bot.ts | ``/start command received from user ID: ${ctx.from.id}`` | INFO | 112 | /start command received from user |
| bot.ts | ``/correlation_analysis command from user ID: ${userId}, message: ${ctx.message.text}`` | INFO | 121 | /correlation_analysis command from user ID: |
| bot.ts | ``/correlation_analysis command received without text content from user ID: ${userId} or in unsupport` | WARN | 193 | /correlation_analysis command received without text |
| bot.ts | ``/analyze_behavior command from user ID: ${userId}, message: ${ctx.message.text}`` | INFO | 201 | /analyze_behavior command from user ID: |
| bot.ts | ``/analyze_advanced command from user ID: ${userId}, message: ${ctx.message.text}`` | INFO | 241 | /analyze_advanced command from user ID: |
| bot.ts | ``/pnl_overview command from user ID: ${userId}, message: ${ctx.message.text}`` | INFO | 329 | /pnl_overview command from user ID: |
| bot.ts | ``/pnl_overview command received without text content from user ID: ${userId} or in unsupported conte` | WARN | 340 | /pnl_overview command received without text |
| bot.ts | ``/behavior_summary command from user ID: ${userId}, message: ${ctx.message.text}`` | INFO | 348 | /behavior_summary command from user ID: |
| bot.ts | ``/behavior_summary command received without text content from user ID: ${userId} or in unsupported c` | WARN | 359 | /behavior_summary command received without text |
| bot.ts | ``/help command received from user ID: ${ctx.from.id}`` | INFO | 365 | /help command received from user |
| bot.ts | ``Document received from user ID: ${userId}, Filename: ${document.file_name}, MIME: ${document.mime_t` | INFO | 375 | Document received from user ID: |
| bot.ts | `'CSV parsing errors:'` | WARN | 402 | CSV parsing errors: |
| bot.ts | `'Error processing uploaded CSV file:'` | ERROR | 443 | Error processing uploaded CSV file: |
| bot.ts | `'Bot commands setup completed.'` | INFO | 448 | Bot commands setup completed. |
| bot.ts | `'Error setting up bot commands:'` | ERROR | 450 | Error setting up bot commands: |
| bot.ts | `'Starting Wallet Analysis Bot...'` | INFO | 461 | Starting Wallet Analysis Bot... |
| bot.ts | `'Wallet Analysis Bot successfully launched and connected to Telegram.'` | INFO | 465 | Wallet Analysis Bot successfully launched |
| bot.ts | `'Failed to launch the bot:'` | ERROR | 467 | Failed to launch the bot: |
| bot.ts | `'Error 409 Conflict: Another instance of the bot might be running with the same token.'` | ERROR | 470 | Error 409 Conflict: Another instance |
| bot.ts | ``Stopping bot due to ${signal} signal...`` | INFO | 486 | Stopping bot due to ${...} |
| bot.ts | `'Bot stopped gracefully.'` | INFO | 488 | Bot stopped gracefully. |

### Component: cliUtils.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| cliUtils.ts | ``Invalid start date format: ${startDate}. Ignoring start date.`` | WARN | 27 | Invalid start date format: ${...}. |
| cliUtils.ts | ``Invalid end date format: ${endDate}. Ignoring end date.`` | WARN | 39 | Invalid end date format: ${...}. |
| cliUtils.ts | ``Applying time range filter: Start=${timeRange.startTs ? new Date(timeRange.startTs*1000).toISOStrin` | INFO | 52 | Applying time range filter: Start=${...}, |

### Component: commands.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| commands.ts | `'WalletAnalysisCommands initialized with HeliusSyncService.'` | INFO | 79 | WalletAnalysisCommands initialized with HeliusSyncService. |
| commands.ts | `'Failed to initialize HeliusSyncService even with API client:'` | ERROR | 81 | Failed to initialize HeliusSyncService even |
| commands.ts | `'WalletAnalysisCommands initialized WITHOUT a Helius API client. HeliusSyncService is not available.` | WARN | 86 | WalletAnalysisCommands initialized WITHOUT a Helius |
| commands.ts | `'Failed to initialize bot system user for activity logging:'` | ERROR | 114 | Failed to initialize bot system |
| commands.ts | `'Bot system user (\'' + BOT_SYSTEM_USER_DESCRIPTION + '\') not found, creating one...'` | INFO | 125 | Bot system user (\ + |
| commands.ts | `'Bot system user created with ID: ' + botUser.id` | INFO | 129 | Bot system user created with |
| commands.ts | `'Failed to create bot system user.'` | ERROR | 131 | Failed to create bot system |
| commands.ts | `'Found existing bot system user with ID: ' + botUser.id` | INFO | 135 | Found existing bot system user |
| commands.ts | `'Error initializing bot system user:'` | ERROR | 140 | Error initializing bot system user: |
| commands.ts | `'Failed to create initial activity log for analyzeWallets:'` | ERROR | 182 | Failed to create initial activity |
| commands.ts | ``Failed to sync wallet ${walletAddress}: ${error.message}`` | ERROR | 246 | Failed to sync wallet ${...}: |
| commands.ts | ``Sync progress: ${currentProgress}% (${syncOperationsCompleted}/${initialWallets.length})`` | INFO | 256 | Sync progress: ${...}% (${...}/${...}) |
| commands.ts | ``Retrieved and prepared ${finalInputsForAnalysis.length} SwapAnalysisInput records for ${walletAddre` | INFO | 282 | Retrieved and prepared ${...} SwapAnalysisInput |
| commands.ts | ``No relevant transactions available for ${walletAddress} after full data pipeline.`` | WARN | 294 | No relevant transactions available for |
| commands.ts | ``Failed to fetch/process DB data for ${walletAddress} after sync: ${dbError.message}`` | ERROR | 297 | Failed to fetch/process DB data |
| commands.ts | `'A sync promise itself rejected unexpectedly:'` | ERROR | 304 | A sync promise itself rejected |
| commands.ts | ``Prepared ${correlatorTxsForWallet.length} CorrelatorTransactionData records for ${walletAddress} (p` | DEBUG | 374 | Prepared ${...} CorrelatorTransactionData records for |
| commands.ts | ``No relevant (post-mint-filter) transactions for ${walletAddress} although it passed bot filter and ` | WARN | 376 | No relevant (post-mint-filter) transactions for |
| commands.ts | `'Error sending a part of Telegram report:'` | ERROR | 463 | Error sending a part of |
| commands.ts | ``Successfully sent wallet analysis report in ${reportMessages.length} part(s).`` | INFO | 468 | Successfully sent wallet analysis report |
| commands.ts | `'Error in analyzeWallets (top level):'` | ERROR | 472 | Error in analyzeWallets (top level): |
| commands.ts | `'Failed to create final activity log for analyzeWallets:'` | ERROR | 497 | Failed to create final activity |
| commands.ts | ``Filtering out wallet ${wallet.address} due to exceeding ${maxDailyPurchasedTokens} unique *purchase` | DEBUG | 547 | Filtering out wallet ${...} due |
| commands.ts | ``[analyzeWalletBehavior] HeliusSyncService not available for ${walletAddress}, skipping sync. API cl` | WARN | 587 | [analyzeWalletBehavior] HeliusSyncService not available for |
| commands.ts | ``Error in analyzeWalletBehavior for ${walletAddress}:`` | ERROR | 606 | Error in analyzeWalletBehavior for ${...}: |
| commands.ts | ``CRITICAL: Top-level command handler error in analyzeWalletBehavior for ${walletAddress}:`` | ERROR | 613 | CRITICAL: Top-level command handler error |
| commands.ts | ``Processing for analyzeWalletBehavior on ${walletAddress} completed with status: ${analysisStatus}. ` | INFO | 626 | Processing for analyzeWalletBehavior on ${...} |
| commands.ts | ``[analyzeAdvancedStats] HeliusSyncService not available for ${walletAddress}, skipping sync. API cli` | WARN | 658 | [analyzeAdvancedStats] HeliusSyncService not available for |
| commands.ts | ``Error in analyzeAdvancedStats for ${walletAddress}:`` | ERROR | 699 | Error in analyzeAdvancedStats for ${...}: |
| commands.ts | ``CRITICAL: Top-level command handler error in analyzeAdvancedStats for ${walletAddress}:`` | ERROR | 705 | CRITICAL: Top-level command handler error |
| commands.ts | ``Processing for analyzeAdvancedStats on ${walletAddress} completed with status: ${analysisStatus}. D` | INFO | 716 | Processing for analyzeAdvancedStats on ${...} |
| commands.ts | `'Failed to create initial activity log for getPnlOverview:'` | ERROR | 755 | Failed to create initial activity |
| commands.ts | ``Error in PNL logic for ${walletAddress}:`` | ERROR | 775 | Error in PNL logic for |
| commands.ts | ``CRITICAL: Top-level command handler error in getPnlOverview for ${walletAddress}:`` | ERROR | 782 | CRITICAL: Top-level command handler error |
| commands.ts | ``Processing for getPnlOverview on ${walletAddress} completed (no activityLogId or bot user not init)` | INFO | 809 | Processing for getPnlOverview on ${...} |
| commands.ts | `'Failed to create initial activity log for getBehaviorSummary:'` | ERROR | 844 | Failed to create initial activity |
| commands.ts | ``Error in behavior summary logic for ${walletAddress}:`` | ERROR | 862 | Error in behavior summary logic |
| commands.ts | ``CRITICAL: Top-level command handler error in getBehaviorSummary for ${walletAddress}:`` | ERROR | 868 | CRITICAL: Top-level command handler error |
| commands.ts | ``Processing for getBehaviorSummary on ${walletAddress} completed (no activityLogId or bot user not i` | INFO | 892 | Processing for getBehaviorSummary on ${...} |

### Component: correlation-service.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| correlation-service.ts | `'CorrelationService instantiated with correlation-specific config.'` | INFO | 29 | CorrelationService instantiated with correlation-specific config. |
| correlation-service.ts | ``Running correlation analysis for ${initialWalletInfos.length} wallets.`` | INFO | 41 | Running correlation analysis for ${...} |
| correlation-service.ts | `'Need at least 2 wallets to proceed with correlation analysis.'` | WARN | 49 | Need at least 2 wallets |
| correlation-service.ts | ``Fetched transaction data for ${Object.keys(allTransactionData).length} wallets.`` | DEBUG | 59 | Fetched transaction data for ${...} |
| correlation-service.ts | ``Less than 2 wallets have transaction data after fetching. Cannot perform correlation. Found transac` | WARN | 65 | Less than 2 wallets have |
| correlation-service.ts | ``Proceeding with ${walletInfosToProcess.length} wallets that have transaction data out of ${initialW` | INFO | 69 | Proceeding with ${...} wallets that |
| correlation-service.ts | `'Error fetching data for correlation analysis:'` | ERROR | 73 | Error fetching data for correlation |
| correlation-service.ts | `'Less than 2 wallets remain after bot filtering. Cannot perform correlation analysis.'` | WARN | 84 | Less than 2 wallets remain |
| correlation-service.ts | `'Correlation analysis completed successfully.'` | INFO | 104 | Correlation analysis completed successfully. |
| correlation-service.ts | `'Error during correlation analysis execution:'` | ERROR | 108 | Error during correlation analysis execution: |
| correlation-service.ts | ``Filtering ${walletInfos.length} wallets based on daily activity (threshold: ${MAX_DAILY_TOKENS_FOR_` | DEBUG | 121 | Filtering ${...} wallets based on |
| correlation-service.ts | ``Filtering out wallet ${wallet.label || address} due to exceeding threshold.`` | DEBUG | 147 | Filtering out wallet ${...} due |
| correlation-service.ts | ``Filtered out ${walletInfos.length - filteredWalletInfos.length} wallets suspected of bot activity. ` | INFO | 162 | Filtered out ${...} wallets suspected |
| correlation-service.ts | ``No wallets filtered out based on daily token activity.`` | INFO | 164 | No wallets filtered out based |

### Component: dexscreener-service.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| dexscreener-service.ts | ``Pre-filtered ${skippedCount} tokens likely not in DexScreener (${((skippedCount/tokenAddresses.leng` | INFO | 80 | Pre-filtered ${...} tokens likely not |
| dexscreener-service.ts | `'All tokens were pre-filtered as unlikely to be in DexScreener'` | INFO | 84 | All tokens were pre-filtered as |
| dexscreener-service.ts | ``Processing chunk ${actualIndex + 1}/${chunks.length} with ${chunk.length} tokens...`` | DEBUG | 104 | Processing chunk ${...}/${...} with ${...} |
| dexscreener-service.ts | ``❌ Chunk ${actualIndex + 1}/${chunks.length} failed:`` | ERROR | 112 | ❌ Chunk ${...}/${...} failed: |
| dexscreener-service.ts | ``DexScreener progress: ${progress}% (${processedCount}/${tokenAddresses.length} tokens)`` | INFO | 125 | DexScreener progress: ${...}% (${...}/${...} tokens) |
| dexscreener-service.ts | ``🔍 DexScreener: Final results - ${actualApiCalls} API calls made, ${processedCount} tokens processe` | INFO | 135 | 🔍 DexScreener: Final results - |
| dexscreener-service.ts | ``Updated metadataSource to 'hybrid' for ${count} tokens with both data sources`` | DEBUG | 152 | Updated metadataSource to hybrid for |
| dexscreener-service.ts | `'Failed to update metadataSource to hybrid:'` | ERROR | 155 | Failed to update metadataSource to |
| dexscreener-service.ts | ``Using cached SOL price: $${this.solPriceCache.price}`` | DEBUG | 188 | Using cached SOL price: $${...} |
| dexscreener-service.ts | ``Successfully fetched SOL price from ${source.name}: $${solPrice}`` | DEBUG | 233 | Successfully fetched SOL price from |
| dexscreener-service.ts | ``${source.name} returned unreasonable SOL price: $${solPrice}, trying next source`` | WARN | 236 | ${...} returned unreasonable SOL price: |
| dexscreener-service.ts | ``${source.name} returned no price data, trying next source`` | WARN | 239 | ${...} returned no price data, |
| dexscreener-service.ts | ``Failed to fetch SOL price from ${source.name}: ${error instanceof Error ? error.message : error}, t` | WARN | 242 | Failed to fetch SOL price |
| dexscreener-service.ts | `errorMsg` | ERROR | 248 | errorMsg |
| dexscreener-service.ts | ``Saved/updated ${tokenInfoFromPairs.length} token records from API.`` | DEBUG | 380 | Saved/updated ${...} token records from |
| dexscreener-service.ts | ``${notFoundAddresses.length} tokens not found via API. Creating placeholders.`` | DEBUG | 388 | ${...} tokens not found via |
| dexscreener-service.ts | ``🔍 Pre-filter: After scam filter - ${validTokens.length} tokens remain (${uncheckedTokens.length - ` | INFO | 437 | 🔍 Pre-filter: After scam filter |
| dexscreener-service.ts | ``Failed to fetch ${description} after ${RETRY_CONFIG.maxRetries} attempts:`` | ERROR | 471 | Failed to fetch ${...} after |
| dexscreener-service.ts | ``Attempt ${attempt}/${RETRY_CONFIG.maxRetries} failed for ${description}, retrying in ${delay}ms:`` | WARN | 481 | Attempt ${...}/${...} failed for ${...}, |

### Component: display-utils.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| display-utils.ts | `'\n===== Swap Analysis Summary ====='` | LOG | 25 | \n===== Swap Analysis Summary ===== |
| display-utils.ts | ``Wallet: ${walletAddress}`` | LOG | 26 | Wallet: ${...} |
| display-utils.ts | `'[DisplayUtils] displaySummary received non-array for results. Cannot proceed.'` | ERROR | 29 | [DisplayUtils] displaySummary received non-array for |
| display-utils.ts | `'Total Unique Tokens: N/A (Invalid data)'` | LOG | 30 | Total Unique Tokens: N/A (Invalid |
| display-utils.ts | `'Overall Net PNL: N/A (Invalid data)'` | LOG | 31 | Overall Net PNL: N/A (Invalid |
| display-utils.ts | ``Total Unique Tokens: ${results.length}`` | LOG | 35 | Total Unique Tokens: ${...} |
| display-utils.ts | ``\nOverall SOL Spent: ${overallSolSpent.toFixed(2)} SOL`` | LOG | 46 | \nOverall SOL Spent: ${...} SOL |
| display-utils.ts | ``Overall SOL Received: ${overallSolReceived.toFixed(2)} SOL`` | LOG | 47 | Overall SOL Received: ${...} SOL |
| display-utils.ts | ``Raw Net SOL P/L: ${formatProfitLoss(overallNetPnl)}`` | LOG | 48 | Raw Net SOL P/L: ${...} |
| display-utils.ts | ``\n--- Value Preservation ---`` | LOG | 52 | \n--- Value Preservation --- |
| display-utils.ts | ``Value Preservation Tokens: ${valuePreservingTokens.length}`` | LOG | 53 | Value Preservation Tokens: ${...} |
| display-utils.ts | ``Total Estimated Value Preserved: ${totalPreservedValue.toFixed(2)} SOL`` | LOG | 54 | Total Estimated Value Preserved: ${...} |
| display-utils.ts | ``Adjusted Net SOL P/L (including preserved value): ${formatProfitLoss(overallAdjustedPnl)}`` | LOG | 55 | Adjusted Net SOL P/L (including |
| display-utils.ts | ``\nTop Value Preservation Tokens:`` | LOG | 58 | \nTop Value Preservation Tokens: |
| display-utils.ts | ``${i+1}. ${getTokenName(token.tokenAddress)}: ${token.estimatedPreservedValue?.toFixed(2) || 0} SOL ` | LOG | 63 | ${...}. ${...}: ${...} SOL value |
| display-utils.ts | `'\nTop 5 Most Profitable Tokens:'` | LOG | 71 | \nTop 5 Most Profitable Tokens: |
| display-utils.ts | ``${index + 1}. ${getTokenName(result.tokenAddress)}: ${formatProfitLoss(result.netSolProfitLoss)}`` | LOG | 73 | ${...}. ${...}: ${...} |
| display-utils.ts | `'\nTop 5 Least Profitable Tokens:'` | LOG | 80 | \nTop 5 Least Profitable Tokens: |
| display-utils.ts | ``${index + 1}. ${getTokenName(result.tokenAddress)}: ${formatProfitLoss(result.netSolProfitLoss)}`` | LOG | 82 | ${...}. ${...}: ${...} |
| display-utils.ts | ``\nActivity Time Range: ${formatDate(range.first)} to ${formatDate(range.last)} (approx. ${range.dur` | LOG | 88 | \nActivity Time Range: ${...} to |
| display-utils.ts | `'\nFor detailed results, check the generated report file or use --verbose flag.'` | LOG | 91 | \nFor detailed results, check the |
| display-utils.ts | `chalk.bold.blue('\n--- Detailed SOL P/L by Token ---')` | LOG | 140 | chalk.bold.blue(\n--- Detailed SOL P/L by |
| display-utils.ts | `chalk.bold.green('\nTop 10 Gainers by SOL P/L:')` | LOG | 142 | chalk.bold.green(\nTop 10 Gainers by SOL |
| display-utils.ts | `chalk.gray(' No profitable tokens found.')` | LOG | 144 | chalk.gray( No profitable tokens found.) |
| display-utils.ts | `` ${index + 1}. ${chalk.bold(displayName)}${addrDisplay}`` | LOG | 149 | ${...}. ${...}${...} |
| display-utils.ts | `` Net SOL P/L: ${chalk.green(result.netSolProfitLoss.toFixed(6))} SOL`` | LOG | 150 | Net SOL P/L: ${...} |
| display-utils.ts | `` Swaps: ${chalk.cyan(result.transferCountIn)} In / ${chalk.cyan(result.transferCountOut)} Out`` | LOG | 151 | Swaps: ${...} In / |
| display-utils.ts | `chalk.bold.red('\nTop 10 Losers by SOL P/L:')` | LOG | 155 | chalk.bold.red(\nTop 10 Losers by SOL |
| display-utils.ts | `chalk.gray(' No tokens with SOL loss found.')` | LOG | 158 | chalk.gray( No tokens with SOL |
| display-utils.ts | `` ${index + 1}. ${chalk.bold(displayName)}${addrDisplay}`` | LOG | 163 | ${...}. ${...}${...} |
| display-utils.ts | `` Net SOL P/L: ${chalk.red(result.netSolProfitLoss.toFixed(6))} SOL`` | LOG | 164 | Net SOL P/L: ${...} |
| display-utils.ts | `` Swaps: ${chalk.cyan(result.transferCountIn)} In / ${chalk.cyan(result.transferCountOut)} Out`` | LOG | 165 | Swaps: ${...} In / |
| display-utils.ts | `chalk.blue('-----------------------------------')` | LOG | 168 | chalk.blue(-----------------------------------) |

### Component: formatters.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| formatters.ts | ``Error formatting timestamp: ${timestampSeconds}`` | ERROR | 28 | Error formatting timestamp: ${...} |
| formatters.ts | ``Error formatting SOL amount: ${amount}`` | ERROR | 45 | Error formatting SOL amount: ${...} |
| formatters.ts | ``Error formatting number: ${num}`` | ERROR | 66 | Error formatting number: ${...} |

### Component: helius-api-client.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| helius-api-client.ts | ``Updated global rate limit interval to ${HeliusApiClient.globalMinRequestIntervalMs}ms (from instanc` | INFO | 94 | Updated global rate limit interval |
| helius-api-client.ts | ``Initializing HeliusApiClient: Target RPS=${targetRps}, Min Request Interval=${this.minRequestInterv` | INFO | 97 | Initializing HeliusApiClient: Target RPS=${...}, Min |
| helius-api-client.ts | ``Attempt ${attempt}: RPC call returned an error`` | WARN | 215 | Attempt ${...}: RPC call returned |
| helius-api-client.ts | ``Attempt ${attempt}: Received unexpected response structure from getSignaturesForAddress RPC.`` | WARN | 224 | Attempt ${...}: Received unexpected response |
| helius-api-client.ts | `'Max retries reached fetching RPC signatures page. Aborting.'` | ERROR | 244 | Max retries reached fetching RPC |
| helius-api-client.ts | ``Attempt ${attempt}: Encountered retryable error (status=${status ?? 'N/A'}). Retrying RPC signature` | DEBUG | 260 | Attempt ${...}: Encountered retryable error |
| helius-api-client.ts | ``Attempt ${attempt}: Unrecoverable error during RPC signatures fetch (status=${status}). Aborting.`` | ERROR | 264 | Attempt ${...}: Unrecoverable error during |
| helius-api-client.ts | ``Attempt ${attempt}: RPC call returned an error`` | WARN | 346 | Attempt ${...}: RPC call returned |
| helius-api-client.ts | ``Attempt ${attempt}: Unexpected response structure from getTransactionsForAddress`` | WARN | 363 | Attempt ${...}: Unexpected response structure |
| helius-api-client.ts | `'Max retries reached for getTransactionsForAddress. Aborting.'` | ERROR | 386 | Max retries reached for getTransactionsForAddress. |
| helius-api-client.ts | ``Attempt ${attempt}: Retrying in ${backoffTime}ms...`` | DEBUG | 403 | Attempt ${...}: Retrying in ${...}ms... |
| helius-api-client.ts | ``Attempt ${attempt}: Unrecoverable error. Aborting.`` | ERROR | 407 | Attempt ${...}: Unrecoverable error. Aborting. |
| helius-api-client.ts | ``Attempt ${attempt}: Received significantly fewer transactions (${response.data.length}) ` + `than s` | WARN | 446 | Attempt ${...}: Received significantly fewer |
| helius-api-client.ts | ``Attempt ${attempt}: 400 Bad Request error fetching transactions`` | ERROR | 469 | Attempt ${...}: 400 Bad Request |
| helius-api-client.ts | `'Max retries reached fetching transactions by signatures. Aborting this batch.'` | ERROR | 488 | Max retries reached fetching transactions |
| helius-api-client.ts | ``Attempt ${attempt}: Rate limit or server error (${status}). Retrying batch in ${backoffTime}ms...`` | DEBUG | 496 | Attempt ${...}: Rate limit or |
| helius-api-client.ts | ``Attempt ${attempt}: Unrecoverable client error (${status}). Aborting batch fetch.`` | ERROR | 500 | Attempt ${...}: Unrecoverable client error |
| helius-api-client.ts | ``Attempt ${attempt}: Network or unknown error. Retrying batch in ${backoffTime}ms...`` | DEBUG | 505 | Attempt ${...}: Network or unknown |
| helius-api-client.ts | ``Starting Phase 1: Fetching signatures via ${HELIUS_V2_CONFIG.enableTransactionsForAddressSignatures` | DEBUG | 556 | Starting Phase 1: Fetching signatures |
| helius-api-client.ts | ``Helius getTransactionsForAddress V2 disabled for this process due to hard failure: ${v2Error?.messa` | WARN | 627 | Helius getTransactionsForAddress V2 disabled for |
| helius-api-client.ts | ``Found stopAtSignature (${stopAtSignature}) in the current batch at index ${stopIndex}. Stopping sig` | DEBUG | 654 | Found stopAtSignature (${...}) in the |
| helius-api-client.ts | ``RPC fetcher has retrieved ${fetchedSignaturesCount} signatures, meeting conceptual target related t` | DEBUG | 662 | RPC fetcher has retrieved ${...} |
| helius-api-client.ts | ``RPC signature fetch for ${address} exceeded safety cap of ${signatureSafetyLimit} (maxSignatures=${` | WARN | 665 | RPC signature fetch for ${...} |
| helius-api-client.ts | `'Last page of RPC signatures reached (received less than limit).'` | DEBUG | 669 | Last page of RPC signatures |
| helius-api-client.ts | `'Last page of RPC signatures reached (received 0 items).'` | DEBUG | 673 | Last page of RPC signatures |
| helius-api-client.ts | ``Finished Phase 1. Total signatures retrieved via RPC: ${allRpcSignaturesInfo.length}`` | DEBUG | 679 | Finished Phase 1. Total signatures |
| helius-api-client.ts | ``Phase 1 Telemetry: Pages=${telemetry.pageCount}, Credits=${telemetry.creditUsage}, Duration=${phase` | INFO | 680 | Phase 1 Telemetry: Pages=${...}, Credits=${...}, |
| helius-api-client.ts | `'Failed during RPC signature fetching phase (Phase 1): Returning empty list.'` | ERROR | 687 | Failed during RPC signature fetching |
| helius-api-client.ts | ``RPC fetch resulted in ${allRpcSignaturesInfo.length} signatures. Applying hard limit of ${maxSignat` | DEBUG | 697 | RPC fetch resulted in ${...} |
| helius-api-client.ts | ``Sliced RPC signatures to newest ${allRpcSignaturesInfo.length} based on maxSignatures limit (RPC or` | DEBUG | 700 | Sliced RPC signatures to newest |
| helius-api-client.ts | ``Total unique signatures from RPC after potential maxSignatures slicing: ${uniqueSignatures.length}`` | DEBUG | 704 | Total unique signatures from RPC |
| helius-api-client.ts | ``Checking database cache existence for ${uniqueSignatures.length} signatures...`` | DEBUG | 707 | Checking database cache existence for |
| helius-api-client.ts | ``Found ${cacheHits} signatures in cache. Need to fetch details for ${signaturesToFetchDetails.size} ` | DEBUG | 727 | Found ${...} signatures in cache. |
| helius-api-client.ts | ``Starting Phase 2: Fetching parsed details from Helius for ${signaturesToFetchArray.length} new sign` | DEBUG | 733 | Starting Phase 2: Fetching parsed |
| helius-api-client.ts | ``A batch fetch within concurrent set failed for ${batchSignatures.length} signatures. Continuing wit` | ERROR | 759 | A batch fetch within concurrent |
| helius-api-client.ts | `'Concurrent batch requests for Phase 2 finished.'` | DEBUG | 811 | Concurrent batch requests for Phase |
| helius-api-client.ts | ``Successfully fetched details for ${onTransactionBatch ? totalFetchedTxCount : newlyFetchedTransacti` | DEBUG | 812 | Successfully fetched details for ${...} |
| helius-api-client.ts | ``Saving ${newlyFetchedTransactions.length} newly fetched transactions to database cache...`` | DEBUG | 817 | Saving ${...} newly fetched transactions |
| helius-api-client.ts | `'Finished saving new transactions to cache.'` | DEBUG | 820 | Finished saving new transactions to |
| helius-api-client.ts | `'No new transactions were successfully fetched in Phase 2.'` | DEBUG | 823 | No new transactions were successfully |
| helius-api-client.ts | ``Cache hit ${cacheHits} signatures (avoided re-fetching).`` | DEBUG | 829 | Cache hit ${...} signatures (avoided |
| helius-api-client.ts | ``Fetched ${newlyFetchedTransactions.length} new transactions from API.`` | DEBUG | 830 | Fetched ${...} new transactions from |
| helius-api-client.ts | ``Filtered by newestProcessedTimestamp (${newestProcessedTimestamp}): ${countBefore} -> ${countAfter}` | DEBUG | 848 | Filtered by newestProcessedTimestamp (${...}): ${...} |
| helius-api-client.ts | `'No newestProcessedTimestamp provided or stopAtSignature present, skipping timestamp filter.'` | DEBUG | 850 | No newestProcessedTimestamp provided or stopAtSignature |
| helius-api-client.ts | ``Filtered by untilTimestamp (${untilTimestamp}): ${countBefore} -> ${countAfter} transactions.`` | DEBUG | 859 | Filtered by untilTimestamp (${...}): ${...} |
| helius-api-client.ts | `'No untilTimestamp provided, skipping until filter.'` | DEBUG | 861 | No untilTimestamp provided, skipping until |
| helius-api-client.ts | ``Total transactions before address relevance filter: ${filteredTransactions.length}`` | DEBUG | 865 | Total transactions before address relevance |
| helius-api-client.ts | ``Filtered combined transactions down to ${relevantFiltered.length} involving the target address (kep` | INFO | 949 | Filtered combined transactions down to |
| helius-api-client.ts | ``⚠️ High filtering rate: ${((filteredCount / filteredTransactions.length) * 100).toFixed(1)}% of tra` | WARN | 953 | ⚠️ High filtering rate: ${...}% |
| helius-api-client.ts | ``Sorted ${relevantFiltered.length} relevant transactions by timestamp.`` | DEBUG | 958 | Sorted ${...} relevant transactions by |
| helius-api-client.ts | ``Helius API client process finished. Returning ${relevantFiltered.length} relevant transactions.`` | DEBUG | 960 | Helius API client process finished. |
| helius-api-client.ts | ``All retries failed or non-retryable error for RPC method ${method}.`` | ERROR | 1044 | All retries failed or non-retryable |
| helius-api-client.ts | ``Attempt ${retries}/${MAX_RETRIES} failed for RPC method ${method}. Retrying in ${backoffTime}ms...`` | WARN | 1054 | Attempt ${...}/${...} failed for RPC |
| helius-api-client.ts | ``getMultipleAccounts called with ${pubkeys.length} pubkeys, exceeding the typical limit of 100. The ` | WARN | 1111 | getMultipleAccounts called with ${...} pubkeys, |
| helius-api-client.ts | ``Fetching multiple accounts for ${pubkeys.length} pubkeys with options:`` | DEBUG | 1126 | Fetching multiple accounts for ${...} |
| helius-api-client.ts | ``Failed to fetch multiple accounts for pubkeys: ${pubkeys.join(', ')}`` | ERROR | 1135 | Failed to fetch multiple accounts |
| helius-api-client.ts | ``Successfully fetched token accounts (V2) for owner ${ownerPubkey}. Count: ${v2.value.length}`` | INFO | 1180 | Successfully fetched token accounts (V2) |
| helius-api-client.ts | ``Helius V2 disabled for this process due to hard failure (code=${code ?? 'n/a'}): ${e?.message}`` | WARN | 1188 | Helius V2 disabled for this |
| helius-api-client.ts | ``Fetching token accounts (V1) for owner ${ownerPubkey} with program/mint filter: `` | DEBUG | 1208 | Fetching token accounts (V1) for |
| helius-api-client.ts | ``Successfully fetched token accounts for owner ${ownerPubkey}. Count: ${result.value.length}`` | DEBUG | 1220 | Successfully fetched token accounts for |
| helius-api-client.ts | ``Failed to fetch token accounts for owner ${ownerPubkey}`` | ERROR | 1223 | Failed to fetch token accounts |
| helius-api-client.ts | ``Fetching largest token accounts for mint ${mintPubkey}`` | DEBUG | 1317 | Fetching largest token accounts for |
| helius-api-client.ts | ``Successfully fetched ${result.value.length} largest token accounts for mint ${mintPubkey}`` | DEBUG | 1327 | Successfully fetched ${...} largest token |
| helius-api-client.ts | ``Failed to fetch largest token accounts for mint ${mintPubkey}`` | ERROR | 1330 | Failed to fetch largest token |
| helius-api-client.ts | ``Fetching token supply for mint ${mintPubkey}`` | DEBUG | 1358 | Fetching token supply for mint |
| helius-api-client.ts | ``Successfully fetched token supply for mint ${mintPubkey}: ${result.value.uiAmount}`` | DEBUG | 1365 | Successfully fetched token supply for |
| helius-api-client.ts | ``Failed to fetch token supply for mint ${mintPubkey}`` | ERROR | 1368 | Failed to fetch token supply |
| helius-api-client.ts | ``getAssetBatch called with ${uniqueIds.length} assets, will batch in chunks of 1000`` | WARN | 1393 | getAssetBatch called with ${...} assets, |
| helius-api-client.ts | ``Failed to fetch asset batch for ${uniqueIds.length} assets`` | ERROR | 1412 | Failed to fetch asset batch |

### Component: helius-sync-service.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| helius-sync-service.ts | ``[Sync] Skipping API fetch for ${walletAddress} (--skipApi).`` | DEBUG | 90 | [Sync] Skipping API fetch for |
| helius-sync-service.ts | ``[Sync] Skipping sync for ${walletAddress} - already marked as INVALID`` | DEBUG | 98 | [Sync] Skipping sync for ${...} |
| helius-sync-service.ts | ``[Sync] Could not check wallet classification for ${walletAddress}, proceeding:`` | WARN | 103 | [Sync] Could not check wallet |
| helius-sync-service.ts | ``[Sync] Wallet entry ensured for ${walletAddress}. Proceeding with sync.`` | INFO | 109 | [Sync] Wallet entry ensured for |
| helius-sync-service.ts | ``[Sync] CRITICAL: Could not ensure wallet entry for ${walletAddress}. Aborting sync.`` | ERROR | 111 | [Sync] CRITICAL: Could not ensure |
| helius-sync-service.ts | ``[Sync] Error during synchronization for ${walletAddress}:`` | ERROR | 171 | [Sync] Error during synchronization for |
| helius-sync-service.ts | ``[Sync] Executing SmartFetch for ${walletAddress} with overall target of ${options.maxSignatures} si` | DEBUG | 190 | [Sync] Executing SmartFetch for ${...} |
| helius-sync-service.ts | ``[Sync] SmartFetch called for ${walletAddress} without a valid positive options.maxSignatures. Proce` | WARN | 193 | [Sync] SmartFetch called for ${...} |
| helius-sync-service.ts | ``[Sync] SmartFetch Phase 1 (Newer): Fetching for ${walletAddress} since sig: ${stopAtSignatureForNew` | DEBUG | 210 | [Sync] SmartFetch Phase 1 (Newer): |
| helius-sync-service.ts | ``[Sync] SmartFetch Phase 1 (Newer): ✅ Completed processing ${newerTransactionsFetchedCount} newer tr` | INFO | 237 | [Sync] SmartFetch Phase 1 (Newer): |
| helius-sync-service.ts | ``[Sync] WrongSize error detected for ${walletAddress}. Marking wallet as invalid.`` | WARN | 242 | [Sync] WrongSize error detected for |
| helius-sync-service.ts | ``[Sync] Failed to mark wallet ${walletAddress} as invalid:`` | ERROR | 248 | [Sync] Failed to mark wallet |
| helius-sync-service.ts | ``[Sync] SmartFetch Phase 1 (Newer): Failed to fetch/process newer transactions for ${walletAddress}:` | ERROR | 252 | [Sync] SmartFetch Phase 1 (Newer): |
| helius-sync-service.ts | ``[Sync] SmartFetch: DB count for ${walletAddress} after fetching newer is ${countAfterNewerFetch}. T` | DEBUG | 259 | [Sync] SmartFetch: DB count for |
| helius-sync-service.ts | ``[Sync] SmartFetch Phase 2 (Older): Current count ${countAfterNewerFetch} is less than target ${opti` | DEBUG | 263 | [Sync] SmartFetch Phase 2 (Older): |
| helius-sync-service.ts | ``[Sync] SmartFetch Phase 2 (Older): Attempting to fetch ${remainingSignaturesToFetchForOlder} older ` | DEBUG | 269 | [Sync] SmartFetch Phase 2 (Older): |
| helius-sync-service.ts | ``[Sync] SmartFetch Phase 2 (Older): ✅ Completed processing ${totalOlderProcessedCount} older transac` | INFO | 296 | [Sync] SmartFetch Phase 2 (Older): |
| helius-sync-service.ts | ``[Sync] WrongSize error detected for ${walletAddress} in Phase 2. Marking wallet as invalid.`` | WARN | 301 | [Sync] WrongSize error detected for |
| helius-sync-service.ts | ``[Sync] Failed to mark wallet ${walletAddress} as invalid:`` | ERROR | 307 | [Sync] Failed to mark wallet |
| helius-sync-service.ts | ``[Sync] SmartFetch Phase 2 (Older): Failed to fetch/process older transactions for ${walletAddress}:` | ERROR | 311 | [Sync] SmartFetch Phase 2 (Older): |
| helius-sync-service.ts | ``[Sync] SmartFetch Phase 2 (Older): DB count (${countAfterNewerFetch}) already meets or exceeds targ` | DEBUG | 314 | [Sync] SmartFetch Phase 2 (Older): |
| helius-sync-service.ts | ``[Sync] SmartFetch: Skipping Phase 2 (Older) because options.maxSignatures is not valid or not set. ` | DEBUG | 317 | [Sync] SmartFetch: Skipping Phase 2 |
| helius-sync-service.ts | ``[Sync] Successfully saved accumulated mapping activity log for ${walletAddress}`` | DEBUG | 324 | [Sync] Successfully saved accumulated mapping |
| helius-sync-service.ts | ``[Sync] Failed to save accumulated mapping activity log for ${walletAddress}`` | ERROR | 326 | [Sync] Failed to save accumulated |
| helius-sync-service.ts | ``[Sync] 🎉 SmartFetch completed for ${walletAddress}: ${finalCount} transactions processed and saved` | INFO | 340 | [Sync] 🎉 SmartFetch completed for |
| helius-sync-service.ts | ``[Sync] Executing Standard Fetch for ${walletAddress} with overall target of ${options.maxSignatures` | DEBUG | 357 | [Sync] Executing Standard Fetch for |
| helius-sync-service.ts | ``[Sync] StandardFetch called for ${walletAddress} without a valid positive options.maxSignatures. Ab` | WARN | 360 | [Sync] StandardFetch called for ${...} |
| helius-sync-service.ts | ``[Sync] Standard Fetch (Initial/FetchOlder): Fetching for ${walletAddress} from beginning, up to ${o` | DEBUG | 372 | [Sync] Standard Fetch (Initial/FetchOlder): Fetching |
| helius-sync-service.ts | ``[Sync] Standard Fetch (Incremental Newer): Fetching for ${walletAddress}.`` | DEBUG | 377 | [Sync] Standard Fetch (Incremental Newer): |
| helius-sync-service.ts | ``[Sync] Standard Fetch: Calling HeliusApiClient for ${walletAddress} with maxSignatures: ${options.m` | DEBUG | 384 | [Sync] Standard Fetch: Calling HeliusApiClient |
| helius-sync-service.ts | ``[Sync] Standard Fetch: ✅ Completed processing ${totalStandardProcessedCount} transactions for ${wal` | INFO | 410 | [Sync] Standard Fetch: ✅ Completed |
| helius-sync-service.ts | ``[Sync] WrongSize error detected for ${walletAddress} in Standard Fetch. Marking wallet as invalid.`` | WARN | 415 | [Sync] WrongSize error detected for |
| helius-sync-service.ts | ``[Sync] Failed to mark wallet ${walletAddress} as invalid:`` | ERROR | 421 | [Sync] Failed to mark wallet |
| helius-sync-service.ts | ``[Sync] CRITICAL: Aborting sync for ${walletAddress} due to a non-retryable RPC error (e.g., invalid` | ERROR | 426 | [Sync] CRITICAL: Aborting sync for |
| helius-sync-service.ts | ``[Sync] Standard Fetch: Failed to fetch/process transactions for ${walletAddress}:`` | ERROR | 429 | [Sync] Standard Fetch: Failed to |
| helius-sync-service.ts | ``[Sync] 🎉 Standard Fetch completed for ${walletAddress}: ${finalCount} transactions processed and s` | INFO | 438 | [Sync] 🎉 Standard Fetch completed |
| helius-sync-service.ts | ``[Sync] No transactions in this batch to update wallet state for ${walletAddress}.`` | DEBUG | 557 | [Sync] No transactions in this |
| helius-sync-service.ts | ``[Sync] Error getting DB transaction count for ${walletAddress}`` | ERROR | 580 | [Sync] Error getting DB transaction |

### Component: helius-transaction-mapper.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| helius-transaction-mapper.ts | `'Error parsing rawTokenAmount'` | WARN | 132 | Error parsing rawTokenAmount |
| helius-transaction-mapper.ts | `'Error in safeParseAmount (direct tokenAmount parsing)'` | WARN | 154 | Error in safeParseAmount (direct tokenAmount |
| helius-transaction-mapper.ts | ``Event Matcher: Ambiguous - Cannot choose between consistent SOL (${solConsistent}) and USDC (${usdc` | WARN | 259 | Event Matcher: Ambiguous - Cannot |
| helius-transaction-mapper.ts | ``Error during 'Matching Value' event processing. Sig: ${tx.signature}`` | ERROR | 269 | Error during Matching Value event |
| helius-transaction-mapper.ts | ``FEE_PAYER_DEBUG_PRE_CHECK for ${tx.signature}: isFeePayerWalletA = ${isFeePayerWalletA}, tx.feePaye` | WARN | 610 | FEE_PAYER_DEBUG_PRE_CHECK for ${...}: isFeePayerWalletA = |
| helius-transaction-mapper.ts | ``FEE_PAYER_DEBUG_PRE_CHECK for ${tx.signature}: tx.events object: ${JSON.stringify(tx.events, null, ` | WARN | 611 | FEE_PAYER_DEBUG_PRE_CHECK for ${...}: tx.events object: |
| helius-transaction-mapper.ts | ``FEE_PAYER_DEBUG_IN_BLOCK for ${tx.signature}: swapEvent data: ${JSON.stringify(tx.events.swap, null` | WARN | 617 | FEE_PAYER_DEBUG_IN_BLOCK for ${...}: swapEvent data: |
| helius-transaction-mapper.ts | ``Tx ${tx.signature} Mint ${inputMint}: FEE PAYER heuristic - Attributed SWAP EVENT INPUT to ${wallet` | DEBUG | 696 | Tx ${...} Mint ${...}: FEE |
| helius-transaction-mapper.ts | ``Tx ${tx.signature} Mint ${outputMint}: FEE PAYER heuristic - Attributed SWAP EVENT OUTPUT to ${wall` | DEBUG | 722 | Tx ${...} Mint ${...}: FEE |
| helius-transaction-mapper.ts | ``Tx ${tx.signature}: Helius API bug detected - WSOL tokenAmount provided as raw lamports (${currentA` | WARN | 807 | Tx ${...}: Helius API bug |
| helius-transaction-mapper.ts | ``Tx ${tx.signature}: Large WSOL transfer detected: ${wsolAmount.toFixed(9)} SOL. ` + `Native change:` | INFO | 813 | Tx ${...}: Large WSOL transfer |
| helius-transaction-mapper.ts | ``Tx ${tx.signature}, Mint ${mint} (${direction}): CREATE_POOL - Both Net SOL and USDC changed. Defau` | WARN | 855 | Tx ${...}, Mint ${...} (${...}): |
| helius-transaction-mapper.ts | ``Error during proportional value redistribution for tx ${tx.signature}`` | ERROR | 1058 | Error during proportional value redistribution |
| helius-transaction-mapper.ts | ``Mapper error processing transaction ${tx.signature}`` | ERROR | 1067 | Mapper error processing transaction ${...} |
| helius-transaction-mapper.ts | ``Mapping stats at time of error for tx ${tx.signature}:`` | DEBUG | 1073 | Mapping stats at time of |
| helius-transaction-mapper.ts | ``Finished mapping ${transactions.length} transactions for ${walletAddress}.`` | INFO | 1088 | Finished mapping ${...} transactions for |

### Component: index.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| index.ts | ``[index.ts] LOG_LEVEL from process.env after dotenv.config(): ${process.env.LOG_LEVEL}`` | LOG | 9 | [index.ts] LOG_LEVEL from process.env after |
| index.ts | `'Wallet Analysis Bot initialized and started'` | INFO | 29 | Wallet Analysis Bot initialized and |
| index.ts | `'Failed to start Wallet Analysis Bot:'` | ERROR | 31 | Failed to start Wallet Analysis |
| index.ts | `'Unhandled error in main:'` | ERROR | 39 | Unhandled error in main: |

### Component: mint-participants.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| mint-participants.ts | ``[creation-scan] owner=${owner} pages=${pages} total=${total}`` | LOG | 338 | [creation-scan] owner=${...} pages=${...} total=${...} |
| mint-participants.ts | ``[creation-scan] owner=${owner} hit MAX_PAGES=${MAX_PAGES}; stopping early.`` | WARN | 341 | [creation-scan] owner=${...} hit MAX_PAGES=${...}; stopping |

### Component: onchain-metadata.service.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| onchain-metadata.service.ts | ``Insecure HTTP URI detected: ${sanitizeUriForLogging(uri)}`` | WARN | 113 | Insecure HTTP URI detected: ${...} |
| onchain-metadata.service.ts | ``Non-trusted gateway: ${sanitizeUriForLogging(uri)}`` | WARN | 118 | Non-trusted gateway: ${...} |
| onchain-metadata.service.ts | ``String truncated from ${obj.length} to ${MAX_STRING_LENGTH} chars`` | WARN | 154 | String truncated from ${...} to |
| onchain-metadata.service.ts | ``Array truncated from ${obj.length} to ${MAX_ARRAY_LENGTH} elements`` | WARN | 163 | Array truncated from ${...} to |
| onchain-metadata.service.ts | ``Stripped dangerous key: ${key}`` | WARN | 175 | Stripped dangerous key: ${...} |
| onchain-metadata.service.ts | ``Fetching basic metadata for ${mints.length} tokens via DAS API`` | INFO | 204 | Fetching basic metadata for ${...} |
| onchain-metadata.service.ts | ``Successfully fetched basic metadata for ${results.length}/${mints.length} tokens`` | INFO | 222 | Successfully fetched basic metadata for |
| onchain-metadata.service.ts | `'Failed to fetch basic metadata from DAS:'` | ERROR | 225 | Failed to fetch basic metadata |
| onchain-metadata.service.ts | ``Security violation for ${mint}: ${error.message}`` | WARN | 260 | Security violation for ${...}: ${...} |
| onchain-metadata.service.ts | ``Failed to fetch metadata for ${mint}: ${error.message}`` | DEBUG | 262 | Failed to fetch metadata for |
| onchain-metadata.service.ts | ``Security validation failed for URI: ${error.message}`` | WARN | 298 | Security validation failed for URI: |
| onchain-metadata.service.ts | ``Retry ${attempt}/${maxAttempts} for ${sanitizeUriForLogging(uri)} after ${delay}ms`` | DEBUG | 335 | Retry ${...}/${...} for ${...} after |
| onchain-metadata.service.ts | ``Unexpected Content-Type "${contentType}" from ${sanitizeUriForLogging(uri)}`` | WARN | 379 | Unexpected Content-Type ${...} from ${...} |

### Component: pnl_calculator.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| pnl_calculator.ts | ``Calculating PNL for ${Object.keys(transactionsByWallet).length} wallets.`` | INFO | 42 | Calculating PNL for ${...} wallets. |
| pnl_calculator.ts | ``- PNL for ${walletAddress}: ${pnl.toFixed(4)} SOL`` | DEBUG | 46 | - PNL for ${...}: ${...} |

### Component: pnl-analysis-service.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| pnl-analysis-service.ts | `'PnlAnalysisService instantiated with HeliusApiClient and TokenInfoService. WalletBalanceService act` | INFO | 61 | PnlAnalysisService instantiated with HeliusApiClient and |
| pnl-analysis-service.ts | `'PnlAnalysisService instantiated without HeliusApiClient. WalletBalanceService inactive.'` | INFO | 64 | PnlAnalysisService instantiated without HeliusApiClient. WalletBalanceService |
| pnl-analysis-service.ts | ``[PnlAnalysis] Starting analysis for wallet ${walletAddress}`` | DEBUG | 86 | [PnlAnalysis] Starting analysis for wallet |
| pnl-analysis-service.ts | ``[PnlAnalysis] Skipping balance fetch for ${walletAddress} (skipBalanceFetch=true)`` | DEBUG | 103 | [PnlAnalysis] Skipping balance fetch for |
| pnl-analysis-service.ts | ``[PnlAnalysis] Retrieved stored balance data for ${walletAddress}. SOL: ${solBalance}, Tokens: ${tok` | INFO | 135 | [PnlAnalysis] Retrieved stored balance data |
| pnl-analysis-service.ts | ``[PnlAnalysis] No stored balance data found for ${walletAddress}`` | DEBUG | 137 | [PnlAnalysis] No stored balance data |
| pnl-analysis-service.ts | ``[PnlAnalysis] Failed to retrieve stored balance data for ${walletAddress}: ${error}`` | WARN | 140 | [PnlAnalysis] Failed to retrieve stored |
| pnl-analysis-service.ts | ``[PnlAnalysis] Using pre-fetched wallet state for ${walletAddress}. SOL: ${currentWalletBalance.solB` | INFO | 148 | [PnlAnalysis] Using pre-fetched wallet state |
| pnl-analysis-service.ts | ``[PnlAnalysis] Fetching current wallet state for ${walletAddress}...`` | DEBUG | 152 | [PnlAnalysis] Fetching current wallet state |
| pnl-analysis-service.ts | ``[PnlAnalysis] Successfully fetched wallet state for ${walletAddress}. SOL: ${currentWalletBalance.s` | INFO | 157 | [PnlAnalysis] Successfully fetched wallet state |
| pnl-analysis-service.ts | ``[PnlAnalysis] Failed to fetch wallet state for ${walletAddress}. Proceeding without live balances. ` | WARN | 160 | [PnlAnalysis] Failed to fetch wallet |
| pnl-analysis-service.ts | ``[PnlAnalysis] WalletBalanceService is not active (no HeliusApiClient provided). Skipping live balan` | DEBUG | 164 | [PnlAnalysis] WalletBalanceService is not active |
| pnl-analysis-service.ts | ``[PnlAnalysis] No swap analysis input records found for ${walletAddress}${timeRange ? ' in time rang` | WARN | 189 | [PnlAnalysis] No swap analysis input |
| pnl-analysis-service.ts | ``[PnlAnalysis] Fetched ${swapInputs.length} swap input records from DB.`` | DEBUG | 198 | [PnlAnalysis] Fetched ${...} swap input |
| pnl-analysis-service.ts | ``[PnlAnalysis] Error fetching swap inputs for ${walletAddress}. Message: ${errorMessage}`` | ERROR | 202 | [PnlAnalysis] Error fetching swap inputs |
| pnl-analysis-service.ts | ``[PnlAnalysis] SwapAnalyzer finished for ${walletAddress}. Got ${swapAnalysisResultsFromAnalyzer.len` | DEBUG | 229 | [PnlAnalysis] SwapAnalyzer finished for ${...}. |
| pnl-analysis-service.ts | ``[PnlAnalysis] No results from SwapAnalyzer for wallet ${walletAddress}. Returning empty summary.`` | WARN | 252 | [PnlAnalysis] No results from SwapAnalyzer |
| pnl-analysis-service.ts | ``[PnlAnalysis] Cannot calculate unrealized PNL without proper SOL price. Skipping unrealized PNL cal` | WARN | 288 | [PnlAnalysis] Cannot calculate unrealized PNL |
| pnl-analysis-service.ts | ``[PnlAnalysis] Using SOL price: $${estimatedSolPriceUsd} for unrealized PNL calculation`` | DEBUG | 290 | [PnlAnalysis] Using SOL price: $${...} |
| pnl-analysis-service.ts | ``[PnlAnalysis] Skipping unrealistic token ${tokenBalance.mint}: ${currentHoldingsValueSol.toFixed(2)` | WARN | 312 | [PnlAnalysis] Skipping unrealistic token ${...}: |
| pnl-analysis-service.ts | ``[PnlAnalysis] Skipping token with suspicious price ${tokenBalance.mint}: $${priceUsd} vs SOL $${est` | WARN | 317 | [PnlAnalysis] Skipping token with suspicious |
| pnl-analysis-service.ts | ``[PnlAnalysis] Skipping excluded token ${tokenBalance.mint} from unrealized PnL calculation (configu` | DEBUG | 324 | [PnlAnalysis] Skipping excluded token ${...} |
| pnl-analysis-service.ts | ``[PnlAnalysis] Skipping unrealistic unrealized PnL for ${tokenBalance.mint}: ${unrealizedPnlSol.toFi` | WARN | 343 | [PnlAnalysis] Skipping unrealistic unrealized PnL |
| pnl-analysis-service.ts | ``[PnlAnalysis] Skipping unrealized PNL calculation due to missing SOL price data`` | WARN | 350 | [PnlAnalysis] Skipping unrealized PNL calculation |
| pnl-analysis-service.ts | ``[PnlAnalysis] Calculated unrealized PNL for ${walletAddress}: ${unrealizedPnl} SOL`` | DEBUG | 353 | [PnlAnalysis] Calculated unrealized PNL for |
| pnl-analysis-service.ts | ``[PnlAnalysis] Failed to calculate unrealized PNL for ${walletAddress}: ${error}`` | WARN | 355 | [PnlAnalysis] Failed to calculate unrealized |
| pnl-analysis-service.ts | ``[PnlAnalysis] No non-stablecoin results for advanced stats for ${walletAddress}.`` | WARN | 368 | [PnlAnalysis] No non-stablecoin results for |
| pnl-analysis-service.ts | ``[PnlAnalysis] Error during advanced stats calculation for ${walletAddress}:`` | ERROR | 370 | [PnlAnalysis] Error during advanced stats |
| pnl-analysis-service.ts | ``[PnlAnalysis] Upserted WalletPnlSummary (no advanced stats) for ${walletAddress}.`` | INFO | 462 | [PnlAnalysis] Upserted WalletPnlSummary (no advanced |
| pnl-analysis-service.ts | ``[PnlAnalysis] Batch upserted ${resultsToUpsert.length} AnalysisResult records for ${walletAddress}.` | DEBUG | 509 | [PnlAnalysis] Batch upserted ${...} AnalysisResult |
| pnl-analysis-service.ts | ``[PnlAnalysis] Successfully marked AnalysisRun ${runId} as COMPLETED.`` | INFO | 530 | [PnlAnalysis] Successfully marked AnalysisRun ${...} |
| pnl-analysis-service.ts | ``[PnlAnalysis] Analysis completed for ${walletAddress}${timeRangeStr}: ${swapInputs.length} transact` | INFO | 535 | [PnlAnalysis] Analysis completed for ${...}${...}: |
| pnl-analysis-service.ts | ``[PnlAnalysis] Critical error during PNL analysis for ${walletAddress}:`` | ERROR | 540 | [PnlAnalysis] Critical error during PNL |
| pnl-analysis-service.ts | ``[PnlAnalysis] FAILED to update AnalysisRun ${runId} to FAILED status:`` | ERROR | 547 | [PnlAnalysis] FAILED to update AnalysisRun |
| pnl-analysis-service.ts | ``[PnlAnalysis] Error in finally block updating AnalysisRun ${runId}:`` | ERROR | 560 | [PnlAnalysis] Error in finally block |

### Component: report_utils.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| report_utils.ts | ``Generating behavior report for ${walletAddress}`` | DEBUG | 72 | Generating behavior report for ${...} |
| report_utils.ts | ``Generating correlation report for ${walletInfos.length} wallets.`` | DEBUG | 225 | Generating correlation report for ${...} |
| report_utils.ts | ``Generating similarity report for ${walletInfos.length} wallets.`` | DEBUG | 313 | Generating similarity report for ${...} |
| report_utils.ts | `'[ReportUtils] No summary or results provided for CSV generation.'` | WARN | 580 | [ReportUtils] No summary or results |
| report_utils.ts | `'Error unparsing CSV data:'` | ERROR | 646 | Error unparsing CSV data: |
| report_utils.ts | ``Created reports directory: ${reportsDir}`` | INFO | 663 | Created reports directory: ${...} |
| report_utils.ts | ``Report saved successfully to ${reportPath}`` | DEBUG | 673 | Report saved successfully to ${...} |
| report_utils.ts | ``Failed to save report to ${reportPath}:`` | ERROR | 676 | Failed to save report to |

### Component: reportGenerator.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| reportGenerator.ts | `'ReportingService instantiated'` | INFO | 37 | ReportingService instantiated |
| reportGenerator.ts | `'BehaviorService not injected. Cannot generate comparative behavior report.'` | ERROR | 48 | BehaviorService not injected. Cannot generate |
| reportGenerator.ts | `'No wallets provided for comparison report.'` | WARN | 52 | No wallets provided for comparison |
| reportGenerator.ts | ``Generating comparative report for ${wallets.length} wallets`` | INFO | 56 | Generating comparative report for ${...} |
| reportGenerator.ts | ``Analyzing wallet: ${walletId}`` | INFO | 62 | Analyzing wallet: ${...} |
| reportGenerator.ts | ``Saved individual report for ${wallet.address} to ${reportPath}`` | INFO | 75 | Saved individual report for ${...} |
| reportGenerator.ts | ``No metrics generated for wallet ${wallet.address}, skipping its reports.`` | WARN | 77 | No metrics generated for wallet |
| reportGenerator.ts | ``Error processing wallet ${walletId} for comparison report:`` | ERROR | 80 | Error processing wallet ${...} for |
| reportGenerator.ts | `'KPIAnalyzer not injected. Cannot generate final comparison.'` | WARN | 86 | KPIAnalyzer not injected. Cannot generate |
| reportGenerator.ts | `'Failed to collect metrics for any wallets. No comparison report generated.'` | WARN | 87 | Failed to collect metrics for |
| reportGenerator.ts | ``Saved comparative report to ${reportPath}`` | INFO | 95 | Saved comparative report to ${...} |
| reportGenerator.ts | `'Error generating or saving the final comparison report:'` | ERROR | 97 | Error generating or saving the |
| reportGenerator.ts | `'Comparative report generation process complete.'` | INFO | 100 | Comparative report generation process complete. |
| reportGenerator.ts | ``No metrics provided for wallet ${walletAddress}. Cannot generate individual behavior report.`` | WARN | 111 | No metrics provided for wallet |
| reportGenerator.ts | ``Generating individual behavior report (MD) for ${walletAddress}`` | DEBUG | 114 | Generating individual behavior report (MD) |
| reportGenerator.ts | ``Saved individual behavior report (MD) for ${walletAddress} to ${reportPath}`` | INFO | 118 | Saved individual behavior report (MD) |
| reportGenerator.ts | ``Error generating or saving individual behavior report (MD) for ${walletAddress}:`` | ERROR | 120 | Error generating or saving individual |
| reportGenerator.ts | `'CorrelationService not injected. Cannot generate correlation report.'` | ERROR | 129 | CorrelationService not injected. Cannot generate |
| reportGenerator.ts | `'No wallets provided for correlation report.'` | WARN | 133 | No wallets provided for correlation |
| reportGenerator.ts | ``Generating correlation report for ${targetWallets.length} wallets...`` | INFO | 136 | Generating correlation report for ${...} |
| reportGenerator.ts | `'Correlation result has pairs/clusters, but could not map all to original WalletInfo. Report might l` | WARN | 163 | Correlation result has pairs/clusters, but |
| reportGenerator.ts | ``Saved correlation report to ${reportPath}`` | INFO | 176 | Saved correlation report to ${...} |
| reportGenerator.ts | `'Correlation analysis did not produce results. Report not generated.'` | WARN | 178 | Correlation analysis did not produce |
| reportGenerator.ts | `'Error generating or saving correlation report:'` | ERROR | 181 | Error generating or saving correlation |
| reportGenerator.ts | `'SimilarityService not injected. Cannot generate similarity report.'` | ERROR | 195 | SimilarityService not injected. Cannot generate |
| reportGenerator.ts | ``Generating similarity report for ${walletAddresses.length} wallets (type: ${vectorType})...`` | INFO | 198 | Generating similarity report for ${...} |
| reportGenerator.ts | ``Saved similarity report to ${reportPath}`` | INFO | 220 | Saved similarity report to ${...} |
| reportGenerator.ts | `'Similarity analysis did not produce results. Report not generated.'` | WARN | 222 | Similarity analysis did not produce |
| reportGenerator.ts | `'Error generating or saving similarity report:'` | ERROR | 225 | Error generating or saving similarity |
| reportGenerator.ts | ``[ReportingService] No summary provided for ${walletAddress}. Cannot generate Swap Pnl report.`` | WARN | 237 | [ReportingService] No summary provided for |
| reportGenerator.ts | ``[ReportingService] Generating Swap Pnl report for ${walletAddress}...`` | INFO | 240 | [ReportingService] Generating Swap Pnl report |
| reportGenerator.ts | ``[ReportingService] Saved Swap Pnl report to ${reportPath}`` | INFO | 244 | [ReportingService] Saved Swap Pnl report |
| reportGenerator.ts | ``[ReportingService] Error generating or saving Swap Pnl report for ${walletAddress}:`` | ERROR | 246 | [ReportingService] Error generating or saving |
| reportGenerator.ts | ``[ReportingService] No summary provided for ${walletAddress}. Cannot generate Swap Pnl CSV.`` | WARN | 259 | [ReportingService] No summary provided for |
| reportGenerator.ts | ``[ReportingService] Generating Swap Pnl CSV for ${walletAddress}...`` | INFO | 262 | [ReportingService] Generating Swap Pnl CSV |
| reportGenerator.ts | ``[ReportingService] Saved Swap Pnl CSV to ${reportPath}`` | INFO | 267 | [ReportingService] Saved Swap Pnl CSV |
| reportGenerator.ts | ``[ReportingService] CSV content generation failed for ${walletAddress}.`` | WARN | 269 | [ReportingService] CSV content generation failed |
| reportGenerator.ts | ``[ReportingService] Error generating or saving Swap Pnl CSV for ${walletAddress}:`` | ERROR | 272 | [ReportingService] Error generating or saving |

### Component: similarity-service.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| similarity-service.ts | `'Similarity calculation requires at least 2 wallets.'` | WARN | 52 | Similarity calculation requires at least |
| similarity-service.ts | ``Fetched transaction data for ${Object.keys(transactionData).length} wallets.`` | DEBUG | 60 | Fetched transaction data for ${...} |
| similarity-service.ts | ``Error fetching transaction data for similarity analysis:`` | ERROR | 62 | Error fetching transaction data for |
| similarity-service.ts | `'Less than 2 wallets have transaction data after fetching. Skipping similarity.'` | WARN | 69 | Less than 2 wallets have |
| similarity-service.ts | ``[Primary Filtered] Wallet ${walletAddr.slice(0, 8)}...${walletAddr.slice(-4)}: ${walletResults.leng` | DEBUG | 105 | [Primary Filtered] Wallet ${...}...${...}: ${...} |
| similarity-service.ts | ``[Primary Filtered] Filtered from ${primaryRelevantMints.length} to ${filteredPrimaryMints.length} t` | DEBUG | 113 | [Primary Filtered] Filtered from ${...} |
| similarity-service.ts | ``[Primary Filtered] Wallet ${walletAddr.slice(0, 8)}...${walletAddr.slice(-4)}: ${filteredCount}/${o` | DEBUG | 127 | [Primary Filtered] Wallet ${...}...${...}: ${...}/${...} |
| similarity-service.ts | ``[Primary Filtered Similarity] Calculated ${vectorType} similarity for ${walletsWithPrimaryVectors.l` | INFO | 141 | [Primary Filtered Similarity] Calculated ${...} |
| similarity-service.ts | ``Less than 2 wallets have data for filtered primary vector type ${vectorType}. Cosine matrix will be` | WARN | 143 | Less than 2 wallets have |
| similarity-service.ts | ``No actively traded tokens found for primary vector type ${vectorType}. Cosine matrix will be empty.` | WARN | 146 | No actively traded tokens found |
| similarity-service.ts | ``[Historical Similarity] Found ${binaryRelevantMints.length} relevant mints from transaction data`` | DEBUG | 163 | [Historical Similarity] Found ${...} relevant |
| similarity-service.ts | `'[Historical Filtered] No actively traded tokens found after filtering. Skipping historical similari` | WARN | 218 | [Historical Filtered] No actively traded |
| similarity-service.ts | `'No relevant mints for binary vectors. Jaccard matrix will be empty.'` | WARN | 224 | No relevant mints for binary |
| similarity-service.ts | `'Calculated Jaccard similarity for current holdings presence (all tokens).'` | DEBUG | 309 | Calculated Jaccard similarity for current |
| similarity-service.ts | `'Calculated Cosine similarity for current holdings presence.'` | DEBUG | 316 | Calculated Cosine similarity for current |
| similarity-service.ts | `'[Holdings Filtered] Starting filtered holdings similarity calculation...'` | DEBUG | 348 | [Holdings Filtered] Starting filtered holdings |
| similarity-service.ts | ``[Holdings Filtered] Wallet ${walletAddr.slice(0,8)}...${walletAddr.slice(-4)}: ${walletResults.leng` | DEBUG | 365 | [Holdings Filtered] Wallet ${...}...${...}: ${...} |
| similarity-service.ts | `'[Holdings Filtered] Error calculating filtered holdings similarity:'` | ERROR | 406 | [Holdings Filtered] Error calculating filtered |
| similarity-service.ts | `'Less than 2 wallets have valid holdings presence vectors. Skipping holdings similarity.'` | WARN | 410 | Less than 2 wallets have |
| similarity-service.ts | `'No unique tokens found in current holdings. Skipping holdings similarity.'` | WARN | 413 | No unique tokens found in |
| similarity-service.ts | `'Less than 2 wallets have balance data provided. Skipping holdings similarity.'` | WARN | 416 | Less than 2 wallets have |
| similarity-service.ts | `'Only 1 wallet has balance data; cannot calculate holdings-based similarity.'` | WARN | 419 | Only 1 wallet has balance |
| similarity-service.ts | ``Comprehensive similarity analysis completed for ${walletsWithFetchedData.length} wallets.`` | INFO | 423 | Comprehensive similarity analysis completed for |
| similarity-service.ts | `'[analyzeSharedTokensInternal] Less than 2 wallets, skipping.'` | DEBUG | 438 | [analyzeSharedTokensInternal] Less than 2 wallets, |
| similarity-service.ts | `'[analyzeSharedTokensInternal] Identifying shared tokens...'` | DEBUG | 442 | [analyzeSharedTokensInternal] Identifying shared tokens... |
| similarity-service.ts | ``[analyzeSharedTokensInternal] Found ${sharedTokensResult.length} shared tokens.`` | DEBUG | 469 | [analyzeSharedTokensInternal] Found ${...} shared tokens. |
| similarity-service.ts | ``[calculateWalletPairCounts] Calculated shared token counts between ${targetWalletAddresses.length} ` | DEBUG | 497 | [calculateWalletPairCounts] Calculated shared token counts |

### Component: smart-fetch-service.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| smart-fetch-service.ts | ``🤖 Auto-classified ${walletAddress} as 'high_frequency': ${recommendation.reason}`` | INFO | 53 | 🤖 Auto-classified ${...} as high_frequency: |
| smart-fetch-service.ts | ``✅ Auto-classified ${walletAddress} as 'normal': ${recommendation.reason}`` | INFO | 61 | ✅ Auto-classified ${...} as normal: |

### Component: test-current-holdings-fix.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| test-current-holdings-fix.ts | `'🧪 Testing Current Holdings Calculation & Deterministic Fix\n'` | LOG | 112 | 🧪 Testing Current Holdings Calculation |
| test-current-holdings-fix.ts | `'🔄 Testing: Deterministic Behavior'` | LOG | 127 | 🔄 Testing: Deterministic Behavior |
| test-current-holdings-fix.ts | `' ✅ PASSED - Results are deterministic'` | LOG | 144 | ✅ PASSED - Results |
| test-current-holdings-fix.ts | `' ❌ FAILED - Results vary between runs'` | LOG | 147 | ❌ FAILED - Results |
| test-current-holdings-fix.ts | `` Run 1: avgDuration=${result1.averageCurrentHoldingDurationHours}, percentValue=${result1.percentOf` | LOG | 148 | Run 1: avgDuration=${...}, percentValue=${...} |
| test-current-holdings-fix.ts | `` Run 2: avgDuration=${result2.averageCurrentHoldingDurationHours}, percentValue=${result2.percentOf` | LOG | 149 | Run 2: avgDuration=${...}, percentValue=${...} |
| test-current-holdings-fix.ts | `''` | LOG | 151 | Log statement |
| test-current-holdings-fix.ts | ``📊 Testing: ${scenario.name}`` | LOG | 155 | 📊 Testing: ${...} |
| test-current-holdings-fix.ts | `` Expected current holding duration: ${scenario.expectedCurrentHoldingDuration?.toFixed(3)} hours`` | LOG | 166 | Expected current holding duration: |
| test-current-holdings-fix.ts | `` Actual current holding duration: ${result.averageCurrentHoldingDurationHours.toFixed(3)} hours`` | LOG | 167 | Actual current holding duration: |
| test-current-holdings-fix.ts | `` Expected % value in holdings: ${scenario.expectedPercentOfValueInCurrentHoldings}%`` | LOG | 168 | Expected % value in |
| test-current-holdings-fix.ts | `` Actual % value in holdings: ${result.percentOfValueInCurrentHoldings.toFixed(1)}%`` | LOG | 169 | Actual % value in |
| test-current-holdings-fix.ts | `` ✅ PASSED\n`` | LOG | 179 | ✅ PASSED\n |
| test-current-holdings-fix.ts | `` ❌ FAILED`` | LOG | 182 | ❌ FAILED |
| test-current-holdings-fix.ts | `` - Current holding duration mismatch`` | LOG | 183 | - Current holding duration |
| test-current-holdings-fix.ts | `` - Percentage value mismatch`` | LOG | 184 | - Percentage value mismatch |
| test-current-holdings-fix.ts | `''` | LOG | 185 | Log statement |
| test-current-holdings-fix.ts | `` ❌ FAILED - Error: ${error}\n`` | LOG | 189 | ❌ FAILED - Error: |
| test-current-holdings-fix.ts | `'📊 Testing: No Current Holdings (All Sold)'` | LOG | 194 | 📊 Testing: No Current Holdings |
| test-current-holdings-fix.ts | `' ✅ PASSED - No current holdings correctly handled\n'` | LOG | 218 | ✅ PASSED - No |
| test-current-holdings-fix.ts | `' ❌ FAILED - Should have zero current holdings'` | LOG | 221 | ❌ FAILED - Should |
| test-current-holdings-fix.ts | `` Duration: ${result.averageCurrentHoldingDurationHours}, Percentage: ${result.percentOfValueInCurre` | LOG | 222 | Duration: ${...}, Percentage: ${...}\n |
| test-current-holdings-fix.ts | ``\n📋 Test Results: ${passedTests}/${totalTests} tests passed`` | LOG | 225 | \n📋 Test Results: ${...}/${...} tests |
| test-current-holdings-fix.ts | `'🎉 All tests passed! Current holdings calculation and deterministic fix are working correctly.'` | LOG | 228 | 🎉 All tests passed! Current |
| test-current-holdings-fix.ts | `'⚠️ Some tests failed. Current holdings calculation needs review.'` | LOG | 230 | ⚠️ Some tests failed. Current |

### Component: test-fifo-holding-time.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| test-fifo-holding-time.ts | `'🧪 Testing FIFO Holding Time Calculation\n'` | LOG | 117 | 🧪 Testing FIFO Holding Time |
| test-fifo-holding-time.ts | ``📊 Testing: ${scenario.name}`` | LOG | 133 | 📊 Testing: ${...} |
| test-fifo-holding-time.ts | `` Expected durations: [${scenario.expectedDurations.map(d => d.toFixed(3)).join(', ')}] hours`` | LOG | 141 | Expected durations: [${...}] hours |
| test-fifo-holding-time.ts | `` Actual durations: [${actualDurations.map(d => d.toFixed(3)).join(', ')}] hours`` | LOG | 142 | Actual durations: [${...}] hours |
| test-fifo-holding-time.ts | `` Expected pairs: ${scenario.expectedPairs}`` | LOG | 143 | Expected pairs: ${...} |
| test-fifo-holding-time.ts | `` Actual pairs: ${actualPairs}`` | LOG | 144 | Actual pairs: ${...} |
| test-fifo-holding-time.ts | `` ✅ PASSED\n`` | LOG | 156 | ✅ PASSED\n |
| test-fifo-holding-time.ts | `` ❌ FAILED`` | LOG | 159 | ❌ FAILED |
| test-fifo-holding-time.ts | `` - Duration mismatch`` | LOG | 160 | - Duration mismatch |
| test-fifo-holding-time.ts | `` - Pairs count mismatch`` | LOG | 161 | - Pairs count mismatch |
| test-fifo-holding-time.ts | `''` | LOG | 162 | Log statement |
| test-fifo-holding-time.ts | `` ❌ FAILED - Error: ${error}\n`` | LOG | 166 | ❌ FAILED - Error: |
| test-fifo-holding-time.ts | ``\n📋 Test Results: ${passedTests}/${totalTests} tests passed`` | LOG | 170 | \n📋 Test Results: ${...}/${...} tests |
| test-fifo-holding-time.ts | `'🎉 All tests passed! FIFO implementation is working correctly.'` | LOG | 173 | 🎉 All tests passed! FIFO |
| test-fifo-holding-time.ts | `'⚠️ Some tests failed. Please review the implementation.'` | LOG | 175 | ⚠️ Some tests failed. Please |

### Component: test-holder-risk-analysis.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| test-holder-risk-analysis.ts | `'\n=== Test 1: Exit Detection (20% threshold) ==='` | LOG | 51 | \n=== Test 1: Exit Detection |
| test-holder-risk-analysis.ts | `'Exit detection result:'` | LOG | 60 | Exit detection result: |
| test-holder-risk-analysis.ts | `'✓ Should detect EXITED status when position drops to ≤20% of peak'` | LOG | 61 | ✓ Should detect EXITED status |
| test-holder-risk-analysis.ts | `'\n=== Test 2: Multiple Completed Cycles (Historical Pattern) ==='` | LOG | 64 | \n=== Test 2: Multiple Completed |
| test-holder-risk-analysis.ts | `'\nHistorical Pattern Result:'` | LOG | 85 | \nHistorical Pattern Result: |
| test-holder-risk-analysis.ts | `` - Completed Cycles: ${pattern2?.completedCycleCount}`` | LOG | 86 | - Completed Cycles: ${...} |
| test-holder-risk-analysis.ts | `` - Average Hold Time: ${pattern2?.historicalAverageHoldTimeHours.toFixed(2)}h`` | LOG | 87 | - Average Hold Time: |
| test-holder-risk-analysis.ts | `` - Median Hold Time: ${pattern2?.medianCompletedHoldTimeHours.toFixed(2)}h`` | LOG | 88 | - Median Hold Time: |
| test-holder-risk-analysis.ts | `` - Behavior Type: ${pattern2?.behaviorType}`` | LOG | 89 | - Behavior Type: ${...} |
| test-holder-risk-analysis.ts | `` - Exit Pattern: ${pattern2?.exitPattern}`` | LOG | 90 | - Exit Pattern: ${...} |
| test-holder-risk-analysis.ts | `` - Data Quality: ${pattern2?.dataQuality.toFixed(2)}`` | LOG | 91 | - Data Quality: ${...} |
| test-holder-risk-analysis.ts | `` - Observation Period: ${pattern2?.observationPeriodDays.toFixed(1)} days`` | LOG | 92 | - Observation Period: ${...} |
| test-holder-risk-analysis.ts | `'✓ Should calculate pattern from 3 completed cycles, excluding active TOKEN_D'` | LOG | 93 | ✓ Should calculate pattern from |
| test-holder-risk-analysis.ts | `'\n=== Test 3: Insufficient Data (< 3 completed cycles) ==='` | LOG | 96 | \n=== Test 3: Insufficient Data |
| test-holder-risk-analysis.ts | `'Result:'` | LOG | 106 | Result: |
| test-holder-risk-analysis.ts | `'✓ Should return null when < 3 completed cycles'` | LOG | 107 | ✓ Should return null when |
| test-holder-risk-analysis.ts | `'\n=== Test 4: Position Status Classification ==='` | LOG | 110 | \n=== Test 4: Position Status |
| test-holder-risk-analysis.ts | `'Completed cycles (should be 2: DUST + EXITED):'` | LOG | 131 | Completed cycles (should be 2: |
| test-holder-risk-analysis.ts | `'✓ Should correctly classify: DUST, EXITED, PROFIT_TAKER, FULL_HOLDER'` | LOG | 132 | ✓ Should correctly classify: DUST, |
| test-holder-risk-analysis.ts | `'\n=== Test 5: Weighted Average Holding Time ==='` | LOG | 135 | \n=== Test 5: Weighted Average |
| test-holder-risk-analysis.ts | `'Average hold time:'` | LOG | 145 | Average hold time: |
| test-holder-risk-analysis.ts | `'Expected: closer to 2.5h (9000s for 1000 tokens) than 1.67h (unweighted avg)'` | LOG | 146 | Expected: closer to 2.5h (9000s |
| test-holder-risk-analysis.ts | `'✓ Large positions should have more influence on average'` | LOG | 147 | ✓ Large positions should have |
| test-holder-risk-analysis.ts | `'\n=== Test 6: Behavior Type Classification ==='` | LOG | 150 | \n=== Test 6: Behavior Type |
| test-holder-risk-analysis.ts | `'\nUltra Flipper:'` | LOG | 163 | \nUltra Flipper: |
| test-holder-risk-analysis.ts | `'Flipper:'` | LOG | 176 | Flipper: |
| test-holder-risk-analysis.ts | `'Swing Trader:'` | LOG | 189 | Swing Trader: |
| test-holder-risk-analysis.ts | `'Holder:'` | LOG | 202 | Holder: |
| test-holder-risk-analysis.ts | `'\n✓ All behavior types classified correctly'` | LOG | 204 | \n✓ All behavior types classified |
| test-holder-risk-analysis.ts | `'\n=== Test 7: Exit Pattern Detection ==='` | LOG | 207 | \n=== Test 7: Exit Pattern |
| test-holder-risk-analysis.ts | `'All-at-once pattern:'` | LOG | 221 | All-at-once pattern: |
| test-holder-risk-analysis.ts | `'Gradual pattern:'` | LOG | 241 | Gradual pattern: |
| test-holder-risk-analysis.ts | `'\n✓ Exit patterns detected correctly'` | LOG | 243 | \n✓ Exit patterns detected correctly |
| test-holder-risk-analysis.ts | `'\n=== Test Summary ==='` | LOG | 246 | \n=== Test Summary === |
| test-holder-risk-analysis.ts | `'✓ Exit detection (20% threshold)'` | LOG | 247 | ✓ Exit detection (20% threshold) |
| test-holder-risk-analysis.ts | `'✓ Historical pattern calculation'` | LOG | 248 | ✓ Historical pattern calculation |
| test-holder-risk-analysis.ts | `'✓ Insufficient data handling'` | LOG | 249 | ✓ Insufficient data handling |
| test-holder-risk-analysis.ts | `'✓ Position status classification'` | LOG | 250 | ✓ Position status classification |
| test-holder-risk-analysis.ts | `'✓ Weighted average holding time'` | LOG | 251 | ✓ Weighted average holding time |
| test-holder-risk-analysis.ts | `'✓ Behavior type classification (ULTRA_FLIPPER, FLIPPER, SWING, HOLDER)'` | LOG | 252 | ✓ Behavior type classification (ULTRA_FLIPPER, |
| test-holder-risk-analysis.ts | `'✓ Exit pattern detection (ALL_AT_ONCE, GRADUAL)'` | LOG | 253 | ✓ Exit pattern detection (ALL_AT_ONCE, |
| test-holder-risk-analysis.ts | `'\n✅ All holder risk analysis tests passed!\n'` | LOG | 254 | \n✅ All holder risk analysis |

### Component: token-first-buyers-service.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| token-first-buyers-service.ts | ``Starting first buyers analysis for token mint: ${mintAddress}`` | INFO | 100 | Starting first buyers analysis for |
| token-first-buyers-service.ts | ``Target: ${maxBuyers} buyers, Max signatures: ${maxSignatures}, Batch size: ${batchSize}`` | DEBUG | 101 | Target: ${...} buyers, Max signatures: |
| token-first-buyers-service.ts | ``Address type: ${addressType}`` | DEBUG | 102 | Address type: ${...} |
| token-first-buyers-service.ts | ``Using address for transaction fetch: ${fetchAddress.address} (${fetchAddress.type})`` | DEBUG | 106 | Using address for transaction fetch: |
| token-first-buyers-service.ts | ``No signatures found for address: ${fetchAddress.address}`` | WARN | 116 | No signatures found for address: |
| token-first-buyers-service.ts | ``Processing ${oldestFirst.length} signatures chronologically from oldest to newest`` | INFO | 122 | Processing ${...} signatures chronologically from |
| token-first-buyers-service.ts | ``Reached target of ${maxBuyers} unique buyers, stopping processing`` | INFO | 130 | Reached target of ${...} unique |
| token-first-buyers-service.ts | ``🔄 Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.length} signatures (${uniqueBuyers.si` | INFO | 137 | 🔄 Processing batch ${...}: ${...} |
| token-first-buyers-service.ts | ``👤 Found buyer #${uniqueBuyers.size}: ${walletAddress}`` | INFO | 182 | 👤 Found buyer #${...}: ${...} |
| token-first-buyers-service.ts | ``Reached target of ${maxBuyers} unique buyers`` | INFO | 186 | Reached target of ${...} unique |
| token-first-buyers-service.ts | ``Progress: ${progress}% (${processedSignatures}/${oldestFirst.length} signatures) - Found ${uniqueBu` | INFO | 198 | Progress: ${...}% (${...}/${...} signatures) - |
| token-first-buyers-service.ts | ``Error processing batch starting at index ${i}: ${errorMessage}`` | ERROR | 203 | Error processing batch starting at |
| token-first-buyers-service.ts | ``Completed analysis for ${mintAddress}:`` | INFO | 213 | Completed analysis for ${...}: |
| token-first-buyers-service.ts | ``- Processed ${processedSignatures} signatures`` | INFO | 214 | - Processed ${...} signatures |
| token-first-buyers-service.ts | ``- Found ${firstBuyers.length} unique first buyers`` | INFO | 215 | - Found ${...} unique first |
| token-first-buyers-service.ts | ``- Time range: ${firstBuy.toISOString()} to ${lastBuy.toISOString()}`` | INFO | 220 | - Time range: ${...} to |
| token-first-buyers-service.ts | ``📍 Using mint address directly (may miss bonding curve period)`` | INFO | 243 | 📍 Using mint address directly |
| token-first-buyers-service.ts | ``📍 Using provided bonding curve address`` | INFO | 248 | 📍 Using provided bonding curve |
| token-first-buyers-service.ts | ``⚠️ Bonding curve requested but no address provided. Using mint address.`` | WARN | 251 | ⚠️ Bonding curve requested but |
| token-first-buyers-service.ts | ``🤖 Auto mode: Using mint address. For pump.fun tokens, specify bonding curve address.`` | WARN | 259 | 🤖 Auto mode: Using mint |
| token-first-buyers-service.ts | ``📡 Fetching signatures for ${addressType}: ${address}`` | DEBUG | 277 | 📡 Fetching signatures for ${...}: |
| token-first-buyers-service.ts | ``Fetching signatures for address: ${address}, max: ${maxSignatures}`` | DEBUG | 278 | Fetching signatures for address: ${...}, |
| token-first-buyers-service.ts | ``📄 Fetched ${allSignatures.length} signatures so far...`` | DEBUG | 309 | 📄 Fetched ${...} signatures so |
| token-first-buyers-service.ts | `'Reached end of available signatures'` | DEBUG | 314 | Reached end of available signatures |
| token-first-buyers-service.ts | ``Collected ${allSignatures.length} total signatures for ${addressType}: ${address}`` | DEBUG | 321 | Collected ${...} total signatures for |
| token-first-buyers-service.ts | ``📅 Time range: ${lastDate.toISOString()} to ${firstDate.toISOString()}`` | DEBUG | 331 | 📅 Time range: ${...} to |
| token-first-buyers-service.ts | `'Could not fetch timestamp debug info:'` | DEBUG | 334 | Could not fetch timestamp debug |
| token-first-buyers-service.ts | ``Error fetching signatures for ${addressType} ${address}: ${errorMessage}`` | ERROR | 342 | Error fetching signatures for ${...} |
| token-first-buyers-service.ts | ``Results saved to: ${outputPath}`` | INFO | 386 | Results saved to: ${...} |
| token-first-buyers-service.ts | ``Starting top traders analysis for token: ${mintAddress}`` | INFO | 422 | Starting top traders analysis for |
| token-first-buyers-service.ts | ``Filtered first buyers by minTokenAmount=${options.minTokenAmount}. Kept ${afterCount}/${beforeCount` | INFO | 434 | Filtered first buyers by minTokenAmount=${...}. |
| token-first-buyers-service.ts | `'No first buyers found, cannot analyze top traders'` | WARN | 438 | No first buyers found, cannot |
| token-first-buyers-service.ts | ``Using database infrastructure for PnL analysis of ${firstBuyers.length} first buyers...`` | INFO | 453 | Using database infrastructure for PnL |
| token-first-buyers-service.ts | ``Ensuring ${walletAddresses.length} wallets exist in database...`` | INFO | 456 | Ensuring ${...} wallets exist in |
| token-first-buyers-service.ts | ``Failed to ensure wallet exists: ${walletAddress}`` | WARN | 461 | Failed to ensure wallet exists: |
| token-first-buyers-service.ts | ``Checking for existing analysis results for mint ${mintAddress}...`` | INFO | 466 | Checking for existing analysis results |
| token-first-buyers-service.ts | ``Found ${existingResults.length} existing analysis results in database`` | INFO | 475 | Found ${...} existing analysis results |
| token-first-buyers-service.ts | ``Error fetching existing analysis results:`` | WARN | 477 | Error fetching existing analysis results: |
| token-first-buyers-service.ts | ``Running proper data pipeline for ${missingWallets.length} wallets missing database results...`` | INFO | 486 | Running proper data pipeline for |
| token-first-buyers-service.ts | ``Processing data pipeline batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(missingWallets.length /` | INFO | 492 | Processing data pipeline batch ${...}/${...} |
| token-first-buyers-service.ts | ``🔄 Starting data pipeline for ${walletAddress}`` | DEBUG | 496 | 🔄 Starting data pipeline for |
| token-first-buyers-service.ts | ``✅ Saved ${transactionsSaved} transactions for ${walletAddress}, now analyzing PnL`` | DEBUG | 502 | ✅ Saved ${...} transactions for |
| token-first-buyers-service.ts | ``✅ Completed PnL analysis for ${walletAddress}`` | DEBUG | 514 | ✅ Completed PnL analysis for |
| token-first-buyers-service.ts | ``⚠️ No transactions found for ${walletAddress}, skipping PnL analysis`` | WARN | 516 | ⚠️ No transactions found for |
| token-first-buyers-service.ts | ``❌ Failed data pipeline for ${walletAddress}: ${errorMessage}`` | WARN | 520 | ❌ Failed data pipeline for |
| token-first-buyers-service.ts | ``Fetching all analysis results for mint ${mintAddress} from database...`` | INFO | 534 | Fetching all analysis results for |
| token-first-buyers-service.ts | ``Retrieved ${allResults.length} total analysis results from database`` | INFO | 543 | Retrieved ${...} total analysis results |
| token-first-buyers-service.ts | ``Error fetching analysis results from database:`` | ERROR | 545 | Error fetching analysis results from |
| token-first-buyers-service.ts | ``No analysis result found for wallet ${buyer.walletAddress} on mint ${mintAddress}`` | WARN | 575 | No analysis result found for |
| token-first-buyers-service.ts | ``Top traders analysis completed for ${mintAddress}:`` | INFO | 609 | Top traders analysis completed for |
| token-first-buyers-service.ts | ``- Analyzed ${topTradersData.length} wallets`` | INFO | 610 | - Analyzed ${...} wallets |
| token-first-buyers-service.ts | ``- Successful analyses: ${successfulAnalyses}`` | INFO | 611 | - Successful analyses: ${...} |
| token-first-buyers-service.ts | ``- Failed analyses: ${failedAnalyses}`` | INFO | 612 | - Failed analyses: ${...} |
| token-first-buyers-service.ts | ``- Average PnL: ${averagePnl.toFixed(4)} SOL`` | INFO | 613 | - Average PnL: ${...} SOL |
| token-first-buyers-service.ts | ``- Top ${sortedTraders.length} traders identified`` | INFO | 614 | - Top ${...} traders identified |
| token-first-buyers-service.ts | ``All ${allFirstBuyers.length} first buyer wallet addresses saved to: ${walletListPath}`` | INFO | 730 | All ${...} first buyer wallet |
| token-first-buyers-service.ts | ``Top ${result.topTraders.length} traders analysis saved to CSV: ${topTradersPath}`` | INFO | 731 | Top ${...} traders analysis saved |
| token-first-buyers-service.ts | ``Human-friendly Markdown report saved to: ${mdPath}`` | INFO | 732 | Human-friendly Markdown report saved to: |
| token-first-buyers-service.ts | `'Database service not available, cannot save transactions'` | WARN | 751 | Database service not available, cannot |
| token-first-buyers-service.ts | ``🔄 Fetching token accounts for wallet ${walletAddress} and mint ${mintAddress}`` | DEBUG | 756 | 🔄 Fetching token accounts for |
| token-first-buyers-service.ts | ``No token accounts found for wallet ${walletAddress} and mint ${mintAddress}`` | DEBUG | 768 | No token accounts found for |
| token-first-buyers-service.ts | ``Found ${tokenAccountsResult.value.length} token accounts for wallet ${walletAddress}`` | DEBUG | 772 | Found ${...} token accounts for |
| token-first-buyers-service.ts | ``📡 Fetching signatures for token account ${tokenAccountAddress}`` | DEBUG | 783 | 📡 Fetching signatures for token |
| token-first-buyers-service.ts | ``📄 Collected ${signatures.length} signatures from token account ${tokenAccountAddress}`` | DEBUG | 794 | 📄 Collected ${...} signatures from |
| token-first-buyers-service.ts | ``Failed to fetch signatures for token account ${tokenAccountAddress}: ${errorMessage}`` | WARN | 798 | Failed to fetch signatures for |
| token-first-buyers-service.ts | ``🔄 Fetching ${allSignatures.length} total signatures in batches`` | DEBUG | 805 | 🔄 Fetching ${...} total signatures |
| token-first-buyers-service.ts | ``📄 Fetched ${transactions.length} transactions for batch ${Math.floor(i / batchSize) + 1}`` | DEBUG | 815 | 📄 Fetched ${...} transactions for |
| token-first-buyers-service.ts | ``Failed to fetch transactions for batch ${Math.floor(i / batchSize) + 1}: ${errorMessage}`` | WARN | 818 | Failed to fetch transactions for |
| token-first-buyers-service.ts | ``No transactions found for wallet ${walletAddress} and mint ${mintAddress}`` | DEBUG | 825 | No transactions found for wallet |
| token-first-buyers-service.ts | ``💾 Processing ${allTransactions.length} total transactions for database storage`` | DEBUG | 829 | 💾 Processing ${...} total transactions |
| token-first-buyers-service.ts | ``✅ Successfully saved ${analysisInputs.length} analysis inputs to database for ${walletAddress}`` | DEBUG | 836 | ✅ Successfully saved ${...} analysis |
| token-first-buyers-service.ts | ``ℹ️ No analysis inputs to save for wallet ${walletAddress}`` | DEBUG | 839 | ℹ️ No analysis inputs to |
| token-first-buyers-service.ts | ``❌ Failed to fetch and save transactions for ${walletAddress}: ${errorMessage}`` | ERROR | 845 | ❌ Failed to fetch and |

### Component: wallet-balance-service.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| wallet-balance-service.ts | ``Fetching RAW wallet balances for ${walletAddresses.length} addresses. Commitment: ${commitment || '` | INFO | 62 | Fetching RAW wallet balances for |
| wallet-balance-service.ts | ``Fetching SOL balances for batch of ${batchAddresses.length} addresses (offset ${i}).`` | DEBUG | 81 | Fetching SOL balances for batch |
| wallet-balance-service.ts | ``No SOL balance account info found for address: ${address} in batch.`` | WARN | 97 | No SOL balance account info |
| wallet-balance-service.ts | ``Error fetching SOL balances for batch (offset ${i}, ${batchAddresses.length} addresses):`` | WARN | 101 | Error fetching SOL balances for |
| wallet-balance-service.ts | ``Address ${address}: Using pre-fetched token data (${preFetchedTokenData[address].length} tokens)`` | DEBUG | 115 | Address ${...}: Using pre-fetched token |
| wallet-balance-service.ts | ``Address ${address}: Skipping token fetch - pre-fetched count is 0`` | DEBUG | 118 | Address ${...}: Skipping token fetch |
| wallet-balance-service.ts | ``Address ${address}: Found ${currentTokenAccounts.length} SPL accounts.`` | DEBUG | 137 | Address ${...}: Found ${...} SPL |
| wallet-balance-service.ts | ``Address ${address}: Found ${token2022AccountsResult.value.length} Token-2022 accounts.`` | DEBUG | 150 | Address ${...}: Found ${...} Token-2022 |
| wallet-balance-service.ts | ``Address ${address}: Failed to fetch Token-2022 accounts:`` | WARN | 154 | Address ${...}: Failed to fetch |
| wallet-balance-service.ts | ``🚨 SYSTEM WALLET DETECTED: ${address} caused ${errorMessage} - likely has excessive tokens`` | WARN | 238 | 🚨 SYSTEM WALLET DETECTED: ${...} |
| wallet-balance-service.ts | ``Error fetching token balances for address ${address}:`` | WARN | 241 | Error fetching token balances for |
| wallet-balance-service.ts | ``Successfully processed RAW wallet balance fetching for ${walletAddresses.length} addresses (no meta` | INFO | 247 | Successfully processed RAW wallet balance |
| wallet-balance-service.ts | ``Found ${missingTokens.length} potentially missing tokens for ${walletAddress}`` | DEBUG | 283 | Found ${...} potentially missing tokens |
| wallet-balance-service.ts | ``Error finding missing tokens for ${walletAddress}:`` | WARN | 288 | Error finding missing tokens for |
| wallet-balance-service.ts | `'TokenInfoService not available, returning balances without metadata enrichment'` | WARN | 304 | TokenInfoService not available, returning balances |
| wallet-balance-service.ts | `'No tokens found to enrich with metadata'` | DEBUG | 312 | No tokens found to enrich |
| wallet-balance-service.ts | ``Enriching ${uniqueMints.length} unique tokens with metadata`` | INFO | 316 | Enriching ${...} unique tokens with |
| wallet-balance-service.ts | ``Successfully enriched wallet balances with metadata for ${enrichedBalances.size} wallets`` | INFO | 341 | Successfully enriched wallet balances with |
| wallet-balance-service.ts | ``Skipping token metadata enrichment for ${walletAddresses.length} wallets (performance optimization ` | DEBUG | 364 | Skipping token metadata enrichment for |

### Component: wallet-classification.service.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| wallet-classification.service.ts | ``Error fetching mapping activity logs for ${walletAddress}:`` | ERROR | 53 | Error fetching mapping activity logs |
| wallet-classification.service.ts | `'Error fetching high volume wallets:'` | ERROR | 89 | Error fetching high volume wallets: |
| wallet-classification.service.ts | ``Error getting fetch recommendation for ${walletAddress}:`` | ERROR | 158 | Error getting fetch recommendation for |
| wallet-classification.service.ts | ``Updated ${walletAddress} classification to ${classification}: ${reason}`` | DEBUG | 182 | Updated ${...} classification to ${...}: |
| wallet-classification.service.ts | ``Error updating classification for ${walletAddress}:`` | ERROR | 185 | Error updating classification for ${...}: |
| wallet-classification.service.ts | ``Error getting classification for ${walletAddress}:`` | ERROR | 202 | Error getting classification for ${...}: |

## Layer: API

### Component: helius.module.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| helius.module.ts | `'HELIUS_API_KEY is not configured.'` | ERROR | 25 | HELIUS_API_KEY is not configured. |

### Component: similarity.service.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| similarity.service.ts | ``Error running similarity analysis for wallets: ${dto.walletAddresses.join(', ')}`` | ERROR | 135 | Error running similarity analysis for |

## Layer: Dashboard

### Component: api-key-store.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| api-key-store.ts | `"Demo API Key is not configured. Please set Demo key."` | ERROR | 26 | Demo API Key is not |
| api-key-store.ts | `"Failed to fetch user profile, assuming not a demo key."` | ERROR | 56 | Failed to fetch user profile, |

### Component: ExitTimingDrilldownPanel.tsx

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| ExitTimingDrilldownPanel.tsx | `'Error fetching exit timing tokens:'` | ERROR | 66 | Error fetching exit timing tokens: |

### Component: page.tsx

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| page.tsx | `'📊 Main analysis progress:'` | LOG | 60 | 📊 Main analysis progress: |
| page.tsx | `'🎨 Ignoring progress for job:'` | LOG | 64 | 🎨 Ignoring progress for job: |
| page.tsx | `'✅ Job completed hook fired. Job ID:'` | LOG | 69 | ✅ Job completed hook fired. |
| page.tsx | `'✅ Processing completion for MAIN job:'` | LOG | 73 | ✅ Processing completion for MAIN |
| page.tsx | `'✅ Using similarity result data from WebSocket:'` | LOG | 84 | ✅ Using similarity result data |
| page.tsx | `'[Token holder progress payload]'` | LOG | 91 | [Token holder progress payload] |
| page.tsx | `'[Token holder numeric progress]'` | LOG | 112 | [Token holder numeric progress] |
| page.tsx | `'❌ Error processing main job result:'` | ERROR | 125 | ❌ Error processing main job |
| page.tsx | `'Ignoring completion for unrelated job:'` | LOG | 133 | Ignoring completion for unrelated job: |
| page.tsx | `'❌ Job failed (WebSocket):'` | ERROR | 138 | ❌ Job failed (WebSocket): |
| page.tsx | `'🎨 Processing completion for ENRICHMENT job:'` | LOG | 180 | 🎨 Processing completion for ENRICHMENT |
| page.tsx | `'❌ Error processing enrichment data:'` | ERROR | 202 | ❌ Error processing enrichment data: |
| page.tsx | `'Stale analysis result found in localStorage. Discarding.'` | WARN | 228 | Stale analysis result found in |
| page.tsx | `"Failed to parse analysis result from localStorage"` | ERROR | 235 | Failed to parse analysis result |
| page.tsx | `'🔔 Subscribing to enrichment job:'` | LOG | 245 | 🔔 Subscribing to enrichment job: |
| page.tsx | `'⚠️ Analysis already running, ignoring duplicate request'` | LOG | 316 | ⚠️ Analysis already running, ignoring |
| page.tsx | `'🔌 Using WebSocket for job updates'` | LOG | 390 | 🔌 Using WebSocket for job |
| page.tsx | `'📊 WebSocket not connected - using polling'` | LOG | 393 | 📊 WebSocket not connected - |
| page.tsx | `'Error submitting job:'` | ERROR | 398 | Error submitting job: |
| page.tsx | `'📊 Starting polling for job:'` | LOG | 410 | 📊 Starting polling for job: |
| page.tsx | `'❌ Job failed (Polling):'` | ERROR | 450 | ❌ Job failed (Polling): |
| page.tsx | `'Error polling job status:'` | ERROR | 489 | Error polling job status: |

### Component: ReviewerLogTab.tsx

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| ReviewerLogTab.tsx | ``${title}:`` | ERROR | 117 | ${...}: |

### Component: TokenPerformanceTab.tsx

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| TokenPerformanceTab.tsx | ``[TokenPerformance] ❌ Fetch error:`` | ERROR | 520 | [TokenPerformance] ❌ Fetch error: |

### Component: useJobProgress.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| useJobProgress.ts | `'✅ WebSocket connected'` | LOG | 123 | ✅ WebSocket connected |
| useJobProgress.ts | `'🔌 WebSocket disconnected:'` | LOG | 130 | 🔌 WebSocket disconnected: |
| useJobProgress.ts | `'🔌 WebSocket error:'` | ERROR | 136 | 🔌 WebSocket error: |
| useJobProgress.ts | `'🔌 WebSocket connection error:'` | ERROR | 141 | 🔌 WebSocket connection error: |
| useJobProgress.ts | `'❌ Job failed (WebSocket):'` | ERROR | 170 | ❌ Job failed (WebSocket): |
| useJobProgress.ts | ``🔔 Subscribing to WebSocket for job: ${jobId}`` | LOG | 213 | 🔔 Subscribing to WebSocket for |
| useJobProgress.ts | ``⚠️ Cannot subscribe to WebSocket for job ${jobId} - socket not connected.`` | WARN | 216 | ⚠️ Cannot subscribe to WebSocket |
| useJobProgress.ts | ``Error polling job status for ${jobId}:`` | ERROR | 234 | Error polling job status for |
| useJobProgress.ts | ``🔕 Unsubscribing from job: ${jobId}`` | LOG | 246 | 🔕 Unsubscribing from job: ${...} |

### Component: useTokenMetadata.ts

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| useTokenMetadata.ts | ``[TokenMetadataBatcher] Fetching metadata for ${mints.length} tokens in ONE batch`` | LOG | 86 | [TokenMetadataBatcher] Fetching metadata for ${...} |
| useTokenMetadata.ts | `'[TokenMetadataBatcher] Failed to fetch batch:'` | ERROR | 139 | [TokenMetadataBatcher] Failed to fetch batch: |
| useTokenMetadata.ts | ``[TokenMetadataBatcher] Refreshing enriched metadata for ${mints.length} tokens`` | LOG | 155 | [TokenMetadataBatcher] Refreshing enriched metadata for |
| useTokenMetadata.ts | `'[TokenMetadataBatcher] Failed to refresh enriched data:'` | ERROR | 192 | [TokenMetadataBatcher] Failed to refresh enriched |

### Component: WalletProfileLayout.tsx

| Component | Log Statement | Log Level | Line | Description |
|-----------|---------------|-----------|------|-------------|
| WalletProfileLayout.tsx | `'Error loading AccountStatsPnlTab:'` | ERROR | 98 | Error loading AccountStatsPnlTab: |
| WalletProfileLayout.tsx | `'subscribeToJob not ready when registering job subscription'` | WARN | 282 | subscribeToJob not ready when registering |
| WalletProfileLayout.tsx | `'Failed to subscribe to job from URL'` | ERROR | 317 | Failed to subscribe to job |
| WalletProfileLayout.tsx | `'Error refreshing wallet summary after completion'` | ERROR | 427 | Error refreshing wallet summary after |
| WalletProfileLayout.tsx | ``[WalletProfile] ⚠️ TokenPerformance mutate function not available yet`` | WARN | 440 | [WalletProfile] ⚠️ TokenPerformance mutate function |
| WalletProfileLayout.tsx | `'Error refreshing token performance after scope completion'` | ERROR | 443 | Error refreshing token performance after |
| WalletProfileLayout.tsx | ``[WalletProfile] ⚠️ TokenPerformance mutate function not available for enrichment`` | WARN | 478 | [WalletProfile] ⚠️ TokenPerformance mutate function |
| WalletProfileLayout.tsx | `'Error refreshing token performance after enrichment'` | ERROR | 482 | Error refreshing token performance after |
| WalletProfileLayout.tsx | `'WebSocket disconnected; awaiting reconnection for live job updates.'` | WARN | 493 | WebSocket disconnected; awaiting reconnection for |
| WalletProfileLayout.tsx | `'Failed to copy: '` | ERROR | 660 | Failed to copy: |
| WalletProfileLayout.tsx | ``Failed to trigger ${scope} analysis`` | ERROR | 788 | Failed to trigger ${...} analysis |

## Notes

This log map is automatically generated using AST-based code parsing. It accurately extracts log statements by understanding the code structure, not just pattern matching. This ensures all log statements are captured correctly.
