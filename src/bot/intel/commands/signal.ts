import { Context } from 'telegraf';
import { PrismaClient } from '@prisma/client';
import { SovaIntelClient, SovaHttpError, HolderProfilesResult } from '@sova/intel-sdk';
import { formatSignalCard } from '../formatters/signal.formatter';
import { logInvocation } from '../attribution';

// Matches a standalone Solana base58 address anywhere in a message.
// Requires word boundaries so it doesn't fire on URLs or partial strings.
const SOLANA_MINT_RE = /(?<![/\w])([1-9A-HJ-NP-Za-km-z]{32,44})(?![/\w])/g;

// Only respond in group/supergroup chats to avoid double-firing in DMs
// (users can still use /holders <mint> in DMs).
function isGroupChat(ctx: Context): boolean {
  const type = ctx.chat?.type;
  return type === 'group' || type === 'supergroup';
}

export function extractMint(text: string): string | null {
  const matches = [...text.matchAll(SOLANA_MINT_RE)];
  if (!matches.length) return null;
  // Prefer the last match — signal bots typically put the mint near the end.
  return matches[matches.length - 1][1];
}

export async function signalHandler(
  ctx: Context,
  client: SovaIntelClient,
  prisma: PrismaClient,
): Promise<void> {
  if (!isGroupChat(ctx)) return;

  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  if (!text) return;

  const mint = extractMint(text);
  if (!mint) return;

  const chatId = ctx.chat?.id;
  if (!chatId) return;

  // Reply to the original signal message so context is clear
  const replyToId = ctx.message?.message_id;
  const pending = await ctx.telegram.sendMessage(
    chatId,
    '⏳ Profiling holders...',
    replyToId ? { reply_parameters: { message_id: replyToId } } : undefined,
  );

  let success = false;
  let errorCode: string | undefined;

  try {
    const result = await client.pollHolderProfiles<HolderProfilesResult>(mint);
    const formatted = formatSignalCard(result);
    await ctx.telegram.editMessageText(
      chatId,
      pending.message_id,
      undefined,
      formatted,
      { parse_mode: 'HTML' },
    );
    success = true;
  } catch (err: unknown) {
    errorCode = apiErrorCode(err);
    // Silent fail for group listener — don't spam the group with error messages
    // unless it's a genuine service issue (not "no data").
    const msg = apiErrorMessage(err);
    if (msg) {
      await ctx.telegram.editMessageText(chatId, pending.message_id, undefined, msg);
    } else {
      // Delete the ⏳ placeholder rather than leave it hanging
      await ctx.telegram.deleteMessage(chatId, pending.message_id).catch(() => {});
    }
  }

  logInvocation(prisma, {
    telegramUserId: String(ctx.from?.id ?? 'group-signal'),
    username: ctx.from?.username,
    command: 'signal',
    address: mint,
    creditCost: 20,
    success,
    errorCode,
  });
}

function apiErrorMessage(err: unknown): string | null {
  if (err instanceof SovaHttpError) {
    if (err.status === 402) return '❌ Bot credit balance depleted. Contact admin.';
    if (err.status === 400) return null; // invalid mint — silently delete
    if (err.status === 422) return null; // system wallet — silently delete
    if (err.status === 404) return null; // no data yet — silently delete
  }
  return '❌ Service error. Try again shortly.';
}

function apiErrorCode(err: unknown): string | undefined {
  if (err instanceof SovaHttpError) return String(err.status);
  return 'unknown';
}
