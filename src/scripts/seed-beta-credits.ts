#!/usr/bin/env ts-node
/**
 * seed-beta-credits.ts — Grant 500 credits to all existing users
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register src/scripts/seed-beta-credits.ts
 *
 * Options:
 *   --dry-run        Print what would happen without writing to DB
 *   --amount N       Override default 500 credits (e.g. --amount 100)
 *   --user EMAIL     Target by email (repeatable)
 *   --user-id ID     Target by user ID (repeatable, works for users with no email)
 */

import { prisma } from '../core/services/database-service';
import { getErrorMessage } from '../core/utils/error-utils';

const REASON = 'beta_grant';
const DEFAULT_AMOUNT = 500;

function parseArgs(): { dryRun: boolean; amount: number; emails: string[]; ids: string[] } {
  const args = process.argv.slice(2).map((a) => a.trim());
  const dryRun = args.includes('--dry-run');
  const amountIdx = args.indexOf('--amount');
  const amount = amountIdx !== -1 ? parseInt(args[amountIdx + 1], 10) : DEFAULT_AMOUNT;
  const emails: string[] = [];
  const ids: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--user' && args[i + 1]) emails.push(args[i + 1]);
    if (args[i] === '--user-id' && args[i + 1]) ids.push(args[i + 1]);
  }
  return { dryRun, amount, emails, ids };
}

async function main() {
  const { dryRun, amount, emails, ids } = parseArgs();

  if (isNaN(amount) || amount <= 0) {
    console.error('ERROR: --amount must be a positive integer');
    process.exit(1);
  }

  console.log(`\n=== Beta Credits Seed ===`);
  console.log(`Amount per user : ${amount} credits`);
  console.log(`Dry run         : ${dryRun}`);
  if (emails.length > 0) console.log(`Targeting emails : ${emails.join(', ')}`);
  if (ids.length > 0) console.log(`Targeting IDs    : ${ids.join(', ')}`);
  console.log('');

  const hasFilter = emails.length > 0 || ids.length > 0;
  const users = await prisma.user.findMany({
    where: {
      OR: hasFilter
        ? [
            ...(emails.length > 0 ? [{ email: { in: emails } }] : []),
            ...(ids.length > 0 ? [{ id: { in: ids } }] : []),
          ]
        : undefined,
      AND: {
        OR: [{ email: null }, { email: { not: { endsWith: '@x402.agent' } } }],
      },
    },
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
  });

  if (users.length === 0) {
    console.log('No users found.');
    return;
  }

  console.log(`Found ${users.length} user(s):\n`);
  users.forEach((u, i) => console.log(`  ${i + 1}. ${u.email ?? '(no email)'} (${u.id})`));
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

      console.log(`  ✓ ${user.email ?? user.id} → +${amount} credits`);
      succeeded++;
    } catch (error) {
      console.error(`  ✗ ${user.email ?? user.id} → FAILED: ${getErrorMessage(error)}`);
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
