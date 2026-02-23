import { config } from './config.js';
import { PFTClient } from './pft-client.js';
import { Scanner } from './scanner.js';
import { AnalyzerClient } from './analyzer.js';
import { DeferredJobs } from './deferred-jobs.js';

async function main(): Promise<void> {
  console.log('[BOOT] Starting Sova Intel bot...');

  // 1. Init PFT client (spawns MCP subprocess)
  const pft = new PFTClient(config);
  await pft.connect();

  // 2. Register bot (idempotent — updates if already registered)
  await pft.registerBot({
    name: 'Sova Intel',
    description: 'Solana wallet intelligence. Analyze token holders, profile wallets, compare trading behavior.',
    capabilities: ['text-generation'],
    icon_emoji: '\u{1F989}',
    commands: [
      { command: '/holders', description: 'Top holders with behavioral profiles', example: '/holders <token_mint>', min_cost_drops: '1000000000' },
      { command: '/profile', description: 'Quick wallet behavioral profile', example: '/profile <wallet_address>', min_cost_drops: '500000000' },
      { command: '/analyze', description: 'Deep analysis (2-15 min)', example: '/analyze <wallet_address>', min_cost_drops: '3000000000' },
      { command: '/compare', description: 'Compare wallet behavior', example: '/compare <addr1> <addr2>', min_cost_drops: '3000000000' },
    ],
  });

  // 3. Init analyzer client
  const analyzer = new AnalyzerClient(config.ANALYZER_API_URL, config.ANALYZER_API_KEY);

  // 4. Init deferred jobs (loads pending from file)
  const deferred = new DeferredJobs(pft, analyzer);
  await deferred.loadPending();

  // 5. Start deferred job polling in background
  deferred.startPolling().catch(err => {
    console.error('[JOBS] Fatal polling error:', err);
  });

  // 6. Start scan loop (blocks until stopped)
  const scanner = new Scanner(pft, analyzer, deferred);

  // Graceful shutdown
  const shutdown = (): void => {
    console.log('\n[BOOT] Shutting down...');
    scanner.stop();
    deferred.stopPolling();
    pft.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('[BOOT] Sova Intel bot running. Scanning for messages...');

  // Notify pm2 we're ready
  if (process.send) process.send('ready');

  await scanner.start();
}

main().catch(err => {
  console.error('[BOOT] Fatal error:', err);
  process.exit(1);
});
