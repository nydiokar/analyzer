-- MCE-7: Market Context Downstream
-- Adds USD-denominated fields to AnalysisResult, TokenLot, WalletPnlSummary,
-- and mcap preference fields to WalletBehaviorProfile.
-- All columns are nullable — no existing data is affected.

-- AnalysisResult: avg entry/exit market cap per token
ALTER TABLE "AnalysisResult" ADD COLUMN IF NOT EXISTS "avgEntryMcap" DOUBLE PRECISION;
ALTER TABLE "AnalysisResult" ADD COLUMN IF NOT EXISTS "avgEntryMcapBucket" TEXT;
ALTER TABLE "AnalysisResult" ADD COLUMN IF NOT EXISTS "avgExitMcap" DOUBLE PRECISION;
ALTER TABLE "AnalysisResult" ADD COLUMN IF NOT EXISTS "avgExitMcapBucket" TEXT;

-- TokenLot: USD cost basis and entry mcap per lot
ALTER TABLE "TokenLot" ADD COLUMN IF NOT EXISTS "entryPriceUsd" DOUBLE PRECISION;
ALTER TABLE "TokenLot" ADD COLUMN IF NOT EXISTS "entryMcapUsd" DOUBLE PRECISION;
ALTER TABLE "TokenLot" ADD COLUMN IF NOT EXISTS "entryMcapBucket" TEXT;
ALTER TABLE "TokenLot" ADD COLUMN IF NOT EXISTS "costBasisUsd" DOUBLE PRECISION;

-- WalletBehaviorProfile: mcap preference fields
ALTER TABLE "WalletBehaviorProfile" ADD COLUMN IF NOT EXISTS "preferredMcapBucket" TEXT;
ALTER TABLE "WalletBehaviorProfile" ADD COLUMN IF NOT EXISTS "avgEntryMcap" DOUBLE PRECISION;
ALTER TABLE "WalletBehaviorProfile" ADD COLUMN IF NOT EXISTS "mcapDistribution" JSONB;
ALTER TABLE "WalletBehaviorProfile" ADD COLUMN IF NOT EXISTS "mcapBucketPnl" JSONB;

-- WalletPnlSummary: USD-denominated PnL summary
ALTER TABLE "WalletPnlSummary" ADD COLUMN IF NOT EXISTS "totalVolumeUsd" DOUBLE PRECISION;
ALTER TABLE "WalletPnlSummary" ADD COLUMN IF NOT EXISTS "realizedPnlUsd" DOUBLE PRECISION;
ALTER TABLE "WalletPnlSummary" ADD COLUMN IF NOT EXISTS "unrealizedPnlUsd" DOUBLE PRECISION;
ALTER TABLE "WalletPnlSummary" ADD COLUMN IF NOT EXISTS "netPnlUsd" DOUBLE PRECISION;
