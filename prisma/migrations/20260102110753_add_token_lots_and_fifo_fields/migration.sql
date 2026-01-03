-- AlterTable
ALTER TABLE "AnalysisResult" ADD COLUMN     "currentHoldingsCostBasisSol" DOUBLE PRECISION,
ADD COLUMN     "hasIncompleteHistory" BOOLEAN DEFAULT false,
ADD COLUMN     "realizedPnlSol" DOUBLE PRECISION,
ADD COLUMN     "totalPnlSol" DOUBLE PRECISION,
ADD COLUMN     "unrealizedPnlSol" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "TokenLot" (
    "id" SERIAL NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "amountBought" DECIMAL(38,18) NOT NULL,
    "costBasisSol" DECIMAL(38,18) NOT NULL,
    "amountRemaining" DECIMAL(38,18) NOT NULL,
    "purchaseTimestamp" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "sourceSignature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenLot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TokenLot_walletAddress_tokenAddress_purchaseTimestamp_idx" ON "TokenLot"("walletAddress", "tokenAddress", "purchaseTimestamp");

-- CreateIndex
CREATE INDEX "TokenLot_walletAddress_idx" ON "TokenLot"("walletAddress");

-- CreateIndex
CREATE INDEX "TokenLot_tokenAddress_idx" ON "TokenLot"("tokenAddress");

-- AddForeignKey
ALTER TABLE "TokenLot" ADD CONSTRAINT "TokenLot_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE CASCADE ON UPDATE CASCADE;
