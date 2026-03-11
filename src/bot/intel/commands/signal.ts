import { Context } from 'telegraf';
import { PrismaClient } from '@prisma/client';
import { SovaIntelClient, SovaHttpError, HolderProfilesResult } from '@sova/intel-sdk';
import { formatSignalCard } from '../formatters/signal.formatter';
import { logInvocation } from '../attribution';

const SOLANA_MINT_RE = /(?<![/\w])([1-9A-HJ-NP-Za-km-z]{32,44})(?![/\w])/g;

function isSignalChat(ctx: Context): boolean {
  const type = ctx.chat?.type;
  return type === 'group' || type === 'supergroup' || type === 'channel';
}

type TelegramTextMsg = {
  text?: string;
  message_id?: number;
  message_thread_id?: number;
};

export function extractMint(text: string): string | null {
  const matches = [...text.matchAll(SOLANA_MINT_RE)];
  if (!matches.length) return null;
  return matches[matches.length - 1][1];
}

export async function signalHandler(
  ctx: Context,
  client: SovaIntelClient,
  prisma: PrismaClient,
): Promise<void> {
  if (!isSignalChat(ctx)) return;

  const msg = getTextMessage(ctx);
  const text = msg?.text ?? '';
  if (!text) return;

  const mint = extractMint(text);
  if (!mint) return;

  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const pending = await ctx.telegram.sendMessage(
    chatId,
    'Profiling holders...',
    {
      ...(msg?.message_id ? { reply_parameters: { message_id: msg.message_id } } : {}),
      ...(msg?.message_thread_id ? { message_thread_id: msg.message_thread_id } : {}),
    },
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
    const msgText = apiErrorMessage(err);
    if (msgText) {
      await ctx.telegram.editMessageText(chatId, pending.message_id, undefined, msgText);
    } else {
      await ctx.telegram.deleteMessage(chatId, pending.message_id).catch(() => {});
    }
  }

  logInvocation(prisma, {
    telegramUserId: String(ctx.from?.id ?? ctx.chat?.id ?? 'signal-chat'),
    username: ctx.from?.username ?? getChatTitle(ctx),
    command: 'signal',
    address: mint,
    creditCost: 20,
    success,
    errorCode,
  });
}

function apiErrorMessage(err: unknown): string | null {
  if (err instanceof SovaHttpError) {
    if (err.status === 402) return 'Bot credit balance depleted. Contact admin.';
    if (err.status === 400) return null;
    if (err.status === 422) return null;
    if (err.status === 404) return null;
  }
  return 'Service error. Try again shortly.';
}

function apiErrorCode(err: unknown): string | undefined {
  if (err instanceof SovaHttpError) return String(err.status);
  return 'unknown';
}

function getTextMessage(ctx: Context): TelegramTextMsg | undefined {
  const msg = ctx.msg as TelegramTextMsg | undefined;
  if (!msg?.text) return undefined;
  return msg;
}

function getChatTitle(ctx: Context): string | undefined {
  const chat = ctx.chat;
  if (!chat) return undefined;
  if ('title' in chat) return chat.title;
  return undefined;
}
