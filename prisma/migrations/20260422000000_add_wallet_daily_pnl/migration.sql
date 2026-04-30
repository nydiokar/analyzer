CREATE TABLE IF NOT EXISTS "WalletDailyPnl" (
    "id" SERIAL NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "tradeCount" INTEGER NOT NULL,
    "buyCount" INTEGER NOT NULL,
    "sellCount" INTEGER NOT NULL,
    "volumeSol" DOUBLE PRECISION NOT NULL,
    "feesSol" DOUBLE PRECISION NOT NULL,
    "realizedPnlSol" DOUBLE PRECISION NOT NULL,
    "profitableSellsCount" INTEGER NOT NULL,
    "totalSellsCount" INTEGER NOT NULL,
    "uniqueMintsTradedCount" INTEGER NOT NULL,
    "newMintsEnteredCount" INTEGER NOT NULL,
    "volumeUsd" DOUBLE PRECISION,
    "realizedPnlUsd" DOUBLE PRECISION,
    "hasIncompleteEnrichment" BOOLEAN NOT NULL DEFAULT false,
    "hasIncompleteHistory" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastComputedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletDailyPnl_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WalletDailyPnl_walletAddress_date_key"
    ON "WalletDailyPnl"("walletAddress", "date");

CREATE INDEX IF NOT EXISTS "WalletDailyPnl_walletAddress_idx"
    ON "WalletDailyPnl"("walletAddress");

CREATE INDEX IF NOT EXISTS "WalletDailyPnl_date_idx"
    ON "WalletDailyPnl"("date");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'WalletDailyPnl_walletAddress_fkey'
    ) THEN
        ALTER TABLE "WalletDailyPnl"
            ADD CONSTRAINT "WalletDailyPnl_walletAddress_fkey"
            FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address")
            ON DELETE CASCADE
            ON UPDATE CASCADE;
    END IF;
END $$;
