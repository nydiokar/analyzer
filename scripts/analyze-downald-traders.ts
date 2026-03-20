/**
 * Downald Twump Top Traders — Ingestion + Analysis
 *
 * 1. Queue all wallets for deep analysis (via BullMQ, same as god-mode-import-favorites)
 * 2. Poll POST /wallets/hud/batch until wallets have data
 * 3. Fetch final HUDs from the API
 * 4. Enrich with DB signals (AnalysisResult + AdvancedTradeStats)
 * 5. Cluster + write compact signal cards
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/analyze-downald-traders.ts
 *   npx ts-node -r tsconfig-paths/register scripts/analyze-downald-traders.ts --skip-ingest
 *   npx ts-node -r tsconfig-paths/register scripts/analyze-downald-traders.ts --sigs 1000
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Redis } from 'ioredis';

dotenv.config();

import { AnalysisOperationsQueue } from '../src/queues/queues/analysis-operations.queue';
import { JobPriority } from '../src/queues/config/queue.config';
import type { DashboardWalletAnalysisJobData } from '../src/queues/jobs/types';
import { getErrorMessage } from '../src/core/utils/error-utils';
import { prisma } from '../src/core/services/database-service';
import axios from 'axios';

// ─── Config ───────────────────────────────────────────────────────────────────

const INPUT_FILE  = path.resolve(__dirname, '../analyses/Downald.txt');
const OUT_RAW     = path.resolve(__dirname, '../analyses/downald-raw-huds.json');
const OUT_CLUSTER = path.resolve(__dirname, '../analyses/downald-analysis.json');

const TOKEN_MINT = 'EiqNgtwFzHqTEa3UV57s2x4svjJF59URgBqnG3sCpump';

const API_BASE         = process.env.API_BASE_URL || 'http://localhost:3001/api/v1';
const TARGET_SIGS      = 1500;
const BATCH_SIZE       = 10;
const BATCH_DELAY_MS   = 3000;
const POLL_INTERVAL_MS = 20000;
const POLL_TIMEOUT_MS  = 45 * 60 * 1000; // 45 min

// ─── Args ─────────────────────────────────────────────────────────────────────

const args       = process.argv.slice(2);
const SKIP_INGEST = args.includes('--skip-ingest');
const sigsIdx    = args.indexOf('--sigs');
const targetSigs = sigsIdx !== -1 ? parseInt(args[sigsIdx + 1], 10) : TARGET_SIGS;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function loadWallets(): string[] {
  return fs.readFileSync(INPUT_FILE, 'utf-8').trim().split(/\s+/).filter(Boolean);
}

// ─── Phase 1: Queue ingestion ─────────────────────────────────────────────────

async function ingest(wallets: string[], queue: AnalysisOperationsQueue) {
  console.log(`\nQueueing ${wallets.length} wallets (deep, ${targetSigs} sigs)...`);
  const requestId = `downald-${Date.now()}`;

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const total    = Math.ceil(wallets.length / BATCH_SIZE);

    await Promise.all(batch.map(walletAddress => {
      const jobData: DashboardWalletAnalysisJobData = {
        walletAddress,
        requestId,
        analysisScope: 'deep',
        triggerSource: 'system',
        targetSignatureCount: targetSigs,
        forceRefresh: true,
        queueWorkingAfter: false,
        queueDeepAfter: false,
      };
      return queue.addDashboardWalletAnalysisJob(jobData, { priority: JobPriority.HIGH, delay: 0 });
    }));

    console.log(`  Batch ${batchNum}/${total} queued`);
    if (i + BATCH_SIZE < wallets.length) await sleep(BATCH_DELAY_MS);
  }

  console.log(`  Done. Request ID: ${requestId}`);
}

// ─── Phase 2+3: Poll API until data is ready, then return final HUDs ──────────

type HudData = Record<string, any>;

async function pollAndFetch(wallets: string[]): Promise<Record<string, HudData | null>> {
  console.log(`\nPolling ${API_BASE}/wallets/hud/batch every ${POLL_INTERVAL_MS / 1000}s...`);
  console.log('(Ctrl+C to stop waiting and use whatever is ready)\n');

  const start = Date.now();

  while (true) {
    const { data: body } = await axios.post<{ huds: Record<string, any>; notFound: string[] }>(
      `${API_BASE}/wallets/hud/batch`,
      { walletAddresses: wallets },
    );
    const found = Object.keys(body.huds).length;
    const pct   = Math.round((found / wallets.length) * 100);

    process.stdout.write(`\r  ${found}/${wallets.length} ready (${pct}%)   `);

    if (found >= wallets.length || Date.now() - start > POLL_TIMEOUT_MS) {
      console.log(found >= wallets.length ? '\n  All ready.' : `\n  Timeout — proceeding with ${found}/${wallets.length}.`);

      const result: Record<string, HudData | null> = {};
      for (const addr of wallets) result[addr] = body.huds[addr] ?? null;
      return result;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

// ─── Phase 4: Enrich from DB ──────────────────────────────────────────────────

interface TokenTrade {
  realizedPnlSol:        number | null;
  totalSolSpent:         number;
  totalSolReceived:      number;
  firstTransferTimestamp: number | null;
  lastTransferTimestamp:  number | null;
}

interface AdvancedSignals {
  weightedEfficiencyScore:   number | null; // capital efficiency, weighted by trade size
  profitConsistencyIndex:    number | null; // low variance = systematic, high variance = lucky
  averagePnlPerDayActive:    number | null; // normalized productivity per active day
  walletFirstSeenTimestamp:  number | null; // from advancedStats.firstTransactionTimestamp
}

async function fetchDbSignals(wallets: string[]): Promise<{
  tokenTrades: Record<string, TokenTrade>;
  advanced:    Record<string, AdvancedSignals>;
}> {
  console.log('\nFetching DB signals (AnalysisResult + AdvancedTradeStats)...');

  const [tokenResults, pnlSummaries] = await Promise.all([
    prisma.analysisResult.findMany({
      where: { tokenAddress: TOKEN_MINT, walletAddress: { in: wallets } },
      select: {
        walletAddress:          true,
        realizedPnlSol:         true,
        totalSolSpent:          true,
        totalSolReceived:       true,
        firstTransferTimestamp: true,
        lastTransferTimestamp:  true,
      },
    }),
    prisma.walletPnlSummary.findMany({
      where: { walletAddress: { in: wallets } },
      select: {
        walletAddress: true,
        advancedStats: {
          select: {
            weightedEfficiencyScore:   true,
            profitConsistencyIndex:    true,
            averagePnlPerDayActiveApprox: true,
            firstTransactionTimestamp: true,
          },
        },
      },
    }),
  ]);

  const tokenTrades: Record<string, TokenTrade> = {};
  for (const r of tokenResults) {
    tokenTrades[r.walletAddress] = {
      realizedPnlSol:         r.realizedPnlSol,
      totalSolSpent:          r.totalSolSpent,
      totalSolReceived:       r.totalSolReceived,
      firstTransferTimestamp: r.firstTransferTimestamp,
      lastTransferTimestamp:  r.lastTransferTimestamp,
    };
  }

  const advanced: Record<string, AdvancedSignals> = {};
  for (const s of pnlSummaries) {
    advanced[s.walletAddress] = {
      weightedEfficiencyScore:  s.advancedStats?.weightedEfficiencyScore ?? null,
      profitConsistencyIndex:   s.advancedStats?.profitConsistencyIndex  ?? null,
      averagePnlPerDayActive:   s.advancedStats?.averagePnlPerDayActiveApprox ?? null,
      walletFirstSeenTimestamp: s.advancedStats?.firstTransactionTimestamp ?? null,
    };
  }

  console.log(`  Token trades found: ${tokenResults.length}/${wallets.length}`);
  console.log(`  Advanced stats found: ${pnlSummaries.length}/${wallets.length}`);

  return { tokenTrades, advanced };
}

// ─── Phase 5: Build compact signal cards (no classification — let the analyst decide) ───

function holdStyle(hud: HudData): string {
  const h = hud.medianHoldTimeHours;
  if (h != null) {
    if (h < 0.083) return 'sniper';
    if (h < 0.5)   return 'scalper';
    if (h < 4)     return 'momentum';
    if (h < 168)   return 'swing';
    return 'hodler';
  }
  const map: Record<string, string> = { S:'sniper', R:'scalper', M:'momentum', I:'momentum', D:'swing', W:'swing', P:'hodler', H:'hodler' };
  return map[hud.behaviorCode] ?? 'unknown';
}

function buildOutput(
  wallets:     string[],
  huds:        Record<string, HudData | null>,
  tokenTrades: Record<string, TokenTrade>,
  advanced:    Record<string, AdvancedSignals>,
) {
  // Compute entry timing rank across wallets that have token data: 0=first buyer, 1=last buyer
  const withTokenEntry = wallets
    .filter(a => tokenTrades[a]?.firstTransferTimestamp != null)
    .sort((a, b) => tokenTrades[a].firstTransferTimestamp! - tokenTrades[b].firstTransferTimestamp!);

  const entryRankMap: Record<string, number> = {};
  withTokenEntry.forEach((addr, idx) => {
    entryRankMap[addr] = withTokenEntry.length > 1 ? idx / (withTokenEntry.length - 1) : 0;
  });

  const cards = wallets
    .filter(a => huds[a])
    .map(a => {
      const hud   = huds[a]!;
      const token = tokenTrades[a];
      const adv   = advanced[a];
      const rank  = entryRankMap[a] ?? null;

      const tokenPnl = token?.realizedPnlSol ?? null;
      const tokenROI = (token && token.totalSolSpent > 0 && tokenPnl != null)
        ? parseFloat((tokenPnl / token.totalSolSpent).toFixed(3))
        : null;

      const firstSeenTs   = adv?.walletFirstSeenTimestamp ?? null;
      const walletAgeDays = firstSeenTs
        ? parseFloat(((Date.now() / 1000 - firstSeenTs) / 86400).toFixed(1))
        : null;

      return {
        address: a,

        // ── Structural profile (overall history) ──────────────────────────
        tier:             hud.dataQualityTier,           // data confidence: GOLD/SILVER/BRONZE/INSUFFICIENT
        isBot:            hud.isBot ?? false,
        behaviorCategory: hud.behaviorCategory ?? hud.behaviorCode ?? null,
        holdStyle:        holdStyle(hud),
        winRate:          hud.winRate        != null ? parseFloat(hud.winRate.toFixed(3))        : null, // overall token win rate
        trimmedMeanPnl:   hud.trimmedMeanPnl != null ? parseFloat(hud.trimmedMeanPnl.toFixed(3)) : null, // avg PnL per token, outliers trimmed
        avgTradesPerDay:  hud.avgTradesPerDay != null ? parseFloat(hud.avgTradesPerDay.toFixed(1)) : null,
        walletAgeDays,                                   // null if unknown

        // ── Edge quality (how structural the edge is across all trades) ────
        // efficiency: capital deployment precision (high = intentional sizing, low = random/reckless)
        efficiency:  adv?.weightedEfficiencyScore != null ? parseFloat(adv.weightedEfficiencyScore.toFixed(3)) : null,
        // consistency: PnL repeatability across tokens (high = systematic, low = lucky/variance)
        consistency: adv?.profitConsistencyIndex  != null ? parseFloat(adv.profitConsistencyIndex.toFixed(3))  : null,
        // pnlPerDay: average profit per active trading day
        pnlPerDay:   adv?.averagePnlPerDayActive  != null ? parseFloat(adv.averagePnlPerDayActive.toFixed(3))  : null,

        // ── Token-specific: what this wallet did on Downald ────────────────
        token: token ? {
          realizedPnlSol:   tokenPnl != null ? parseFloat(tokenPnl.toFixed(3)) : null,
          totalSolSpent:    parseFloat(token.totalSolSpent.toFixed(3)),
          totalSolReceived: parseFloat(token.totalSolReceived.toFixed(3)),
          tokenROI,          // realizedPnl / totalSolSpent (null if no spend)
          entryRank:         rank != null ? parseFloat(rank.toFixed(3)) : null, // 0=earliest, 1=latest among this group
          firstEntryTs:      token.firstTransferTimestamp,
          lastExitTs:        token.lastTransferTimestamp,
        } : null,
      };
    });

  const withoutData = wallets.filter(a => !huds[a]);

  // Aggregates — for the analyst to understand the group
  const n   = cards.length || 1;
  const avg = (fn: (w: typeof cards[0]) => number | null) => {
    const vals = cards.map(fn).filter((v): v is number => v != null);
    return vals.length ? parseFloat((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(3)) : null;
  };
  const pct = (fn: (w: typeof cards[0]) => boolean) =>
    Math.round((cards.filter(fn).length / n) * 100);
  const breakdown = (fn: (w: typeof cards[0]) => string | null) =>
    cards.reduce((acc, w) => { const k = fn(w) ?? '?'; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {} as Record<string, number>);

  // Sorted views for quick analyst reference
  const sortedByTokenPnl  = [...cards].filter(w => w.token?.realizedPnlSol != null).sort((a, b) => b.token!.realizedPnlSol! - a.token!.realizedPnlSol!);
  const sortedByEntryTime = [...cards].filter(w => w.token?.firstEntryTs != null).sort((a, b) => a.token!.firstEntryTs! - b.token!.firstEntryTs!);
  const sortedByTokenROI  = [...cards].filter(w => w.token?.tokenROI != null).sort((a, b) => b.token!.tokenROI! - a.token!.tokenROI!);

  return {
    token: 'Downald Twump',
    tokenMint: TOKEN_MINT,
    generatedAt: new Date().toISOString(),
    totalWallets: wallets.length,
    withData: cards.length,
    withoutData: withoutData.length,

    // All wallet signal cards — no cluster assigned, analyst reads the signals
    wallets: cards,

    // Sorted reference views
    views: {
      // Who made the most on this token
      topTokenPnl: sortedByTokenPnl.slice(0, 10).map(w => ({
        address: w.address, tier: w.tier, isBot: w.isBot,
        tokenPnlSol: w.token!.realizedPnlSol, tokenROI: w.token!.tokenROI,
        entryRank: w.token!.entryRank, walletAgeDays: w.walletAgeDays,
        winRate: w.winRate, efficiency: w.efficiency, consistency: w.consistency,
      })),
      // Who got in earliest
      earliestEntries: sortedByEntryTime.slice(0, 10).map(w => ({
        address: w.address, tier: w.tier,
        entryRank: w.token!.entryRank, firstEntryTs: w.token!.firstEntryTs,
        tokenPnlSol: w.token!.realizedPnlSol, tokenROI: w.token!.tokenROI,
        walletAgeDays: w.walletAgeDays, behaviorCategory: w.behaviorCategory,
      })),
      // Best ROI (capital efficiency on this token)
      topTokenROI: sortedByTokenROI.slice(0, 10).map(w => ({
        address: w.address, tier: w.tier,
        tokenROI: w.token!.tokenROI, tokenPnlSol: w.token!.realizedPnlSol,
        totalSolSpent: w.token!.totalSolSpent, entryRank: w.token!.entryRank,
        walletAgeDays: w.walletAgeDays, consistency: w.consistency,
      })),
      // Bots
      bots: cards.filter(w => w.isBot).map(w => ({
        address: w.address, avgTradesPerDay: w.avgTradesPerDay,
        tokenPnl: w.token?.realizedPnlSol,
      })),
    },

    aggregates: {
      avgWinRate:         avg(w => w.winRate),
      avgEfficiency:      avg(w => w.efficiency),
      avgConsistency:     avg(w => w.consistency),
      avgPnlPerDay:       avg(w => w.pnlPerDay),
      avgTokenPnlSol:     avg(w => w.token?.realizedPnlSol ?? null),
      avgTokenROI:        avg(w => w.token?.tokenROI ?? null),
      pctBots:            pct(w => w.isBot),
      pctTokenProfitable: pct(w => (w.token?.realizedPnlSol ?? 0) > 0),
      pctHighWinRate:     pct(w => (w.winRate ?? 0) >= 0.5),
      pctEarlyEntry:      pct(w => (w.token?.entryRank ?? 1) < 0.33),
      pctNewWallet:       pct(w => w.walletAgeDays != null && w.walletAgeDays < 14),
      holdStyleBreakdown: breakdown(w => w.holdStyle),
      tierBreakdown:      breakdown(w => w.tier ?? null),
      behaviorBreakdown:  breakdown(w => w.behaviorCategory),
    },
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('DOWNALD TWUMP — TOP TRADERS ANALYSIS');
  console.log(`Sigs: ${targetSigs} | Skip ingest: ${SKIP_INGEST} | API: ${API_BASE}`);
  console.log('='.repeat(60));

  const wallets = loadWallets();
  console.log(`\nLoaded ${wallets.length} wallets`);

  const redis = new Redis({
    host:     process.env.REDIS_HOST     || 'localhost',
    port:     parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db:       parseInt(process.env.REDIS_DB   || '0', 10),
  });

  const queue = new AnalysisOperationsQueue(redis);

  try {
    if (!SKIP_INGEST) {
      await ingest(wallets, queue);
    }

    const huds = await pollAndFetch(wallets);

    // Save raw HUDs
    fs.writeFileSync(OUT_RAW, JSON.stringify({ generatedAt: new Date().toISOString(), huds }, null, 2));
    console.log(`\nRaw HUDs -> ${OUT_RAW}`);

    // Fetch DB signals and build enriched analysis
    const { tokenTrades, advanced } = await fetchDbSignals(wallets);
    const analysis = buildOutput(wallets, huds, tokenTrades, advanced);
    fs.writeFileSync(OUT_CLUSTER, JSON.stringify(analysis, null, 2));
    console.log(`Analysis  -> ${OUT_CLUSTER}`);

    // Terminal summary
    const a = analysis.aggregates;
    console.log('\n' + '='.repeat(60));
    console.log(`Wallets with data: ${analysis.withData}/${analysis.totalWallets}`);
    console.log(`Tiers: ${Object.entries(a.tierBreakdown).map(([k,v]) => `${k}=${v}`).join(' ')}`);
    console.log(`Behaviors: ${Object.entries(a.behaviorBreakdown).map(([k,v]) => `${k}=${v}`).join(' ')}`);
    console.log(`Avg win rate: ${((a.avgWinRate ?? 0) * 100).toFixed(1)}% | Efficiency: ${a.avgEfficiency ?? 'N/A'} | Consistency: ${a.avgConsistency ?? 'N/A'}`);
    console.log(`Token profitable: ${a.pctTokenProfitable}% | Avg token PnL: ${a.avgTokenPnlSol ?? 'N/A'} SOL | Avg ROI: ${a.avgTokenROI ?? 'N/A'}`);
    console.log(`Early entries (<33%): ${a.pctEarlyEntry}% | New wallets (<14d): ${a.pctNewWallet}% | Bots: ${a.pctBots}%`);

    console.log('\nTop token PnL:');
    analysis.views.topTokenPnl.slice(0, 5).forEach((w, i) =>
      console.log(`  ${i + 1}. ${w.address.slice(0,8)}...${w.address.slice(-4)} | PnL: ${w.tokenPnlSol} SOL | ROI: ${w.tokenROI} | Entry: ${w.entryRank != null ? (w.entryRank * 100).toFixed(0) + '%' : '?'} | Age: ${w.walletAgeDays ?? '?'}d | WR: ${w.winRate != null ? (w.winRate * 100).toFixed(0) + '%' : '?'}`)
    );
    console.log('='.repeat(60));

  } finally {
    await redis.quit();
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error(getErrorMessage(err));
  process.exit(1);
});
