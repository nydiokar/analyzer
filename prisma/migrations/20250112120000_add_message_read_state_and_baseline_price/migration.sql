-- Add baselinePrice column to TokenAlert table
ALTER TABLE "TokenAlert" ADD COLUMN "baselinePrice" TEXT;

-- CreateTable
CREATE TABLE "MessageReadState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "lastReadAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MessageReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageReadState_userId_scope_key" ON "MessageReadState"("userId", "scope");

-- CreateIndex
CREATE INDEX "MessageReadState_scope_idx" ON "MessageReadState"("scope");