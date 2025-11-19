Summary of Changes:

  1. Extended Existing Data Structure (Minimal Addition)

  - Added holdTimeTokenMap to WalletHistoricalPattern interface in src/types/behavior.ts
  - This stores which tokens are in each bucket (not just counts)

  2. Modified Core Analyzer (Where the Data Already Existed)

  - Updated src/core/analysis/behavior/analyzer.ts (lines 304-338)
  - Added token mapping logic RIGHT where the distribution is already calculated
  - Reused existing lifecyclesByToken data that was already being iterated

  3. Added Service Layer Method (Following Architecture)

  - Added getExitTimingTokens() method to BehaviorService (API layer service)
  - This wraps the existing getWalletBehavior() and extracts the bucket data

  4. Added Controller Endpoint (Correct Location)

  - Added GET /wallets/:walletAddress/exit-timing-tokens/:timeBucket to WalletsController (not AnalysesController!)
  - Follows pattern: Controller → Service (API layer) → Core Service
  - No direct imports of core services in controller ✅

  5. Frontend Types

  - Added holdTimeTokenMap to HistoricalPattern interface
  - Added ExitTimingTokensResponse and TimeBucket type

  6. Cleaned Up

  - Removed duplicate classification function I initially created
  - Removed incorrect implementation from AnalysesController
  - Removed unused DTO file

  Architectural Pattern Followed:

  WalletsController (API endpoint)
    ↓
  BehaviorService (API layer service)
    ↓
  BehaviorService (Core service) → BehaviorAnalyzer
    ↓
  Returns data with holdTimeTokenMap already populated

  The key insight: The data was already being calculated in the analyzer! I just needed to capture which tokens went
   into each bucket while building the distribution, then expose it through the existing service layer.
