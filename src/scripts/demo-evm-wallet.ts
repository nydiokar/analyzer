import * as dotenv from 'dotenv';
dotenv.config();

import { EvmApiClient } from '../core/services/evm-api-client';
import { mapEvmTransactionsToSwapInputs } from '../core/services/evm-transaction-mapper';
import { EvmChain } from '../types/evm-api';

async function main() {
  const walletAddress = process.argv[2];
  const chain = (process.argv[3] ?? 'ethereum') as EvmChain;

  if (!walletAddress) {
    console.error('Usage: pnpm demo:evm-wallet <WALLET_ADDRESS> [ethereum|arbitrum|base]');
    process.exit(1);
  }

  const alchemyApiKey = process.env.ALCHEMY_API_KEY;
  if (!alchemyApiKey) {
    console.error('ALCHEMY_API_KEY not set in .env');
    process.exit(1);
  }

  const client = new EvmApiClient({ alchemyApiKey });

  console.log(`\nFetching transfers for ${walletAddress} on ${chain}...`);
  const transfers = await client.getTransfersForAddress(walletAddress, chain, { maxCount: 200 });
  console.log(`  ${transfers.length} token transfer events found`);

  const txHashes = client.extractTxHashes(transfers);
  console.log(`  ${txHashes.length} unique transactions`);

  console.log(`\nFetching full tx data + logs...`);
  const transactions = await client.getTransactionsWithLogs(txHashes, chain, 5);
  console.log(`  ${transactions.length} transactions fetched`);

  console.log(`\nMapping to SwapAnalysisInput...`);
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
`);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
