import { Context } from 'telegraf';
import { PrismaClient } from '@prisma/client';
import { SovaIntelClient, SovaHttpError, HolderProfilesResult } from '@sova/intel-sdk';
import { formatHolderProfilesResult } from '../formatters/holders.formatter';
import { logInvocation } from '../attribution';

const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function holdersHandler(
  ctx: Context,
  client: SovaIntelClient,
  prisma: PrismaClient,
): Promise<void> {
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const parts = text.trim().split(/\s+/);
  const mint = parts[1];

  if (!mint || !SOLANA_ADDR_RE.test(mint)) {
    await ctx.reply('Usage: /holders <token_mint>');
    return;
  }

  const pending = await ctx.reply('⏳ Profiling top holders...');
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  let success = false;
  let errorCode: string | undefined;

  try {
    const result = await client.pollHolderProfiles<HolderProfilesResult>(mint);
    const formatted = formatHolderProfilesResult(result);
    await ctx.telegram.editMessageText(
      chatId,
      pending.message_id,
      undefined,
      formatted,
      { parse_mode: 'HTML' },
    );
    success = true;
  } catch (err: unknown) {
    const msg = apiErrorMessage(err);
    errorCode = apiErrorCode(err);
    await ctx.telegram.editMessageText(chatId, pending.message_id, undefined, msg);
  }

  logInvocation(prisma, {
    telegramUserId: String(ctx.from?.id ?? ''),
    username: ctx.from?.username,
    command: 'holders',
    address: mint,
    creditCost: 20,
    success,
    errorCode,
  });
}

function apiErrorMessage(err: unknown): string {
  if (err instanceof SovaHttpError) {
    if (err.status === 402) return '❌ Bot credit balance depleted. Contact admin.';
    if (err.status === 400) return '❌ Invalid token mint. Check your input.';
    if (err.status === 422) return '⚠️ This mint is a known system/program account — not eligible for analysis.';
    if (err.status === 404) return '❌ Token not found.';
  }
  return '❌ Service error. Try again shortly.';
}

function apiErrorCode(err: unknown): string | undefined {
  if (err instanceof SovaHttpError) return String(err.status);
  return 'unknown';
}
