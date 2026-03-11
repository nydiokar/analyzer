import { Context } from 'telegraf';
import { PrismaClient } from '@prisma/client';
import { SovaIntelClient, SovaHttpError } from '@sova/intel-sdk';
import { formatHud } from '../formatters/hud.formatter';
import { logInvocation } from '../attribution';

const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function hudHandler(
  ctx: Context,
  client: SovaIntelClient,
  prisma: PrismaClient,
): Promise<void> {
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const parts = text.trim().split(/\s+/);
  const address = parts[1];

  if (!address || !SOLANA_ADDR_RE.test(address)) {
    await ctx.reply('Usage: /hud <wallet_address>\nExample: /hud So11111111111111111111111111111111111111112');
    return;
  }

  const pending = await ctx.reply('⏳ Analyzing...');
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  let success = false;
  let errorCode: string | undefined;

  try {
    const hud = await client.getWalletHud(address);
    const formatted = formatHud(address, hud);
    await ctx.telegram.editMessageText(chatId, pending.message_id, undefined, formatted, {
      parse_mode: 'HTML',
    });
    success = true;
  } catch (err: unknown) {
    const msg = apiErrorMessage(err);
    errorCode = apiErrorCode(err);
    await ctx.telegram.editMessageText(chatId, pending.message_id, undefined, msg);
  }

  logInvocation(prisma, {
    telegramUserId: String(ctx.from?.id ?? ''),
    username: ctx.from?.username,
    command: 'hud',
    address,
    creditCost: 1,
    success,
    errorCode,
  });
}

function apiErrorMessage(err: unknown): string {
  if (err instanceof SovaHttpError) {
    if (err.status === 402) return '❌ Bot credit balance depleted. Contact admin.';
    if (err.status === 400) return '❌ Invalid Solana address. Check your input.';
    if (err.status === 422) return '⚠️ This address is a known system/program account — not eligible for analysis.';
    if (err.status === 404) return '❌ No data found. Try /profile first to trigger analysis.';
  }
  return '❌ Service error. Try again shortly.';
}

function apiErrorCode(err: unknown): string | undefined {
  if (err instanceof SovaHttpError) return String(err.status);
  return 'unknown';
}
