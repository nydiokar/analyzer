-- CreateTable
CREATE TABLE "TelegramBotLog" (
    "id" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "username" TEXT,
    "command" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "creditCost" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramBotLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TelegramBotLog_telegramUserId_idx" ON "TelegramBotLog"("telegramUserId");

-- CreateIndex
CREATE INDEX "TelegramBotLog_command_idx" ON "TelegramBotLog"("command");

-- CreateIndex
CREATE INDEX "TelegramBotLog_createdAt_idx" ON "TelegramBotLog"("createdAt");
