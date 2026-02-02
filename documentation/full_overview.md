 Perfect! Now I have comprehensive information. Let me create a detailed summary report:

       Wallet Analytics & Display Architecture Report

       Based on my thorough exploration of the codebase, here's a complete breakdown of the current wallet analytics and display architecture:

       ---
       1. API ENDPOINTS FOR WALLET DATA AND ANALYTICS

       Base Path: /wallets (WalletsController)

       Core Wallet Endpoints:
       ┌────────────────────────────────────────────────────────────┬────────────┬────────────────────────────────────────────┬───────────────────────────────────────────────────────────────────────────┐
       │                          Endpoint                          │   Method   │                  Purpose                   │                                  Returns                                  │
       ├────────────────────────────────────────────────────────────┼────────────┼────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────┤
       │ GET /wallets/search?query=...                              │ GET        │ Search wallets by address fragment         │ WalletSearchResultsDto - matching wallet addresses                        │
       ├────────────────────────────────────────────────────────────┼────────────┼────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────┤
       │ GET /wallets/:walletAddress/summary                        │ GET        │ Comprehensive wallet overview              │ WalletSummaryResponse - KPIs, classification, balances                    │
       ├────────────────────────────────────────────────────────────┼────────────┼────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────┤
       │ GET /wallets/:walletAddress/token-performance              │ GET        │ Paginated token performance data           │ PaginatedTokenPerformanceResponse - historical token trades               │
       ├────────────────────────────────────────────────────────────┼────────────┼────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────┤
       │ GET /wallets/:walletAddress/pnl-overview                   │ GET        │ Detailed P&L breakdown                     │ PnlOverviewResponse - realized/unrealized PNL, volumes, stats             │
       ├────────────────────────────────────────────────────────────┼────────────┼────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────┤
       │ GET /wallets/:walletAddress/behavior-analysis              │ GET        │ Trading behavior classification            │ BehaviorAnalysisResponseDto - trading patterns, efficiency, temporal data │
       ├────────────────────────────────────────────────────────────┼────────────┼────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────┤
       │ GET /wallets/:walletAddress/classification                 │ GET        │ Wallet classification & smart fetch status │ Classification, smart fetch recommendations                               │
       ├────────────────────────────────────────────────────────────┼────────────┼────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────┤
       │ POST /wallets/:walletAddress/enrich-all-tokens             │ POST (202) │ Trigger background token enrichment        │ Job confirmation                                                          │
       ├────────────────────────────────────────────────────────────┼────────────┼────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────┤
       │ GET /wallets/:walletAddress/exit-timing-tokens/:timeBucket │ GET        │ Token mints by exit timing category        │ Array of token addresses in time bucket                                   │
       └────────────────────────────────────────────────────────────┴────────────┴────────────────────────────────────────────┴───────────────────────────────────────────────────────────────────────────┘
       Wallet Notes Endpoints:

       | POST /wallets/:walletAddress/notes | Create user note | Note record |
       | GET /wallets/:walletAddress/notes | List user notes | Array of notes |
       | PATCH /wallets/:walletAddress/notes/:noteId | Update note | Updated note record |
       | DELETE /wallets/:walletAddress/notes/:noteId | Delete note (204) | No content |

       User Favorites Endpoints (separate controller):

       | GET /users/me/favorites | List tracked wallets | FavoriteWallet[] |
       | POST /users/me/favorites | Add tracked wallet | New favorite entry |
       | PATCH /users/me/favorites/:walletAddress | Update favorite metadata | Updated entry |
       | DELETE /users/me/favorites/:walletAddress | Remove from tracking | No content |
       | POST /users/me/favorites/import | Bulk import wallets | Import results summary |
       | DELETE /users/me/favorites | Clear all tracked wallets | Removal confirmation |
       | POST /users/me/favorites/batch-analyze | Queue multiple wallets for analysis | Analysis job IDs |

       ---
       2. UI PAGES & COMPONENTS FOR WALLET DISPLAY

       Main Pages:

       - /wallets/[walletAddress] - Single wallet detail view
         - Uses WalletProfileLayout component
         - Dynamic route for individual wallet analysis
       - /trackers - Portfolio tracking dashboard
         - Displays all favorited/tracked wallets
         - Batch operations and analytics
         - Collection filtering and management
         - Wallet import/export functionality
       - /discover - Wallet discovery interface
       - /tools/holder-profiles - Holder analysis tools
       - /tools/top-holders - Top holder analysis

       Key Components:
       ┌─────────────────────────┬──────────────────────────────────────────┬─────────────────────────────────┐
       │        Component        │                 Purpose                  │            Location             │
       ├─────────────────────────┼──────────────────────────────────────────┼─────────────────────────────────┤
       │ WalletProfileLayout     │ Main wallet detail layout with tabs      │ /components/layout/             │
       ├─────────────────────────┼──────────────────────────────────────────┼─────────────────────────────────┤
       │ AccountSummaryCard      │ KPI summary display (PNL, balance, etc.) │ /components/dashboard/          │
       ├─────────────────────────┼──────────────────────────────────────────┼─────────────────────────────────┤
       │ TokenPerformanceTab     │ Token trade history table                │ /components/dashboard/          │
       ├─────────────────────────┼──────────────────────────────────────────┼─────────────────────────────────┤
       │ AccountStatsPnlTabProps │ P&L overview and stats                   │ /components/dashboard/          │
       ├─────────────────────────┼──────────────────────────────────────────┼─────────────────────────────────┤
       │ BehavioralPatternsTab   │ Trading behavior visualization           │ /components/dashboard/          │
       ├─────────────────────────┼──────────────────────────────────────────┼─────────────────────────────────┤
       │ ReviewerLogTab          │ Activity logging                         │ /components/dashboard/          │
       ├─────────────────────────┼──────────────────────────────────────────┼─────────────────────────────────┤
       │ WalletBadge             │ Wallet address badge with actions        │ /components/shared/             │
       ├─────────────────────────┼──────────────────────────────────────────┼─────────────────────────────────┤
       │ WalletSearch            │ Wallet search input                      │ /components/shared/             │
       ├─────────────────────────┼──────────────────────────────────────────┼─────────────────────────────────┤
       │ WalletHeroCard          │ Holder profile visualization             │ /components/holder-profiles/v2/ │
       ├─────────────────────────┼──────────────────────────────────────────┼─────────────────────────────────┤
       │ CollectionAnalytics     │ Collection-level portfolio stats         │ /components/trackers/           │
       └─────────────────────────┴──────────────────────────────────────────┴─────────────────────────────────┘
       TrackerPage Features:

       - Real-time wallet tracking with filtering
       - Collection management and organization
       - Active wallet filtering (24h)
       - Batch analysis with scope selection (flash/working/deep)
       - Import/export functionality (CSV/JSON/TXT)
       - Portfolio statistics sidebar
       - Collection-level analytics

       ---
       3. METRICS CALCULATED & STORED IN DATABASE

       Main Data Models:

       Wallet Model - Base wallet entity
       - address (PK)
       - firstProcessedTimestamp, newestProcessedTimestamp
       - classification, classificationConfidence, knownType, knownLabel
       - lastSuccessfulFetchTimestamp
       - isVerifiedBot, botType, botPatternTags

       WalletPnlSummary Model - Aggregated P&L metrics (normalized summary)
       - walletAddress (FK, unique)
       - realizedPnl, unrealizedPnl, netPnl
       - totalVolume, totalFees, stablecoinNetFlow
       - profitableTokensCount, unprofitableTokensCount
       - profitableTradesCount, totalIndividualTradesCount
       - tokenWinRate, averageRealizedPnlPerExecutedSwap
       - realizedPnlToTotalVolumeRatio
       - currentSolBalance, solBalanceFetchedAt

       AdvancedTradeStats Model - Advanced performance metrics (child of PnlSummary)
       - medianPnlPerToken, trimmedMeanPnlPerToken
       - tokenWinRatePercent, standardDeviationPnl
       - profitConsistencyIndex, weightedEfficiencyScore
       - averagePnlPerDayActiveApprox
       - firstTransactionTimestamp, lastTransactionTimestamp

       AnalysisResult Model - Per-token performance history
       - walletAddress, tokenAddress (unique composite)
       - totalAmountIn/Out, netAmountChange
       - totalSolSpent/Received, netSolProfitLoss
       - transferCountIn/Out, timestamps
       - currentHoldingsValueSol/Usd, realizedPnlSol, totalPnlSol
       - currentRawBalance, currentUiBalance
       - isValuePreservation, preservationType

       WalletBehaviorProfile Model - Trading behavior classification
       - walletAddress (PK, unique)
       - buySellRatio, buySellSymmetry, averageFlipDurationHours
       - medianHoldTime, sequenceConsistency, flipperScore
       - uniqueTokensTraded, totalTradeCount
       - tradingStyle (classifier output), confidenceScore
       - tradingFrequency, tokenPreferences, riskMetrics (JSON)
       - activeTradingPeriods, tradingTimeDistribution (JSON)
       - speedCategory, strategyType, flowPattern
       - sessionCount, avgTradesPerSession
       - exitPattern, holdTimeTokenMap
       - firstTransactionTimestamp, lastTransactionTimestamp

       UserFavoriteWallet Model - User tracking metadata
       - userId, walletAddress (composite PK)
       - nickname, collections
       - metadata (JSON), tags
       - lastViewedAt, createdAt

       WalletNote Model - User annotations
       - id (PK)
       - walletAddress, userId (FKs)
       - content, createdAt, updatedAt

       TokenInfo Model - Token metadata (enriched)
       - Stores token mint data with metadata (name, symbol, image, etc.)

       ---
       4. WALLET ANALYSIS/TRACKING STRUCTURE

       Analysis Pipeline:

       Database Service Layer
       ├── Core Database Service (database-service.ts)
       │   └── Manages Prisma operations for all models
       │
       ├── Token Performance Service
       │   ├── Queries AnalysisResult table
       │   ├── Supports: pagination, sorting, filtering, spam detection
       │   └── Returns: paginated token trade history
       │
       ├── PNL Overview Service
       │   ├── Aggregates: realizedPnl, unrealizedPnl, volumes, fees
       │   ├── Includes: swap win rates, advanced statistics
       │   └── Supports: time-range filtering
       │
       ├── Behavior Service
       │   ├── Reads: WalletBehaviorProfile (with cache staleness checks)
       │   ├── Falls back: Recalculates if cache stale vs. last wallet sync
       │   ├── Returns: BehavioralMetrics (trading style, patterns, metrics)
       │   └── Caches: Full history queries (disable with DISABLE_BEHAVIOR_CACHE=true)
       │
       └── Wallet Classification Service
           ├── Auto-classifies: high-frequency vs. normal wallets
           ├── Applies: Smart fetch recommendations (signature limits)
           └── Supports: Registry-based known wallet filtering

       Data Flow Chain:

       API Request (WalletsController)
           ↓
       1. getWalletSummary()
          ├─ Ensures wallet exists
          ├─ Fetches WalletPnlSummary (with relations)
          ├─ Fetches WalletBehaviorProfile
          ├─ Gets SOL price (cached 30s)
          ├─ Auto-classifies wallet
          └─ Returns: Composite summary with all KPIs
           ↓
       2. getLatestTokenPerformance()
          ├─ Queries AnalysisResult table
          ├─ Applies filters (date range, search, PNL condition, spam)
          ├─ Supports pagination
          └─ Returns: Per-token historical data
           ↓
       3. getPnlOverview()
          ├─ Fetches PNL data (all-time + period-specific)
          ├─ Includes: Advanced stats, win rates, volumes
          └─ Returns: Detailed P&L breakdown
           ↓
       4. getBehaviorAnalysis()
          ├─ Checks: Known wallet registry
          ├─ Reads: Cached behavior profile
          ├─ Validates: Cache staleness vs. last sync
          └─ Returns: Complete behavioral metrics

       User Favorites Management
           ↓
       UserFavoritesService
       ├─ Tracks: userId + walletAddress pairs
       ├─ Stores: Nickname, collections, metadata
       ├─ Supports: Bulk import with job queuing
       ├─ Supports: Batch analysis triggering
       └─ Caches: Favorite list in user SWR hooks

       ---
       5. PERFORMANCE METRICS & BEHAVIORAL DATA MODELS

       Performance Metrics Stored:

       PNL Metrics:
       - Realized PNL (completed trades only)
       - Unrealized PNL (current holdings mark-to-market)
       - Net PNL (realized + unrealized)
       - P&L per token (median, trimmed mean)
       - P&L to volume ratio
       - Win rate (% profitable trades)

       Efficiency Metrics:
       - Weighted efficiency score
       - Average PNL per day active
       - Average swap size
       - Total execution volume
       - Fee totals and percentages

       Advanced Statistics:
       - Standard deviation of PNL
       - Profit consistency index
       - Median PNL to volatility ratio

       Trade Metrics:
       - Individual trade count
       - Profitable vs. unprofitable trade counts
       - Token count breakdown
       - Swap win rate (trade-level)

       Behavioral Data Models:

       Trading Style Classifications:
       - True Flipper (high frequency, quick exits)
       - Momentum Trader (medium-term holds)
       - Position Holder (long-term accumulation)
       - Accumulator (DCA patterns)
       - Bot-like behavior (if detected)

       Behavior Profile Fields:
       {
         // Ratio & Symmetry
         buySellRatio: float,
         buySellSymmetry: float,

         // Timing
         averageFlipDurationHours: float,
         medianHoldTime: float,
         medianCurrentHoldingDurationHours: float,
         medianCompletedHoldTimeHours: float,

         // Consistency
         sequenceConsistency: float,
         flipperScore: float,
         profitConsistencyIndex: float,

         // Token Patterns
         uniqueTokensTraded: int,
         tokensWithBothBuyAndSell: int,
         tokensWithOnlyBuys: int,

         // Trade Counts
         totalTradeCount: int,
         totalBuyCount: int,
         totalSellCount: int,
         completePairsCount: int,

         // Temporal Patterns
         activeTradingPeriods: {
           hourlyTradeCounts: Record<0-23, count>,
           identifiedWindows: [{ startTimeUTC, endTimeUTC, tradeCount, percentage }],
           activityFocusScore: 0-1 (concentration metric)
         },
         tradingFrequency: { daily, weekly, monthly, frequency },
         tradingTimeDistribution: { instant, ultraFast, fast, momentum, intraday, day, swing, position },

         // Classification
         tradingStyle: string (classifier output),
         confidenceScore: float (0-1),
         speedCategory: string (instant | fast | deliberate),
         strategyType: string (aggressive | balanced | conservative),
         flowPattern: string (accumulation | distribution | mixed),

         // Session Data
         sessionCount: int,
         avgTradesPerSession: float,
         averageSessionStartHour: float,
         averageSessionDurationMinutes: float,

         // Risk & Efficiency
         riskMetrics: { volatility, drawdown, sortino, ... },
         tokenPreferences: { preferred_tokens, avoided_tokens, ... },
         reentryRate: float (% of tokens traded again after exit),
         percentageOfUnpairedTokens: float,

         // Current Holdings
         averageCurrentHoldingDurationHours: float,
         percentOfValueInCurrentHoldings: float,
         exitPattern: string,

         // Performance
         averagePnlPerDayActiveApprox: float,
         velocityScore: int (transaction velocity measure)
       }

       Exit Timing Buckets (cached in profile):
       - instant - exits within minutes
       - ultraFast - exits within hours
       - fast - exits within 4 hours
       - momentum - exits within a day
       - intraday - exits within trading day
       - day - exits within 24 hours
       - swing - exits within days/weeks
       - position - long-term holdings

       ---
       6. DATA FLOW: DATABASE → API → FRONTEND

       DATABASE LAYER (PostgreSQL via Prisma)
       ├── Primary Tables
       │   ├── Wallet (base entity, indexed by classification)
       │   ├── WalletPnlSummary (aggregated metrics, indexed by walletAddress)
       │   ├── AdvancedTradeStats (advanced metrics, FK to PnlSummary)
       │   ├── WalletBehaviorProfile (behavioral cache, indexed by walletAddress)
       │   ├── AnalysisResult (per-token history, indexed by wallet+token)
       │   ├── TokenInfo (token metadata, for enrichment)
       │   ├── UserFavoriteWallet (user tracking, composite PK)
       │   └── WalletNote (user annotations)
       │
       └── Secondary Tables
           ├── AnalysisRun (execution logs)
           ├── ActivityLog (user action tracking)
           └── SwapAnalysisInput (raw transaction data)

                ↓↓↓

       API SERVICE LAYER (NestJS Services)
       ├── DatabaseService
       │   └── Direct Prisma queries, logging, caching layer
       │
       ├── TokenPerformanceService
       │   ├── getPaginatedTokenPerformance()
       │   ├── Filters: date range, search, PNL condition, spam
       │   ├── Sorts: by PNL, volume, timestamp, etc.
       │   └── Paginates: 20 items default
       │
       ├── PnlOverviewService
       │   ├── getPnlOverview()
       │   ├── Aggregates: realizedPnl, unrealizedPnl, volumes
       │   └── Time-range aware: all-time + period specific
       │
       ├── BehaviorService
       │   ├── getWalletBehavior()
       │   ├── Cache management: staleness checks vs. wallet sync
       │   └── Fallback: recalculate if stale
       │
       ├── WalletClassificationService
       │   ├── Auto-classify: high-frequency detection
       │   └── Smart fetch: signature limits per classification
       │
       └── TokenInfoService
           ├── Enriches: token metadata
           └── Caches: 30s TTL for SOL price

                ↓↓↓

       API CONTROLLERS (HTTP Endpoints)
       ├── WalletsController
       │   ├── GET /wallets/search
       │   ├── GET /wallets/:address/summary (composite endpoint)
       │   ├── GET /wallets/:address/token-performance
       │   ├── GET /wallets/:address/pnl-overview
       │   ├── GET /wallets/:address/behavior-analysis
       │   ├── GET /wallets/:address/classification
       │   ├── Notes endpoints (CRUD)
       │   └── Batch operations (enrich, exit-timing)
       │
       └── UserFavoritesController
           ├── GET /users/me/favorites
           ├── POST /users/me/favorites (add)
           ├── POST /users/me/favorites/import (bulk)
           ├── POST /users/me/favorites/batch-analyze
           └── DELETE endpoints

                ↓↓↓

       FRONTEND LAYER (Next.js 15 Client)
       ├── Pages
       │   ├── /wallets/[walletAddress] → WalletProfileLayout
       │   │   └── Dynamic route with tabs:
       │   │       ├── Account Summary (AccountSummaryCard)
       │   │       ├── Token Performance (TokenPerformanceTab)
       │   │       ├── Account Stats & PNL (AccountStatsPnlTab)
       │   │       ├── Behavioral Patterns (BehavioralPatternsTab)
       │   │       └── Notes (ReviewerLogTab)
       │   │
       │   └── /trackers → TrackersPage
       │       ├── Wallet table with filters
       │       ├── Portfolio overview stats
       │       ├── Collection analytics
       │       ├── Batch operations
       │       └── Import/Export functionality
       │
       ├── Data Fetching (SWR)
       │   ├── Cache key: `createCacheKey(address, endpoint, params)`
       │   ├── Revalidation: on-demand via `mutate()`
       │   └── Real-time: WebSocket subscriptions for job progress
       │
       ├── State Management
       │   ├── useFavorites() → SWR hook for favorite list
       │   ├── useJobProgress() → WebSocket job tracking
       │   ├── useTimeRangeStore() → Persistent date range
       │   └── useApiKeyStore() → API key management
       │
       └── UI Components
           ├── WalletBadge (address + actions)
           ├── WalletProfileLayout (tab container)
           ├── Charts (ECharts integration)
           ├── Tables (paginated displays)
           └── Modals (edit, import, delete confirmations)

                ↓↓↓

       DISPLAY OUTPUT
       ├── Summary Card
       │   ├── PNL (realized, unrealized, net)
       │   ├── Win rate
       │   ├── Balance
       │   ├── Last active
       │   ├── Days active
       │   ├── Trading style
       │   └── Classification badge
       │
       ├── Token Performance Table
       │   ├── Token address + metadata
       │   ├── Entry/exit prices
       │   ├── PNL metrics
       │   ├── Hold duration
       │   ├── Current holdings
       │   └── Sort + filter
       │
       ├── P&L Overview Chart
       │   ├── Realized vs. unrealized
       │   ├── Volume trends
       │   ├── Win rate timeline
       │   └── Advanced stats
       │
       ├── Behavior Analysis
       │   ├── Trading style (classification)
       │   ├── Temporal patterns (hourly heatmap)
       │   ├── Hold time distribution
       │   ├── Token reentry rate
       │   ├── Risk metrics
       │   └── Session patterns
       │
       └── Tracked Wallets Portfolio
           ├── Total PNL aggregation
           ├── Active wallet count (24h)
           ├── Collection breakdown
           ├── Batch operations queue
           └── Import progress tracking

       ---
       Key Architecture Insights:

       1. Normalized Summary Model: WalletPnlSummary stores pre-aggregated metrics for fast access, while AnalysisResult maintains per-token granularity.
       2. Behavior Caching Strategy: Profiles are cached but validated against wallet sync timestamps to prevent stale data. Recalculation triggered on detection of newer wallet transactions.
       3. Smart Fetch Optimization: Wallets are auto-classified as "high_frequency" to limit transaction analysis to recent signatures (250-3000 depending on scope).
       4. Multi-scope Analysis:
         - Flash (7 days, 250 signatures)
         - Working (30 days, 2000 signatures)
         - Deep (all-time, 3000 signatures)
       5. Real-time Job Tracking: WebSocket subscriptions allow frontend to track background analysis jobs in real-time with progress updates.
       6. Collection-based Organization: Users can organize tracked wallets into collections with aggregated stats per collection.
       7. Flexible Time Ranges: APIs support optional start/end date filtering for period-specific analysis without recalculation.
       8. Activity Logging: All user actions logged to ActivityLog table with timing, IP, and error tracking for audit trails.

       This architecture provides a comprehensive wallet analytics system with flexible querying, caching optimization, and real-time user feedback mechanisms.