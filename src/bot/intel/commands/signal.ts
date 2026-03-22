import { Context } from 'telegraf';
import { PrismaClient } from '@prisma/client';
import { SovaIntelClient, SovaHttpError, HolderProfilesResult } from '@sova-intel/sdk';
import { formatSignalCard } from '../formatters/signal.formatter';
import { buildSignalCardSummary, renderSignalCardSvg, fetchTokenMetadata, fetchImageAsDataUri } from '../render/social-card';
import { renderSvgToPngBuffer } from '../render/png';
import { logInvocation } from '../attribution';

const SOLANA_MINT_RE = /(?<![/\w])([1-9A-HJ-NP-Za-km-z]{32,44})(?![/\w])/g;

function isSignalChat(ctx: Context): boolean {
  const type = ctx.chat?.type;
  return type === 'group' || type === 'supergroup' || type === 'channel';
}

function isBotMentioned(ctx: Context): boolean {
  const msg = ctx.msg as { text?: string; entities?: { type: string; offset: number; length: number }[] } | undefined;
  const entities = msg?.entities ?? [];
  const text = msg?.text ?? '';
  const botUsername = ctx.botInfo?.username?.toLowerCase();
  if (!botUsername) return false;
  return entities.some((e) => {
    if (e.type !== 'mention') return false;
    const mention = text.slice(e.offset + 1, e.offset + e.length); // strip leading '@'
    return mention.toLowerCase() === botUsername;
  });
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
  if (!isBotMentioned(ctx)) return;

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

  let result: HolderProfilesResult | undefined;

  try {
    const [holderResult, metadata] = await Promise.all([
      client.pollHolderProfiles<HolderProfilesResult>(mint),
      fetchTokenMetadata(mint),
    ]);
    result = holderResult;

    // Render image
    const tokenImageDataUri = metadata.imageUrl ? await fetchImageAsDataUri(metadata.imageUrl) : null;
    const summary = buildSignalCardSummary(result, metadata, tokenImageDataUri);
    const svg = renderSignalCardSvg(summary);
    const png = await renderSvgToPngBuffer(svg);

    await ctx.telegram.deleteMessage(chatId, pending.message_id).catch(() => {});
    await ctx.telegram.sendPhoto(
      chatId,
      { source: png },
      {
        caption: formatSignalCard(result),
        parse_mode: 'HTML',
        ...(msg?.message_id ? { reply_parameters: { message_id: msg.message_id } } : {}),
        ...(msg?.message_thread_id ? { message_thread_id: msg.message_thread_id } : {}),
      },
    );

    success = true;
  } catch (err: unknown) {
    console.error('[signal] Error:', err);
    errorCode = apiErrorCode(err);
    const apiMsg = apiErrorMessage(err);
    if (apiMsg) {
      // API-level error — show it
      await ctx.telegram.editMessageText(chatId, pending.message_id, undefined, apiMsg).catch(() => {});
    } else if (result) {
      // API succeeded but render/send failed — fall back to text card
      await ctx.telegram.editMessageText(
        chatId,
        pending.message_id,
        undefined,
        formatSignalCard(result),
        { parse_mode: 'HTML' },
      ).catch(() => {});
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
