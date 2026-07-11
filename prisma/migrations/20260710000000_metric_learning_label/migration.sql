-- SPEC-002 Act 3: metric-learning label ledger (additive-only, new table).
-- No existing table is altered. Append-only, idempotent training-ready pair ledger.
CREATE TABLE "MetricLearningLabel" (
  "id" TEXT NOT NULL,
  "walletA" TEXT NOT NULL,
  "walletB" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "huntId" TEXT,
  "reviewerId" TEXT,
  "confidence" DOUBLE PRECISION,
  "splitBucket" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MetricLearningLabel_pkey" PRIMARY KEY ("id")
);

-- Idempotency key on the canonicalized unordered pair (walletA < walletB) + source.
CREATE UNIQUE INDEX "MetricLearningLabel_walletA_walletB_source_key" ON "MetricLearningLabel"("walletA", "walletB", "source");
CREATE INDEX "MetricLearningLabel_huntId_idx" ON "MetricLearningLabel"("huntId");
CREATE INDEX "MetricLearningLabel_label_idx" ON "MetricLearningLabel"("label");
