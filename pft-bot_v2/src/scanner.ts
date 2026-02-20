import fs from 'node:fs';
import path from 'node:path';
import type { PFTClient } from './pft-client.js';
import type { AnalyzerClient } from './analyzer.js';
import type { DeferredJobs } from './deferred-jobs.js';
import { config, COMMAND_PRICES, HELP_TEXT } from './config.js';
import { parseCommand, handleCommand } from './commands.js';

const MIN_PAYMENT = config.MIN_PAYMENT_PFT;

export class Scanner {
  private cursor: number | undefined;
  private processedHashes = new Set<string>();
  private running = false;
  private maxHashSetSize = 1000;

  constructor(
    private pft: PFTClient,
    private analyzer: AnalyzerClient,
    private deferred: DeferredJobs,
  ) {
    this.cursor = this.loadCursor();
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`[SCAN] Starting scan loop (interval: ${config.SCAN_INTERVAL_MS}ms, cursor: ${this.cursor ?? 'none'})`);

    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        console.error('[SCAN] Tick error:', err instanceof Error ? err.message : err);
      }
      await this.sleep(config.SCAN_INTERVAL_MS);
    }
  }

  stop(): void {
    this.running = false;
    console.log('[SCAN] Stopping scan loop');
  }

  private async tick(): Promise<void> {
    const scan = await this.pft.scanMessages({
      since_ledger: this.cursor,
      direction: 'inbound',
    });

    if (scan.count === 0) return;

    console.log(`[SCAN] Received ${scan.count} messages`);

    for (const msg of scan.messages) {
      if (this.processedHashes.has(msg.tx_hash)) continue;
      if (msg.direction !== 'inbound') continue;

      try {
        await this.processMessage(msg.tx_hash);
      } catch (err) {
        console.error(`[SCAN] Error processing ${msg.tx_hash}:`, err instanceof Error ? err.message : err);
      }

      this.processedHashes.add(msg.tx_hash);
      if (this.processedHashes.size > this.maxHashSetSize) {
        const first = this.processedHashes.values().next().value;
        if (first) this.processedHashes.delete(first);
      }
    }

    this.cursor = scan.next_cursor;
    this.saveCursor(this.cursor);
  }

  private async processMessage(txHash: string): Promise<void> {
    const decrypted = await this.pft.getMessage({ tx_hash: txHash });

    const amountPft = parseFloat(decrypted.amount_pft ?? '0');

    // Ignore dust/spam
    if (amountPft < MIN_PAYMENT) {
      console.log(`[SCAN] Ignoring dust message from ${decrypted.sender} (${amountPft} PFT)`);
      return;
    }

    const parsed = parseCommand(decrypted.message);

    // Validate payment for known commands
    const requiredPrice = COMMAND_PRICES[parsed.command];
    if (requiredPrice && amountPft < requiredPrice) {
      const reply = `Insufficient payment. ${parsed.command} requires ${requiredPrice} PFT (you sent ${amountPft} PFT).\n\n${HELP_TEXT}`;
      await this.pft.sendMessage({
        recipient: decrypted.sender,
        message: reply,
        reply_to_tx: txHash,
        thread_id: decrypted.thread_id,
      });
      return;
    }

    console.log(`[SCAN] Processing ${parsed.command} from ${decrypted.sender} (${amountPft} PFT)`);

    const result = await handleCommand(parsed, decrypted.sender, txHash, this.analyzer, this.deferred, decrypted.thread_id);

    // Send reply
    if (result.attachment) {
      const upload = await this.pft.uploadContent({
        content: result.attachment.content,
        content_type: result.attachment.contentType,
      });
      await this.pft.sendMessage({
        recipient: decrypted.sender,
        message: result.text,
        reply_to_tx: txHash,
        thread_id: decrypted.thread_id,
        attachments: [{ cid: upload.cid, content_type: result.attachment.contentType, filename: result.attachment.filename }],
      });
    } else {
      await this.pft.sendMessage({
        recipient: decrypted.sender,
        message: result.text,
        reply_to_tx: txHash,
        thread_id: decrypted.thread_id,
      });
    }
  }

  // --- Cursor persistence ---

  private saveCursor(cursor: number): void {
    const dir = path.dirname(config.CURSOR_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(config.CURSOR_FILE, JSON.stringify({ cursor, updatedAt: Date.now() }));
  }

  private loadCursor(): number | undefined {
    try {
      const raw = fs.readFileSync(config.CURSOR_FILE, 'utf-8');
      const data = JSON.parse(raw) as { cursor: number };
      console.log(`[SCAN] Loaded cursor: ${data.cursor}`);
      return data.cursor;
    } catch {
      return undefined;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
