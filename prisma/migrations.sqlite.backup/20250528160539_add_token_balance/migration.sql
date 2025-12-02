-- AlterTable
ALTER TABLE "AnalysisResult" ADD COLUMN "balanceDecimals" INTEGER;
ALTER TABLE "AnalysisResult" ADD COLUMN "balanceFetchedAt" DATETIME;
ALTER TABLE "AnalysisResult" ADD COLUMN "currentRawBalance" TEXT;

-- AlterTable
ALTER TABLE "WalletPnlSummary" ADD COLUMN "currentSolBalance" REAL;
ALTER TABLE "WalletPnlSummary" ADD COLUMN "solBalanceFetchedAt" DATETIME;
