/**
 * End-to-end EVM wallet sync + DB save validation script.
 * Usage: pnpm ts-node -r tsconfig-paths/register src/scripts/evm-save-wallet.ts <WALLET_ADDRESS> [chain]
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { EvmApiClient } from '../core/services/evm-api-client';
import { EvmSyncService } from '../core/services/evm-sync-service';
import { DatabaseService } from '../core/services/database-service';
import { EvmChain } from '../types/evm-api';

async function main() {
  const walletAddress = process.argv[2];
  const chain = (process.argv[3] ?? 'ethereum') as EvmChain;

  if (!walletAddress || !walletAddress.startsWith('0x')) {
    console.error('Usage: pnpm ts-node -r tsconfig-paths/register src/scripts/evm-save-wallet.ts <0x...> [ethereum|arbitrum|base]');
    process.exit(1);
  }

  const dbService = new DatabaseService();
  const evmClient = new EvmApiClient({ alchemyApiKey: process.env.ALCHEMY_API_KEY });
  const syncService = new EvmSyncService(evmClient, dbService);

  console.log(`\nSyncing ${walletAddress} on ${chain} → saving to DB...`);
  const result = await syncService.syncWalletData(walletAddress, chain, {
    maxTransactions: 200,
    enrichLimit: 30,
    skipSave: false,
  });

  console.log('\n--- Result ---');
  console.log(`  savedCount:  ${result.savedCount}`);
  console.log(`  swaps:       ${result.stats.swapsDetected}`);
  console.log(`  transfers:   ${result.stats.transfersDetected}`);
  console.log(`  durationMs:  ${result.durationMs}`);

  // Verify rows are in DB (EVM addresses stored lowercase by mapper)
  const prisma = new PrismaClient();
  const walletLower = walletAddress.toLowerCase();
  const count = await prisma.swapAnalysisInput.count({ where: { walletAddress: walletLower } });
  const wallet = await prisma.wallet.findFirst({ where: { address: { in: [walletAddress, walletLower] } } });
  console.log(`\n  DB row count for wallet: ${count}`);
  console.log(`  Wallet row in DB: ${wallet ? 'yes (chain=' + wallet.chain + ')' : 'no'}`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
