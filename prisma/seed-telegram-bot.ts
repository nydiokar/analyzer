import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const SALT_ROUNDS = 10;

async function main(): Promise<void> {
  // Generate key in the same format as ApiKeyService
  const prefixId = crypto.randomBytes(6).toString('hex');
  const prefix = `ak_${prefixId}`;
  const secret = crypto.randomBytes(32).toString('base64url');
  const rawKey = `${prefix}_${secret}`;

  const keyHash = await bcrypt.hash(rawKey, SALT_ROUNDS);

  // Upsert User by description — idempotent
  const user = await prisma.user.upsert({
    where: { email: 'system-telegram-bot@internal' },
    update: {},
    create: {
      apiKey: crypto.randomBytes(16).toString('hex'), // legacy field, not used by ApiKey table
      description: 'system-telegram-bot',
      email: 'system-telegram-bot@internal',
      emailVerified: true,
      isActive: true,
      isAdmin: false,
    },
  });

  // Create the ApiKey record
  const keyRecord = await prisma.apiKey.create({
    data: {
      prefix,
      keyHash,
      userId: user.id,
      description: 'Telegram Intel Bot system key',
      scopes: JSON.stringify(['full']),
      isActive: true,
    },
  });

  console.log('');
  console.log('=== Telegram Bot API Key ===');
  console.log(`User ID:    ${user.id}`);
  console.log(`ApiKey ID:  ${keyRecord.id}`);
  console.log(`Prefix:     ${prefix}`);
  console.log('');
  console.log(`INTEL_API_KEY=${rawKey}`);
  console.log('');
  console.log('Copy the INTEL_API_KEY line into .env, then top up credits for this user.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
