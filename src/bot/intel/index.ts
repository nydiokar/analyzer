import { PrismaClient } from '@prisma/client';
import { config } from './config';
import { createBot } from './bot';

async function main(): Promise<void> {
  // Validate config eagerly — will throw on missing env vars
  console.log('[BOOT] Starting Sova Intel Telegram bot...');
  console.log(`[BOOT] API base: ${config.INTEL_BASE_URL}`);
  console.log(`[BOOT] Allowed users: ${config.ALLOWED_USER_IDS.length > 0 ? config.ALLOWED_USER_IDS.join(', ') : 'NONE — bot locked down'}`);

  const prisma = new PrismaClient();
  const bot = createBot(prisma);

  // Graceful shutdown
  const shutdown = (): void => {
    console.log('\n[BOOT] Shutting down...');
    bot.stop('SIGINT');
    prisma.$disconnect().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', () => {
    bot.stop('SIGTERM');
    prisma.$disconnect().catch(() => {});
    process.exit(0);
  });

  await bot.launch({ dropPendingUpdates: true });
  console.log('[BOOT] Bot launched and polling for updates.');

  // Notify PM2 we are ready
  if (process.send) process.send('ready');
}

main().catch((err) => {
  console.error('[BOOT] Fatal error:', err);
  process.exit(1);
});
