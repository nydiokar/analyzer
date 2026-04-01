#!/usr/bin/env node
/**
 * Debug script: interrogate avgEntryMcap for a wallet
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/debug-wallet-mcap.ts \
 *     --wallet Gu7JugMP1FZHdFmKDveCHxsJXwXGe4P1pYeRz47nq1V7
 */
import * as dotenv from 'dotenv';
dotenv.config();

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { PrismaClient } from '@prisma/client';
import { classifyMcap, MCAP_BUCKETS } from '../core/services/market-context-standalone';

const prisma = new PrismaClient();

function fmt(n: number | null | undefined): string {
  if (n == null) return 'NULL';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtSol(n: number | null | undefined): string {
  if (n == null) return 'NULL';
  return `${n.toFixed(4)} SOL`;
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option('wallet', { type: 'string', demandOption: true, description: 'Wallet address' })
    .argv;

  const wallet = argv.wallet;
  console.log(`\n${'='.repeat(80)}`);
  console.log(`MCAP DEBUG — wallet: ${wallet}`);
  console.log('='.repeat(80));

  // ── 1. WalletBehaviorProfile ──────────────────────────────────────────────
  const behavior = await prisma.walletBehaviorProfile.findUnique({
    where: { walletAddress: wallet },
    select: {
      avgEntryMcap: true,
      preferredMcapBucket: true,
      mcapDistribution: true,
      mcapBucketPnl: true,
      averageFlipDurationHours: true,
    },
  });

  console.log('\n── WalletBehaviorProfile ──');
  if (!behavior) {
    console.log('  NOT FOUND');
  } else {
    console.log(`  avgEntryMcap:       ${fmt(behavior.avgEntryMcap)}  (bucket stored: ${behavior.preferredMcapBucket})`);
    if (behavior.avgEntryMcap != null) {
      console.log(`  bucket recomputed:  ${classifyMcap(behavior.avgEntryMcap)}`);
    }
    console.log(`  mcapDistribution:   ${JSON.stringify(behavior.mcapDistribution, null, 2)}`);
    console.log(`  mcapBucketPnl:      ${JSON.stringify(behavior.mcapBucketPnl, null, 2)}`);
  }

  // ── 2. AnalysisResult per token ────────────────────────────────────────────
  const results = await prisma.analysisResult.findMany({
    where: { walletAddress: wallet },
    select: {
      tokenAddress: true,
      avgEntryMcap: true,
      avgEntryMcapBucket: true,
      avgExitMcap: true,
      avgExitMcapBucket: true,
      totalSolSpent: true,
      realizedPnlSol: true,
    },
    orderBy: { avgEntryMcap: 'desc' },
  });

  console.log(`\n── AnalysisResult (${results.length} tokens, sorted by avgEntryMcap desc) ──`);
  const withMcap = results.filter(r => r.avgEntryMcap != null);
  const withoutMcap = results.filter(r => r.avgEntryMcap == null);
  console.log(`  Has avgEntryMcap:   ${withMcap.length}`);
  console.log(`  NULL avgEntryMcap:  ${withoutMcap.length}`);

  if (withMcap.length > 0) {
    console.log('\n  Top 15 by avgEntryMcap:');
    console.log(`  ${'Token'.padEnd(46)} ${'AvgEntry'.padStart(12)} ${'Bucket'.padEnd(12)} ${'AvgExit'.padStart(12)} ${'SolSpent'.padStart(10)} ${'PnL'.padStart(10)}`);
    console.log(`  ${'-'.repeat(110)}`);
    for (const r of withMcap.slice(0, 15)) {
      const recomputed = classifyMcap(r.avgEntryMcap!);
      const mismatch = recomputed !== r.avgEntryMcapBucket ? ` ⚠ stored=${r.avgEntryMcapBucket}` : '';
      console.log(
        `  ${r.tokenAddress.padEnd(46)} ${fmt(r.avgEntryMcap).padStart(12)} ${(recomputed + mismatch).padEnd(20)} ${fmt(r.avgExitMcap).padStart(12)} ${fmtSol(r.totalSolSpent).padStart(10)} ${fmtSol(r.realizedPnlSol).padStart(10)}`
      );
    }
  }

  // ── 3. Manual wallet-level weighted average ────────────────────────────────
  // Replicate exactly what behavior-service does: volume-weighted across buy trades
  console.log('\n── Recomputing wallet-level avgEntryMcap from SwapAnalysisInput ──');
  // Replicate the fixed behavior-service query (excluded mints filtered out)
  const EXCLUDED = [
    'So11111111111111111111111111111111111111112',
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
    '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj',
    'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB',
    '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
    'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij',
    '7vfCXTUXX5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
    'BQcdHdAQW1hczDbBi9hiegXAR7A98Q9jx3X3iBBBDiq4',
    '2FPyTwcZLUg1MDrwsyoP4D6s1tM7hAkHYRjkNb5w6Pxk',
    '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E',
  ];

  const buyRows = await prisma.swapAnalysisInput.findMany({
    where: {
      walletAddress: wallet,
      direction: 'in',
      marketCapUsd: { not: null },
      usdValue: { not: null },
      mint: { notIn: EXCLUDED },
    },
    select: {
      mint: true,
      marketCapUsd: true,
      usdValue: true,
      timestamp: true,
    },
    orderBy: { marketCapUsd: 'desc' },
  });

  const totalBuyRows = await prisma.swapAnalysisInput.count({
    where: { walletAddress: wallet, direction: 'in' },
  });
  const nullMcapRows = await prisma.swapAnalysisInput.count({
    where: { walletAddress: wallet, direction: 'in', marketCapUsd: null },
  });

  console.log(`  Total buy rows:     ${totalBuyRows}`);
  console.log(`  With marketCapUsd:  ${buyRows.length}`);
  console.log(`  NULL marketCapUsd:  ${nullMcapRows}`);

  if (buyRows.length > 0) {
    // Check for extreme outliers
    console.log('\n  Top 10 buy rows by marketCapUsd (these dominate the weighted avg):');
    console.log(`  ${'Mint'.padEnd(46)} ${'McapUsd'.padStart(14)} ${'UsdValue'.padStart(12)} ${'Weight%'.padStart(9)} ${'Date'}`);
    console.log(`  ${'-'.repeat(100)}`);

    let totalUsdVolume = 0;
    for (const r of buyRows) totalUsdVolume += r.usdValue!;

    let sumMcapWeighted = 0;
    let sumUsd = 0;
    for (const r of buyRows) {
      sumMcapWeighted += r.marketCapUsd! * r.usdValue!;
      sumUsd += r.usdValue!;
    }
    const recomputedAvg = sumUsd > 0 ? sumMcapWeighted / sumUsd : null;

    for (const r of buyRows.slice(0, 10)) {
      const weightPct = totalUsdVolume > 0 ? ((r.usdValue! / totalUsdVolume) * 100).toFixed(1) : '?';
      const date = new Date(r.timestamp * 1000).toISOString().split('T')[0];
      console.log(
        `  ${r.mint.padEnd(46)} ${fmt(r.marketCapUsd).padStart(14)} ${('$' + r.usdValue!.toFixed(2)).padStart(12)} ${(weightPct + '%').padStart(9)} ${date}`
      );
    }

    console.log(`\n  Total USD buy volume: $${totalUsdVolume.toFixed(2)}`);
    console.log(`  Recomputed avgEntryMcap: ${fmt(recomputedAvg)}`);
    console.log(`  Recomputed bucket:       ${recomputedAvg != null ? classifyMcap(recomputedAvg) : 'N/A'}`);
    console.log(`  Stored avgEntryMcap:     ${fmt(behavior?.avgEntryMcap)}`);

    if (recomputedAvg != null && behavior?.avgEntryMcap != null) {
      const ratio = recomputedAvg / behavior.avgEntryMcap;
      if (ratio > 1.01 || ratio < 0.99) {
        console.log(`  ⚠ MISMATCH: stored vs recomputed ratio = ${ratio.toFixed(4)}`);
      } else {
        console.log(`  ✓ stored matches recomputed`);
      }
    }

    // ── 4. Bucket distribution of buy volume ──────────────────────────────
    console.log('\n── Buy volume distribution by mcap bucket ──');
    const bucketVolume = new Map<string, { usd: number; txCount: number }>();
    for (const r of buyRows) {
      const bucket = classifyMcap(r.marketCapUsd!);
      const existing = bucketVolume.get(bucket) ?? { usd: 0, txCount: 0 };
      existing.usd += r.usdValue!;
      existing.txCount++;
      bucketVolume.set(bucket, existing);
    }

    console.log(`  ${'Bucket'.padEnd(14)} ${'USD Volume'.padStart(14)} ${'% of Total'.padStart(12)} ${'Tx Count'.padStart(10)}`);
    console.log(`  ${'-'.repeat(55)}`);
    // Sort by bucket order
    for (const b of MCAP_BUCKETS) {
      const entry = bucketVolume.get(b.label);
      if (!entry) continue;
      const pct = totalUsdVolume > 0 ? ((entry.usd / totalUsdVolume) * 100).toFixed(1) : '0';
      console.log(`  ${b.label.padEnd(14)} ${'$' + entry.usd.toFixed(2).padStart(13)} ${(pct + '%').padStart(12)} ${entry.txCount.toString().padStart(10)}`);
    }

    // ── 5. Spot the outlier tokens ─────────────────────────────────────────
    console.log('\n── Tokens where any buy had mcap > $1M (potential outliers) ──');
    const bigMcapMints = new Set(buyRows.filter(r => r.marketCapUsd! > 1_000_000).map(r => r.mint));
    if (bigMcapMints.size === 0) {
      console.log('  None');
    } else {
      for (const mint of bigMcapMints) {
        const tokenRows = buyRows.filter(r => r.mint === mint);
        const maxMcap = Math.max(...tokenRows.map(r => r.marketCapUsd!));
        const totalUsd = tokenRows.reduce((s, r) => s + r.usdValue!, 0);
        console.log(`  ${mint}  maxMcap=${fmt(maxMcap)}  buyVol=$${totalUsd.toFixed(2)}  txs=${tokenRows.length}`);
      }
    }
  }

  console.log('\n' + '='.repeat(80) + '\n');
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
