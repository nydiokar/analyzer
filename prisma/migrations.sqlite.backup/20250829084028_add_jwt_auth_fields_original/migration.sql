-- Add JWT authentication fields to User table (PostgreSQL compatible)
-- Original SQLite migration converted for PostgreSQL

-- Add new columns for JWT authentication
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);

-- Create unique constraint on email
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
