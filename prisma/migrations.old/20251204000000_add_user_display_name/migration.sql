-- Add displayName field to User table
ALTER TABLE "User" ADD COLUMN "displayName" TEXT;

-- Create unique index on displayName
CREATE UNIQUE INDEX "User_displayName_key" ON "User"("displayName");
