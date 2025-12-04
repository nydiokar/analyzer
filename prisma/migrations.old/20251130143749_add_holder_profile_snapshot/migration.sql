-- CreateTable
CREATE TABLE "HolderProfileSnapshot" (
    "id" SERIAL NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "tokenMint" TEXT,
    "analysisMode" TEXT NOT NULL,
    "holderRank" INTEGER,
    "supplyPercent" DOUBLE PRECISION,
    "topN" INTEGER,
    "jobId" TEXT,
    "requestId" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "profile" JSONB NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "HolderProfileSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HolderProfileSnapshot_tokenMint_idx" ON "HolderProfileSnapshot"("tokenMint");

-- CreateIndex
CREATE INDEX "HolderProfileSnapshot_walletAddress_tokenMint_computedAt_idx" ON "HolderProfileSnapshot"("walletAddress", "tokenMint", "computedAt");

-- AddForeignKey
ALTER TABLE "HolderProfileSnapshot" ADD CONSTRAINT "HolderProfileSnapshot_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE RESTRICT ON UPDATE CASCADE;
