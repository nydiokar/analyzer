import fs from 'node:fs';
import path from 'node:path';
import type { PFTClient } from './pft-client.js';
import type { AnalyzerClient } from './analyzer.js';
import { config } from './config.js';
import { formatWalletProfile } from './formatters/profile.js';
import { formatComparison } from './formatters/comparison.js';
import { formatHolderProfilesResult } from './formatters/holders.js';
import type { HolderProfilesResult } from './analyzer.js';

export interface PendingJob {
  jobId: string;
  // 'profile'    — auto-triggered flash analysis from /profile on unanalyzed wallet
  //                on completion: fetch HUD and send formatted profile card
  // 'analysis'   — explicit /analyze command (user-requested deep analysis)
  //                on completion: fetch HUD and send profile card
  // 'holders'    — /holders <mint> command via POST /analyses/holder-profiles
  //                on completion: format HolderProfilesResult and send holder table
  // 'similarity' — /compare command
  //                on completion: format raw job result and send comparison
  type: 'profile' | 'analysis' | 'holders' | 'similarity';
  sender: string;
  txHash: string;
  threadId?: string;
  queuedAt: number;
  walletAddress?: string;  // required for 'profile' and 'analysis'
  tokenMint?: string;       // required for 'holders'
  tokenName?: string;       // optional display name for 'holders'
  tokenSymbol?: string;     // optional display symbol for 'holders'
  addresses?: string[];     // required for 'similarity'
}

export class DeferredJobs {
  private pending: PendingJob[] = [];
  private running = false;

  constructor(
    private pft: PFTClient,
    private analyzer: AnalyzerClient,
  ) {}

  async loadPending(): Promise<void> {
    try {
      if (!fs.existsSync(config.PENDING_JOBS_FILE)) {
        this.pending = [];
        return;
      }

      const raw = fs.readFileSync(config.PENDING_JOBS_FILE, 'utf-8');
      this.pending = JSON.parse(raw) as PendingJob[];
      console.log(`[JOBS] Loaded ${this.pending.length} pending job(s)`);
    } catch (err) {
      console.error(`[JOBS] Failed to load pending jobs:`, err);
      this.pending = [];
    }
  }

  addJob(job: PendingJob): void {
    this.pending.push(job);
    this.savePending();
    console.log(`[JOBS] Added ${job.type} job ${job.jobId} for ${job.sender}`);
  }

  async startPolling(): Promise<void> {
    this.running = true;
    console.log(`[JOBS] Starting poll loop (interval: ${config.JOB_POLL_INTERVAL_MS}ms)`);

    while (this.running) {
      if (this.pending.length > 0) {
        await this.pollAll();
      }
      await this.sleep(config.JOB_POLL_INTERVAL_MS);
    }
  }

  stopPolling(): void {
    this.running = false;
  }

  private async pollAll(): Promise<void> {
    const completed: string[] = [];

    for (const job of this.pending) {
      try {
        if (Date.now() - job.queuedAt > config.JOB_TIMEOUT_MS) {
          console.log(`[JOBS] Job ${job.jobId} timed out`);
          await this.sendTimeout(job);
          completed.push(job.jobId);
          continue;
        }

        const result = await this.analyzer.getJobResult(job.jobId);

        if (result.status === 'completed') {
          console.log(`[JOBS] Job ${job.jobId} completed`);
          await this.sendResult(job, result.result);
          completed.push(job.jobId);
        } else if (result.status === 'failed') {
          console.log(`[JOBS] Job ${job.jobId} failed: ${result.error}`);
          await this.sendError(job, result.error ?? 'Unknown error');
          completed.push(job.jobId);
        }
      } catch (err) {
        console.error(`[JOBS] Error polling ${job.jobId}:`, err instanceof Error ? err.message : err);
      }
    }

    if (completed.length > 0) {
      this.pending = this.pending.filter(j => !completed.includes(j.jobId));
      this.savePending();
    }
  }

  private async sendResult(job: PendingJob, result: unknown): Promise<void> {
    let text: string;
    let attachment: { content: string; contentType: string; filename: string } | undefined;

    if (job.type === 'profile' || job.type === 'analysis') {
      // Job result is internal BullMQ data — the clean output is the HUD.
      // Fetch it fresh now that analysis has completed and cache is invalidated.
      const hud = await this.analyzer.getWalletHud(job.walletAddress!);
      text = formatWalletProfile(job.walletAddress!, hud);
    } else if (job.type === 'holders') {
      // holder-profiles job — result is HolderProfilesResult resolved from Redis pointer
      text = formatHolderProfilesResult(result as HolderProfilesResult, job.tokenName, job.tokenSymbol);
    } else {
      // similarity — raw job result contains the comparison data
      const { summary, report } = formatComparison(job.addresses!, result);
      text = summary;
      if (report) {
        attachment = { content: report, contentType: 'text/markdown', filename: 'comparison.md' };
      }
    }

    if (attachment) {
      const upload = await this.pft.uploadContent({
        content: attachment.content,
        content_type: attachment.contentType,
      });
      await this.pft.sendMessage({
        recipient: job.sender,
        message: text,
        reply_to_tx: job.txHash,
        thread_id: job.threadId,
        attachments: [{ cid: upload.cid, content_type: attachment.contentType, filename: attachment.filename }],
      });
    } else {
      await this.pft.sendMessage({
        recipient: job.sender,
        message: text,
        reply_to_tx: job.txHash,
        thread_id: job.threadId,
      });
    }
  }

  private async sendError(job: PendingJob, error: string): Promise<void> {
    const addr = job.walletAddress
      ? `${job.walletAddress.slice(0, 4)}..${job.walletAddress.slice(-4)}`
      : job.tokenMint
        ? `token ${job.tokenMint.slice(0, 6)}..${job.tokenMint.slice(-4)}`
        : 'your wallets';
    const context = job.type === 'similarity' ? 'Comparison' : job.type === 'holders' ? 'Holder analysis' : 'Analysis';
    await this.pft.sendMessage({
      recipient: job.sender,
      message: `${context} for ${addr} failed: ${error}\n\nPlease try again.`,
      reply_to_tx: job.txHash,
      thread_id: job.threadId,
    });
  }

  private async sendTimeout(job: PendingJob): Promise<void> {
    const addr = job.walletAddress
      ? `${job.walletAddress.slice(0, 4)}..${job.walletAddress.slice(-4)}`
      : job.tokenMint
        ? `token ${job.tokenMint.slice(0, 6)}..${job.tokenMint.slice(-4)}`
        : 'your wallets';
    const timeoutMin = Math.round(config.JOB_TIMEOUT_MS / 60000);
    const hint = job.type === 'holders'
      ? `\n\nTry again — the token may have many unanalyzed holders.`
      : `\n\nTry again with /analyze ${job.walletAddress ?? '<address>'} to force a fresh run.`;
    await this.pft.sendMessage({
      recipient: job.sender,
      message: `Analysis for ${addr} timed out after ${timeoutMin} minutes.${hint}`,
      reply_to_tx: job.txHash,
      thread_id: job.threadId,
    });
  }

  private savePending(): void {
    try {
      const dir = path.dirname(config.PENDING_JOBS_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(config.PENDING_JOBS_FILE, JSON.stringify(this.pending, null, 2));
    } catch (err) {
      console.error(`[JOBS] Failed to save pending jobs:`, err);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
