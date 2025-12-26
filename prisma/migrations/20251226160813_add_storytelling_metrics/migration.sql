-- AlterTable
ALTER TABLE "WalletBehaviorProfile" ADD COLUMN     "averageCurrentHoldingDurationHours" DOUBLE PRECISION,
ADD COLUMN     "exitPattern" TEXT,
ADD COLUMN     "medianCurrentHoldingDurationHours" DOUBLE PRECISION,
ADD COLUMN     "percentOfValueInCurrentHoldings" DOUBLE PRECISION;
