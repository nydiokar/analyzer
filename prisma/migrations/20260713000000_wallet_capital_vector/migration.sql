-- AGENT_11 Part B: capital / outcome embedding (money axis), separate from WalletVector.
-- Additive-only. Mirrors the WalletVector / PopulationStats / HNSW pattern.

CREATE TABLE "WalletCapitalVector" (
  "walletAddress" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "vector" vector(16) NOT NULL,
  "sourceVector" JSONB NOT NULL,
  "dataQuality" DOUBLE PRECISION NOT NULL,
  "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletCapitalVector_pkey" PRIMARY KEY ("walletAddress"),
  CONSTRAINT "WalletCapitalVector_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "WalletCapitalVector_schemaVersion_idx" ON "WalletCapitalVector"("schemaVersion");
CREATE INDEX "WalletCapitalVector_vector_hnsw_idx" ON "WalletCapitalVector" USING hnsw ("vector" vector_cosine_ops);

CREATE TABLE "CapitalPopulationStats" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "schemaVersion" INTEGER NOT NULL,
  "means" JSONB NOT NULL,
  "scales" JSONB NOT NULL,
  "walletCount" INTEGER NOT NULL,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CapitalPopulationStats_pkey" PRIMARY KEY ("id")
);
