-- Add chain field to Wallet for multi-chain support (EVM ingestion)
-- Existing Solana wallets default to "solana"
ALTER TABLE "Wallet" ADD COLUMN IF NOT EXISTS "chain" TEXT NOT NULL DEFAULT 'solana';
