⚠️ Areas for Optimization:
1. Performance (53 seconds total)
Most time spent on external Helius API calls (~45 seconds)
Analysis itself is lightning fast (~2 seconds)
This is acceptable for E2E testing but could be optimized for production
2. Redundant API Calls
SmartFetch Phase 2 (Older): Fetched 0 potentially older transactions



logs:

[Nest] 7984  - 01/07/2025, 14:10:19     LOG [NestFactory] Starting Nest application...
 [DatabaseService] DatabaseService instantiated.
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] DatabaseModule dependencies initialized +53ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] WebSocketModule dependencies initialized +1ms
 [HeliusApiClient] Initializing HeliusApiClient: Target RPS=10, Min Request Interval=115ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] ThrottlerModule dependencies initialized +3ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] HttpModule dependencies initialized +0ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [DexscreenerService] CoreDexscreenerService instantiated within NestJS DexscreenerService wrapper.
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] ConfigHostModule dependencies initialized +0ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] DiscoveryModule dependencies initialized +3ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] BehaviorModule dependencies initialized +0ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] DexscreenerModule dependencies initialized +1ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] TerminusModule dependencies initialized +0ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] ConfigModule dependencies initialized +0ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] ConfigModule dependencies initialized +1ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] ApiModule dependencies initialized +1ms
 [HeliusApiClient] Initializing HeliusApiClient: Target RPS=10, Min Request Interval=115ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [ApiKeyAuthGuard] Initialized with 3 demo wallets.
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [ApiKeyAuthGuard] Initialized with 3 demo wallets.
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [ApiKeyAuthGuard] Initialized with 3 demo wallets.
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [ApiKeyAuthGuard] Initialized with 3 demo wallets.
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [ApiKeyAuthGuard] Initialized with 3 demo wallets.
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] HealthModule dependencies initialized +1ms
 [SwapAnalyzer] SwapAnalyzer instantiated.
 [AdvancedStatsAnalyzer] AdvancedStatsAnalyzer instantiated.
 [PnlAnalysisService] PnlAnalysisService instantiated with HeliusApiClient. WalletBalanceService active.
 [PnlAnalysisService] PnlAnalysisService instantiated with TokenInfoService. Token info enrichment active.
BullMQ: WARNING! Your redis options maxRetriesPerRequest must be null and will be overridden by BullMQ.
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [EnrichmentOperationsProcessor] EnrichmentOperationsProcessor initialized with worker
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] BullModule dependencies initialized +4ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] BullModule dependencies initialized +0ms
 [HeliusSyncService] HeliusSyncService instantiated with provided HeliusApiClient.
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] AppModule dependencies initialized +1ms
[Nest] 7984  - 01/07/2025, 14:10:19   DEBUG [PnlAnalysisService] PnlAnalysisService (NestJS wrapper) constructor called.
[Nest] 7984  - 01/07/2025, 14:10:19   DEBUG [PnlAnalysisService]   DatabaseService injected: Yes
[Nest] 7984  - 01/07/2025, 14:10:19   DEBUG [PnlAnalysisService]   HeliusApiClient injected: Yes
 [SwapAnalyzer] SwapAnalyzer instantiated.
 [AdvancedStatsAnalyzer] AdvancedStatsAnalyzer instantiated.
 [PnlAnalysisService] PnlAnalysisService instantiated with HeliusApiClient. WalletBalanceService active.
 [PnlAnalysisService] PnlAnalysisService instantiated with TokenInfoService. Token info enrichment active.
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [PnlAnalysisService] CorePnlAnalysisService instantiated within NestJS PnlAnalysisService wrapper.
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [ApiKeyAuthGuard] Initialized with 3 demo wallets.
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] TokenPerformanceModule dependencies initialized +0ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] HeliusModule dependencies initialized +1ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] UsersModule dependencies initialized +0ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] JobsModule dependencies initialized +0ms
BullMQ: WARNING! Your redis options maxRetriesPerRequest must be null and will be overridden by BullMQ.
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [WalletOperationsProcessor] WalletOperationsProcessor initialized with worker
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] SimilarityModule dependencies initialized +0ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] PnlAnalysisModule dependencies initialized +1ms
BullMQ: WARNING! Your redis options maxRetriesPerRequest must be null and will be overridden by BullMQ.
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [AnalysisOperationsProcessor] AnalysisOperationsProcessor initialized with worker
BullMQ: WARNING! Your redis options maxRetriesPerRequest must be null and will be overridden by BullMQ.
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] PnlOverviewModule dependencies initialized +2ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] AnalysesModule dependencies initialized +2ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] QueueModule dependencies initialized +0ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] TokenInfoModule dependencies initialized +1ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] WalletsModule dependencies initialized +0ms
[Nest] 7984  - 01/07/2025, 14:10:19     LOG [InstanceLoader] BullModule dependencies initialized +0ms
[Nest] 7984  - 01/07/2025, 14:10:19    WARN [Bootstrap] CORS enabled for all origins (FRONTEND_URL not set)
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [JobProgressGateway] WebSocket Gateway initialized
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [WebSocketsController] JobProgressGateway subscribed to the "subscribe-to-job" message +5ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [WebSocketsController] JobProgressGateway subscribed to the "subscribe-to-queue" message +0ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [WebSocketsController] JobProgressGateway subscribed to the "unsubscribe-from-job" message +1ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [WebSocketsController] JobProgressGateway subscribed to the "unsubscribe-from-queue" message +0ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [WebSocketsController] JobProgressGateway subscribed to the "get-subscriptions" message +0ms
[Nest] 7984  - 01/07/2025, 14:10:20    WARN [LegacyRouteConverter] Unsupported route path: "/api/v1/*". In previous versions, the symbols ?, *, and + were used to denote optional or repeating path parameters. The latest version of "path-to-regexp" now requires the use of named parameters. For example, instead of using a route like /users/* to capture all routes starting with "/users", you should use /users/*path. For more details, refer to the migration guide. Attempting to auto-convert...
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RoutesResolver] TokenInfoController {/api/v1/token-info}: +2ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/token-info, POST} route +10ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RoutesResolver] TestController {/api/v1/test-auth}: +1ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/test-auth, GET} route +1ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RoutesResolver] WalletsController {/api/v1/wallets}: +0ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/wallets/search, GET} route +3ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/wallets/:walletAddress/summary, GET} route +9ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/wallets/:walletAddress/token-performance, GET} route +2ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/wallets/:walletAddress/pnl-overview, GET} route +1ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/wallets/:walletAddress/behavior-analysis, GET} route +2ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/wallets/:walletAddress/notes, POST} route +1ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/wallets/:walletAddress/notes, GET} route +1ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/wallets/:walletAddress/notes/:noteId, DELETE} route +2ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/wallets/:walletAddress/notes/:noteId, PATCH} route +4ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/wallets/:walletAddress/enrich-all-tokens, POST} route +8ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RoutesResolver] AnalysesController {/api/v1/analyses}: +5ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/analyses/similarity, POST} route +44ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/analyses/similarity/enrich-balances, POST} route +8ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/analyses/similarity/queue, POST} route +10ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/analyses/wallets/status, POST} route +8ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/analyses/wallets/trigger-analysis, POST} route +6ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RoutesResolver] JobsController {/api/v1/jobs}: +0ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/jobs/wallets/sync, POST} route +2ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/jobs/wallets/analyze, POST} route +1ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/jobs/similarity/analyze, POST} route +1ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/jobs/:jobId, GET} route +1ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/jobs/:jobId/progress, GET} route +3ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/jobs/:jobId/result, GET} route +6ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/jobs/queue/:queueName/stats, GET} route +7ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/jobs/queue/:queueName/jobs, GET} route +2ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/jobs, GET} route +6ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RoutesResolver] UserFavoritesController {/api/v1/users/me/favorites}: +2ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/users/me/favorites, POST} route +6ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/users/me/favorites/:walletAddress, DELETE} route +7ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/users/me/favorites, GET} route +2ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RoutesResolver] UsersController {/api/v1/users}: +2ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/users/me, GET} route +2ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RoutesResolver] HealthController {/api/v1/health}: +1ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [RouterExplorer] Mapped {/api/v1/health, GET} route +0ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [NestApplication] Nest application successfully started +19ms
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [Bootstrap] 🚀 Application is running on: http://localhost:3001/api/v1
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [Bootstrap] 📚 API Documentation available at: http://localhost:3001/api-docs
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [JobProgressGateway] Subscribed to Redis pattern: bullmq:progress:*
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [JobProgressGateway] Subscribed to Redis pattern: bullmq:completed:*
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [JobProgressGateway] Subscribed to Redis pattern: bullmq:failed:*
[Nest] 7984  - 01/07/2025, 14:10:20     LOG [JobProgressGateway] Subscribed to Redis pattern: job-progress:*
[Nest] 7984  - 01/07/2025, 14:10:24 VERBOSE [ApiKeyAuthGuard] User cmckawpo10000wk4kap7m1smv validated and added to cache.
[Nest] 7984  - 01/07/2025, 14:10:24 VERBOSE [ApiKeyAuthGuard] User cmckawpo10000wk4kap7m1smv (isDemo: false) granted access to GET /api/v1/wallets/8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH/summary
[Nest] 7984  - 01/07/2025, 14:10:25 VERBOSE [ApiKeyAuthGuard] User cmckawpo10000wk4kap7m1smv validated and added to cache.
[Nest] 7984  - 01/07/2025, 14:10:25 VERBOSE [ApiKeyAuthGuard] User cmckawpo10000wk4kap7m1smv (isDemo: false) granted access to GET /api/v1/wallets/8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH/summary
[Nest] 7984  - 01/07/2025, 14:10:25   DEBUG [WalletsController] getWalletSummary called for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH with query: {}
[Nest] 7984  - 01/07/2025, 14:10:25   DEBUG [WalletsController] ServiceTimeRange for period-specific data (if any): undefined
 [DatabaseService] Logging activity for user ID: cmckawpo10000wk4kap7m1smv, action: get_wallet_summary
[Nest] 7984  - 01/07/2025, 14:10:25    WARN [WalletsController] No WalletPnlSummary found for wallet: 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH. Returning 'unanalyzed' state.
[Nest] 7984  - 01/07/2025, 14:10:25   DEBUG [WalletsController] getWalletSummary called for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe with query: {}
[Nest] 7984  - 01/07/2025, 14:10:25   DEBUG [WalletsController] ServiceTimeRange for period-specific data (if any): undefined
 [DatabaseService] Logging activity for user ID: cmckawpo10000wk4kap7m1smv, action: get_wallet_summary
[Nest] 7984  - 01/07/2025, 14:10:25    WARN [WalletsController] No WalletPnlSummary found for wallet: 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe. Returning 'unanalyzed' state.
[Nest] 7984  - 01/07/2025, 14:10:25 VERBOSE [ApiKeyAuthGuard] User cmckawpo10000wk4kap7m1smv validated and added to cache.
[Nest] 7984  - 01/07/2025, 14:10:25 VERBOSE [ApiKeyAuthGuard] User cmckawpo10000wk4kap7m1smv (isDemo: false) granted access to POST /api/v1/jobs/wallets/sync
[Nest] 7984  - 01/07/2025, 14:10:25     LOG [JobsService] Submitting sync job for wallet: 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH
[Nest] 7984  - 01/07/2025, 14:10:25     LOG [WalletOperationsProcessor] Processing sync-wallet job sync-f8531e7d
[Nest] 7984  - 01/07/2025, 14:10:25   DEBUG [RedisLockService] Lock acquired: lock:wallet:sync:8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH with value: sync-f8531e7d
 [HeliusSyncService] [Sync] Wallet entry ensured for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH. Proceeding with sync.
 [HeliusSyncService] [Sync] Starting data synchronization for wallet: 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH
 [HeliusSyncService] [Sync] Executing SmartFetch for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH with overall target of 200 signatures in DB.
 [HeliusSyncService] [Sync] SmartFetch Phase 1 (Newer): Fetching for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH since sig: undefined, ts: undefined. API client call will be capped by 200.
 [HeliusApiClient] Starting Phase 1: Fetching signatures via Solana RPC for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH
[Nest] 7984  - 01/07/2025, 14:10:26     LOG [JobsService] Submitting sync job for wallet: 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe
[Nest] 7984  - 01/07/2025, 14:10:26     LOG [WalletOperationsProcessor] Processing sync-wallet job sync-bfcfec18
[Nest] 7984  - 01/07/2025, 14:10:26   DEBUG [RedisLockService] Lock acquired: lock:wallet:sync:7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe with value: sync-bfcfec18
 [HeliusSyncService] [Sync] Wallet entry ensured for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe. Proceeding with sync.
 [HeliusSyncService] [Sync] Starting data synchronization for wallet: 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe
 [HeliusSyncService] [Sync] Executing SmartFetch for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe with overall target of 200 signatures in DB.
 [HeliusSyncService] [Sync] SmartFetch Phase 1 (Newer): Fetching for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe since sig: undefined, ts: undefined. API client call will be capped by 200.
 [HeliusApiClient] Starting Phase 1: Fetching signatures via Solana RPC for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe
[Nest] 7984  - 01/07/2025, 14:10:26     LOG [JobsService] Submitting similarity analysis job for 2 wallets
[Nest] 7984  - 01/07/2025, 14:10:26   DEBUG [RedisLockService] Lock acquired: lock:similarity:similarity-1751368226336-i0nwku30u with value: similarity-86eba3e1ed9c
[Nest] 7984  - 01/07/2025, 14:10:26     LOG [SimilarityOperationsProcessor] Starting similarity flow for 2 wallets, requestId: similarity-1751368226336-i0nwku30u
[Nest] 7984  - 01/07/2025, 14:10:26   DEBUG [RedisLockService] Lock already exists: lock:wallet:sync:7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe
[Nest] 7984  - 01/07/2025, 14:10:26   DEBUG [RedisLockService] Lock already exists: lock:wallet:sync:8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH
[Nest] 7984  - 01/07/2025, 14:10:26    WARN [SimilarityOperationsProcessor] Wallet 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe is being synced by another process, waiting for completion...
[Nest] 7984  - 01/07/2025, 14:10:26    WARN [SimilarityOperationsProcessor] Wallet 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH is being synced by another process, waiting for completion...
[Nest] 7984  - 01/07/2025, 14:10:26     LOG [JobsService] Fetching stats for all queues
[Nest] 7984  - 01/07/2025, 14:10:26     LOG [JobsService] Fetching stats for queue: wallet-operations
[Nest] 7984  - 01/07/2025, 14:10:26     LOG [JobsService] Fetching stats for queue: analysis-operations
[Nest] 7984  - 01/07/2025, 14:10:26     LOG [JobsService] Fetching stats for queue: similarity-operations
[Nest] 7984  - 01/07/2025, 14:10:26     LOG [JobsService] Fetching stats for queue: enrichment-operations
 [HeliusApiClient] RPC fetcher has retrieved 1000 signatures, which meets or exceeds an intended conceptual target related to maxSignatures (200). Stopping further RPC pagination.
 [HeliusApiClient] Finished Phase 1. Total signatures retrieved via RPC: 1000
 [HeliusApiClient] RPC fetch resulted in 1000 signatures. Applying hard limit of 200.
 [HeliusApiClient] Sliced RPC signatures to newest 200 based on maxSignatures limit.
 [HeliusApiClient] RPC fetcher has retrieved 1000 signatures, which meets or exceeds an intended conceptual target related to maxSignatures (200). Stopping further RPC pagination.
 [HeliusApiClient] Finished Phase 1. Total signatures retrieved via RPC: 1000
 [HeliusApiClient] RPC fetch resulted in 1000 signatures. Applying hard limit of 200.
 [HeliusApiClient] Sliced RPC signatures to newest 200 based on maxSignatures limit.
 [HeliusApiClient] Found 2 signatures in cache. Need to fetch details for 198 signatures.
 [HeliusApiClient] Starting Phase 2: Fetching parsed details from Helius for 198 new signatures with internal concurrency of 3.
 [HeliusApiClient] Found 0 signatures in cache. Need to fetch details for 200 signatures.
 [HeliusApiClient] Starting Phase 2: Fetching parsed details from Helius for 200 new signatures with internal concurrency of 3.
  Fetching details: Processed ~100% of signatures (198 successful txns fetched so far)...
 [HeliusApiClient] Successfully fetched details for 198 out of 198 new transactions attempted in Phase 2.
 [DatabaseService] Identified 198 new transactions to insert into HeliusTransactionCache.
 [DatabaseService] Cache save complete. 198 new transactions added to HeliusTransactionCache.
 [HeliusApiClient] Loaded 2 cached transactions.
 [HeliusApiClient] Filtered combined transactions down to 199 involving the target address.
 [HeliusSyncService] [Sync] SmartFetch Phase 1 (Newer): Fetched 199 potentially newer transactions from API for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe.
 [HeliusSyncService] [Sync] Processing 199 transactions for wallet 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe...
 [HeliusTransactionMapper] Finished mapping 199 transactions for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe. Mapping statistics: {"totalTransactionsReceived":199,"transactionsSkippedError":7,"transactionsSuccessfullyProcessed":152,"analysisInputsGenerated":1024,"nativeSolTransfersProcessed":466,"tokenTransfersProcessed":558,"wsolTransfersProcessed":410,"usdcTransfersProcessed":0,"otherTokenTransfersProcessed":148,"feePayerHeuristicApplied":0,"feesCalculated":148,"eventMatcherAttempts":0,"eventMatcherPrimaryMintsIdentified":0,"eventMatcherConsistentSolFound":0,"eventMatcherConsistentUsdcFound":0,"eventMatcherAmbiguous":0,"eventMatcherNoConsistentValue":0,"splToSplSwapDetections":0,"associatedValueFromSplToSpl":0,"associatedValueFromEventMatcher":0,"associatedValueFromTotalMovement":148,"associatedValueFromNetChange":0,"smallOutgoingHeuristicApplied":262,"skippedDuplicateRecordKey":0,"countByInteractionType":{"SWAP":148,"TRANSFER":44},"unknownTxSkippedNoJito":0}
 [DatabaseService] Mapping activity log saved with ID: cmckffqm70004wk5snd1r3x6r for wallet 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe
 [HeliusSyncService] [Sync] Successfully saved mapping activity log for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe
 [HeliusSyncService] [Sync] Saving 152 analysis input records for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe...
 [DatabaseService] [DB] Attempting to save 152 SwapAnalysisInput records efficiently...
 [DatabaseService] [DB] Identified 150 unique new SwapAnalysisInput records to insert.
 [DatabaseService] [DB] Attempting to bulk insert 150 records with createMany...
 [DatabaseService] [DB] createMany successful. Inserted 150 records.
 [HeliusSyncService] [Sync] Successfully saved 152 new analysis input records for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe.
 [DatabaseService] [DB] Successfully upserted wallet: 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe
 [HeliusSyncService] [Sync] Finished processing batch of 199 transactions for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe.
 [HeliusSyncService] [Sync] SmartFetch: DB count for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe after fetching newer is 150. Target is 200.
 [HeliusSyncService] [Sync] SmartFetch Phase 2 (Older): Current count 150 is less than target 200. Still need 50 older transactions.
 [HeliusSyncService] [Sync] SmartFetch Phase 2 (Older): Attempting to fetch 50 older transactions for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe, older than ts: 1751102020.
 [HeliusApiClient] Starting Phase 1: Fetching signatures via Solana RPC for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe
[Nest] 7984  - 01/07/2025, 14:10:51   DEBUG [SimilarityOperationsProcessor] Wallet 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe sync completed by another process
 [HeliusApiClient] RPC fetcher has retrieved 1000 signatures, which meets or exceeds an intended conceptual target related to maxSignatures (50). Stopping further RPC pagination.
 [HeliusApiClient] Finished Phase 1. Total signatures retrieved via RPC: 1000
 [HeliusApiClient] RPC fetch resulted in 1000 signatures. Applying hard limit of 50.
 [HeliusApiClient] Sliced RPC signatures to newest 50 based on maxSignatures limit.
 [HeliusApiClient] Found 50 signatures in cache. Need to fetch details for 0 signatures.
 [HeliusApiClient] Loaded 50 cached transactions.
 [HeliusApiClient] Filtered by untilTimestamp (1751102020): 50 -> 0 transactions.
 [HeliusApiClient] Filtered combined transactions down to 0 involving the target address.
 [HeliusSyncService] [Sync] SmartFetch Phase 2 (Older): Fetched 0 potentially older transactions from API for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe.
 [HeliusSyncService] [Sync] SmartFetch process completed for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe.
 [HeliusSyncService] [Sync] Synchronization complete for wallet: 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe
[Nest] 7984  - 01/07/2025, 14:10:52     LOG [WalletOperationsProcessor] Wallet sync completed for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe.
[Nest] 7984  - 01/07/2025, 14:10:52   DEBUG [RedisLockService] Lock released: lock:wallet:sync:7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe with value: sync-bfcfec18
[Nest] 7984  - 01/07/2025, 14:10:52     LOG [WalletOperationsProcessor] Job sync-bfcfec18 completed successfully
  Fetching details: Processed ~100% of signatures (200 successful txns fetched so far)...
 [HeliusApiClient] Successfully fetched details for 200 out of 200 new transactions attempted in Phase 2.
 [DatabaseService] Identified 200 new transactions to insert into HeliusTransactionCache.
 [DatabaseService] Cache save complete. 200 new transactions added to HeliusTransactionCache.
 [HeliusApiClient] Loaded 0 cached transactions.
 [HeliusApiClient] Filtered combined transactions down to 200 involving the target address.
 [HeliusSyncService] [Sync] SmartFetch Phase 1 (Newer): Fetched 200 potentially newer transactions from API for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH.
 [HeliusSyncService] [Sync] Processing 200 transactions for wallet 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH...
 [HeliusTransactionMapper] Finished mapping 200 transactions for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH. Mapping statistics: {"totalTransactionsReceived":200,"transactionsSkippedError":9,"transactionsSuccessfullyProcessed":150,"analysisInputsGenerated":1001,"nativeSolTransfersProcessed":473,"tokenTransfersProcessed":528,"wsolTransfersProcessed":392,"usdcTransfersProcessed":0,"otherTokenTransfersProcessed":136,"feePayerHeuristicApplied":0,"feesCalculated":136,"eventMatcherAttempts":0,"eventMatcherPrimaryMintsIdentified":0,"eventMatcherConsistentSolFound":0,"eventMatcherConsistentUsdcFound":0,"eventMatcherAmbiguous":0,"eventMatcherNoConsistentValue":0,"splToSplSwapDetections":0,"associatedValueFromSplToSpl":0,"associatedValueFromEventMatcher":0,"associatedValueFromTotalMovement":136,"associatedValueFromNetChange":0,"smallOutgoingHeuristicApplied":256,"skippedDuplicateRecordKey":0,"countByInteractionType":{"SWAP":136,"TRANSFER":55},"unknownTxSkippedNoJito":0}
 [DatabaseService] Mapping activity log saved with ID: cmckfg9vm0005wk5sbnml9hby for wallet 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH
 [HeliusSyncService] [Sync] Successfully saved mapping activity log for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH
 [HeliusSyncService] [Sync] Saving 150 analysis input records for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH...
 [DatabaseService] [DB] Attempting to save 150 SwapAnalysisInput records efficiently...
 [DatabaseService] [DB] Identified 150 unique new SwapAnalysisInput records to insert.
 [DatabaseService] [DB] Attempting to bulk insert 150 records with createMany...
 [DatabaseService] [DB] createMany successful. Inserted 150 records.
 [HeliusSyncService] [Sync] Successfully saved 150 new analysis input records for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH.
 [DatabaseService] [DB] Successfully upserted wallet: 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH
 [HeliusSyncService] [Sync] Finished processing batch of 200 transactions for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH.
 [HeliusSyncService] [Sync] SmartFetch: DB count for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH after fetching newer is 150. Target is 200.
 [HeliusSyncService] [Sync] SmartFetch Phase 2 (Older): Current count 150 is less than target 200. Still need 50 older transactions.
 [HeliusSyncService] [Sync] SmartFetch Phase 2 (Older): Attempting to fetch 50 older transactions for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH, older than ts: 1751021088.
 [HeliusApiClient] Starting Phase 1: Fetching signatures via Solana RPC for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH
[Nest] 7984  - 01/07/2025, 14:11:16   DEBUG [SimilarityOperationsProcessor] Wallet 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH sync completed by another process
[Nest] 7984  - 01/07/2025, 14:11:16     LOG [SimilarityOperationsProcessor] Sync phase completed: 2/2 wallets synced successfully (100.0%)
[Nest] 7984  - 01/07/2025, 14:11:16   DEBUG [PnlAnalysisService] [NestWrapper] analyzeWalletPnl called for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe
 [PnlAnalysisService] [PnlAnalysis] Starting analysis for wallet 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe {}
 [WalletBalanceService] Fetching wallet balances for 1 addresses. Commitment: default
[Nest] 7984  - 01/07/2025, 14:11:16   DEBUG [BehaviorService] Getting wallet behavior for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe
 [BehaviorAnalyzer] BehaviorAnalyzer instantiated with behavior-specific config.
 [BehaviorService] BehaviorService instantiated
 [BehaviorService] Analyzing trading behavior for wallet 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe
[Nest] 7984  - 01/07/2025, 14:11:16   DEBUG [PnlAnalysisService] [NestWrapper] analyzeWalletPnl called for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH
 [PnlAnalysisService] [PnlAnalysis] Starting analysis for wallet 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH {}
 [WalletBalanceService] Fetching wallet balances for 1 addresses. Commitment: default
[Nest] 7984  - 01/07/2025, 14:11:16   DEBUG [BehaviorService] Getting wallet behavior for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH
 [BehaviorAnalyzer] BehaviorAnalyzer instantiated with behavior-specific config.
 [BehaviorService] BehaviorService instantiated
 [BehaviorService] Analyzing trading behavior for wallet 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH
 [HeliusApiClient] RPC fetcher has retrieved 1000 signatures, which meets or exceeds an intended conceptual target related to maxSignatures (50). Stopping further RPC pagination.
 [HeliusApiClient] Finished Phase 1. Total signatures retrieved via RPC: 1000
 [HeliusApiClient] RPC fetch resulted in 1000 signatures. Applying hard limit of 50.
 [HeliusApiClient] Sliced RPC signatures to newest 50 based on maxSignatures limit.
 [DatabaseService] Found 150 SwapAnalysisInput records for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe.
 [DatabaseService] Found 150 SwapAnalysisInput records for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH.
 [HeliusApiClient] Found 50 signatures in cache. Need to fetch details for 0 signatures.
 [HeliusApiClient] Loaded 50 cached transactions.
 [HeliusApiClient] Filtered by untilTimestamp (1751021088): 50 -> 0 transactions.
 [HeliusApiClient] Filtered combined transactions down to 0 involving the target address.
 [HeliusSyncService] [Sync] SmartFetch Phase 2 (Older): Fetched 0 potentially older transactions from API for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH.
 [HeliusSyncService] [Sync] SmartFetch process completed for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH.
 [HeliusSyncService] [Sync] Synchronization complete for wallet: 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH
 [BehaviorService] Successfully upserted WalletBehaviorProfile for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe
 [BehaviorService] Completed behavior analysis for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe
 [BehaviorService] Successfully upserted WalletBehaviorProfile for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH
 [BehaviorService] Completed behavior analysis for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH
[Nest] 7984  - 01/07/2025, 14:11:16     LOG [WalletOperationsProcessor] Wallet sync completed for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH.
[Nest] 7984  - 01/07/2025, 14:11:16   DEBUG [RedisLockService] Lock released: lock:wallet:sync:8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH with value: sync-f8531e7d
[Nest] 7984  - 01/07/2025, 14:11:16     LOG [WalletOperationsProcessor] Job sync-f8531e7d completed successfully
 [HeliusApiClient] Successfully fetched token accounts for owner 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH. Count: 211
 [WalletBalanceService] Successfully processed wallet balance fetching for 1 addresses.
 [PnlAnalysisService] [PnlAnalysis] Successfully fetched wallet state for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH. SOL: 0.536818935, FetchedAt: Tue Jul 01 2025 14:11:16 GMT+0300 (Eastern European Summer Time)
 [DatabaseService] Found 150 SwapAnalysisInput records for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH.
 [SwapAnalyzer] [SwapAnalyzer] Analyzing 150 pre-processed swap input records for wallet 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH (after BURN filter)...
 [SwapAnalyzer] [SwapAnalyzer] Aggregated data for 4 unique SPL tokens across 150 signatures.
 [SwapAnalyzer] [SwapAnalyzer] Final analysis complete. Generated 3 results (after filtering WSOL).
 [PnlAnalysisService] [PnlAnalysis] SwapAnalyzer finished for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH. Got 3 token results.
 [AdvancedStatsAnalyzer] [AdvancedStatsAnalyzer] Calculated advanced trading stats.
 [PnlAnalysisService] [PnlAnalysis] Upserted 3 AnalysisResult records for 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH.
 [PnlAnalysisService] [PnlAnalysis] Successfully marked AnalysisRun 43 as COMPLETED.
[Nest] 7984  - 01/07/2025, 14:11:17   DEBUG [SimilarityOperationsProcessor] Analysis completed for wallet: 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH (PNL: true, Behavior: true)
 [HeliusApiClient] Successfully fetched token accounts for owner 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe. Count: 266
 [WalletBalanceService] Successfully processed wallet balance fetching for 1 addresses.
 [PnlAnalysisService] [PnlAnalysis] Successfully fetched wallet state for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe. SOL: 53.14217693, FetchedAt: Tue Jul 01 2025 14:11:16 GMT+0300 (Eastern European Summer Time)
 [DatabaseService] Found 150 SwapAnalysisInput records for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe.
 [SwapAnalyzer] [SwapAnalyzer] Analyzing 150 pre-processed swap input records for wallet 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe (after BURN filter)...
 [SwapAnalyzer] [SwapAnalyzer] Aggregated data for 4 unique SPL tokens across 150 signatures.
 [SwapAnalyzer] [SwapAnalyzer] Final analysis complete. Generated 3 results (after filtering WSOL).
 [PnlAnalysisService] [PnlAnalysis] SwapAnalyzer finished for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe. Got 3 token results.
 [AdvancedStatsAnalyzer] [AdvancedStatsAnalyzer] Calculated advanced trading stats.
 [PnlAnalysisService] [PnlAnalysis] Upserted 3 AnalysisResult records for 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe.
 [PnlAnalysisService] [PnlAnalysis] Successfully marked AnalysisRun 44 as COMPLETED.
[Nest] 7984  - 01/07/2025, 14:11:17   DEBUG [SimilarityOperationsProcessor] Analysis completed for wallet: 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe (PNL: true, Behavior: true)
[Nest] 7984  - 01/07/2025, 14:11:17     LOG [SimilarityOperationsProcessor] Analysis phase completed: 2/2 wallets analyzed successfully (100.0%)
 [SimilarityApiService] Received request to run comprehensive similarity analysis for 2 wallets. {"wallets":["8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH","7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe"]}
 [WalletBalanceService] Fetching wallet balances for 2 addresses. Commitment: default
 [HeliusApiClient] Successfully fetched token accounts for owner 8vdBzbTqiiWQMmqnGJX1gAQxF79g84snrwdWEpHuF2HH. Count: 211
 [HeliusApiClient] Successfully fetched token accounts for owner 7WHUZhaCDqGGeTwhkqFRa6pERnyaBLcZDQmGyt2cpVpe. Count: 266
 [WalletBalanceService] Successfully processed wallet balance fetching for 2 addresses.
 [SimilarityService] [Primary Filtered Similarity] Calculated capital similarity for 2 wallets using 4 actively traded tokens
 [SimilarityService] [Primary Filtered Similarity] Calculated binary similarity for 2 wallets using 4 actively traded tokens
 [SimilarityService] Comprehensive similarity analysis completed for 2 wallets.
 [SimilarityService] Comprehensive similarity analysis completed for 2 wallets.
[Nest] 7984  - 01/07/2025, 14:11:18     LOG [SimilarityOperationsProcessor] Similarity flow completed successfully. Processed 2/2 wallets
[Nest] 7984  - 01/07/2025, 14:11:18   DEBUG [RedisLockService] Lock released: lock:similarity:similarity-1751368226336-i0nwku30u with value: similarity-86eba3e1ed9c
[Nest] 7984  - 01/07/2025, 14:11:19     LOG [SimilarityOperationsProcessor] Job similarity-86eba3e1ed9c completed successfully
