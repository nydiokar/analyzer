-- CreateTable
CREATE TABLE "KolProfile" (
    "walletAddress" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "twitter" TEXT,
    "telegram" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KolProfile_pkey" PRIMARY KEY ("walletAddress")
);

-- CreateIndex
CREATE INDEX "KolProfile_name_idx" ON "KolProfile"("name");

-- AddForeignKey
ALTER TABLE "KolProfile" ADD CONSTRAINT "KolProfile_walletAddress_fkey"
    FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address")
    ON DELETE CASCADE ON UPDATE CASCADE;
