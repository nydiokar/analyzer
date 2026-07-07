CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "WalletVector" (
  "walletAddress" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "vector" vector(64) NOT NULL,
  "sourceVector" JSONB NOT NULL,
  "builtAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WalletVector_pkey" PRIMARY KEY ("walletAddress"),
  CONSTRAINT "WalletVector_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "WalletVector_schemaVersion_idx" ON "WalletVector"("schemaVersion");
CREATE INDEX "WalletVector_vector_hnsw_idx" ON "WalletVector" USING hnsw ("vector" vector_cosine_ops);

CREATE TABLE "PopulationStats" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "schemaVersion" INTEGER NOT NULL,
  "means" JSONB NOT NULL,
  "scales" JSONB NOT NULL,
  "walletCount" INTEGER NOT NULL,
  "computedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PopulationStats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WalletTokenEdge" (
  "walletAddress" TEXT NOT NULL,
  "mint" TEXT NOT NULL,
  "buyWeight" DOUBLE PRECISION NOT NULL,
  "buyCount" INTEGER NOT NULL,
  "sellCount" INTEGER NOT NULL,
  "tradeCount" INTEGER NOT NULL,
  "firstTs" INTEGER NOT NULL,
  "lastTs" INTEGER NOT NULL,
  "refreshedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WalletTokenEdge_pkey" PRIMARY KEY ("walletAddress", "mint")
);

CREATE INDEX "WalletTokenEdge_mint_idx" ON "WalletTokenEdge"("mint");
CREATE INDEX "WalletTokenEdge_walletAddress_idx" ON "WalletTokenEdge"("walletAddress");

CREATE TABLE "WalletWalletEdge" (
  "a" TEXT NOT NULL,
  "b" TEXT NOT NULL,
  "sharedNonObvious" INTEGER NOT NULL,
  "syncEventCount" INTEGER NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "refreshedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WalletWalletEdge_pkey" PRIMARY KEY ("a", "b")
);

CREATE INDEX "WalletWalletEdge_a_idx" ON "WalletWalletEdge"("a");
CREATE INDEX "WalletWalletEdge_b_idx" ON "WalletWalletEdge"("b");
CREATE INDEX "WalletWalletEdge_score_idx" ON "WalletWalletEdge"("score");

CREATE TABLE "WalletClusterMembership" (
  "walletAddress" TEXT NOT NULL,
  "clusterId" TEXT NOT NULL,
  "role" TEXT,
  "clusterSize" INTEGER NOT NULL,
  "refreshedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WalletClusterMembership_pkey" PRIMARY KEY ("walletAddress")
);

CREATE INDEX "WalletClusterMembership_clusterId_idx" ON "WalletClusterMembership"("clusterId");

ALTER TABLE "RadarHolding"
  ADD COLUMN "reviewerId" TEXT,
  ADD COLUMN "reviewSource" TEXT;

CREATE INDEX "RadarHolding_reviewerId_idx" ON "RadarHolding"("reviewerId");
CREATE INDEX "RadarHolding_reviewSource_idx" ON "RadarHolding"("reviewSource");

ALTER TABLE "WalletHunt"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archiveReason" TEXT;

CREATE INDEX "WalletHunt_archivedAt_idx" ON "WalletHunt"("archivedAt");
