/**
 * Interactive bot surface test — no MCP, no chain.
 *
 * Simulates the full bot pipeline against the live analyzer API:
 *   user input → parseCommand → handleCommand → formatter → print output
 *
 * Usage:
 *   npx tsx src/test-bot.ts
 *
 * You will be prompted for ANALYZER_API_URL, ANALYZER_API_KEY, then
 * a command loop where you can type anything the bot would receive.
 */

import readline from 'node:readline';
import { AnalyzerClient } from './analyzer.js';
import { DeferredJobs } from './deferred-jobs.js';
import { parseCommand, handleCommand } from './commands.js';
import type { PFTClient } from './pft-client.js';

// ── Minimal PFTClient stub — captures what the bot would send ─────────────

interface SentMessage {
  recipient: string;
  message: string;
  reply_to_tx: string;
  thread_id?: string;
  attachments?: unknown[];
}

class StubPFTClient {
  sent: SentMessage[] = [];
  uploads: { content: string; content_type: string }[] = [];

  async sendMessage(params: SentMessage): Promise<{ tx_hash: string }> {
    this.sent.push(params);
    return { tx_hash: 'stub-tx-' + Date.now() };
  }

  async uploadContent(params: { content: string; content_type: string }): Promise<{ cid: string; uri: string }> {
    this.uploads.push(params);
    return { cid: 'stub-cid-' + Date.now(), uri: 'ipfs://stub' };
  }
}

// ── Prompt helpers ────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
}

function hr(char = '─', width = 72): string {
  return char.repeat(width);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n' + hr('═'));
  console.log('  Sova Intel — Bot Surface Test');
  console.log(`  API: ${process.env['ANALYZER_API_URL'] ?? 'http://localhost:3001/api/v1'}`);
  console.log('  No MCP. No chain. Pure logic validation.');
  console.log(hr('═') + '\n');

  // ── Credentials ──────────────────────────────────────────────────────
  // URL is fixed — same default the bot uses (localhost:3001/api/v1)
  const apiUrl = process.env['ANALYZER_API_URL'] ?? 'http://localhost:3001/api/v1';
  let apiKey   = process.env['ANALYZER_API_KEY'] ?? '';

  if (!apiKey) {
    apiKey = await ask('ANALYZER_API_KEY: ');
  }
  if (!apiKey) {
    console.error('\nNo API key provided. Exiting.');
    process.exit(1);
  }

  const analyzer = new AnalyzerClient(apiUrl, apiKey);

  // Smoke-test connectivity before entering the loop
  process.stdout.write('\nConnecting to analyzer API... ');
  try {
    // Use a known-bad address to get a fast 404 — just proves the server is up and auth works
    await analyzer.getWalletSummary('11111111111111111111111111111111').catch(() => {});
    console.log('OK\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`FAILED\n\nCould not reach ${apiUrl}: ${msg}\n`);
    process.exit(1);
  }

  // Stub out the PFT client — we capture sends instead of hitting the chain
  const stubPft = new StubPFTClient();
  const deferred = new DeferredJobs(
    stubPft as unknown as PFTClient,
    analyzer,
  );

  // ── Constants for the fake sender context ─────────────────────────────
  const FAKE_SENDER  = 'TEST_SENDER_' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const FAKE_TX_HASH = 'test-tx-0000';

  console.log(hr());
  console.log('  Commands: /profile <addr>  /analyze <addr> [flash|working|deep]');
  console.log('            /holders <mint>  /compare <addr1> <addr2>');
  console.log('  Type "exit" to quit.\n');
  console.log('  Fake sender:  ' + FAKE_SENDER);
  console.log(hr() + '\n');

  // ── Command loop ──────────────────────────────────────────────────────
  while (true) {
    const input = await ask('bot> ');

    if (!input || input.toLowerCase() === 'exit') {
      console.log('\nBye.\n');
      break;
    }

    // Anything that doesn't start with / is treated as a raw /profile shortcut
    // so you can just paste an address and get a profile
    const normalized = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input)
      ? `/profile ${input}`
      : input;

    console.log('');

    const parsed = parseCommand(normalized);
    console.log(`[parse]  command=${parsed.command}  args=[${parsed.args.join(', ')}]`);
    console.log(hr('─'));

    const t0 = Date.now();

    try {
      const result = await handleCommand(
        parsed,
        FAKE_SENDER,
        FAKE_TX_HASH,
        analyzer,
        deferred,
        undefined,
      );

      const elapsed = Date.now() - t0;

      // ── Show what the bot would send ──────────────────────────────────
      console.log('\n┌─ BOT REPLY ' + hr('─', 59));
      console.log(result.text);

      if (result.attachment) {
        console.log('\n├─ ATTACHMENT (' + result.attachment.contentType + ')');
        console.log(result.attachment.content.slice(0, 400) + (result.attachment.content.length > 400 ? '\n  ...' : ''));
      }

      console.log('└' + hr('─', 71));
      console.log(`  [${elapsed}ms]\n`);

      // ── Show any deferred jobs that were registered ───────────────────
      const jobCount = (deferred as any).pending?.length ?? 0;
      if (jobCount > 0) {
        const jobs = (deferred as any).pending as Array<{ jobId: string; type: string; walletAddress?: string }>;
        console.log('  [deferred] ' + jobs.map(j => `${j.type}:${j.jobId} (${j.walletAddress ?? 'n/a'})`).join(', ') + '\n');
      }

    } catch (err) {
      const elapsed = Date.now() - t0;
      const msg = err instanceof Error ? err.message : String(err);
      console.log('\n┌─ ERROR ' + hr('─', 63));
      console.log(msg);
      console.log('└' + hr('─', 71));
      console.log(`  [${elapsed}ms]\n`);
    }
  }

  rl.close();
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
