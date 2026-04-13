import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

import { prisma } from '../src/core/services/database-service';

type CliOptions = {
  userId?: string;
  scope: 'tracked' | 'global';
  limit?: number;
  candidateLimit: number;
  minUniqueTokens: number;
  minActiveDays: number;
  maxInactiveDays: number;
  sortBy: SortKey;
  format: 'table' | 'json' | 'html';
  outputPath?: string;
  includeTokens: boolean;
  excludeVerifiedBots: boolean;
  excludeSpeedCategories: string[];
};

type SortKey =
  | 'copytrade'
  | 'composite'
  | 'entry'
  | 'hold'
  | 'multiple'
  | 'pnl'
  | 'efficiency'
  | 'winrate';

type FavoriteWalletRow = {
  walletAddress: string;
  nickname: string | null;
  collections: string | null;
  knownType: string | null;
  knownLabel: string | null;
  favoritedAt: Date | null;
  isVerifiedBot: boolean | null;
  botType: string | null;
  totalExecutedSwapsCount: number | null;
  overallLastTimestamp: number | null;
  totalVolumeUsd: number | null;
  realizedPnlUsd: number | null;
  unrealizedPnlUsd: number | null;
  netPnlUsd: number | null;
  realizedPnlToTotalVolumeRatio: number | null;
  tokenWinRatePercent: number | null;
  weightedEfficiencyScore: number | null;
  profitConsistencyIndex: number | null;
  averagePnlPerDayActiveApprox: number | null;
  tradingStyle: string | null;
  strategyType: string | null;
  speedCategory: string | null;
  medianHoldTime: number | null;
  medianCompletedHoldTimeHours: number | null;
  averageTradesPerToken: number | null;
  percentTradesUnder1Hour: number | null;
  percentTradesUnder4Hours: number | null;
  uniqueTokensTraded: number | null;
  activeTradingDays: number | null;
  typicalEntryMcapUsd: number | null;
  entryMcapP25Usd: number | null;
  entryMcapP75Usd: number | null;
  dominantEntryMcapBucket: string | null;
  dominantEntryMcapBucketShare: number | null;
  entryMcapSampleSizeTokens: number | null;
};

type TokenMetricRow = {
  walletAddress: string;
  tokenAddress: string;
  totalSolSpent: number;
  realizedPnlSol: number | null;
  totalPnlSol: number | null;
  avgEntryMcap: number | null;
  avgExitMcap: number | null;
  typicalEntryMcapUsd: number | null;
  typicalExitMcapUsd: number | null;
};

type FirstTradeMetricRow = {
  walletAddress: string;
  tokenAddress: string;
  firstBuyMcap: number | null;
  firstSellMcap: number | null;
};

type WalletTokenStats = {
  tokenCountWithTypicalExit: number;
  tokenCountWithAvgMultiple: number;
  tokenCountWithFirstMultiple: number;
  medianTokenRealizedRoiPct: number | null;
  medianTokenTotalRoiPct: number | null;
  medianTypicalExitMcapUsd: number | null;
  medianAvgExitEntryMultiple: number | null;
  pctTokensAboveEntry: number | null;
  pctTokensAt1_5x: number | null;
  pctTokensAt2x: number | null;
  pctTokensAt3x: number | null;
  medianFirstExitEntryMultiple: number | null;
  pctFirstExitAboveEntry: number | null;
};

type ReviewRow = {
  walletAddress: string;
  label: string;
  knownType: string | null;
  isVerifiedBot: boolean;
  botType: string | null;
  collections: string[];
  favoritedAt: string | null;
  swaps: number | null;
  overallLastTimestamp: number | null;
  uniqueTokensTraded: number | null;
  activeTradingDays: number | null;
  medianHoldHours: number | null;
  holdPercentile: number | null;
  tradesPerToken: number | null;
  churnPercentile: number | null;
  under1hPct: number | null;
  under4hPct: number | null;
  realizedPnlUsd: number | null;
  unrealizedPnlUsd: number | null;
  netPnlUsd: number | null;
  realizedVsUnrealizedRatio: number | null;
  realizedPnlToVolume: number | null;
  pnlPercentile: number | null;
  tokenWinRatePercent: number | null;
  winRatePercentile: number | null;
  weightedEfficiencyScore: number | null;
  efficiencyPercentile: number | null;
  profitConsistencyIndex: number | null;
  averagePnlPerDayActiveApprox: number | null;
  tradingStyle: string | null;
  strategyType: string | null;
  speedCategory: string | null;
  typicalEntryMcapUsd: number | null;
  entryMcapP25Usd: number | null;
  entryMcapP75Usd: number | null;
  entryPercentile: number | null;
  dominantEntryMcapBucket: string | null;
  dominantEntryMcapBucketShare: number | null;
  entryMcapSampleSizeTokens: number | null;
  tokenCountWithTypicalExit: number;
  medianTypicalExitMcapUsd: number | null;
  medianAvgExitEntryMultiple: number | null;
  multiplePercentile: number | null;
  pctTokensAboveEntry: number | null;
  pctTokensAt1_5x: number | null;
  pctTokensAt2x: number | null;
  pctTokensAt3x: number | null;
  medianFirstExitEntryMultiple: number | null;
  pctFirstExitAboveEntry: number | null;
  medianTokenRealizedRoiPct: number | null;
  medianTokenTotalRoiPct: number | null;
  compositeScore: number | null;
  copyTradeScore: number | null;
};

type JsonOutput = {
  user: {
    id: string;
    displayName: string | null;
    isAnalyst: boolean;
    isActive: boolean;
  };
  cohort: {
    walletCount: number;
    generatedAt: string;
    notes: string[];
  };
  rows: ReviewRow[];
  tokenBreakdown?: Record<string, TokenMetricSummary[]>;
};

type TokenMetricSummary = {
  tokenAddress: string;
  avgEntryMcap: number | null;
  avgExitMcap: number | null;
  typicalEntryMcapUsd: number | null;
  typicalExitMcapUsd: number | null;
  avgExitEntryMultiple: number | null;
  firstExitEntryMultiple: number | null;
  realizedRoiPct: number | null;
  totalRoiPct: number | null;
};

const SORT_KEYS: SortKey[] = ['copytrade', 'composite', 'entry', 'hold', 'multiple', 'pnl', 'efficiency', 'winrate'];

function parseArgs(argv: string[]): CliOptions {
  const getArg = (name: string, alias?: string): string | undefined => {
    const index = argv.findIndex((arg) => arg === name || (alias ? arg === alias : false));
    if (index === -1) return undefined;
    return argv[index + 1];
  };

  const hasFlag = (name: string): boolean => argv.includes(name);

  const userId = getArg('--user', '-u');
  const scopeValue = (getArg('--scope') ?? 'tracked') as 'tracked' | 'global';
  if (scopeValue !== 'tracked' && scopeValue !== 'global') {
    printUsageAndExit(`Invalid --scope value "${scopeValue}". Expected "tracked" or "global".`);
  }

  if (scopeValue === 'tracked' && !userId) {
    printUsageAndExit('Missing required argument: --user <userId>');
  }

  const sortByValue = getArg('--sort') ?? 'composite';
  if (!SORT_KEYS.includes(sortByValue as SortKey)) {
    printUsageAndExit(`Invalid --sort value "${sortByValue}". Expected one of: ${SORT_KEYS.join(', ')}`);
  }

  const formatValue = getArg('--format') ?? 'table';
  if (formatValue !== 'table' && formatValue !== 'json' && formatValue !== 'html') {
    printUsageAndExit(`Invalid --format value "${formatValue}". Expected "table", "json", or "html".`);
  }

  const limitValue = getArg('--limit');
  const parsedLimit = limitValue ? Number.parseInt(limitValue, 10) : undefined;
  if (limitValue && (!Number.isFinite(parsedLimit) || parsedLimit <= 0)) {
    printUsageAndExit(`Invalid --limit value "${limitValue}". Expected a positive integer.`);
  }

  const candidateLimitValue = getArg('--candidate-limit');
  const parsedCandidateLimit = candidateLimitValue ? Number.parseInt(candidateLimitValue, 10) : 500;
  if (!Number.isFinite(parsedCandidateLimit) || parsedCandidateLimit <= 0) {
    printUsageAndExit(`Invalid --candidate-limit value "${candidateLimitValue}". Expected a positive integer.`);
  }

  const minUniqueTokensValue = getArg('--min-unique-tokens');
  const minActiveDaysValue = getArg('--min-active-days');
  const maxInactiveDaysValue = getArg('--max-inactive-days');
  const parsedMinUniqueTokens = minUniqueTokensValue
    ? Number.parseInt(minUniqueTokensValue, 10)
    : (scopeValue === 'global' ? 5 : 0);
  const parsedMinActiveDays = minActiveDaysValue
    ? Number.parseInt(minActiveDaysValue, 10)
    : (scopeValue === 'global' ? 2 : 0);
  const parsedMaxInactiveDays = maxInactiveDaysValue
    ? Number.parseInt(maxInactiveDaysValue, 10)
    : (scopeValue === 'global' ? 30 : 3650);

  const excludeSpeed = (getArg('--exclude-speed') ?? '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  return {
    userId,
    scope: scopeValue,
    limit: parsedLimit,
    candidateLimit: parsedCandidateLimit,
    minUniqueTokens: parsedMinUniqueTokens,
    minActiveDays: parsedMinActiveDays,
    maxInactiveDays: parsedMaxInactiveDays,
    sortBy: sortByValue as SortKey,
    format: formatValue,
    outputPath: getArg('--out'),
    includeTokens: hasFlag('--include-tokens'),
    excludeVerifiedBots: hasFlag('--exclude-verified-bots'),
    excludeSpeedCategories: excludeSpeed,
  };
}

function printUsageAndExit(message?: string): never {
  if (message) {
    console.error(message);
  }
  console.error(`
Usage:
  npx ts-node -r tsconfig-paths/register scripts/review-tracked-wallets.ts --scope tracked --user <userId> [options]
  npx ts-node -r tsconfig-paths/register scripts/review-tracked-wallets.ts --scope global [options]

Options:
  --scope <mode>       tracked | global
  --sort <key>         copytrade | composite | entry | hold | multiple | pnl | efficiency | winrate
  --limit <n>          Limit output rows
  --candidate-limit<n> Candidate pool size before deep token-level scoring (useful in global mode)
  --min-unique-tokens<n>
  --min-active-days<n>
  --max-inactive-days<n>
  --format <mode>      table | json | html
  --out <path>         Write output to a file
  --include-tokens     Include token-level breakdown in json output
  --exclude-verified-bots
  --exclude-speed <list>  Comma-separated speed categories to exclude, e.g. SCALPER,SNIPER
`);
  process.exit(1);
}

function parseCollections(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function percentileRank(values: number[], target: number, reverse = false): number | null {
  if (!Number.isFinite(target) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => reverse ? b - a : a - b);
  const index = sorted.findIndex((value) => reverse ? target >= value : target <= value);
  const effectiveIndex = index === -1 ? sorted.length - 1 : index;
  return sorted.length === 1 ? 1 : effectiveIndex / (sorted.length - 1);
}

function round(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function ratioOrNull(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

function computeCompositeScore(row: ReviewRow): number | null {
  const parts: Array<number | null> = [
    row.multiplePercentile,
    row.pnlPercentile,
    row.efficiencyPercentile,
    row.winRatePercentile,
    row.holdPercentile,
    row.entryPercentile !== null ? 1 - row.entryPercentile : null,
    row.churnPercentile !== null ? 1 - row.churnPercentile : null,
  ];
  const valid = parts.filter((value): value is number => value !== null);
  if (valid.length < 4) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function computeCopyTradeScore(
  row: ReviewRow,
  roiPercentile: number | null,
  tokens2xPercentile: number | null,
): number | null {
  const weightedParts: Array<{ weight: number; value: number | null }> = [
    { weight: 0.24, value: row.multiplePercentile },
    { weight: 0.18, value: tokens2xPercentile },
    { weight: 0.16, value: roiPercentile },
    { weight: 0.14, value: row.pnlPercentile },
    { weight: 0.12, value: row.efficiencyPercentile },
    { weight: 0.08, value: row.winRatePercentile },
    { weight: 0.08, value: row.entryPercentile !== null ? 1 - row.entryPercentile : null },
  ];

  const valid = weightedParts.filter((part): part is { weight: number; value: number } => part.value !== null);
  if (valid.length < 4) return null;

  const weightSum = valid.reduce((sum, part) => sum + part.weight, 0);
  const score = valid.reduce((sum, part) => sum + part.weight * part.value, 0);
  return weightSum > 0 ? score / weightSum : null;
}

function sortRows(rows: ReviewRow[], sortBy: SortKey): ReviewRow[] {
  const valueForSort = (row: ReviewRow): number => {
    switch (sortBy) {
      case 'copytrade':
        return row.copyTradeScore ?? -1;
      case 'entry':
        return row.entryPercentile !== null ? 1 - row.entryPercentile : -1;
      case 'hold':
        return row.holdPercentile ?? -1;
      case 'multiple':
        return row.multiplePercentile ?? -1;
      case 'pnl':
        return row.pnlPercentile ?? -1;
      case 'efficiency':
        return row.efficiencyPercentile ?? -1;
      case 'winrate':
        return row.winRatePercentile ?? -1;
      case 'composite':
      default:
        return row.compositeScore ?? -1;
    }
  };

  return [...rows].sort((left, right) => {
    const diff = valueForSort(right) - valueForSort(left);
    if (diff !== 0) return diff;
    return (right.netPnlUsd ?? Number.NEGATIVE_INFINITY) - (left.netPnlUsd ?? Number.NEGATIVE_INFINITY);
  });
}

async function fetchTrackedWalletRows(userId: string): Promise<FavoriteWalletRow[]> {
  return prisma.$queryRaw<FavoriteWalletRow[]>`
    SELECT
      ufw."walletAddress",
      ufw.nickname,
      ufw.collections,
      w."knownType",
      w."knownLabel",
      w."isVerifiedBot",
      w."botType",
      ufw."createdAt" AS "favoritedAt",
      ps."totalExecutedSwapsCount",
      ps."overallLastTimestamp",
      ps."totalVolumeUsd",
      ps."realizedPnlUsd",
      ps."unrealizedPnlUsd",
      ps."netPnlUsd",
      ps."realizedPnlToTotalVolumeRatio",
      ats."tokenWinRatePercent",
      ats."weightedEfficiencyScore",
      ats."profitConsistencyIndex",
      ats."averagePnlPerDayActiveApprox",
      bp."tradingStyle",
      bp."strategyType",
      bp."speedCategory",
      bp."medianHoldTime",
      bp."medianCompletedHoldTimeHours",
      bp."averageTradesPerToken",
      bp."percentTradesUnder1Hour",
      bp."percentTradesUnder4Hours",
      bp."uniqueTokensTraded",
      bp."activeTradingDays",
      bp."typicalEntryMcapUsd",
      bp."entryMcapP25Usd",
      bp."entryMcapP75Usd",
      bp."dominantEntryMcapBucket",
      bp."dominantEntryMcapBucketShare",
      bp."entryMcapSampleSizeTokens"
    FROM "UserFavoriteWallet" ufw
    LEFT JOIN "Wallet" w ON w.address = ufw."walletAddress"
    LEFT JOIN "WalletPnlSummary" ps ON ps."walletAddress" = ufw."walletAddress"
    LEFT JOIN "AdvancedTradeStats" ats ON ats."walletPnlSummaryId" = ps.id
    LEFT JOIN "WalletBehaviorProfile" bp ON bp."walletAddress" = ufw."walletAddress"
    WHERE ufw."userId" = ${userId}
  `;
}

async function fetchGlobalWalletRows(options: CliOptions): Promise<FavoriteWalletRow[]> {
  const excludedSpeeds = options.excludeSpeedCategories;
  const minLastActiveTimestamp = Math.floor(Date.now() / 1000) - (options.maxInactiveDays * 24 * 60 * 60);

  return prisma.$queryRaw<FavoriteWalletRow[]>`
    SELECT
      w.address AS "walletAddress",
      NULL::text AS nickname,
      NULL::text AS collections,
      w."knownType",
      w."knownLabel",
      w."isVerifiedBot",
      w."botType",
      NULL::timestamp AS "favoritedAt",
      ps."totalExecutedSwapsCount",
      ps."overallLastTimestamp",
      ps."totalVolumeUsd",
      ps."realizedPnlUsd",
      ps."unrealizedPnlUsd",
      ps."netPnlUsd",
      ps."realizedPnlToTotalVolumeRatio",
      ats."tokenWinRatePercent",
      ats."weightedEfficiencyScore",
      ats."profitConsistencyIndex",
      ats."averagePnlPerDayActiveApprox",
      bp."tradingStyle",
      bp."strategyType",
      bp."speedCategory",
      bp."medianHoldTime",
      bp."medianCompletedHoldTimeHours",
      bp."averageTradesPerToken",
      bp."percentTradesUnder1Hour",
      bp."percentTradesUnder4Hours",
      bp."uniqueTokensTraded",
      bp."activeTradingDays",
      bp."typicalEntryMcapUsd",
      bp."entryMcapP25Usd",
      bp."entryMcapP75Usd",
      bp."dominantEntryMcapBucket",
      bp."dominantEntryMcapBucketShare",
      bp."entryMcapSampleSizeTokens"
    FROM "Wallet" w
    JOIN "WalletPnlSummary" ps ON ps."walletAddress" = w.address
    JOIN "AdvancedTradeStats" ats ON ats."walletPnlSummaryId" = ps.id
    JOIN "WalletBehaviorProfile" bp ON bp."walletAddress" = w.address
    WHERE ps."totalExecutedSwapsCount" >= 20
      AND COALESCE(bp."uniqueTokensTraded", 0) >= ${options.minUniqueTokens}
      AND COALESCE(bp."activeTradingDays", 0) >= ${options.minActiveDays}
      AND COALESCE(ps."overallLastTimestamp", 0) >= ${minLastActiveTimestamp}
      AND (${options.excludeVerifiedBots} = false OR COALESCE(w."isVerifiedBot", false) = false)
      AND (CARDINALITY(${excludedSpeeds}::text[]) = 0 OR COALESCE(UPPER(bp."speedCategory"), '') <> ALL(${excludedSpeeds}::text[]))
    ORDER BY
      COALESCE(ps."realizedPnlToTotalVolumeRatio", -999999) DESC,
      COALESCE(ats."weightedEfficiencyScore", -999999) DESC,
      COALESCE(bp."typicalEntryMcapUsd", 999999999999) ASC
    LIMIT ${options.candidateLimit}
  `;
}

async function fetchTokenMetricRows(walletAddresses: string[]): Promise<TokenMetricRow[]> {
  return prisma.analysisResult.findMany({
    where: {
      walletAddress: { in: walletAddresses },
    },
    select: {
      walletAddress: true,
      tokenAddress: true,
      totalSolSpent: true,
      realizedPnlSol: true,
      totalPnlSol: true,
      avgEntryMcap: true,
      avgExitMcap: true,
      typicalEntryMcapUsd: true,
      typicalExitMcapUsd: true,
    },
  });
}

async function fetchFirstTradeRows(walletAddresses: string[]): Promise<FirstTradeMetricRow[]> {
  return prisma.$queryRaw<FirstTradeMetricRow[]>`
    WITH tracked AS (
      SELECT UNNEST(${walletAddresses}::text[]) AS wallet_address
    ),
    ranked AS (
      SELECT
        sai."walletAddress",
        sai.mint AS "tokenAddress",
        LOWER(sai.direction) AS direction_lower,
        sai."marketCapUsd",
        ROW_NUMBER() OVER (
          PARTITION BY sai."walletAddress", sai.mint, LOWER(sai.direction)
          ORDER BY sai.timestamp ASC, sai.id ASC
        ) AS row_num
      FROM "SwapAnalysisInput" sai
      JOIN tracked t ON t.wallet_address = sai."walletAddress"
      WHERE sai."marketCapUsd" IS NOT NULL
        AND LOWER(sai.direction) IN ('buy', 'sell')
    )
    SELECT
      ranked."walletAddress",
      ranked."tokenAddress",
      MAX(CASE WHEN ranked.direction_lower = 'buy' AND ranked.row_num = 1 THEN ranked."marketCapUsd" END) AS "firstBuyMcap",
      MAX(CASE WHEN ranked.direction_lower = 'sell' AND ranked.row_num = 1 THEN ranked."marketCapUsd" END) AS "firstSellMcap"
    FROM ranked
    GROUP BY ranked."walletAddress", ranked."tokenAddress"
  `;
}

function buildWalletTokenStats(
  tokenRows: TokenMetricRow[],
  firstRows: FirstTradeMetricRow[],
): {
  byWallet: Map<string, WalletTokenStats>;
  tokenBreakdown: Record<string, TokenMetricSummary[]>;
} {
  const tokensByWallet = new Map<string, TokenMetricSummary[]>();
  const firstMap = new Map<string, FirstTradeMetricRow>();

  for (const row of firstRows) {
    firstMap.set(`${row.walletAddress}:${row.tokenAddress}`, row);
  }

  for (const row of tokenRows) {
    const key = `${row.walletAddress}:${row.tokenAddress}`;
    const first = firstMap.get(key);
    const avgExitEntryMultiple = ratioOrNull(row.avgExitMcap, row.avgEntryMcap);
    const firstExitEntryMultiple = ratioOrNull(first?.firstSellMcap ?? null, first?.firstBuyMcap ?? null);
    const realizedRoiPct = ratioOrNull(row.realizedPnlSol, row.totalSolSpent) ?? null;
    const totalRoiPct = ratioOrNull(row.totalPnlSol, row.totalSolSpent) ?? null;

    const summary: TokenMetricSummary = {
      tokenAddress: row.tokenAddress,
      avgEntryMcap: row.avgEntryMcap,
      avgExitMcap: row.avgExitMcap,
      typicalEntryMcapUsd: row.typicalEntryMcapUsd,
      typicalExitMcapUsd: row.typicalExitMcapUsd,
      avgExitEntryMultiple,
      firstExitEntryMultiple,
      realizedRoiPct,
      totalRoiPct,
    };

    if (!tokensByWallet.has(row.walletAddress)) {
      tokensByWallet.set(row.walletAddress, []);
    }
    tokensByWallet.get(row.walletAddress)?.push(summary);
  }

  const byWallet = new Map<string, WalletTokenStats>();
  const tokenBreakdown: Record<string, TokenMetricSummary[]> = {};

  for (const [walletAddress, summaries] of tokensByWallet.entries()) {
    tokenBreakdown[walletAddress] = [...summaries].sort((left, right) => {
      return (right.avgExitEntryMultiple ?? Number.NEGATIVE_INFINITY) - (left.avgExitEntryMultiple ?? Number.NEGATIVE_INFINITY);
    });

    const typicalExitMcaps = summaries
      .map((item) => item.typicalExitMcapUsd)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const avgMultiples = summaries
      .map((item) => item.avgExitEntryMultiple)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const firstMultiples = summaries
      .map((item) => item.firstExitEntryMultiple)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const realizedRoiValues = summaries
      .map((item) => item.realizedRoiPct)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const totalRoiValues = summaries
      .map((item) => item.totalRoiPct)
      .filter((value): value is number => value !== null && Number.isFinite(value));

    byWallet.set(walletAddress, {
      tokenCountWithTypicalExit: typicalExitMcaps.length,
      tokenCountWithAvgMultiple: avgMultiples.length,
      tokenCountWithFirstMultiple: firstMultiples.length,
      medianTokenRealizedRoiPct: median(realizedRoiValues),
      medianTokenTotalRoiPct: median(totalRoiValues),
      medianTypicalExitMcapUsd: median(typicalExitMcaps),
      medianAvgExitEntryMultiple: median(avgMultiples),
      pctTokensAboveEntry: avgMultiples.length > 0 ? avgMultiples.filter((value) => value > 1).length / avgMultiples.length : null,
      pctTokensAt1_5x: avgMultiples.length > 0 ? avgMultiples.filter((value) => value >= 1.5).length / avgMultiples.length : null,
      pctTokensAt2x: avgMultiples.length > 0 ? avgMultiples.filter((value) => value >= 2).length / avgMultiples.length : null,
      pctTokensAt3x: avgMultiples.length > 0 ? avgMultiples.filter((value) => value >= 3).length / avgMultiples.length : null,
      medianFirstExitEntryMultiple: median(firstMultiples),
      pctFirstExitAboveEntry: firstMultiples.length > 0 ? firstMultiples.filter((value) => value > 1).length / firstMultiples.length : null,
    });
  }

  return { byWallet, tokenBreakdown };
}

function buildReviewRows(
  favoriteRows: FavoriteWalletRow[],
  tokenStats: Map<string, WalletTokenStats>,
): ReviewRow[] {
  const holdValues = favoriteRows
    .map((row) => toNumber(row.medianCompletedHoldTimeHours ?? row.medianHoldTime))
    .filter((value): value is number => value !== null);
  const entryValues = favoriteRows
    .map((row) => toNumber(row.typicalEntryMcapUsd))
    .filter((value): value is number => value !== null);
  const pnlValues = favoriteRows
    .map((row) => toNumber(row.realizedPnlToTotalVolumeRatio))
    .filter((value): value is number => value !== null);
  const winRateValues = favoriteRows
    .map((row) => toNumber(row.tokenWinRatePercent))
    .filter((value): value is number => value !== null);
  const efficiencyValues = favoriteRows
    .map((row) => toNumber(row.weightedEfficiencyScore))
    .filter((value): value is number => value !== null);
  const churnValues = favoriteRows
    .map((row) => toNumber(row.averageTradesPerToken))
    .filter((value): value is number => value !== null);
  const multipleValues = Array.from(tokenStats.values())
    .map((row) => row.medianAvgExitEntryMultiple)
    .filter((value): value is number => value !== null);
  const realizedRoiValues = Array.from(tokenStats.values())
    .map((row) => row.medianTokenRealizedRoiPct)
    .filter((value): value is number => value !== null);
  const tokens2xValues = Array.from(tokenStats.values())
    .map((row) => row.pctTokensAt2x)
    .filter((value): value is number => value !== null);

  const rows = favoriteRows.map((row) => {
    const token = tokenStats.get(row.walletAddress);
    const medianHoldHours = toNumber(row.medianCompletedHoldTimeHours ?? row.medianHoldTime);
    const realizedVsUnrealizedRatio = ratioOrNull(toNumber(row.realizedPnlUsd), toNumber(row.unrealizedPnlUsd));

    const reviewRow: ReviewRow = {
      walletAddress: row.walletAddress,
      label: row.nickname ?? row.knownLabel ?? row.walletAddress,
      knownType: row.knownType,
      isVerifiedBot: row.isVerifiedBot ?? false,
      botType: row.botType,
      collections: parseCollections(row.collections),
      favoritedAt: row.favoritedAt ? row.favoritedAt.toISOString() : null,
      swaps: row.totalExecutedSwapsCount,
      overallLastTimestamp: row.overallLastTimestamp,
      uniqueTokensTraded: row.uniqueTokensTraded,
      activeTradingDays: row.activeTradingDays,
      medianHoldHours,
      holdPercentile: medianHoldHours !== null ? percentileRank(holdValues, medianHoldHours) : null,
      tradesPerToken: row.averageTradesPerToken,
      churnPercentile: row.averageTradesPerToken !== null ? percentileRank(churnValues, row.averageTradesPerToken) : null,
      under1hPct: row.percentTradesUnder1Hour,
      under4hPct: row.percentTradesUnder4Hours,
      realizedPnlUsd: row.realizedPnlUsd,
      unrealizedPnlUsd: row.unrealizedPnlUsd,
      netPnlUsd: row.netPnlUsd,
      realizedVsUnrealizedRatio,
      realizedPnlToVolume: row.realizedPnlToTotalVolumeRatio,
      pnlPercentile: row.realizedPnlToTotalVolumeRatio !== null ? percentileRank(pnlValues, row.realizedPnlToTotalVolumeRatio) : null,
      tokenWinRatePercent: row.tokenWinRatePercent,
      winRatePercentile: row.tokenWinRatePercent !== null ? percentileRank(winRateValues, row.tokenWinRatePercent) : null,
      weightedEfficiencyScore: row.weightedEfficiencyScore,
      efficiencyPercentile: row.weightedEfficiencyScore !== null ? percentileRank(efficiencyValues, row.weightedEfficiencyScore) : null,
      profitConsistencyIndex: row.profitConsistencyIndex,
      averagePnlPerDayActiveApprox: row.averagePnlPerDayActiveApprox,
      tradingStyle: row.tradingStyle,
      strategyType: row.strategyType,
      speedCategory: row.speedCategory,
      typicalEntryMcapUsd: row.typicalEntryMcapUsd,
      entryMcapP25Usd: row.entryMcapP25Usd,
      entryMcapP75Usd: row.entryMcapP75Usd,
      entryPercentile: row.typicalEntryMcapUsd !== null ? percentileRank(entryValues, row.typicalEntryMcapUsd, false) : null,
      dominantEntryMcapBucket: row.dominantEntryMcapBucket,
      dominantEntryMcapBucketShare: row.dominantEntryMcapBucketShare,
      entryMcapSampleSizeTokens: row.entryMcapSampleSizeTokens,
      tokenCountWithTypicalExit: token?.tokenCountWithTypicalExit ?? 0,
      medianTypicalExitMcapUsd: token?.medianTypicalExitMcapUsd ?? null,
      medianAvgExitEntryMultiple: token?.medianAvgExitEntryMultiple ?? null,
      multiplePercentile: token?.medianAvgExitEntryMultiple != null ? percentileRank(multipleValues, token.medianAvgExitEntryMultiple) : null,
      pctTokensAboveEntry: token?.pctTokensAboveEntry ?? null,
      pctTokensAt1_5x: token?.pctTokensAt1_5x ?? null,
      pctTokensAt2x: token?.pctTokensAt2x ?? null,
      pctTokensAt3x: token?.pctTokensAt3x ?? null,
      medianFirstExitEntryMultiple: token?.medianFirstExitEntryMultiple ?? null,
      pctFirstExitAboveEntry: token?.pctFirstExitAboveEntry ?? null,
      medianTokenRealizedRoiPct: token?.medianTokenRealizedRoiPct ?? null,
      medianTokenTotalRoiPct: token?.medianTokenTotalRoiPct ?? null,
      compositeScore: null,
      copyTradeScore: null,
    };

    reviewRow.compositeScore = computeCompositeScore(reviewRow);
    const roiPercentile = reviewRow.medianTokenRealizedRoiPct !== null
      ? percentileRank(realizedRoiValues, reviewRow.medianTokenRealizedRoiPct)
      : null;
    const tokens2xPercentile = reviewRow.pctTokensAt2x !== null
      ? percentileRank(tokens2xValues, reviewRow.pctTokensAt2x)
      : null;
    reviewRow.copyTradeScore = computeCopyTradeScore(reviewRow, roiPercentile, tokens2xPercentile);
    return reviewRow;
  });

  return rows;
}

function formatNullable(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? `${round(value, 3)}` : '-';
  }
  return value;
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return `${round(value * 100, 1)}%`;
}

function formatUsdCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${round(value / 1_000_000_000, 2)}b`;
  if (abs >= 1_000_000) return `${round(value / 1_000_000, 2)}m`;
  if (abs >= 1_000) return `${round(value / 1_000, 1)}k`;
  return `${round(value, 2)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function printTable(rows: ReviewRow[]): void {
  const columns = [
    'label',
    'wallet',
    'copy',
    'score',
    'entry_pctile',
    'hold_pctile',
    'multiple',
    'pnl_vol',
    'eff',
    'winrate',
    'swaps',
    'entry_mcap',
    'hold_h',
    'r_roi',
  ];

  const tableRows = rows.map((row) => [
    row.label.slice(0, 14),
    `${row.walletAddress.slice(0, 4)}...${row.walletAddress.slice(-4)}`,
    formatNullable(row.copyTradeScore),
    formatNullable(row.compositeScore),
    formatPct(row.entryPercentile !== null ? 1 - row.entryPercentile : null),
    formatPct(row.holdPercentile),
    formatNullable(row.medianAvgExitEntryMultiple),
    formatNullable(row.realizedPnlToVolume),
    formatNullable(row.weightedEfficiencyScore),
    row.tokenWinRatePercent !== null ? `${round(row.tokenWinRatePercent, 1)}%` : '-',
    formatNullable(row.swaps),
    formatNullable(row.typicalEntryMcapUsd),
    formatNullable(row.medianHoldHours),
    formatNullable(row.medianTokenRealizedRoiPct),
  ]);

  const widths = columns.map((heading, index) => {
    const valueWidths = tableRows.map((row) => String(row[index]).length);
    return Math.max(heading.length, ...valueWidths);
  });

  const renderRow = (values: string[]): string =>
    values.map((value, index) => value.padEnd(widths[index], ' ')).join(' | ');

  console.log(renderRow(columns));
  console.log(widths.map((width) => '-'.repeat(width)).join('-|-'));
  for (const row of tableRows) {
    console.log(renderRow(row.map((value) => String(value))));
  }
}

function renderHtml(payload: JsonOutput): string {
  const datasetBase64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Tracked Wallet Review</title>
  <style>
    :root {
      --bg: #f4efe7;
      --panel: #fffaf2;
      --panel-2: #f8f2e8;
      --text: #1f1b16;
      --muted: #6a5d50;
      --line: #d7c8b4;
      --accent: #0e7c66;
      --accent-2: #9f3f2f;
      --good: #17653d;
      --warn: #9a5c00;
      --bad: #9d2f2f;
      --shadow: 0 12px 32px rgba(48, 36, 22, 0.08);
      --radius: 16px;
      --mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      --sans: "IBM Plex Sans", "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--sans);
      background:
        radial-gradient(circle at top left, rgba(14, 124, 102, 0.10), transparent 28%),
        radial-gradient(circle at top right, rgba(159, 63, 47, 0.08), transparent 24%),
        linear-gradient(180deg, #f8f4ec 0%, var(--bg) 100%);
      color: var(--text);
    }
    .page {
      max-width: 1480px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    .hero {
      display: grid;
      gap: 18px;
      padding: 28px;
      background: linear-gradient(135deg, rgba(255,250,242,0.96), rgba(247,239,226,0.96));
      border: 1px solid var(--line);
      border-radius: 28px;
      box-shadow: var(--shadow);
    }
    .hero h1 {
      margin: 0;
      font-size: clamp(28px, 5vw, 48px);
      line-height: 0.95;
      letter-spacing: -0.04em;
    }
    .hero p {
      margin: 0;
      max-width: 980px;
      color: var(--muted);
      font-size: 16px;
      line-height: 1.5;
    }
    .meta-grid,
    .stats-grid,
    .slice-grid,
    .wallet-grid {
      display: grid;
      gap: 16px;
    }
    .meta-grid { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
    .stats-grid { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-top: 10px; }
    .slice-grid { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    .wallet-grid { grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); }
    .panel,
    .slice-card,
    .wallet-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
    }
    .panel { padding: 18px; }
    .stat-card {
      padding: 16px;
      border-radius: 14px;
      background: var(--panel-2);
      border: 1px solid var(--line);
    }
    .eyebrow {
      font-size: 11px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 8px;
    }
    .value {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.03em;
    }
    .section {
      margin-top: 28px;
    }
    .section h2 {
      margin: 0 0 10px;
      font-size: 24px;
      letter-spacing: -0.03em;
    }
    .section p,
    .section li {
      color: var(--muted);
      line-height: 1.5;
    }
    .notes {
      margin: 0;
      padding-left: 18px;
    }
    .controls {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      align-items: end;
    }
    label {
      display: grid;
      gap: 6px;
      font-size: 13px;
      color: var(--muted);
    }
    input,
    select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 11px 12px;
      background: #fffdf9;
      color: var(--text);
      font: inherit;
    }
    .slice-card {
      padding: 18px;
      display: grid;
      gap: 10px;
      min-height: 230px;
    }
    .slice-card h3 {
      margin: 0;
      font-size: 18px;
      letter-spacing: -0.02em;
    }
    .mini-table {
      display: grid;
      gap: 8px;
    }
    .mini-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      padding-top: 8px;
      border-top: 1px dashed rgba(106, 93, 80, 0.18);
      font-size: 13px;
    }
    .mini-row strong {
      display: block;
      font-size: 14px;
      color: var(--text);
    }
    .wallet-card {
      padding: 18px;
      display: grid;
      gap: 14px;
      min-width: 0;
    }
    .wallet-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      min-width: 0;
    }
    .wallet-head > div:first-child {
      min-width: 0;
      flex: 1 1 auto;
    }
    .wallet-head h3 {
      margin: 0;
      font-size: 20px;
      line-height: 1.1;
      letter-spacing: -0.03em;
      overflow-wrap: anywhere;
    }
    .address {
      font-family: var(--mono);
      font-size: 12px;
      color: var(--muted);
      word-break: break-all;
    }
    .badge-row,
    .metric-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px 14px;
      min-width: 0;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: var(--panel-2);
      font-size: 12px;
      color: var(--muted);
    }
    .badge.good { color: var(--good); border-color: rgba(23, 101, 61, 0.25); }
    .badge.warn { color: var(--warn); border-color: rgba(154, 92, 0, 0.25); }
    .badge.bad { color: var(--bad); border-color: rgba(157, 47, 47, 0.25); }
    .metric {
      padding: 10px 12px;
      background: var(--panel-2);
      border: 1px solid rgba(106, 93, 80, 0.12);
      border-radius: 12px;
      min-width: 0;
      overflow: hidden;
    }
    .metric .name {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin-bottom: 6px;
      overflow-wrap: anywhere;
    }
    .metric .number {
      font-size: clamp(14px, 2vw, 18px);
      font-weight: 700;
      letter-spacing: -0.03em;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    details {
      border-top: 1px solid rgba(106, 93, 80, 0.16);
      padding-top: 12px;
    }
    details summary {
      cursor: pointer;
      font-weight: 600;
      color: var(--accent);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      font-size: 12px;
    }
    th, td {
      padding: 8px 6px;
      border-bottom: 1px solid rgba(106, 93, 80, 0.12);
      text-align: left;
      vertical-align: top;
    }
    th {
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 10px;
    }
    .empty {
      padding: 24px;
      text-align: center;
      color: var(--muted);
      border: 1px dashed var(--line);
      border-radius: 16px;
      background: rgba(255, 250, 242, 0.65);
    }
    @media (max-width: 720px) {
      .page { padding: 18px 14px 36px; }
      .hero { padding: 20px; border-radius: 22px; }
      .metric-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="page">
    <section class="hero">
      <div class="eyebrow">Tracked Wallet Methodology Surface</div>
      <h1>${escapeHtml(payload.user.displayName ?? payload.user.id)}</h1>
      <p>
        This report is a cohort-relative review surface for tracked wallets. It deliberately avoids trusting repo speed labels as ground truth.
        Instead it shows which wallets hold longer or shorter relative to the current cohort, which ones enter earlier or later by market cap,
        and which ones actually monetize through exit multiples, realized capture, and token-level ROI.
      </p>
      <div class="meta-grid">
        <div class="stat-card"><div class="eyebrow">User</div><div class="value">${escapeHtml(payload.user.id)}</div></div>
        <div class="stat-card"><div class="eyebrow">Tracked Wallets</div><div class="value">${payload.cohort.walletCount}</div></div>
        <div class="stat-card"><div class="eyebrow">Generated At</div><div class="value" style="font-size:18px">${escapeHtml(payload.cohort.generatedAt)}</div></div>
      </div>
    </section>

    <section class="section panel">
      <h2>Interpretation Notes</h2>
      <ul class="notes">
        ${payload.cohort.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}
      </ul>
      <div class="stats-grid" id="cohort-stats"></div>
    </section>

    <section class="section">
      <h2>Ranked Slices</h2>
      <p>These slices are not final truth. They are prompts for analyst review: different ways to surface potentially interesting wallets.</p>
      <div class="slice-grid" id="slice-grid"></div>
    </section>

    <section class="section panel">
      <h2>Explorer</h2>
      <div class="controls">
        <label>
          Search
          <input id="search" type="text" placeholder="wallet, label, collection, strategy" />
        </label>
        <label>
          Sort By
          <select id="sort">
            <option value="copytrade">Copy-Trade</option>
            <option value="composite">Composite</option>
            <option value="entry">Earliest Entry</option>
            <option value="hold">Longest Relative Hold</option>
            <option value="multiple">Exit Multiple</option>
            <option value="pnl">Realized PnL / Volume</option>
            <option value="efficiency">Weighted Efficiency</option>
            <option value="winrate">Token Win Rate</option>
          </select>
        </label>
        <label>
          Minimum Swaps
          <input id="min-swaps" type="number" min="0" step="1" value="0" />
        </label>
        <label>
          Minimum Composite
          <input id="min-score" type="number" min="0" max="1" step="0.01" value="0" />
        </label>
        <label>
          Maximum Entry Percentile
          <input id="max-entry" type="number" min="0" max="1" step="0.01" value="1" />
        </label>
        <label>
          Minimum Exit Multiple
          <input id="min-multiple" type="number" min="0" step="0.01" value="0" />
        </label>
      </div>
    </section>

    <section class="section">
      <h2>Wallet Explorer</h2>
      <div class="wallet-grid" id="wallet-grid"></div>
      <div id="empty-state" class="empty" hidden>No wallets match the current filters.</div>
    </section>
  </div>

  <script id="payload" type="application/json">${datasetBase64}</script>
  <script>
    const payload = JSON.parse(atob(document.getElementById('payload').textContent));
    const rows = payload.rows;
    const tokenBreakdown = payload.tokenBreakdown || {};

    const fmt = {
      n(value, digits = 2) {
        if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
        return Number(value).toFixed(digits).replace(/\\.0+$/, '').replace(/(\\.\\d*[1-9])0+$/, '$1');
      },
      pct(value) {
        if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
        return (Number(value) * 100).toFixed(1).replace(/\\.0$/, '') + '%';
      },
      win(value) {
        if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
        return Number(value).toFixed(1).replace(/\\.0$/, '') + '%';
      },
      usd(value) {
        if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
        const abs = Math.abs(Number(value));
        if (abs >= 1_000_000_000) return (value / 1_000_000_000).toFixed(2).replace(/\\.00$/, '') + 'b';
        if (abs >= 1_000_000) return (value / 1_000_000).toFixed(2).replace(/\\.00$/, '') + 'm';
        if (abs >= 1_000) return (value / 1_000).toFixed(1).replace(/\\.0$/, '') + 'k';
        return Number(value).toFixed(0);
      },
      short(value) {
        if (!value) return '-';
        return value.slice(0, 4) + '...' + value.slice(-4);
      }
    };

    const sortValue = (row, key) => {
      switch (key) {
        case 'copytrade': return row.copyTradeScore ?? -1;
        case 'entry': return row.entryPercentile !== null ? 1 - row.entryPercentile : -1;
        case 'hold': return row.holdPercentile ?? -1;
        case 'multiple': return row.multiplePercentile ?? -1;
        case 'pnl': return row.pnlPercentile ?? -1;
        case 'efficiency': return row.efficiencyPercentile ?? -1;
        case 'winrate': return row.winRatePercentile ?? -1;
        case 'composite':
        default: return row.compositeScore ?? -1;
      }
    };

    const sortRows = (inputRows, key) => {
      return [...inputRows].sort((a, b) => {
        const diff = sortValue(b, key) - sortValue(a, key);
        if (diff !== 0) return diff;
        return (b.netPnlUsd ?? -Infinity) - (a.netPnlUsd ?? -Infinity);
      });
    };

    const topBy = (key, count = 5, filterFn = () => true) => sortRows(rows.filter(filterFn), key).slice(0, count);

    function buildCohortStats() {
      const cards = [
        ['Median Copy-Trade', median(rows.map((row) => row.copyTradeScore).filter((v) => v !== null))],
        ['Median Composite', median(rows.map((row) => row.compositeScore).filter((v) => v !== null))],
        ['Median Exit Multiple', median(rows.map((row) => row.medianAvgExitEntryMultiple).filter((v) => v !== null))],
        ['Median Entry Mcap', median(rows.map((row) => row.typicalEntryMcapUsd).filter((v) => v !== null))],
        ['Median Hold Hours', median(rows.map((row) => row.medianHoldHours).filter((v) => v !== null))],
      ];
      document.getElementById('cohort-stats').innerHTML = cards.map(([label, value]) => \`
        <div class="stat-card">
          <div class="eyebrow">\${label}</div>
          <div class="value">\${typeof value === 'number' ? fmt.n(value, 3) : '-'}</div>
        </div>
      \`).join('');
    }

    function median(values) {
      if (!values.length) return null;
      const sorted = [...values].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
    }

    function renderSlices() {
      const slices = [
        {
          title: 'Copy-Trade Candidates',
          description: 'Prioritizes upside capture, realized monetization, repeatability, and earlier entry. Hold duration does not reduce this score.',
          rows: topBy('copytrade', 5, (row) => row.copyTradeScore !== null),
        },
        {
          title: 'Overall Interesting',
          description: 'Balanced cross-signal surface: exit multiples, monetization, hold relative to cohort, earlier entry, lower churn.',
          rows: topBy('composite', 5),
        },
        {
          title: 'Earliest Entrants',
          description: 'Smallest typical entry market-cap relative to the current tracked cohort.',
          rows: topBy('entry', 5, (row) => row.typicalEntryMcapUsd !== null),
        },
        {
          title: 'Best Exiters',
          description: 'Strongest exit-vs-entry behavior by token-level market-cap multiple.',
          rows: topBy('multiple', 5, (row) => row.medianAvgExitEntryMultiple !== null),
        },
        {
          title: 'High Upside Capture',
          description: 'Wallets repeatedly exiting at 2x+ token-level market-cap multiples.',
          rows: [...rows]
            .filter((row) => row.pctTokensAt2x !== null)
            .sort((a, b) => ((b.pctTokensAt2x ?? -1) - (a.pctTokensAt2x ?? -1)) || ((b.copyTradeScore ?? -1) - (a.copyTradeScore ?? -1)))
            .slice(0, 5),
        },
        {
          title: 'Longer Holders',
          description: 'Wallets holding materially longer than the tracked cohort, regardless of repo speed labels.',
          rows: topBy('hold', 5, (row) => row.medianHoldHours !== null),
        },
        {
          title: 'Realized Capture',
          description: 'Wallets turning activity into realized PnL efficiency, not just unrealized bags.',
          rows: topBy('pnl', 5, (row) => row.realizedPnlToVolume !== null),
        },
        {
          title: 'Noisy / Churny',
          description: 'High churn or weak exit behavior. Good place to study what \"garbage\" looks like.',
          rows: [...rows]
            .filter((row) => row.tradesPerToken !== null || row.medianAvgExitEntryMultiple !== null)
            .sort((a, b) => ((b.churnPercentile ?? -1) - (a.churnPercentile ?? -1)) || ((a.medianAvgExitEntryMultiple ?? Infinity) - (b.medianAvgExitEntryMultiple ?? Infinity)))
            .slice(0, 5),
        },
      ];

      document.getElementById('slice-grid').innerHTML = slices.map((slice) => \`
        <article class="slice-card">
          <div class="eyebrow">Slice</div>
          <h3>\${slice.title}</h3>
          <p>\${slice.description}</p>
          <div class="mini-table">
            \${slice.rows.map((row) => \`
              <div class="mini-row">
                <div>
                  <strong>\${row.label}</strong>
                  <span class="address">\${row.walletAddress}</span>
                </div>
                <div>
                  copy \${fmt.n(row.copyTradeScore, 3)}<br />
                  multiple \${fmt.n(row.medianAvgExitEntryMultiple, 3)}
                </div>
              </div>
            \`).join('')}
          </div>
        </article>
      \`).join('');
    }

    function badgeTone(row) {
      if ((row.compositeScore ?? 0) >= 0.75) return 'good';
      if ((row.compositeScore ?? 0) >= 0.55) return 'warn';
      return 'bad';
    }

    function buildEvidenceTable(row) {
      const tokens = (tokenBreakdown[row.walletAddress] || []).slice(0, 10);
      if (!tokens.length) {
        return '<div class="empty">No token-level evidence available for this wallet.</div>';
      }
      return \`
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th>Avg Exit / Entry</th>
              <th>First Exit / Entry</th>
              <th>Realized ROI</th>
              <th>Total ROI</th>
              <th>Typical Entry Mcap</th>
              <th>Typical Exit Mcap</th>
            </tr>
          </thead>
          <tbody>
            \${tokens.map((token) => \`
              <tr>
                <td><span class="address">\${token.tokenAddress}</span></td>
                <td>\${fmt.n(token.avgExitEntryMultiple, 3)}</td>
                <td>\${fmt.n(token.firstExitEntryMultiple, 3)}</td>
                <td>\${fmt.pct(token.realizedRoiPct)}</td>
                <td>\${fmt.pct(token.totalRoiPct)}</td>
                <td>\${fmt.usd(token.typicalEntryMcapUsd)}</td>
                <td>\${fmt.usd(token.typicalExitMcapUsd)}</td>
              </tr>
            \`).join('')}
          </tbody>
        </table>
      \`;
    }

    function renderWallet(row) {
      const displayTitle = row.label === row.walletAddress ? fmt.short(row.walletAddress) : row.label;
      const tags = [
        row.knownType ? { text: row.knownType, tone: 'warn' } : null,
        row.strategyType ? { text: row.strategyType, tone: '' } : null,
        row.speedCategory ? { text: row.speedCategory, tone: '' } : null,
        row.collections.length ? { text: row.collections.join(', '), tone: '' } : null,
        row.copyTradeScore !== null ? { text: 'copy ' + fmt.n(row.copyTradeScore, 3), tone: badgeTone({ ...row, compositeScore: row.copyTradeScore }) } : null,
        row.compositeScore !== null ? { text: 'score ' + fmt.n(row.compositeScore, 3), tone: badgeTone(row) } : null,
      ].filter(Boolean);

      return \`
        <article class="wallet-card">
          <div class="wallet-head">
            <div>
              <h3>\${displayTitle}</h3>
              <div class="address">\${row.walletAddress}</div>
            </div>
            <div class="badge \${badgeTone(row)}">\${fmt.short(row.walletAddress)}</div>
          </div>
          <div class="badge-row">
            \${tags.map((tag) => \`<span class="badge \${tag.tone}">\${tag.text}</span>\`).join('')}
          </div>
          <div class="metric-grid">
            <div class="metric"><div class="name">Copy-Trade Score</div><div class="number">\${fmt.n(row.copyTradeScore, 3)}</div></div>
            <div class="metric"><div class="name">Composite</div><div class="number">\${fmt.n(row.compositeScore, 3)}</div></div>
            <div class="metric"><div class="name">Median Exit Multiple</div><div class="number">\${fmt.n(row.medianAvgExitEntryMultiple, 3)}</div></div>
            <div class="metric"><div class="name">Realized PnL / Volume</div><div class="number">\${fmt.n(row.realizedPnlToVolume, 3)}</div></div>
            <div class="metric"><div class="name">Token Win Rate</div><div class="number">\${fmt.win(row.tokenWinRatePercent)}</div></div>
            <div class="metric"><div class="name">Typical Entry Mcap</div><div class="number">\${fmt.usd(row.typicalEntryMcapUsd)}</div></div>
            <div class="metric"><div class="name">Median Hold Hours</div><div class="number">\${fmt.n(row.medianHoldHours, 2)}</div></div>
            <div class="metric"><div class="name">Hold Percentile</div><div class="number">\${fmt.pct(row.holdPercentile)}</div></div>
            <div class="metric"><div class="name">Early Entry Percentile</div><div class="number">\${fmt.pct(row.entryPercentile !== null ? 1 - row.entryPercentile : null)}</div></div>
            <div class="metric"><div class="name">Median Token Realized ROI</div><div class="number">\${fmt.pct(row.medianTokenRealizedRoiPct)}</div></div>
            <div class="metric"><div class="name">Pct Tokens Above Entry</div><div class="number">\${fmt.pct(row.pctTokensAboveEntry)}</div></div>
            <div class="metric"><div class="name">Pct Tokens At 2x+</div><div class="number">\${fmt.pct(row.pctTokensAt2x)}</div></div>
            <div class="metric"><div class="name">Pct Tokens At 3x+</div><div class="number">\${fmt.pct(row.pctTokensAt3x)}</div></div>
            <div class="metric"><div class="name">Trades Per Token</div><div class="number">\${fmt.n(row.tradesPerToken, 2)}</div></div>
          </div>
          <details>
            <summary>Show evidence</summary>
            <div class="metric-grid" style="margin-top:12px">
              <div class="metric"><div class="name">Realized PnL USD</div><div class="number">\${fmt.usd(row.realizedPnlUsd)}</div></div>
              <div class="metric"><div class="name">Unrealized PnL USD</div><div class="number">\${fmt.usd(row.unrealizedPnlUsd)}</div></div>
              <div class="metric"><div class="name">Net PnL USD</div><div class="number">\${fmt.usd(row.netPnlUsd)}</div></div>
              <div class="metric"><div class="name">Weighted Efficiency</div><div class="number">\${fmt.n(row.weightedEfficiencyScore, 2)}</div></div>
              <div class="metric"><div class="name">Profit Consistency</div><div class="number">\${fmt.n(row.profitConsistencyIndex, 3)}</div></div>
              <div class="metric"><div class="name">Swaps</div><div class="number">\${fmt.n(row.swaps, 0)}</div></div>
            </div>
            \${buildEvidenceTable(row)}
          </details>
        </article>
      \`;
    }

    function applyFilters() {
      const search = document.getElementById('search').value.trim().toLowerCase();
      const sort = document.getElementById('sort').value;
      const minSwaps = Number(document.getElementById('min-swaps').value || 0);
      const minScore = Number(document.getElementById('min-score').value || 0);
      const maxEntry = Number(document.getElementById('max-entry').value || 1);
      const minMultiple = Number(document.getElementById('min-multiple').value || 0);

      const filtered = rows.filter((row) => {
        const haystack = [
          row.walletAddress,
          row.label,
          ...(row.collections || []),
          row.strategyType || '',
          row.speedCategory || '',
          row.tradingStyle || '',
        ].join(' ').toLowerCase();

        if (search && !haystack.includes(search)) return false;
        if ((row.swaps ?? 0) < minSwaps) return false;
        if ((row.compositeScore ?? 0) < minScore) return false;
        if ((row.entryPercentile ?? 1) > maxEntry) return false;
        if ((row.medianAvgExitEntryMultiple ?? 0) < minMultiple) return false;
        return true;
      });

      const sorted = sortRows(filtered, sort);
      document.getElementById('wallet-grid').innerHTML = sorted.map(renderWallet).join('');
      document.getElementById('empty-state').hidden = sorted.length > 0;
      if (sorted.length === 0) {
        document.getElementById('wallet-grid').innerHTML = '';
      }
    }

    ['search', 'sort', 'min-swaps', 'min-score', 'max-entry', 'min-multiple'].forEach((id) => {
      document.getElementById(id).addEventListener('input', applyFilters);
      document.getElementById(id).addEventListener('change', applyFilters);
    });

    buildCohortStats();
    renderSlices();
    applyFilters();
  </script>
</body>
</html>`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const user = await prisma.user.findUnique({
    where: options.userId ? { id: options.userId } : { id: '__global__missing__' },
    select: {
      id: true,
      displayName: true,
      isActive: true,
      isAnalyst: true,
    },
  });

  if (options.scope === 'tracked' && !user) {
    throw new Error(`User ${options.userId} not found.`);
  }

  const favoriteRows = options.scope === 'global'
    ? await fetchGlobalWalletRows(options)
    : await fetchTrackedWalletRows(options.userId!);

  if (favoriteRows.length === 0) {
    throw new Error(
      options.scope === 'global'
        ? 'Global candidate scan returned no wallets.'
        : `User ${options.userId} has no tracked wallets.`,
    );
  }

  const walletAddresses = favoriteRows.map((row) => row.walletAddress);
  const [tokenRows, firstRows] = await Promise.all([
    fetchTokenMetricRows(walletAddresses),
    fetchFirstTradeRows(walletAddresses),
  ]);

  const { byWallet, tokenBreakdown } = buildWalletTokenStats(tokenRows, firstRows);
  const reviewRows = buildReviewRows(favoriteRows, byWallet);
  const sortedRows = sortRows(reviewRows, options.sortBy);
  const limitedRows = options.limit ? sortedRows.slice(0, options.limit) : sortedRows;

  const notes = [
    'Percentiles are cohort-relative to the tracked wallets of the selected user.',
    'Higher hold percentile means longer holds relative to the cohort, not the repo speed labels.',
    'Higher entry percentile in the table means earlier/smaller entry market cap because it is inverted for readability.',
    'Token multiple metrics are based on token-level avgExitMcap / avgEntryMcap and first-sell / first-buy market-cap pairs where available.',
  ];

  if (options.format === 'json') {
    const payload: JsonOutput = {
      user: {
        id: options.scope === 'global' ? 'global' : user!.id,
        displayName: options.scope === 'global' ? 'Global Wallet Scan' : user!.displayName,
        isAnalyst: options.scope === 'global' ? true : user!.isAnalyst,
        isActive: options.scope === 'global' ? true : user!.isActive,
      },
      cohort: {
        walletCount: favoriteRows.length,
        generatedAt: new Date().toISOString(),
        notes,
      },
      rows: limitedRows.map((row) => ({
        ...row,
        compositeScore: round(row.compositeScore, 4),
      })),
      ...(options.includeTokens ? { tokenBreakdown } : {}),
    };

    const json = JSON.stringify(payload, null, 2);
    if (options.outputPath) {
      const resolved = path.resolve(options.outputPath);
      fs.writeFileSync(resolved, `${json}\n`, 'utf8');
      console.log(`Wrote review output to ${resolved}`);
    } else {
      console.log(json);
    }
  } else if (options.format === 'html') {
    const payload: JsonOutput = {
      user: {
        id: options.scope === 'global' ? 'global' : user!.id,
        displayName: options.scope === 'global' ? 'Global Wallet Scan' : user!.displayName,
        isAnalyst: options.scope === 'global' ? true : user!.isAnalyst,
        isActive: options.scope === 'global' ? true : user!.isActive,
      },
      cohort: {
        walletCount: favoriteRows.length,
        generatedAt: new Date().toISOString(),
        notes,
      },
      rows: limitedRows.map((row) => ({
        ...row,
        compositeScore: round(row.compositeScore, 4),
      })),
      tokenBreakdown,
    };

    const html = renderHtml(payload);
    if (options.outputPath) {
      const resolved = path.resolve(options.outputPath);
      fs.writeFileSync(resolved, `${html}\n`, 'utf8');
      console.log(`Wrote review output to ${resolved}`);
    } else {
      console.log(html);
    }
  } else {
    console.log(`User: ${options.scope === 'global' ? 'Global Wallet Scan' : `${user!.displayName ?? user!.id} (${user!.id})`}`);
    console.log(`Tracked wallets: ${favoriteRows.length}`);
    if (options.scope === 'global') {
      console.log(`Global candidate pool: ${options.candidateLimit}`);
      console.log(`Exclude verified bots: ${options.excludeVerifiedBots ? 'yes' : 'no'}`);
      console.log(`Excluded speed categories: ${options.excludeSpeedCategories.join(', ') || '-'}`);
      console.log(`Minimum unique tokens: ${options.minUniqueTokens}`);
      console.log(`Minimum active days: ${options.minActiveDays}`);
      console.log(`Maximum inactive days: ${options.maxInactiveDays}`);
    }
    console.log(`Sort: ${options.sortBy}`);
    console.log(notes.map((note) => `- ${note}`).join('\n'));
    console.log('');
    printTable(limitedRows.map((row) => ({
      ...row,
      compositeScore: round(row.compositeScore, 4),
    })));
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
