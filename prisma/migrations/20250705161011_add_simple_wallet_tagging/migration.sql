-- AlterTable
ALTER TABLE "UserFavoriteWallet" ADD COLUMN "collections" TEXT;
ALTER TABLE "UserFavoriteWallet" ADD COLUMN "lastViewedAt" DATETIME;
ALTER TABLE "UserFavoriteWallet" ADD COLUMN "metadata" JSONB;
ALTER TABLE "UserFavoriteWallet" ADD COLUMN "nickname" TEXT;
ALTER TABLE "UserFavoriteWallet" ADD COLUMN "tags" TEXT;

-- CreateIndex
CREATE INDEX "UserFavoriteWallet_lastViewedAt_idx" ON "UserFavoriteWallet"("lastViewedAt");
