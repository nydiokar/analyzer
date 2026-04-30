/**
 * Debug script — inspect raw tx data for a single hash.
 * Usage: pnpm debug:evm-tx 0x<HASH> [ethereum|arbitrum|base]
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { EvmApiClient } from '../core/services/evm-api-client';
import { parseTransferLogs } from '../core/services/evm-event-parser';
import { classifyEvmTransaction } from '../core/services/evm-transaction-classifier';
import { EvmChain } from '../types/evm-api';

async function main() {
  const txHash = process.argv[2];
  const chain = (process.argv[3] ?? 'ethereum') as EvmChain;

  if (!txHash) {
    console.error('Usage: pnpm debug:evm-tx <TX_HASH> [chain]');
    process.exit(1);
  }

  const client = new EvmApiClient({ alchemyApiKey: process.env.ALCHEMY_API_KEY });
  const txs = await client.getTransactionsWithLogs([txHash], chain, 1);

  if (!txs.length) {
    console.error('Transaction not found or failed to fetch');
    process.exit(1);
  }

  const tx = txs[0];
  console.log('\n--- TX ---');
  console.log(`  hash:     ${tx.hash}`);
  console.log(`  from:     ${tx.from}`);
  console.log(`  to:       ${tx.to}`);
  console.log(`  value:    ${tx.nativeValue} wei`);
  console.log(`  gasUsed:  ${tx.gasUsed}`);
  console.log(`  gasPrice: ${tx.gasPrice}`);
  console.log(`  success:  ${tx.success}`);
  console.log(`  logs:     ${tx.logs.length}`);

  console.log('\n--- LOGS (all) ---');
  for (const log of tx.logs) {
    console.log(`  [${log.logIndex}] ${log.address}`);
    console.log(`        topic0: ${log.topics[0]}`);
    if (log.topics[1]) console.log(`        topic1: ${log.topics[1]}`);
    if (log.topics[2]) console.log(`        topic2: ${log.topics[2]}`);
    console.log(`        data:   ${log.data.slice(0, 66)}${log.data.length > 66 ? '...' : ''}`);
  }

  // Use a dummy wallet (the tx sender) for classification
  const walletAddress = process.argv[4] ?? tx.from;
  const transfers = parseTransferLogs(tx.logs);
  const classification = classifyEvmTransaction(tx.to, tx.logs, walletAddress, chain);

  console.log('\n--- PARSED TRANSFERS ---');
  for (const t of transfers) {
    const dir = t.from === walletAddress.toLowerCase() ? 'OUT' : ' IN';
    console.log(`  [${dir}] ${t.tokenAddress}  amount=${t.amount}  from=${t.from.slice(0, 12)}  to=${t.to.slice(0, 12)}`);
  }

  console.log('\n--- CLASSIFICATION ---');
  console.log(`  result:     ${classification.classification}`);
  console.log(`  confidence: ${classification.confidence}`);
  console.log(`  reason:     ${classification.reason}`);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
