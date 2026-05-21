import * as dotenv from 'dotenv';
dotenv.config();

import { EvmApiClient } from '../core/services/evm-api-client';
import { mapEvmTransactionsToSwapInputs } from '../core/services/evm-transaction-mapper';
import { selectTransactionsForEnrichment } from '../core/services/evm-sync-service';
import { EvmChain } from '../types/evm-api';

async function main() {
  const walletAddress = process.argv[2];
  const chain = (process.argv[3] ?? 'ethereum') as EvmChain;
  const enrichLimit = parseInt(process.argv[4] ?? '50');

  if (!walletAddress) {
    console.error('Usage: pnpm demo:evm-wallet <WALLET_ADDRESS> [ethereum|arbitrum|base] [enrichLimit=50]');
    process.exit(1);
  }

  if (!process.env.ALCHEMY_API_KEY) {
    console.error('ALCHEMY_API_KEY not set in .env');
    process.exit(1);
  }

  const client = new EvmApiClient({ alchemyApiKey: process.env.ALCHEMY_API_KEY });

  // Step 1: Fetch all ERC-20 transfers (2 RPC calls)
  console.log(`\nFetching transfers for ${walletAddress} on ${chain}...`);
  const transfers = await client.getTransfersForAddress(walletAddress, chain, { maxCount: 500 });
  console.log(`  ${transfers.length} transfer events`);

  const txHashes = client.extractTxHashes(transfers);
  console.log(`  ${txHashes.length} unique transactions`);

  // Step 2: Build transactions from transfer metadata (zero extra RPC calls)
  let transactions = client.buildTransactionsFromTransfers(transfers, walletAddress, chain);

  // Step 3: Smart enrichment — prioritise outgoing swaps first so ETH spent is populated
  const toEnrich = selectTransactionsForEnrichment(transactions, walletAddress, chain, enrichLimit);
  console.log(`\nEnriching ${toEnrich.length} transactions with receipts (smart-ordered, 250ms delay each)...`);
  const enriched = await client.enrichWithReceipts(toEnrich, chain, 250);
  const enrichedMap = new Map(enriched.map(tx => [tx.hash, tx]));
  transactions = transactions.map(tx => enrichedMap.get(tx.hash) ?? tx);

  // Step 4: Map to SwapAnalysisInput records
  console.log(`\nMapping ${transactions.length} transactions...`);
  const { records, stats } = mapEvmTransactionsToSwapInputs(transactions, walletAddress, chain);

  console.log(`
--- Stats ---
  received:   ${stats.transactionsReceived}
  processed:  ${stats.transactionsProcessed}
  skipped:    ${stats.transactionsSkipped}
  swaps:      ${stats.swapsDetected}
  transfers:  ${stats.transfersDetected}
  unknown:    ${stats.unknownSkipped}
  records:    ${stats.inputsGenerated}`);

  if (records.length > 0) {
    console.log('\n--- Sample records (first 10) ---');
    for (const r of records.slice(0, 10)) {
      const dir = r.direction === 'in' ? ' IN' : 'OUT';
      const token = (r.mint as string).slice(0, 12);
      const amt = (r.amount as number).toFixed(4);
      const eth = (r.associatedSolValue as number).toFixed(6);
      console.log(`  [${dir}] ${token}  amt=${amt}  eth=${eth}  ${r.interactionType}`);
    }
  }

  const swapRecords = records.filter(r => r.interactionType === 'SWAP' || r.interactionType === 'SWAP_STABLE');
  const totalIn = swapRecords.filter(r => r.direction === 'in').reduce((s, r) => s + (r.associatedSolValue as number), 0);
  const totalOut = swapRecords.filter(r => r.direction === 'out').reduce((s, r) => s + (r.associatedSolValue as number), 0);
  const uniqueTokens = new Set(records.map(r => r.mint)).size;

  console.log(`
--- Summary (swap records only) ---
  ETH received: ${totalIn.toFixed(6)}
  ETH spent:    ${totalOut.toFixed(6)}
  Net:          ${(totalIn - totalOut).toFixed(6)}
  Unique tokens: ${uniqueTokens}
  Enriched: ${toEnrich.length} txs (outgoing swaps prioritised)
`);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
