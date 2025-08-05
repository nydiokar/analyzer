#!/usr/bin/env ts-node

import { TokenFirstBuyersService } from '../core/services/token-first-buyers-service';
import { HeliusApiClient } from '../core/services/helius-api-client';
import { DatabaseService } from '../api/services/database.service';
import { createLogger } from '../core/utils/logger';
import * as path from 'path';

// Set log level to info to reduce verbosity for this script BEFORE importing logger
process.env.LOG_LEVEL = 'info';

const logger = createLogger('GetFirstTokenBuyers');

/**
 * Script to fetch the first buyers of a specific token mint and optionally analyze their trading performance.
 * 
 * 🎯 SIMPLEST USAGE FOR TOP TRADERS AMONG FIRST 200 BUYERS:
 * npx ts-node -r tsconfig-paths/register src/scripts/get-first-token-buyers.ts <MINT_ADDRESS> --analyze-pnl
 * 
 * Example:
 * npx ts-node -r tsconfig-paths/register src/scripts/get-first-token-buyers.ts 5ACzG28LjHwRTu5jGeCzR4M92zMRxN3c9jKfg5tQpump --analyze-pnl
 * 
 * ⚠️  For pump.fun tokens, add bonding curve address for actual first buyers (before AMM migration):
 * npx ts-node -r tsconfig-paths/register src/scripts/get-first-token-buyers.ts 5ACzG28LjHwRTu5jGeCzR4M92zMRxN3c9jKfg5tQpump 200 3000 bonding-curve 7c6W1BDorJSRcf1iLQYvJEynnwjpyVED6KUfaZ64j5pV --analyze-pnl
 * 
 * Full Usage: npx ts-node -r tsconfig-paths/register src/scripts/get-first-token-buyers.ts <MINT_ADDRESS> [maxBuyers] [maxSignatures] [addressType] [bondingCurveAddress] [--analyze-pnl] [--top-count=N]
 * 
 * Parameters:
 * - MINT_ADDRESS: Token mint address to analyze (required)
 * - maxBuyers: Maximum number of first buyers to find (default: 200)
 * - maxSignatures: Maximum signatures to process (default: 3000)
 * - addressType: 'mint' | 'bonding-curve' | 'auto' (default: 'bonding-curve')
 * - bondingCurveAddress: Bonding curve address for pump.fun tokens (optional)
 * - --analyze-pnl: Enable PnL analysis to rank traders by performance
 * - --top-count=N: Number of top traders to return when using PnL analysis (default: 50)
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('🎯 SIMPLEST USAGE FOR TOP TRADERS AMONG FIRST 200 BUYERS:');
    console.error('   npx ts-node -r tsconfig-paths/register src/scripts/get-first-token-buyers.ts <MINT_ADDRESS> --analyze-pnl');
    console.error('');
    console.error('💡 PUMP.FUN TOKENS - Use bonding curve for actual first buyers:');
    console.error('   npx ts-node -r tsconfig-paths/register src/scripts/get-first-token-buyers.ts <MINT_ADDRESS> 200 3000 bonding-curve <BONDING_CURVE_ADDRESS> --analyze-pnl');
    console.error('');
    console.error('Example with pump.fun token:');
    console.error('   # MINT: 5ACzG28LjHwRTu5jGeCzR4M92zMRxN3c9jKfg5tQpump  BONDING_CURVE: 7c6W1BDorJSRcf1iLQYvJEynnwjpyVED6KUfaZ64j5pV');
    console.error('   npx ts-node -r tsconfig-paths/register src/scripts/get-first-token-buyers.ts 5ACzG28LjHwRTu5jGeCzR4M92zMRxN3c9jKfg5tQpump 200 3000 bonding-curve 7c6W1BDorJSRcf1iLQYvJEynnwjpyVED6KUfaZ64j5pV --analyze-pnl');
    process.exit(1);
  }

  // Parse positional arguments
  const positionalArgs = args.filter(arg => !arg.startsWith('--'));
  const flagArgs = args.filter(arg => arg.startsWith('--'));

  const mintAddress = positionalArgs[0];
  const maxBuyers = positionalArgs[1] ? parseInt(positionalArgs[1]) : 200;
  const maxSignatures = positionalArgs[2] ? parseInt(positionalArgs[2]) : 3000;
  const addressType = positionalArgs[3] as 'mint' | 'bonding-curve' | 'auto' || 'bonding-curve'; // Default to bonding-curve
  const bondingCurveAddress = positionalArgs[4];

  // Parse flags
  const analyzePnl = flagArgs.includes('--analyze-pnl');
  const topCountFlag = flagArgs.find(arg => arg.startsWith('--top-count='));
  const topCount = topCountFlag ? parseInt(topCountFlag.split('=')[1]) : 50;

  if (!process.env.HELIUS_API_KEY) {
    console.error('HELIUS_API_KEY environment variable is required');
    process.exit(1);
  }

  logger.info(`Starting ${analyzePnl ? 'top traders' : 'first buyers'} analysis for token: ${mintAddress}`);
  logger.info(`Parameters: maxBuyers=${maxBuyers}, maxSignatures=${maxSignatures}, addressType=${addressType}`);
  if (bondingCurveAddress) {
    logger.info(`Bonding curve address: ${bondingCurveAddress}`);
  }
  if (analyzePnl) {
    logger.info(`PnL analysis enabled, top ${topCount} traders will be ranked`);
  }

  try {
    // Initialize services
    const databaseService = new DatabaseService();
    const heliusClient = new HeliusApiClient({
      apiKey: process.env.HELIUS_API_KEY,
      network: 'mainnet',
      requestsPerSecond: 20
    }, databaseService);

    const tokenBuyersService = new TokenFirstBuyersService(heliusClient, databaseService);

    // Generate output directory and paths
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const addressTypeSuffix = addressType === 'bonding-curve' ? '_bonding_curve' : addressType === 'mint' ? '_mint' : '_auto';
    const outputDir = path.join(process.cwd(), 'analysis_reports');

    const startTime = Date.now();

    if (analyzePnl) {
      // Run top traders analysis with PnL ranking
      const result = await tokenBuyersService.getTopTradersAndSave(
        mintAddress,
        outputDir,
        {
          maxBuyers,
          maxSignatures,
          batchSize: 100,
          addressType,
          bondingCurveAddress
        },
        topCount
      );

      const duration = (Date.now() - startTime) / 1000;

      // Display results
      console.log('\n' + '='.repeat(80));
      console.log(`TOP TRADERS ANALYSIS COMPLETE`);
      console.log('='.repeat(80));
      console.log(`Token Mint: ${mintAddress}`);
      console.log(`Address Type: ${addressType}${bondingCurveAddress ? ` (${bondingCurveAddress})` : ''}`);
      console.log(`Total First Buyers: ${result.walletAddresses.length}`);
      console.log(`Top Traders Analyzed: ${result.topTraders.length}`);
      console.log(`Successful PnL Analyses: ${result.summary.successfulAnalyses}`);
      console.log(`Failed PnL Analyses: ${result.summary.failedAnalyses}`);
      console.log(`Average PnL: ${result.summary.averagePnl.toFixed(4)} SOL`);
      console.log(`Total Volume: ${result.summary.totalVolume.toFixed(4)} SOL`);
      console.log(`Processing Time: ${duration.toFixed(2)} seconds`);
      console.log('='.repeat(80));

      if (result.topTraders.length > 0) {
        console.log('\n📋 SIMPLE WALLET LIST (copy-paste ready):');
        console.log('-'.repeat(80));
        console.log(result.walletAddresses.join(' '));
        console.log('-'.repeat(80));

        console.log('\n🏆 TOP PERFORMING TRADERS:');
        console.log('-'.repeat(80));
        console.log('Rank | Wallet Address                                     | Net PnL    | Win Rate | Volume     | First Buy Date');
        console.log('-'.repeat(80));
        
        result.topTraders.slice(0, 20).forEach((trader) => {
          const date = new Date(trader.firstBuyTimestamp * 1000);
          const rank = trader.rank.toString().padStart(2, ' ');
          const pnl = trader.netPnl.toFixed(3).padStart(8, ' ');
          const winRate = trader.tokenWinRate.toFixed(1).padStart(5, ' ');
          const volume = trader.totalVolume.toFixed(2).padStart(8, ' ');
          const shortDate = date.toISOString().split('T')[0];
          console.log(`${rank}   | ${trader.walletAddress} | ${pnl} SOL | ${winRate}%   | ${volume} SOL | ${shortDate}`);
        });

        if (result.topTraders.length > 20) {
          console.log(`... and ${result.topTraders.length - 20} more top traders (see full report)`);
        }
      }

    } else {
      // Run basic first buyers analysis (original functionality)
      const outputPath = path.join(outputDir, `first_buyers_${mintAddress}${addressTypeSuffix}_${timestamp}.json`);
      
      const firstBuyers = await tokenBuyersService.getFirstBuyersAndSave(
        mintAddress,
        outputPath,
        {
          maxBuyers,
          maxSignatures,
          batchSize: 100,
          addressType,
          bondingCurveAddress
        }
      );

      const duration = (Date.now() - startTime) / 1000;

      // Display results
      console.log('\n' + '='.repeat(80));
      console.log(`FIRST BUYERS ANALYSIS COMPLETE`);
      console.log('='.repeat(80));
      console.log(`Token Mint: ${mintAddress}`);
      console.log(`Address Type: ${addressType}${bondingCurveAddress ? ` (${bondingCurveAddress})` : ''}`);
      console.log(`Total First Buyers Found: ${firstBuyers.length}`);
      console.log(`Processing Time: ${duration.toFixed(2)} seconds`);
      console.log(`Results saved to: ${outputPath}`);
      console.log('='.repeat(80));

      if (firstBuyers.length > 0) {
        console.log('\n📋 WALLET ADDRESSES (copy-paste ready):');
        console.log('-'.repeat(80));
        const addresses = firstBuyers.map(buyer => buyer.walletAddress);
        console.log(addresses.join(' '));
        console.log('-'.repeat(80));

        console.log('\nFirst 10 buyers:');
        console.log('-'.repeat(80));
        
        firstBuyers.slice(0, 10).forEach((buyer, index) => {
          const date = new Date(buyer.firstBuyTimestamp * 1000);
          const rank = (index + 1).toString().padStart(2, ' ');
          console.log(`${rank}. ${buyer.walletAddress} | ${date.toISOString()} | ${buyer.tokenAmount.toLocaleString()} tokens`);
        });

        if (firstBuyers.length > 10) {
          console.log(`... and ${firstBuyers.length - 10} more buyers`);
        }
      }
    }

    console.log('\n✅ Analysis completed successfully!');

  } catch (error) {
    logger.error('Error during analysis:', error);
    console.error('\n❌ Analysis failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}