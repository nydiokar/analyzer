/*
  Warnings:

  - A unique constraint covering the columns `[signature,mint,direction]` on the table `SwapAnalysisInput` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "SwapAnalysisInput_signature_mint_direction_key" ON "SwapAnalysisInput"("signature", "mint", "direction");
