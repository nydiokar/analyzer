/**
 * Formatter unit tests — no network, no API key required.
 *
 * Each test passes a hardcoded fixture (sampled from real API responses)
 * to a formatter function and asserts the output contains expected strings.
 *
 * Usage:
 *   npx tsx src/test-formatters.ts
 */

import assert from 'node:assert/strict';
import { formatWalletProfile } from './formatters/profile.js';
import { formatHolderProfilesResult } from './formatters/holders.js';
import { formatComparison } from './formatters/comparison.js';
import { formatAnalysisResult } from './formatters/analysis.js';
import { parseCommand } from './commands.js';
import type { WalletHud } from './analyzer.js';
import type { HolderProfilesResult } from './analyzer.js';

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    const msg = err instanceof assert.AssertionError
      ? `\n       expected: ${JSON.stringify(err.expected)}\n       actual:   ${JSON.stringify(err.actual)}`
      : `\n       ${err instanceof Error ? err.message : String(err)}`;
    console.log(`  ✗  ${name}${msg}`);
    failed++;
  }
}

// ── Fixtures — real shapes sampled from live API responses ────────────────────

const WALLET_ADDR = 'Gu7JugMP1FZHdFmKDveCHxsJXwXGe4P1pYeRz47nq1V7';

const hudFixture: WalletHud = {
  walletAddress: WALLET_ADDR,
  signalType: 'BEHAVIORAL',
  trimmedMeanPnl: 0.04,
  avgTxValueSol: 2.45,
  behaviorCategory: 'SWING_TRADER',
  behaviorCode: 'W',
  medianHoldTimeHours: 93.6,   // 3.9d
  avgTradesPerDay: 0.4,
  uniqueTokensPerDay: 0.2,
  winRate: 0.25,
  isBot: false,
  isWhale: false,
  currentHoldingsSol: 0.0,
  dataQualityTier: 'BRONZE',
  calculatedAt: '2026-02-01T00:00:00.000Z',
  provenance: {
    provider: 'sova',
    schemaVersion: '1',
    generatedAt: '2026-02-01T00:00:00.000Z',
    dataRange: { from: '2025-12-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' },
  },
};

const holderProfilesFixture: HolderProfilesResult = {
  mode: 'token',
  tokenMint: '3QsVBTqry3d2iqyttSWpy2H8jsKweHUoCNcesypzpump',
  success: true,
  profiles: [
    {
      walletAddress: '94kNnCEvewxq2yzhbCK3jfL4CQ4z4br3MNcwn4MCrt8p',
      rank: 2,
      supplyPercent: 3.9,
      medianHoldTimeHours: 0.15,   // 9 min
      avgHoldTimeHours: 0.2,
      behaviorType: 'MOMENTUM',
      exitPattern: 'ALL AT ONCE',
      dataQualityTier: 'SILVER',
      completedCycleCount: 12,
      confidence: 0.8,
      walletPnlSol: -0.5,
      walletRealizedPnlSol: -0.5,
      solBalance: 4.2,
    },
    {
      walletAddress: 'CANx1apAmTFCrHWD8YU4iYNmeY6gCHZRxxQqh23Jo8iJ',
      rank: 3,
      supplyPercent: 3.6,
      medianHoldTimeHours: null,
      avgHoldTimeHours: null,
      behaviorType: null,
      exitPattern: null,
      dataQualityTier: 'INSUFFICIENT',
      completedCycleCount: 0,
      confidence: 0,
      walletPnlSol: null,
      walletRealizedPnlSol: null,
      solBalance: null,
      analysisSkipped: false,
    },
  ],
  metadata: {
    totalHoldersRequested: 10,
    totalHoldersAnalyzed: 2,
    totalProcessingTimeMs: 3250,
    avgProcessingTimePerWalletMs: 1625,
    failedHolders: 0,
  },
};

const similarityFixture = {
  pairwiseSimilarities: [
    {
      walletA: 'Gu7JugMP1FZHdFmKDveCHxsJXwXGe4P1pYeRz47nq1V7',
      walletB: '94kNnCEvewxq2yzhbCK3jfL4CQ4z4br3MNcwn4MCrt8p',
      binaryScore: 0.78,
      capitalScore: 0.85,
      sharedTokens: [
        { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Wrapped SOL' },
        { mint: '3QsVBTqry3d2iqyttSWpy2H8jsKweHUoCNcesypzpump' },
      ],
      capitalAllocation: {
        'So11111111111111111111111111111111111111112': { weightA: 0.45, weightB: 0.38 },
        '3QsVBTqry3d2iqyttSWpy2H8jsKweHUoCNcesypzpump': { weightA: 0.12, weightB: 0.21 },
      },
      binarySharedTokenCount: 2,
      capitalSharedTokenCount: 2,
    },
  ],
  summary: { walletCount: 2, uniqueTokensTotal: 47 },
};

const analysisFixture = {
  walletAddress: WALLET_ADDR,
  pnlResult: {
    realizedPnl: 12.5,
    tokenWinRate: 0.68,
    totalVolume: 340.2,
    totalTradesCount: 47,
  },
  behaviorResult: {
    tradingStyle: 'SWING_TRADER',
    uniqueTokensTraded: 23,
    medianHoldTime: 93.6,
    tradingFrequency: { tradesPerDay: 0.4 },
    riskMetrics: { averageTransactionValueSol: 3.1, largestTransactionValueSol: 28.0 },
  },
};

// ── Tests: parseCommand ───────────────────────────────────────────────────────

console.log('\ncommand router');

test('parses /profile with valid address', () => {
  const result = parseCommand(`/profile ${WALLET_ADDR}`);
  assert.equal(result.command, '/profile');
  assert.equal(result.args[0], WALLET_ADDR);
});

test('parses /holders with valid mint', () => {
  const result = parseCommand('/holders 3QsVBTqry3d2iqyttSWpy2H8jsKweHUoCNcesypzpump');
  assert.equal(result.command, '/holders');
  assert.equal(result.args[0], '3QsVBTqry3d2iqyttSWpy2H8jsKweHUoCNcesypzpump');
});

test('parses /analyze with scope', () => {
  const result = parseCommand(`/analyze ${WALLET_ADDR} deep`);
  assert.equal(result.command, '/analyze');
  assert.equal(result.args[1], 'deep');
});

test('parses /analyze defaults scope to working', () => {
  const result = parseCommand(`/analyze ${WALLET_ADDR}`);
  assert.equal(result.args[1], 'working');
});

test('parses /compare with two addresses', () => {
  const result = parseCommand(
    `/compare ${WALLET_ADDR} 94kNnCEvewxq2yzhbCK3jfL4CQ4z4br3MNcwn4MCrt8p`,
  );
  assert.equal(result.command, '/compare');
  assert.equal(result.args.length, 2);
});

test('returns unknown for unrecognised command', () => {
  const result = parseCommand('/foo bar');
  assert.equal(result.command, 'unknown');
});

test('returns unknown for plain text (no slash)', () => {
  const result = parseCommand('hello world');
  assert.equal(result.command, 'unknown');
});

test('args filtered to valid base58 addresses only', () => {
  const result = parseCommand('/profile notanaddress');
  assert.equal(result.args.length, 0);
});

// ── Tests: formatWalletProfile ────────────────────────────────────────────────

console.log('\nformatWalletProfile');

test('contains wallet short address', () => {
  const out = formatWalletProfile(WALLET_ADDR, hudFixture);
  assert.ok(out.includes('Gu7J..q1V7'), `output: ${out}`);
});

test('contains median PnL', () => {
  const out = formatWalletProfile(WALLET_ADDR, hudFixture);
  assert.ok(out.includes('-0.02'), `output: ${out}`);
});

test('contains trimmed avg PnL', () => {
  const out = formatWalletProfile(WALLET_ADDR, hudFixture);
  assert.ok(out.includes('+0.04'), `output: ${out}`);
});

test('contains win rate as percentage', () => {
  const out = formatWalletProfile(WALLET_ADDR, hudFixture);
  assert.ok(out.includes('25%'), `output: ${out}`);
});

test('contains hold time in days', () => {
  const out = formatWalletProfile(WALLET_ADDR, hudFixture);
  assert.ok(out.includes('3.9d'), `output: ${out}`);
});

test('contains data quality tier', () => {
  const out = formatWalletProfile(WALLET_ADDR, hudFixture);
  assert.ok(out.includes('BRONZE'), `output: ${out}`);
});

test('contains data range', () => {
  const out = formatWalletProfile(WALLET_ADDR, hudFixture);
  assert.ok(out.includes('Dec 2025'), `output: ${out}`);
  assert.ok(out.includes('Feb 2026'), `output: ${out}`);
});

test('returns fallback when hud is null', () => {
  const out = formatWalletProfile(WALLET_ADDR, null);
  assert.ok(out.includes('No profile data'), `output: ${out}`);
});

// ── Tests: formatHolderProfilesResult ────────────────────────────────────────

console.log('\nformatHolderProfilesResult');

test('contains token header', () => {
  const out = formatHolderProfilesResult(holderProfilesFixture, 'TestToken', 'TEST');
  assert.ok(out.includes('TestToken (TEST)'), `output: ${out}`);
});

test('falls back to short mint when no token name', () => {
  const out = formatHolderProfilesResult(holderProfilesFixture);
  assert.ok(out.includes('3QsVBT'), `output: ${out}`);
});

test('contains analyzed count', () => {
  const out = formatHolderProfilesResult(holderProfilesFixture, 'T', 'T');
  assert.ok(out.includes('Analyzed 1 of 2'), `output: ${out}`);
});

test('contains wallet short address in table', () => {
  const out = formatHolderProfilesResult(holderProfilesFixture);
  assert.ok(out.includes('94kN..rt8p'), `output: ${out}`);
});

test('contains supply percentage', () => {
  const out = formatHolderProfilesResult(holderProfilesFixture);
  assert.ok(out.includes('3.9%'), `output: ${out}`);
});

test('contains behavior type', () => {
  const out = formatHolderProfilesResult(holderProfilesFixture);
  assert.ok(out.includes('Momentum'), `output: ${out}`);
});

test('contains hold time in minutes', () => {
  const out = formatHolderProfilesResult(holderProfilesFixture);
  assert.ok(out.includes('9min'), `output: ${out}`);
});

test('contains processing time footer', () => {
  const out = formatHolderProfilesResult(holderProfilesFixture);
  assert.ok(out.includes('3.3s total') || out.includes('3.2s total'), `output: ${out}`);
});

test('trader types distribution line', () => {
  const out = formatHolderProfilesResult(holderProfilesFixture);
  assert.ok(out.includes('Trader types:'), `output: ${out}`);
  assert.ok(out.includes('Momentum 1'), `output: ${out}`);
});

// ── Tests: formatComparison ───────────────────────────────────────────────────

console.log('\nformatComparison');

const ADDRS = [
  'Gu7JugMP1FZHdFmKDveCHxsJXwXGe4P1pYeRz47nq1V7',
  '94kNnCEvewxq2yzhbCK3jfL4CQ4z4br3MNcwn4MCrt8p',
];

test('contains wallet count header', () => {
  const { summary } = formatComparison(ADDRS, similarityFixture);
  assert.ok(summary.includes('2 wallets'), `summary: ${summary}`);
});

test('contains similarity percentage', () => {
  const { summary } = formatComparison(ADDRS, similarityFixture);
  // overall = 0.78*0.4 + 0.85*0.6 = 0.312 + 0.51 = 0.822 → 82%
  assert.ok(summary.includes('82%'), `summary: ${summary}`);
});

test('contains High similarity label', () => {
  const { summary } = formatComparison(ADDRS, similarityFixture);
  assert.ok(summary.includes('High'), `summary: ${summary}`);
});

test('verdict contains jaccard or coverage data', () => {
  const { report } = formatComparison(ADDRS, similarityFixture);
  assert.ok(report?.includes('Jaccard') || report?.includes('portfolio'), `report: ${report}`);
});

test('low similarity shows context section', () => {
  const lowFixture = {
    pairwiseSimilarities: [{
      walletA: ADDRS[0], walletB: ADDRS[1],
      binaryScore: 0.10, capitalScore: 0.10,
      sharedTokens: [], capitalAllocation: {},
      binarySharedTokenCount: 0, binaryUniqueTokenCountA: 0, binaryUniqueTokenCountB: 0,
      capitalSharedTokenCount: 0, capitalUniqueTokenCountA: 0, capitalUniqueTokenCountB: 0,
    }],
  };
  const { report } = formatComparison(ADDRS, lowFixture);
  assert.ok(report?.includes('Context'), `report: ${report}`);
});

test('null result returns graceful fallback', () => {
  const { summary } = formatComparison(ADDRS, null);
  assert.ok(summary.includes('no data was returned'), `summary: ${summary}`);
});

test('report is a markdown string', () => {
  const { report } = formatComparison(ADDRS, similarityFixture);
  assert.ok(report?.startsWith('# Wallet Similarity'), `report: ${report}`);
});

// ── Tests: formatAnalysisResult ───────────────────────────────────────────────

console.log('\nformatAnalysisResult');

test('contains short wallet address', () => {
  const { summary } = formatAnalysisResult(WALLET_ADDR, analysisFixture);
  assert.ok(summary.includes('Gu7J..q1V7'), `summary: ${summary}`);
});

test('contains realized PnL', () => {
  const { summary } = formatAnalysisResult(WALLET_ADDR, analysisFixture);
  assert.ok(summary.includes('+12.5') || summary.includes('12.5'), `summary: ${summary}`);
});

test('contains win rate', () => {
  const { summary } = formatAnalysisResult(WALLET_ADDR, analysisFixture);
  assert.ok(summary.includes('68%'), `summary: ${summary}`);
});

test('contains trading style', () => {
  const { summary } = formatAnalysisResult(WALLET_ADDR, analysisFixture);
  assert.ok(summary.includes('SWING_TRADER'), `summary: ${summary}`);
});

test('contains volume', () => {
  const { summary } = formatAnalysisResult(WALLET_ADDR, analysisFixture);
  assert.ok(summary.includes('340'), `summary: ${summary}`);
});

test('report contains full address', () => {
  const { report } = formatAnalysisResult(WALLET_ADDR, analysisFixture);
  assert.ok(report?.includes(WALLET_ADDR), `report: ${report}`);
});

test('null result returns graceful fallback', () => {
  const { summary } = formatAnalysisResult(WALLET_ADDR, null);
  assert.ok(summary.includes('no data was returned'), `summary: ${summary}`);
});

// ── Summary ───────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${passed}/${total} tests passed${failed > 0 ? `, ${failed} failed` : ' ✓'}`);
console.log(`${'─'.repeat(50)}\n`);

if (failed > 0) process.exit(1);
