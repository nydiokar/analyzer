import { Context } from 'telegraf';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { IntelClient, HolderProfilesResult } from '../intel-client';
import { formatHolderProfilesResult } from '../formatters/holders.formatter';
import { logInvocation } from '../attribution';

const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

export async function holdersHandler(
  ctx: Context,
  client: IntelClient,
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
    // POST → 202 immediately
    const job = await client.postHolders(mint);
    const jobId = job.jobId;

    // Poll until completed or timeout
    const result = await pollUntilDone(client, jobId);

    if (!result) {
      await ctx.telegram.editMessageText(
        chatId,
        pending.message_id,
        undefined,
        '⏱ Analysis is taking longer than usual. Try again in a minute.',
      );
      errorCode = 'timeout';
    } else {
      const formatted = formatHolderProfilesResult(result);
      await ctx.telegram.editMessageText(
        chatId,
        pending.message_id,
        undefined,
        formatted,
        { parse_mode: 'HTML' },
      );
      success = true;
    }
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

async function pollUntilDone(
  client: IntelClient,
  jobId: string,
): Promise<HolderProfilesResult | null> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const job = await client.pollJob(jobId);
      if (job.status === 'completed') {
        return job.result as HolderProfilesResult;
      }
      if (job.status === 'failed') {
        throw new Error(job.error ?? 'Job failed');
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        // Job not yet registered — keep polling
        continue;
      }
      throw err;
    }
  }

  return null; // timeout
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    if (status === 402) return '❌ Bot credit balance depleted. Contact admin.';
    if (status === 400) return '❌ Invalid token mint. Check your input.';
    if (status === 422) return '⚠️ This mint is a known system/program account — not eligible for analysis.';
    if (status === 404) return '❌ Token not found.';
  }
  return '❌ Service error. Try again shortly.';
}

function apiErrorCode(err: unknown): string | undefined {
  if (axios.isAxiosError(err)) return String(err.response?.status ?? err.code ?? 'unknown');
  return 'unknown';
}
