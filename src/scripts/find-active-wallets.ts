#!/usr/bin/env node
/**
 * Find Active Trader Wallets - Proper Chain
 *
 * Flow:
 * 1. Get trending tokens from DexScreener
 * 2. For each token: getTokenLargestAccounts (returns TOKEN ACCOUNTS)
 * 3. Resolve token accounts → owner wallets
 * 4. For each owner: getTokenAccountsByOwnerV2 (count token accounts)
 * 5. Filter: Keep owners with 500+ token accounts (active traders)
 * 6. Output: List of owner wallet addresses ready for analysis
 *
 * Usage:
 * npx ts-node -r tsconfig-paths/register src/scripts/find-active-wallets.ts --targetWallets 20 --minTokenAccounts 100
 */

import axios from 'axios';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { HeliusApiClient } from '../core/services/helius-api-client';
import { DatabaseService } from '../core/services/database-service';
import { createLogger } from '../core/utils/logger';

dotenv.config();

const logger = createLogger('FindActiveWallets');

interface OwnerWalletInfo {
  address: string;
  tokenAccountCount: number;
  foundViaToken: string;
}

/**
 * Get trending tokens from DexScreener
 */
async function getTrendingTokens(limit: number = 20): Promise<string[]> {
  try {
    logger.info('📈 Fetching trending tokens from DexScreener...');

    const response = await axios.get('https://api.dexscreener.com/token-profiles/latest/v1');
    const profiles = response.data;

    const solanaTokens = profiles
      .filter((p: any) => p.chainId === 'solana')
      .slice(0, limit)
      .map((p: any) => p.tokenAddress);

    logger.info(`✅ Found ${solanaTokens.length} trending Solana tokens`);
    return solanaTokens;

  } catch (error) {
    logger.error('❌ Error fetching trending tokens:', error);
    return [];
  }
}

/**
 * Check if an account is likely a program (not a real user wallet)
 */
function isProgramAccount(owner: string, tokenAccountCount: number): boolean {
  // Known program prefixes
  const programPrefixes = [
    '11111111111111111111111111111111', // System program
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token program
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium
    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Whirlpool
    'JUP', // Jupiter
    'CLMM', // CLMM pools
  ];

  // Check known prefixes
  if (programPrefixes.some(prefix => owner.startsWith(prefix))) {
    return true;
  }

  // Programs often have exactly 5000 token accounts (the max returned)
  if (tokenAccountCount === 5000) {
    return true;
  }

  return false;
}

/**
 * Get owner wallets from a token's largest holders
 */
async function getOwnerWalletsFromToken(
  tokenMint: string,
  heliusClient: HeliusApiClient,
  minTokenAccounts: number,
  maxTokenAccounts: number = 4000
): Promise<OwnerWalletInfo[]> {
  try {
    logger.info(`\n🔍 Processing token: ${tokenMint.substring(0, 8)}...`);

    // Step 1: Get largest token accounts (skip top 5 - likely pools/programs)
    logger.debug('  Step 1: Fetching token accounts (skipping top 5)...');
    const result = await heliusClient.getTokenLargestAccounts(tokenMint);
    const tokenAccounts = result.value.slice(5, 55); // Skip top 5, get next 50

    logger.info(`  Found ${tokenAccounts.length} large token accounts`);

    // Step 2: Resolve to owner wallets (using getMultipleAccounts)
    logger.debug('  Step 2: Resolving token accounts to owners...');
    const ownerSet = new Set<string>();

    // Process in batches for getMultipleAccounts
    const batchSize = 100;
    for (let i = 0; i < tokenAccounts.length; i += batchSize) {
      const batch = tokenAccounts.slice(i, i + batchSize);
      const accountAddresses = batch.map(acc => acc.address);

      try {
        const result = await heliusClient.getMultipleAccounts(accountAddresses, undefined, 'jsonParsed');

        result.value.forEach((accountInfo) => {
          if (accountInfo && typeof accountInfo.data === 'object' && !Array.isArray(accountInfo.data)) {
            const parsed = accountInfo.data as any;
            if (parsed?.parsed?.info?.owner) {
              ownerSet.add(parsed.parsed.info.owner);
            }
          }
        });
      } catch (error) {
        logger.debug(`  Could not fetch batch ${i / batchSize + 1}`);
      }

      await new Promise(resolve => setTimeout(resolve, 200)); // Rate limit
    }

    logger.info(`  Resolved to ${ownerSet.size} unique owner wallets`);

    // Step 3: Filter by token account count
    logger.debug(`  Step 3: Filtering owners with ≥${minTokenAccounts} token accounts...`);
    const activeOwners: OwnerWalletInfo[] = [];

    let checked = 0;
    for (const owner of Array.from(ownerSet)) {
      checked++;
      process.stdout.write(`\r  Checking owners: ${checked}/${ownerSet.size}`);

      try {
        const tokenAccountsResult = await heliusClient.getTokenAccountsByOwner(owner);
        const count = tokenAccountsResult.value.length;

        // Filter: must be within range and not a program
        if (count >= minTokenAccounts && count <= maxTokenAccounts && !isProgramAccount(owner, count)) {
          activeOwners.push({
            address: owner,
            tokenAccountCount: count,
            foundViaToken: tokenMint,
          });
          console.log(`\n  ✓ Real trader: ${owner.substring(0, 8)} (${count} token accounts)`);
        } else if (isProgramAccount(owner, count)) {
          logger.debug(`  ⊘ Filtered out program: ${owner.substring(0, 8)} (${count} accounts)`);
        }
      } catch (error) {
        // Skip wallets we can't check
      }

      await new Promise(resolve => setTimeout(resolve, 150)); // Rate limit
    }

    console.log(''); // New line after progress
    logger.info(`  ✅ Found ${activeOwners.length} active traders from this token\n`);
    return activeOwners;

  } catch (error) {
    logger.error(`❌ Error processing token ${tokenMint}:`, error);
    return [];
  }
}

/**
 * Main execution
 */
async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option('targetWallets', {
      alias: 'n',
      type: 'number',
      default: 20,
      description: 'Number of active wallets to find',
    })
    .option('minTokenAccounts', {
      alias: 'm',
      type: 'number',
      default: 100,
      description: 'Minimum token accounts to qualify as active trader',
    })
    .option('maxTokenAccounts', {
      alias: 'x',
      type: 'number',
      default: 4000,
      description: 'Maximum token accounts (filter out programs)',
    })
    .option('trendingTokens', {
      alias: 't',
      type: 'number',
      default: 10,
      description: 'Number of trending tokens to check',
    })
    .option('outputFile', {
      alias: 'o',
      type: 'string',
      default: 'active-wallets.json',
      description: 'Output file for wallet list',
    })
    .parseAsync();

  const { targetWallets, minTokenAccounts, maxTokenAccounts, trendingTokens, outputFile } = argv;

  console.log('\n' + '='.repeat(80));
  console.log('FIND ACTIVE TRADER WALLETS');
  console.log('='.repeat(80));
  console.log(`\n📋 Configuration:`);
  console.log(`  Target wallets: ${targetWallets}`);
  console.log(`  Token accounts range: ${minTokenAccounts} - ${maxTokenAccounts}`);
  console.log(`  Trending tokens to check: ${trendingTokens}`);
  console.log(`  Output file: ${outputFile}\n`);

  // Setup
  const heliusApiKey = process.env.HELIUS_API_KEY;
  if (!heliusApiKey) {
    console.error('❌ HELIUS_API_KEY not set in .env');
    process.exit(1);
  }

  const dbService = new DatabaseService();
  const heliusClient = new HeliusApiClient(
    { apiKey: heliusApiKey, network: 'mainnet' },
    dbService
  );

  // Step 1: Get trending tokens
  const tokens = await getTrendingTokens(trendingTokens);

  if (tokens.length === 0) {
    console.error('❌ No trending tokens found');
    process.exit(1);
  }

  // Step 2-5: Process each token to find active wallets
  const allActiveWallets = new Map<string, OwnerWalletInfo>();

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    console.log(`\n[${ i + 1}/${tokens.length}] Processing token: ${token.substring(0, 8)}...${token.substring(token.length - 4)}`);

    const owners = await getOwnerWalletsFromToken(token, heliusClient, minTokenAccounts, maxTokenAccounts);

    // Add to map (deduplicate across tokens)
    owners.forEach(owner => {
      if (!allActiveWallets.has(owner.address)) {
        allActiveWallets.set(owner.address, owner);
      }
    });

    console.log(`📊 Total unique active wallets found so far: ${allActiveWallets.size}`);

    // Stop if we found enough
    if (allActiveWallets.size >= targetWallets) {
      console.log(`\n🎯 Target reached! Found ${targetWallets}+ active wallets.\n`);
      break;
    }

    // Rate limit between tokens
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Step 6: Output results
  const activeWalletsList = Array.from(allActiveWallets.values());

  console.log('\n' + '='.repeat(80));
  console.log('RESULTS');
  console.log('='.repeat(80) + '\n');

  if (activeWalletsList.length === 0) {
    console.log('❌ No active wallets found');
    console.log('\n💡 Try:');
    console.log('  --minTokenAccounts 50   (lower threshold)');
    console.log('  --trendingTokens 20     (check more tokens)');
    return;
  }

  console.log(`✅ Found ${activeWalletsList.length} active trader wallets:\n`);

  // Sort by token account count
  activeWalletsList.sort((a, b) => b.tokenAccountCount - a.tokenAccountCount);

  // Display top 20
  console.log('Top wallets by token account count:');
  activeWalletsList.slice(0, 20).forEach((w, idx) => {
    console.log(`  ${idx + 1}. ${w.address} (${w.tokenAccountCount} token accounts)`);
  });

  if (activeWalletsList.length > 20) {
    console.log(`  ... and ${activeWalletsList.length - 20} more`);
  }

  // Stats
  const avgTokenAccounts = activeWalletsList.reduce((sum, w) => sum + w.tokenAccountCount, 0) / activeWalletsList.length;
  const maxTokenAccountsFound = Math.max(...activeWalletsList.map(w => w.tokenAccountCount));
  const minTokenAccountsFound = Math.min(...activeWalletsList.map(w => w.tokenAccountCount));

  console.log(`\n📊 Statistics:`);
  console.log(`  Total wallets: ${activeWalletsList.length}`);
  console.log(`  Avg token accounts: ${avgTokenAccounts.toFixed(0)}`);
  console.log(`  Range: ${minTokenAccountsFound} - ${maxTokenAccountsFound} token accounts`);

  // Save to file
  const output = {
    generatedAt: new Date().toISOString(),
    config: { targetWallets, minTokenAccounts, trendingTokens },
    summary: {
      totalWallets: activeWalletsList.length,
      avgTokenAccounts: Math.round(avgTokenAccounts),
      maxTokenAccounts: maxTokenAccountsFound,
      minTokenAccounts: minTokenAccountsFound,
    },
    wallets: activeWalletsList,
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`\n💾 Saved to: ${outputFile}`);

  // Save address list
  const addressFile = outputFile.replace('.json', '-addresses.txt');
  fs.writeFileSync(addressFile, activeWalletsList.map(w => w.address).join('\n'));
  console.log(`💾 Address list: ${addressFile}`);

  console.log('\n💡 Next steps:');
  console.log('  1. Use these wallets with batch-validate-holder-risk.ts');
  console.log('  2. Or run hunt-test-wallets.ts with --walletsFile flag\n');
}

main().catch(console.error);
