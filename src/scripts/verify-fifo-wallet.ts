#!/usr/bin/env node
import * as dotenv from 'dotenv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { HeliusApiClient } from '../core/services/helius-api-client';
import { HeliusSyncService, SyncOptions } from '../core/services/helius-sync-service';
import { PnlAnalysisService } from '../core/services/pnl-analysis-service';
import { DatabaseService } from '../api/services/database.service';

dotenv.config();

const EPSILON = 1e-6;

function approxEqual(a: number, b: number, epsilon = EPSILON): boolean {
  return Math.abs(a - b) <= epsilon;
}

function parseDecimal(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return parseFloat(value.toString());
}

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .option('wallet', {
      type: 'string',
      demandOption: true,
      description: 'Wallet address to verify FIFO calculations for',
    })
    .option('skipSync', {
      type: 'boolean',
      default: false,
      description: 'Skip Helius sync and use existing SwapAnalysisInput rows',
    })
    .option('fetchAll', {
      type: 'boolean',
      default: true,
      description: 'Fetch full history when syncing',
    })
    .option('fetchOlder', {
      type: 'boolean',
      default: true,
      description: 'Fetch older signatures when syncing',
    })
    .option('limit', {
      type: 'number',
      default: 100,
      description: 'Batch size for Helius sync',
    })
    .option('maxSignatures', {
      type: 'number',
      default: 1000,
      description: 'Optional cap on signatures fetched (0 = no cap)',
    })
    .parse();

  const walletAddress = argv.wallet;

  if (!argv.skipSync && !process.env.HELIUS_API_KEY) {
    console.error('HELIUS_API_KEY is required unless --skipSync is provided.');
    process.exit(1);
  }

  const databaseService = new DatabaseService();
  const heliusClient = process.env.HELIUS_API_KEY
    ? new HeliusApiClient(
        {
          apiKey: process.env.HELIUS_API_KEY,
          network: 'mainnet',
          requestsPerSecond: 20,
        },
        databaseService,
      )
    : null;

  if (!argv.skipSync && heliusClient) {
    const syncService = new HeliusSyncService(databaseService, heliusClient);
    const syncOptions: SyncOptions = {
      limit: argv.limit,
      fetchAll: argv.fetchAll,
      skipApi: false,
      fetchOlder: argv.fetchOlder,
      maxSignatures: argv.maxSignatures > 0 ? argv.maxSignatures : 1000,
      smartFetch: true,
    };
    console.log(`Syncing wallet ${walletAddress}...`);
    await syncService.syncWalletData(walletAddress, syncOptions);
  }

  const pnlService = new PnlAnalysisService(databaseService, heliusClient, null);
  console.log(`Running FIFO analysis for ${walletAddress}...`);
  await pnlService.analyzeWalletPnl(walletAddress, undefined, { isViewOnly: false, skipBalanceFetch: false });

  const results = await databaseService.getAnalysisResults({ where: { walletAddress } });
  const lots = await databaseService.getTokenLots(walletAddress);
  const swapInputs = await databaseService.getSwapAnalysisInputs(walletAddress);

  const lotsByMint = new Map<
    string,
    { remaining: number; costBasis: number }
  >();

  for (const lot of lots) {
    const mint = lot.tokenAddress;
    const amountRemaining = parseDecimal(lot.amountRemaining);
    const amountBought = parseDecimal(lot.amountBought);
    const costBasisSol = parseDecimal(lot.costBasisSol);
    const unitCost = amountBought > 0 ? costBasisSol / amountBought : 0;
    const prev = lotsByMint.get(mint) || { remaining: 0, costBasis: 0 };
    prev.remaining += amountRemaining;
    prev.costBasis += amountRemaining * unitCost;
    lotsByMint.set(mint, prev);
  }

  let failures = 0;
  let skipped = 0;

  for (const result of results) {
    if (result.isValuePreservation) continue;
    if (result.hasIncompleteHistory) {
      skipped++;
      continue;
    }

    const fees = result.totalFeesPaidInSol || 0;
    const realized = result.realizedPnlSol ?? 0;
    const total = result.totalPnlSol ?? realized;
    const expectedNet = total - fees;

    if (!approxEqual(result.netSolProfitLoss, expectedNet)) {
      failures++;
      console.error(
        `[FAIL] ${result.tokenAddress} netSolProfitLoss ${result.netSolProfitLoss} != expected ${expectedNet}`,
      );
    }

    const lotData = lotsByMint.get(result.tokenAddress);
    const tokenSwapInputs = swapInputs.filter(input => input.mint === result.tokenAddress);
    const schemaMissingIncompleteFlag = result.hasIncompleteHistory === null || result.hasIncompleteHistory === undefined;
    if (lotData && result.currentUiBalance !== null && result.currentUiBalance !== undefined) {
      if (!approxEqual(lotData.remaining, result.currentUiBalance)) {
        failures++;
        console.error(
          `[FAIL] ${result.tokenAddress} lots remaining ${lotData.remaining} != currentUiBalance ${result.currentUiBalance} (swapInputs=${tokenSwapInputs.length}, schemaHasIncompleteFlag=${!schemaMissingIncompleteFlag})`,
        );
      }
    }

    if (lotData && result.currentHoldingsCostBasisSol !== null && result.currentHoldingsCostBasisSol !== undefined) {
      if (!approxEqual(lotData.costBasis, result.currentHoldingsCostBasisSol)) {
        failures++;
        console.error(
          `[FAIL] ${result.tokenAddress} lots cost basis ${lotData.costBasis} != currentHoldingsCostBasisSol ${result.currentHoldingsCostBasisSol}`,
        );
      }
    }

    if (
      result.currentHoldingsValueSol !== null &&
      result.currentHoldingsValueSol !== undefined &&
      result.currentHoldingsCostBasisSol !== null &&
      result.currentHoldingsCostBasisSol !== undefined
    ) {
      const expectedUnrealized = result.currentHoldingsValueSol - result.currentHoldingsCostBasisSol;
      const expectedTotal = realized + expectedUnrealized;

      if (result.unrealizedPnlSol !== null && !approxEqual(result.unrealizedPnlSol, expectedUnrealized)) {
        failures++;
        console.error(
          `[FAIL] ${result.tokenAddress} unrealizedPnlSol ${result.unrealizedPnlSol} != expected ${expectedUnrealized}`,
        );
      }

      if (result.totalPnlSol !== null && !approxEqual(result.totalPnlSol, expectedTotal)) {
        failures++;
        console.error(
          `[FAIL] ${result.tokenAddress} totalPnlSol ${result.totalPnlSol} != expected ${expectedTotal}`,
        );
      }

      const expectedTotalFromFormula =
        (result.totalSolReceived || 0) +
        (result.currentHoldingsValueSol || 0) -
        (result.totalSolSpent || 0);

      if (result.totalPnlSol !== null && !approxEqual(result.totalPnlSol, expectedTotalFromFormula)) {
        failures++;
        console.error(
          `[FAIL] ${result.tokenAddress} totalPnlSol ${result.totalPnlSol} != (received+holdings-spent) ${expectedTotalFromFormula}`,
        );
      }
    }

    if (schemaMissingIncompleteFlag && tokenSwapInputs.length > 0 && lotData && result.currentUiBalance !== null) {
      if (!approxEqual(lotData.remaining, result.currentUiBalance)) {
        console.warn(
          `[WARN] ${result.tokenAddress} holdings mismatch but hasIncompleteHistory not persisted; run migration/backfill to record incomplete history.`,
        );
      }
    }
  }

  console.log(`Verification complete. Failures: ${failures}. Skipped (incomplete history): ${skipped}.`);

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
