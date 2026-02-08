-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastBulkImportAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_lastBulkImportAt_idx" ON "User"("lastBulkImportAt");
