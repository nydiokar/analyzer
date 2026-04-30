/**
 * Demo script: ingest an EVM wallet and print a summary.
 *
 * Usage:
 *   npx ts-node src/scripts/demo-evm-wallet.ts 0x1234...abcd [ethereum|arbitrum|base]
 */
import 'reflect-metadata';
import { EvmApiClient } from '../core/services/evm-api-client';
import { mapEvmTransactionsToSwapInputs } from '../core/services/evm-transaction-mapper';
import { EvmChain } from '../types/evm-api';

async function main() {
  const walletAddress = process.argv[2];
  const chain = (process.argv[3] ?? 'ethereum') as EvmChain;

  if (!walletAddress) {
    console.error('Usage: ts-node demo-evm-wallet.ts <WALLET_ADDRESS> [chain]');
    process.exit(1);
  }

  const alchemyApiKey = process.env.ALCHEMY_API_KEY;
  if (!alchemyApiKey) {
    console.warn('⚠ ALCHEMY_API_KEY not set — requests may be rate limited.');
  }

  const client = new EvmApiClient({ alchemyApiKey });

  console.log(`\n📡 Fetching transfers for ${walletAddress} on ${chain}...\n`);
  const transfers = await client.getTransfersForAddress(walletAddress, chain, { maxCount: 200 });
  console.log(`  Found ${transfers.length} token transfer events`);

  const txHashes = client.extractTxHashes(transfers);
  console.log(`  Unique transactions: ${txHashes.length}`);

  console.log(`\n🔍 Fetching full transaction data (with logs)...\n`);
  const transactions = await client.getTransactionsWithLogs(txHashes, chain, 3);
  console.log(`  Fetched ${transactions.length} transactions`);

  console.log(`\n⚙️  Mapping to SwapAnalysisInput...\n`);
  const { records, stats } = mapEvmTransactionsToSwapInputs(transactions, walletAddress, chain);

  console.log('=== Mapping Stats ===');
  console.log(`  Transactions received:  ${stats.transactionsReceived}`);
  console.log(`  Transactions processed: ${stats.transactionsProcessed}`);
  console.log(`  Transactions skipped:   ${stats.transactionsSkipped}`);
  console.log(`  Swaps detected:         ${stats.swapsDetected}`);
  console.log(`  Transfers detected:     ${stats.transfersDetected}`);
  console.log(`  Unknown skipped:        ${stats.unknownSkipped}`);
  console.log(`  Records generated:      ${stats.inputsGenerated}`);

  if (records.length > 0) {
    console.log('\n=== Sample Records (first 5) ===');
    for (const r of records.slice(0, 5)) {
      console.log(`  [${r.direction.toUpperCase()}] ${r.mint.slice(0, 10)}... | ${r.amount.toFixed(4)} | ETH value: ${r.associatedSolValue.toFixed(6)} | type: ${r.interactionType}`);
    }
  }

  const totalNativeIn = records
    .filter(r => r.direction === 'in')
    .reduce((sum, r) => sum + r.associatedSolValue, 0);
  const totalNativeOut = records
    .filter(r => r.direction === 'out')
    .reduce((sum, r) => sum + r.associatedSolValue, 0);

  console.log('\n=== Portfolio Summary ===');
  console.log(`  Total native value received: ${totalNativeIn.toFixed(4)} ETH`);
  console.log(`  Total native value spent:    ${totalNativeOut.toFixed(4)} ETH`);
  console.log(`  Net:                         ${(totalNativeIn - totalNativeOut).toFixed(4)} ETH`);

  const uniqueTokens = new Set(records.map(r => r.mint)).size;
  console.log(`  Unique tokens interacted:    ${uniqueTokens}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
