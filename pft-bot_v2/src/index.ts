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
    description: 'Solana wallet intelligence powered by on-chain behavioral analysis. Uncover who\'s holding your token, how individual wallets trade, and how traders stack up against each other.\n\nWhat I can do:\n- Holder profiles — scan a token\'s top holders and classify their trading behavior\n- Wallet profile — quick behavioral fingerprint of any Solana wallet\n- Deep analysis — comprehensive breakdown of a wallet\'s on-chain history and patterns\n- Comparison — put two wallets head-to-head to contrast their behavior',
    capabilities: ['wallet-analysis'],
    icon_emoji: '\u{1F989}',
    commands: [
      { command: '/holders', description: 'Top holders with behavioral profiles', example: '/holders <token_mint>', min_cost_drops: '5000000' },
      { command: '/profile', description: 'Quick wallet behavioral profile', example: '/profile <wallet_address>', min_cost_drops: '5000000' },
      { command: '/analyze', description: 'Deep analysis (2-15 min)', example: '/analyze <wallet_address>', min_cost_drops: '20000000' },
      { command: '/compare', description: 'Compare wallet behavior', example: '/compare <addr1> <addr2>', min_cost_drops: '30000000' },
      { command: '/trades', description: 'Full trade history CSV export', example: '/trades <wallet_address>', min_cost_drops: '5000000' },
    ],
  });

  // 3. Start liveness ping loop (keeps bot visible in registry search)
  if (config.PING_INTERVAL_MS > 0) {
    const pingLoop = async (): Promise<void> => {
      while (true) {
        await new Promise(resolve => setTimeout(resolve, config.PING_INTERVAL_MS));
        try {
          const { agent_id, last_ping_at } = await pft.ping();
          console.log(`[PING] OK — agent_id=${agent_id} last_ping_at=${last_ping_at}`);
        } catch (err) {
          console.error('[PING] Ping failed:', err instanceof Error ? err.message : err);
        }
      }
    };
    pingLoop().catch(err => {
      console.error('[PING] Fatal ping loop error:', err);
    });
  }

  // 4. Init analyzer client
  const analyzer = new AnalyzerClient(config.ANALYZER_API_URL, config.ANALYZER_API_KEY);

  // 5. Init deferred jobs (loads pending from file)
  const deferred = new DeferredJobs(pft, analyzer);
  await deferred.loadPending();

  // 6. Start deferred job polling in background
  deferred.startPolling().catch(err => {
    console.error('[JOBS] Fatal polling error:', err);
  });

  // 7. Start scan loop (blocks until stopped)
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
