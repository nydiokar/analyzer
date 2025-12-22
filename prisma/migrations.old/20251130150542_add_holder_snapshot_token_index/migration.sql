-- DropIndex
DROP INDEX "public"."HolderProfileSnapshot_tokenMint_idx";

-- CreateIndex
CREATE INDEX "HolderProfileSnapshot_tokenMint_computedAt_idx" ON "HolderProfileSnapshot"("tokenMint", "computedAt");
