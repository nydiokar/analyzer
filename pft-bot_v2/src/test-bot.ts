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

// ── Job completion waiter ─────────────────────────────────────────────────

interface JobCompletionResult {
  text: string;
  attachment?: { content: string; contentType: string; filename: string };
}

async function waitForJobCompletion(
  analyzer: AnalyzerClient,
  deferred: DeferredJobs,
  jobId: string,
): Promise<JobCompletionResult> {
  const POLL_INTERVAL_MS = 2000;
  const MAX_WAIT_MS = 600000; // 10 minutes
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_WAIT_MS) {
    const result = await analyzer.getJobResult(jobId);

    if (result.status === 'completed') {
      // Get the pending job details
      const pendingJobs = (deferred as any).pending as Array<{
        jobId: string;
        type: string;
        walletAddress?: string;
        tokenMint?: string;
        tokenName?: string;
        tokenSymbol?: string;
        addresses?: string[];
      }>;
      const job = pendingJobs.find(j => j.jobId === jobId);

      if (!job) {
        return { text: 'Job completed but job details not found.' };
      }

      // Format the result based on job type
      if (job.type === 'profile' || job.type === 'analysis') {
        const hud = await analyzer.getWalletHud(job.walletAddress!);
        const { formatWalletProfile } = await import('./formatters/profile.js');
        return { text: formatWalletProfile(job.walletAddress!, hud) };
      } else if (job.type === 'holders') {
        const { formatHolderProfilesResult } = await import('./formatters/holders.js');
        return { text: formatHolderProfilesResult(result.result as any, job.tokenName, job.tokenSymbol) };
      } else if (job.type === 'similarity') {
        const { formatComparison } = await import('./formatters/comparison.js');
        const { summary, report } = formatComparison(job.addresses!, result.result);
        const attachment = report
          ? { content: report, contentType: 'text/markdown', filename: 'comparison.md' }
          : undefined;
        return { text: summary, attachment };
      }

      return { text: 'Job completed but unknown job type.' };
    }

    if (result.status === 'failed') {
      return { text: `Job failed: ${result.error ?? 'Unknown error'}` };
    }

    // Still pending — wait before polling again
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return { text: 'Job timed out after 10 minutes.' };
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

  console.log(`  Key: ${apiKey.slice(0, 20)}... (${apiKey.length} chars)\n`);

  const analyzer = new AnalyzerClient(apiUrl, apiKey);

  // Smoke-test connectivity before entering the loop
  process.stdout.write('\nConnecting to analyzer API... ');
  try {
    // 404 = server up and auth passed (unknown address) — anything else is a real failure
    await analyzer.getWalletSummary('11111111111111111111111111111111').catch((err: unknown) => {
      const status = (err as any)?.response?.status;
      if (status !== 404) throw err;
    });
    console.log('OK\n');
  } catch (err) {
    const status = (err as any)?.response?.status;
    const msg = err instanceof Error ? err.message : String(err);
    if (status === 401) {
      console.log(`FAILED\n\nAPI key rejected (401). Check ANALYZER_API_KEY in your .env\n`);
    } else {
      console.log(`FAILED\n\nCould not reach ${apiUrl}: ${msg}\n`);
    }
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

    // Track job count before command execution
    const pendingJobsBefore = (deferred as any).pending as Array<{ jobId: string; type: string; walletAddress?: string }>;
    const jobCountBefore = pendingJobsBefore?.length ?? 0;

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

      // ── Check if a job was deferred ───────────────────────────────────
      const pendingJobsAfter = (deferred as any).pending as Array<{ jobId: string; type: string; walletAddress?: string }>;
      const jobCountAfter = pendingJobsAfter?.length ?? 0;

      if (jobCountAfter > jobCountBefore) {
        // A new job was just added — wait for it instead of showing the deferred message
        const newJob = pendingJobsAfter[pendingJobsAfter.length - 1];
        console.log('\n┌─ WAITING FOR JOB ' + hr('─', 53));
        console.log(`Job ${newJob.jobId} queued. Waiting for completion...`);
        console.log('└' + hr('─', 71));
        console.log(`  [${elapsed}ms]\n`);

        // Poll until complete
        const finalResult = await waitForJobCompletion(analyzer, deferred, newJob.jobId);

        const finalElapsed = Date.now() - t0;

        console.log('\n┌─ BOT REPLY (FINAL RESULT) ' + hr('─', 44));
        console.log(finalResult.text);

        if (finalResult.attachment) {
          console.log('\n├─ ATTACHMENT (' + finalResult.attachment.contentType + ')');
          console.log(finalResult.attachment.content.slice(0, 400) + (finalResult.attachment.content.length > 400 ? '\n  ...' : ''));
        }

        console.log('└' + hr('─', 71));
        console.log(`  [${finalElapsed}ms]\n`);
      } else {
        // No deferred job — show immediate result
        console.log('\n┌─ BOT REPLY ' + hr('─', 59));
        console.log(result.text);

        if (result.attachment) {
          console.log('\n├─ ATTACHMENT (' + result.attachment.contentType + ')');
          console.log(result.attachment.content.slice(0, 400) + (result.attachment.content.length > 400 ? '\n  ...' : ''));
        }

        console.log('└' + hr('─', 71));
        console.log(`  [${elapsed}ms]\n`);
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
