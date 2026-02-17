-- CreateTable
CREATE TABLE "TokenAccountWatermark" (
    "id" TEXT NOT NULL,
    "ownerPubkey" TEXT NOT NULL,
    "filterKey" TEXT NOT NULL,
    "lastSlot" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenAccountWatermark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TokenAccountWatermark_ownerPubkey_idx" ON "TokenAccountWatermark"("ownerPubkey");

-- CreateIndex
CREATE INDEX "TokenAccountWatermark_updatedAt_idx" ON "TokenAccountWatermark"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TokenAccountWatermark_ownerPubkey_filterKey_key" ON "TokenAccountWatermark"("ownerPubkey", "filterKey");
