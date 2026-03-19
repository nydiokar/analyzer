ALTER TABLE "TokenInfo"
ADD COLUMN "mintCreatedAt" BIGINT,
ADD COLUMN "mintCreationSignature" TEXT,
ADD COLUMN "detectedCreatorAddress" TEXT,
ADD COLUMN "mintCreationFetchedAt" TIMESTAMP(3);

CREATE INDEX "TokenInfo_mintCreatedAt_idx" ON "TokenInfo"("mintCreatedAt");
