/*
  Warnings:

  - A unique constraint covering the columns `[tokenAddress,list]` on the table `WatchedToken` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "WatchedToken_tokenAddress_list_key" ON "WatchedToken"("tokenAddress", "list");
