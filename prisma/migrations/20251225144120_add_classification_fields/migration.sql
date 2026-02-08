-- AlterTable
ALTER TABLE "WalletBehaviorProfile" ADD COLUMN     "flowPattern" TEXT,
ADD COLUMN     "medianActiveHoldingHours" DOUBLE PRECISION,
ADD COLUMN     "speedCategory" TEXT,
ADD COLUMN     "strategyType" TEXT,
ADD COLUMN     "tokensWithOnlyBuys" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "velocityScore" INTEGER;

-- CreateIndex
CREATE INDEX "WalletBehaviorProfile_strategyType_idx" ON "WalletBehaviorProfile"("strategyType");

-- CreateIndex
CREATE INDEX "WalletBehaviorProfile_speedCategory_idx" ON "WalletBehaviorProfile"("speedCategory");
