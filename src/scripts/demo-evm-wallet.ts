import * as dotenv from 'dotenv';
dotenv.config();

import { EvmApiClient } from '../core/services/evm-api-client';
import { mapEvmTransactionsToSwapInputs } from '../core/services/evm-transaction-mapper';
import { EvmChain } from '../types/evm-api';

async function main() {
  const walletAddress = process.argv[2];
  const chain = (process.argv[3] ?? 'ethereum') as EvmChain;
  // How many receipts to enrich with full logs (for value extraction). Keep low on free tier.
  const enrichLimit = parseInt(process.argv[4] ?? '20');

  if (!walletAddress) {
    console.error('Usage: pnpm demo:evm-wallet <WALLET_ADDRESS> [ethereum|arbitrum|base] [enrichLimit=20]');
    process.exit(1);
  }

  if (!process.env.ALCHEMY_API_KEY) {
    console.error('ALCHEMY_API_KEY not set in .env');
    process.exit(1);
  }

  const client = new EvmApiClient({ alchemyApiKey: process.env.ALCHEMY_API_KEY });

  // Step 1: Fetch recent transfers (2 RPC calls total regardless of wallet size)
  console.log(`\nFetching transfers for ${walletAddress} on ${chain}...`);
  const transfers = await client.getTransfersForAddress(walletAddress, chain, { maxCount: 100 });
  console.log(`  ${transfers.length} transfer events`);

  const txHashes = client.extractTxHashes(transfers);
  console.log(`  ${txHashes.length} unique transactions`);

  // Step 2: Build transactions from transfer data (no extra RPC calls)
  let transactions = client.buildTransactionsFromTransfers(transfers, walletAddress);
  transactions = transactions.map(tx => ({ ...tx, chain }));

  // Step 3: Enrich a limited number with full receipts (for DEX log parsing + value extraction)
  // Only needed for accurate ETH value — 1 RPC call per tx, rate-limited
  const toEnrich = transactions.slice(0, enrichLimit);
  if (toEnrich.length > 0) {
    console.log(`\nEnriching ${toEnrich.length} transactions with receipts (250ms delay each)...`);
    const enriched = await client.enrichWithReceipts(toEnrich, chain, 250);
    // Replace enriched txs in the full list
    const enrichedMap = new Map(enriched.map(tx => [tx.hash, tx]));
    transactions = transactions.map(tx => enrichedMap.get(tx.hash) ?? tx);
  }

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

  const totalIn = records.filter(r => r.direction === 'in').reduce((s, r) => s + (r.associatedSolValue as number), 0);
  const totalOut = records.filter(r => r.direction === 'out').reduce((s, r) => s + (r.associatedSolValue as number), 0);
  const uniqueTokens = new Set(records.map(r => r.mint)).size;

  console.log(`
--- Summary ---
  ETH received: ${totalIn.toFixed(6)}
  ETH spent:    ${totalOut.toFixed(6)}
  Net:          ${(totalIn - totalOut).toFixed(6)}
  Tokens:       ${uniqueTokens}
  (note: ETH values only filled for first ${enrichLimit} txs with full log enrichment)
`);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
