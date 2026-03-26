-- AlterTable
ALTER TABLE "SwapAnalysisInput" ADD COLUMN     "enrichedAt" TIMESTAMP(3),
ADD COLUMN     "marketCapUsd" DOUBLE PRECISION,
ADD COLUMN     "mcapBucket" TEXT,
ADD COLUMN     "solPriceUsd" DOUBLE PRECISION,
ADD COLUMN     "tokenPriceUsd" DOUBLE PRECISION,
ADD COLUMN     "usdValue" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "TokenInfo" ADD COLUMN     "totalSupply" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "SolDailyPrice" (
    "date" TEXT NOT NULL,
    "priceUsd" DOUBLE PRECISION NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolDailyPrice_pkey" PRIMARY KEY ("date")
);
