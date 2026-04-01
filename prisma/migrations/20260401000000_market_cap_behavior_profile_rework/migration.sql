-- Add robust market cap behavior summary fields for wallet HUD/profile usage
-- and robust token-level entry/exit mcap summaries.

ALTER TABLE "AnalysisResult" ADD COLUMN IF NOT EXISTS "typicalEntryMcapUsd" DOUBLE PRECISION;
ALTER TABLE "AnalysisResult" ADD COLUMN IF NOT EXISTS "entryMcapP25Usd" DOUBLE PRECISION;
ALTER TABLE "AnalysisResult" ADD COLUMN IF NOT EXISTS "entryMcapP75Usd" DOUBLE PRECISION;
ALTER TABLE "AnalysisResult" ADD COLUMN IF NOT EXISTS "typicalExitMcapUsd" DOUBLE PRECISION;
ALTER TABLE "AnalysisResult" ADD COLUMN IF NOT EXISTS "exitMcapP25Usd" DOUBLE PRECISION;
ALTER TABLE "AnalysisResult" ADD COLUMN IF NOT EXISTS "exitMcapP75Usd" DOUBLE PRECISION;

ALTER TABLE "WalletBehaviorProfile" ADD COLUMN IF NOT EXISTS "typicalEntryMcapUsd" DOUBLE PRECISION;
ALTER TABLE "WalletBehaviorProfile" ADD COLUMN IF NOT EXISTS "entryMcapP25Usd" DOUBLE PRECISION;
ALTER TABLE "WalletBehaviorProfile" ADD COLUMN IF NOT EXISTS "entryMcapP75Usd" DOUBLE PRECISION;
ALTER TABLE "WalletBehaviorProfile" ADD COLUMN IF NOT EXISTS "dominantEntryMcapBucket" TEXT;
ALTER TABLE "WalletBehaviorProfile" ADD COLUMN IF NOT EXISTS "dominantEntryMcapBucketShare" DOUBLE PRECISION;
ALTER TABLE "WalletBehaviorProfile" ADD COLUMN IF NOT EXISTS "entryMcapDistributionByCount" JSONB;
ALTER TABLE "WalletBehaviorProfile" ADD COLUMN IF NOT EXISTS "entryMcapSampleSizeBuys" INTEGER;
ALTER TABLE "WalletBehaviorProfile" ADD COLUMN IF NOT EXISTS "entryMcapSampleSizeTokens" INTEGER;
