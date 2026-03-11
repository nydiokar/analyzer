/**
 * Top up credits for a user by email.
 * Usage: npx ts-node -r tsconfig-paths/register scripts/topup-credits.ts <email> <amount>
 * Example: npx ts-node -r tsconfig-paths/register scripts/topup-credits.ts system-telegram-bot@internal 10000
 */
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const [email, amountStr] = process.argv.slice(2);

  if (!email || !amountStr) {
    console.error('Usage: topup-credits.ts <email> <amount>');
    process.exit(1);
  }

  const amount = parseInt(amountStr, 10);
  if (isNaN(amount) || amount <= 0) {
    console.error('Amount must be a positive integer');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`User not found: ${email}`);
    process.exit(1);
  }

  const balance = await prisma.creditBalance.upsert({
    where: { userId: user.id },
    create: {
      id: crypto.randomUUID(),
      userId: user.id,
      credits: amount,
      updatedAt: new Date(),
    },
    update: {
      credits: { increment: amount },
      updatedAt: new Date(),
    },
  });

  console.log(`✓ ${email} → +${amount} credits → balance: ${balance.credits}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
