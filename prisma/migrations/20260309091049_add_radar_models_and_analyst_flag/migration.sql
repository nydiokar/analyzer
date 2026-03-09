-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isAnalyst" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RadarWallet" (
    "wallet" TEXT NOT NULL,
    "label" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "addedBy" TEXT,

    CONSTRAINT "RadarWallet_pkey" PRIMARY KEY ("wallet")
);

-- CreateTable
CREATE TABLE "RadarHolding" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "uiBalance" DOUBLE PRECISION NOT NULL,
    "usdValue" DOUBLE PRECISION,
    "acquiredAt" TIMESTAMP(3),
    "isActiveHolding" BOOLEAN NOT NULL DEFAULT true,
    "reviewStatus" TEXT NOT NULL DEFAULT 'unreviewed',
    "reviewedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "RadarHolding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RadarHolding_wallet_idx" ON "RadarHolding"("wallet");

-- CreateIndex
CREATE INDEX "RadarHolding_firstSeenAt_idx" ON "RadarHolding"("firstSeenAt");

-- CreateIndex
CREATE INDEX "RadarHolding_reviewStatus_idx" ON "RadarHolding"("reviewStatus");

-- CreateIndex
CREATE INDEX "RadarHolding_isActiveHolding_idx" ON "RadarHolding"("isActiveHolding");

-- CreateIndex
CREATE UNIQUE INDEX "RadarHolding_wallet_tokenMint_key" ON "RadarHolding"("wallet", "tokenMint");
