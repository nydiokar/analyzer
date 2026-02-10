-- DropIndex
DROP INDEX "public"."TokenLot_tokenAddress_idx";

-- DropIndex
DROP INDEX "public"."TokenLot_walletAddress_idx";

-- CreateTable
CREATE TABLE "RegistrationCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "description" TEXT,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "usedByUserId" TEXT,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT,

    CONSTRAINT "RegistrationCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationCode_code_key" ON "RegistrationCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationCode_usedByUserId_key" ON "RegistrationCode"("usedByUserId");

-- CreateIndex
CREATE INDEX "RegistrationCode_code_idx" ON "RegistrationCode"("code");

-- CreateIndex
CREATE INDEX "RegistrationCode_status_idx" ON "RegistrationCode"("status");

-- CreateIndex
CREATE INDEX "RegistrationCode_createdAt_idx" ON "RegistrationCode"("createdAt");

-- CreateIndex
CREATE INDEX "RegistrationCode_expiresAt_idx" ON "RegistrationCode"("expiresAt");

-- AddForeignKey
ALTER TABLE "RegistrationCode" ADD CONSTRAINT "RegistrationCode_usedByUserId_fkey" FOREIGN KEY ("usedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
