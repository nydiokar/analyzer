#!/usr/bin/env ts-node
/**
 * seed-beta-credits.ts — Grant 500 credits to all existing users
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register src/scripts/seed-beta-credits.ts
 *
 * Options:
 *   --dry-run   Print what would happen without writing to DB
 *   --amount N  Override default 500 credits (e.g. --amount 100)
 */

import { prisma } from '../core/services/database-service';
import { getErrorMessage } from '../core/utils/error-utils';

const REASON = 'beta_grant';
const DEFAULT_AMOUNT = 500;

function parseArgs(): { dryRun: boolean; amount: number } {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const amountIdx = args.indexOf('--amount');
  const amount = amountIdx !== -1 ? parseInt(args[amountIdx + 1], 10) : DEFAULT_AMOUNT;
  return { dryRun, amount };
}

async function main() {
  const { dryRun, amount } = parseArgs();

  if (isNaN(amount) || amount <= 0) {
    console.error('ERROR: --amount must be a positive integer');
    process.exit(1);
  }

  console.log(`\n=== Beta Credits Seed ===`);
  console.log(`Amount per user : ${amount} credits`);
  console.log(`Dry run         : ${dryRun}`);
  console.log('');

  const users = await prisma.user.findMany({
    where: {
      email: { not: { endsWith: '@x402.agent' } },
    },
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
  });

  if (users.length === 0) {
    console.log('No users found.');
    return;
  }

  console.log(`Found ${users.length} user(s):\n`);
  users.forEach((u, i) => console.log(`  ${i + 1}. ${u.email} (${u.id})`));
  console.log('');

  if (dryRun) {
    console.log(`[DRY RUN] Would grant ${amount} credits to each of the ${users.length} user(s) above.`);
    console.log(`[DRY RUN] Total credits to issue: ${amount * users.length}`);
    return;
  }

  let succeeded = 0;
  let failed = 0;

  for (const user of users) {
    try {
      await prisma.$transaction(async (tx) => {
        const balance = await tx.creditBalance.upsert({
          where: { userId: user.id },
          create: { userId: user.id, credits: amount },
          update: { credits: { increment: amount } },
        });

        await tx.creditTransaction.create({
          data: {
            userId: user.id,
            delta: amount,
            reason: REASON,
            balanceAfter: balance.credits,
          },
        });
      });

      console.log(`  ✓ ${user.email} → +${amount} credits`);
      succeeded++;
    } catch (error) {
      console.error(`  ✗ ${user.email} → FAILED: ${getErrorMessage(error)}`);
      failed++;
    }
  }

  console.log(`\nDone. ${succeeded} succeeded, ${failed} failed.`);
}

main()
  .catch((err) => {
    console.error('Fatal:', getErrorMessage(err));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
