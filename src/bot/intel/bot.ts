import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { PrismaClient } from '@prisma/client';
import { SovaIntelClient } from '@sova-intel/sdk';
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

  // Private chats are user-gated. Groups and channels are chat-gated.
  bot.use(async (ctx, next) => {
    const chatType = ctx.chat?.type;
    const chatId = ctx.chat?.id;

    if (chatType === 'group' || chatType === 'supergroup' || chatType === 'channel') {
      if (!chatId || !config.ALLOWED_CHAT_IDS.includes(chatId)) {
        console.warn(`[AUTH] Rejected chat: ${chatId} (${ctx.chat?.title})`);
        return;
      }

      await next();
      return;
    }

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
  bot.command('start', (ctx) =>
    ctx.reply(
      'Sova Intel Bot\n\n' +
      '/hud <address> - behavioral snapshot (1cr)\n' +
      '/profile <address> - full wallet profile (5cr)\n' +
      '/holders <mint> - top holder profiles (20cr)',
    ),
  );

  // Text middleware does not fall through, so commands must stay above it.
  bot.on(message('text'), (ctx) => signalHandler(ctx, client, prisma));

  return bot;
}
