/*
  Warnings:

  - You are about to drop the column `detectedCreatorAddress` on the `TokenInfo` table. All the data in the column will be lost.
  - You are about to drop the column `mintCreatedAt` on the `TokenInfo` table. All the data in the column will be lost.
  - You are about to drop the column `mintCreationFetchedAt` on the `TokenInfo` table. All the data in the column will be lost.
  - You are about to drop the column `mintCreationSignature` on the `TokenInfo` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "public"."TokenInfo_mintCreatedAt_idx";

-- AlterTable
ALTER TABLE "TokenInfo" DROP COLUMN "detectedCreatorAddress",
DROP COLUMN "mintCreatedAt",
DROP COLUMN "mintCreationFetchedAt",
DROP COLUMN "mintCreationSignature";
