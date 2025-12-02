/*
  Warnings:

  - A unique constraint covering the columns `[signature,mint,direction,amount]` on the table `SwapAnalysisInput` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "SwapAnalysisInput_signature_mint_direction_key";

-- CreateIndex
CREATE UNIQUE INDEX "SwapAnalysisInput_signature_mint_direction_amount_key" ON "SwapAnalysisInput"("signature", "mint", "direction", "amount");
