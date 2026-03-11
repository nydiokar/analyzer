import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { PrismaClient } from '@prisma/client';
import { SovaIntelClient } from '@sova/intel-sdk';
import { config } from './config';
import { hudHandler } from './commands/hud';
import { profileHandler } from './commands/profile';
import { holdersHandler } from './commands/holders';
import { signalHandler } from './commands/signal';

export function createBot(prisma: PrismaClient): Telegraf<Context> {
  const bot = new Telegraf<Context>(config.BOT_TOKEN);
  const client = new SovaIntelClient({
    baseUrl: config.INTEL_BASE_URL,
    auth: { kind: 'apikey', apiKey: config.INTEL_API_KEY },
  });

  // Allowlist middleware — only for explicit commands (DM or group).
  // Group signal listener is intentionally open so the bot responds to any
  // signal posted in a group it has been added to.
  bot.use(async (ctx, next) => {
    // Allow group text messages through unconditionally (signal listener handles them)
    const chatType = ctx.chat?.type;
    if (chatType === 'group' || chatType === 'supergroup') {
      await next();
      return;
    }
    // For DMs / private channels: enforce allowlist
    const userId = ctx.from?.id;
    if (!userId || !config.ALLOWED_USER_IDS.includes(userId)) {
      console.warn(`[AUTH] Rejected user: ${userId} (${ctx.from?.username})`);
      await ctx.reply('Sorry, you are not authorized to use this bot.');
      return;
    }
    await next();
  });

  bot.command('hud', (ctx) => hudHandler(ctx, client, prisma));
  bot.command('profile', (ctx) => profileHandler(ctx, client, prisma));
  bot.command('holders', (ctx) => holdersHandler(ctx, client, prisma));

  // Group signal listener — fires on any message containing a Solana mint address.
  // Commands are matched first by Telegraf, so explicit /holders in a group still works.
  bot.on(message('text'), (ctx) => signalHandler(ctx, client, prisma));

  bot.command('start', (ctx) =>
    ctx.reply(
      'Sova Intel Bot\n\n' +
      '/hud <address> — behavioral snapshot (1cr)\n' +
      '/profile <address> — full wallet profile (5cr)\n' +
      '/holders <mint> — top holder profiles (20cr)',
    ),
  );

  return bot;
}
