import { Context } from 'telegraf';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { IntelClient } from '../intel-client';
import { formatProfile } from '../formatters/profile.formatter';
import { logInvocation } from '../attribution';

const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function profileHandler(
  ctx: Context,
  client: IntelClient,
  prisma: PrismaClient,
): Promise<void> {
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const parts = text.trim().split(/\s+/);
  const address = parts[1];

  if (!address || !SOLANA_ADDR_RE.test(address)) {
    await ctx.reply('Usage: /profile <wallet_address>');
    return;
  }

  const pending = await ctx.reply('⏳ Analyzing...');
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  let success = false;
  let errorCode: string | undefined;

  try {
    const profile = await client.getProfile(address);
    const formatted = formatProfile(address, profile);
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
    command: 'profile',
    address,
    creditCost: 5,
    success,
    errorCode,
  });
}

function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    if (status === 402) return '❌ Bot credit balance depleted. Contact admin.';
    if (status === 400) return '❌ Invalid Solana address. Check your input.';
    if (status === 422) return '⚠️ This address is a known system/program account — not eligible for analysis.';
    if (status === 404) return '❌ No data found. Try /profile first to trigger analysis.';
    if (err.code === 'ECONNABORTED') return '⏱ Analysis is taking longer than usual. Try again in a minute.';
  }
  return '❌ Service error. Try again shortly.';
}

function apiErrorCode(err: unknown): string | undefined {
  if (axios.isAxiosError(err)) return String(err.response?.status ?? err.code ?? 'unknown');
  return 'unknown';
}
