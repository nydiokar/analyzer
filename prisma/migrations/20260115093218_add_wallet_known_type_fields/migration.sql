/*
  Warnings:

  - Added the required column `transactions` to the `SignificantBuyersCache` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SignificantBuyersCache" ADD COLUMN     "transactions" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "knownLabel" TEXT,
ADD COLUMN     "knownType" TEXT;

-- CreateIndex
CREATE INDEX "Wallet_knownType_idx" ON "Wallet"("knownType");
