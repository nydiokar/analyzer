-- CreateTable
CREATE TABLE "HolderProfileShare" (
    "id" TEXT NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "tokenMint" TEXT,
    "tokenSymbol" TEXT,
    "topN" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HolderProfileShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HolderProfileShare_createdAt_idx" ON "HolderProfileShare"("createdAt");

-- CreateIndex
CREATE INDEX "HolderProfileShare_createdBy_idx" ON "HolderProfileShare"("createdBy");

-- AddForeignKey
ALTER TABLE "HolderProfileShare" ADD CONSTRAINT "HolderProfileShare_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
