/*
  Warnings:

  - You are about to drop the column `transactions` on the `SignificantBuyersCache` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "SignificantBuyersCache" DROP COLUMN "transactions";

-- AlterTable
ALTER TABLE "WalletPnlSummary" ADD COLUMN     "profitableTradesCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalIndividualTradesCount" INTEGER NOT NULL DEFAULT 0;
