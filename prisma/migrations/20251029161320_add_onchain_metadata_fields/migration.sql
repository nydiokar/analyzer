-- AlterTable
ALTER TABLE "TokenInfo" ADD COLUMN "metadataSource" TEXT;
ALTER TABLE "TokenInfo" ADD COLUMN "onchainBasicFetchedAt" DATETIME;
ALTER TABLE "TokenInfo" ADD COLUMN "onchainCreator" TEXT;
ALTER TABLE "TokenInfo" ADD COLUMN "onchainDescription" TEXT;
ALTER TABLE "TokenInfo" ADD COLUMN "onchainDiscordUrl" TEXT;
ALTER TABLE "TokenInfo" ADD COLUMN "onchainImageUrl" TEXT;
ALTER TABLE "TokenInfo" ADD COLUMN "onchainMetadataUri" TEXT;
ALTER TABLE "TokenInfo" ADD COLUMN "onchainName" TEXT;
ALTER TABLE "TokenInfo" ADD COLUMN "onchainSocialsFetchedAt" DATETIME;
ALTER TABLE "TokenInfo" ADD COLUMN "onchainSymbol" TEXT;
ALTER TABLE "TokenInfo" ADD COLUMN "onchainTelegramUrl" TEXT;
ALTER TABLE "TokenInfo" ADD COLUMN "onchainTwitterUrl" TEXT;
ALTER TABLE "TokenInfo" ADD COLUMN "onchainWebsiteUrl" TEXT;

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "body" TEXT NOT NULL,
    "authorUserId" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    CONSTRAINT "Message_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Message_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Message" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessageMention" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT,
    "rawValue" TEXT NOT NULL,
    "metaJson" JSONB,
    CONSTRAINT "MessageMention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessageReaction" (
    "messageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("messageId", "type"),
    CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessageRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "editedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageRevision_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "TokenTag" (
    "tokenAddress" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 1.0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("tokenAddress", "tagId"),
    CONSTRAINT "TokenTag_tokenAddress_fkey" FOREIGN KEY ("tokenAddress") REFERENCES "TokenInfo" ("tokenAddress") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TokenTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WatchedToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenAddress" TEXT NOT NULL,
    "list" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    CONSTRAINT "WatchedToken_tokenAddress_fkey" FOREIGN KEY ("tokenAddress") REFERENCES "TokenInfo" ("tokenAddress") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Message_createdAt_id_idx" ON "Message"("createdAt", "id");

-- CreateIndex
CREATE INDEX "MessageMention_messageId_idx" ON "MessageMention"("messageId");

-- CreateIndex
CREATE INDEX "MessageMention_kind_refId_idx" ON "MessageMention"("kind", "refId");

-- CreateIndex
CREATE INDEX "MessageReaction_type_idx" ON "MessageReaction"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "TokenTag_tagId_idx" ON "TokenTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchedToken_tokenAddress_list_key" ON "WatchedToken"("tokenAddress", "list");
