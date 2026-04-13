import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

const PORT = Number(process.env.WALLET_STRATEGY_LAB_PORT ?? process.env.LAB_PORT ?? 4179);
const HOST = process.env.HOST ?? '127.0.0.1';
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const LAB_USER = process.env.LAB_USER ?? '';
const LAB_PASSWORD = process.env.LAB_PASSWORD ?? '';
const REQUIRE_BASIC_AUTH = Boolean(LAB_USER && LAB_PASSWORD);

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
]);

const DATABASE_CONFIGURED = Boolean(DATABASE_URL);
const prisma = DATABASE_CONFIGURED
  ? new PrismaClient({
      datasources: {
        db: {
          url: addStatementTimeout(DATABASE_URL),
        },
      },
    })
  : null;

let databaseConnected = false;

function addStatementTimeout(rawUrl) {
  const url = new URL(rawUrl);
  if (!url.searchParams.has('statement_timeout')) {
    url.searchParams.set('statement_timeout', '120000');
  }
  return url.toString();
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function unauthorized(res) {
  send(res, 401, 'Unauthorized', {
    'WWW-Authenticate': 'Basic realm="Wallet Strategy Lab", charset="UTF-8"',
    'Content-Type': 'text/plain; charset=utf-8',
  });
}

function hasAuth(req) {
  if (!REQUIRE_BASIC_AUTH) return true;
  const header = req.headers.authorization;
  if (!header?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex < 0) return false;
  const user = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);
  return user === LAB_USER && password === LAB_PASSWORD;
}

async function readAsset(filename) {
  return readFile(path.join(publicDir, filename));
}

function isLikelyWallet(value) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(value);
}

function safePercent(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return (numerator / denominator) * 100;
}

function getOutcome(realizedPnlSol) {
  if (realizedPnlSol == null) return 'FLAT';
  if (realizedPnlSol > 0.000001) return 'WIN';
  if (realizedPnlSol < -0.000001) return 'LOSS';
  return 'FLAT';
}

function compareTokenRows(a, b) {
  const aFirst = a.firstTransferTimestamp ?? Number.MAX_SAFE_INTEGER;
  const bFirst = b.firstTransferTimestamp ?? Number.MAX_SAFE_INTEGER;
  if (aFirst !== bFirst) return aFirst - bFirst;

  const aLast = a.lastTransferTimestamp ?? Number.MAX_SAFE_INTEGER;
  const bLast = b.lastTransferTimestamp ?? Number.MAX_SAFE_INTEGER;
  if (aLast !== bLast) return aLast - bLast;

  return a.tokenAddress.localeCompare(b.tokenAddress);
}

function compareSwaps(a, b) {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  return a.signature.localeCompare(b.signature);
}

function getMedian(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const left = sorted[mid - 1];
  const right = sorted[mid];
  return left != null && right != null ? (left + right) / 2 : null;
}

function getBuyStats(swaps) {
  const firstSellIndex = swaps.findIndex((swap) => swap.direction === 'out');
  const beforeFirstSell = firstSellIndex >= 0 ? swaps.slice(0, firstSellIndex) : swaps;
  const buyRows = beforeFirstSell.filter((swap) => swap.direction === 'in');
  const totalBoughtBeforeFirstSell = buyRows.reduce((sum, row) => sum + row.amount, 0);
  const totalBuyUsd = buyRows.reduce((sum, row) => sum + (row.usdValue ?? 0), 0);
  const weightedMcapBeforeFirstSell = totalBuyUsd > 0
    ? buyRows.reduce((sum, row) => sum + (row.marketCapUsd ?? 0) * (row.usdValue ?? 0), 0) / totalBuyUsd
    : null;

  return {
    buyCountBeforeFirstSell: buyRows.length,
    totalBoughtBeforeFirstSell,
    weightedMcapBeforeFirstSell,
  };
}

async function ensureDatabaseReady() {
  if (!prisma) {
    throw new Error('DATABASE_URL is not configured for the standalone lab.');
  }

  if (databaseConnected) {
    return;
  }

  await prisma.$connect();
  databaseConnected = true;
}

async function fetchStrategy(wallet) {
  await ensureDatabaseReady();

  const [analysisRows, swapRows] = await Promise.all([
    prisma.analysisResult.findMany({
      where: { walletAddress: wallet },
      orderBy: { firstTransferTimestamp: 'asc' },
    }),
    prisma.swapAnalysisInput.findMany({
      where: { walletAddress: wallet },
      orderBy: { timestamp: 'asc' },
    }),
  ]);

  if (analysisRows.length === 0) {
    return { status: 404, data: { message: `No strategy data available for wallet ${wallet}` } };
  }

  const swapsByMint = new Map();
  for (const swap of swapRows) {
    const existing = swapsByMint.get(swap.mint) ?? [];
    existing.push(swap);
    swapsByMint.set(swap.mint, existing);
  }

  const orderedAnalysisRows = [...analysisRows].sort(compareTokenRows);
  const orderedOutcomes = orderedAnalysisRows.map((row, index) => ({
    sequenceIndex: index + 1,
    mint: row.tokenAddress,
    outcome: getOutcome(row.realizedPnlSol),
    realizedPnlSol: row.realizedPnlSol ?? null,
    firstTransferTimestamp: row.firstTransferTimestamp ?? null,
    lastTransferTimestamp: row.lastTransferTimestamp ?? null,
  }));

  const tokens = orderedAnalysisRows.map((row, index) => {
    const mintSwaps = [...(swapsByMint.get(row.tokenAddress) ?? [])].sort(compareSwaps);
    const buyRows = mintSwaps.filter((swap) => swap.direction === 'in');
    const sellRows = mintSwaps.filter((swap) => swap.direction === 'out');
    const firstBuy = buyRows[0] ?? null;
    const secondBuy = buyRows[1] ?? null;
    const firstSellIndex = mintSwaps.findIndex((swap) => swap.direction === 'out');
    const firstSell = firstSellIndex >= 0 ? mintSwaps[firstSellIndex] ?? null : null;
    const buyStats = getBuyStats(mintSwaps);

    let cumulativeSold = 0;
    const sellEvents = sellRows.map((swap, sellIndex) => {
      cumulativeSold += swap.amount;
      const sellPctOfInitialInventory = safePercent(swap.amount, buyStats.totalBoughtBeforeFirstSell);
      const cumulativeSoldPctOfInitialInventory = safePercent(cumulativeSold, buyStats.totalBoughtBeforeFirstSell);
      const pumpVsFirstBuyPct =
        firstBuy?.marketCapUsd != null && swap.marketCapUsd != null && firstBuy.marketCapUsd > 0
          ? ((swap.marketCapUsd / firstBuy.marketCapUsd) - 1) * 100
          : null;
      const pumpVsWeightedEntryPct =
        buyStats.weightedMcapBeforeFirstSell != null && swap.marketCapUsd != null && buyStats.weightedMcapBeforeFirstSell > 0
          ? ((swap.marketCapUsd / buyStats.weightedMcapBeforeFirstSell) - 1) * 100
          : null;

      return {
        eventType: 'SELL',
        sellNumber: sellIndex + 1,
        signature: swap.signature,
        timestamp: swap.timestamp,
        amount: swap.amount,
        associatedSolValue: swap.associatedSolValue,
        usdValue: swap.usdValue ?? null,
        tokenPriceUsd: swap.tokenPriceUsd ?? null,
        marketCapUsd: swap.marketCapUsd ?? null,
        sellPctOfInitialInventory,
        cumulativeSoldPctOfInitialInventory,
        pumpVsFirstBuyPct,
        pumpVsWeightedEntryPct,
        minutesFromFirstBuy: firstBuy != null ? (swap.timestamp - firstBuy.timestamp) / 60 : null,
      };
    });

    const buyEvents = buyRows.map((swap, buyIndex) => {
      const isReentry = firstSell != null && swap.timestamp > firstSell.timestamp;
      const minutesFromFirstBuy = firstBuy != null ? (swap.timestamp - firstBuy.timestamp) / 60 : null;

      return {
        eventType: 'BUY',
        eventNumber: buyIndex + 1,
        signature: swap.signature,
        timestamp: swap.timestamp,
        amount: swap.amount,
        associatedSolValue: swap.associatedSolValue,
        usdValue: swap.usdValue ?? null,
        tokenPriceUsd: swap.tokenPriceUsd ?? null,
        marketCapUsd: swap.marketCapUsd ?? null,
        sellPctOfInitialInventory: null,
        cumulativeSoldPctOfInitialInventory: null,
        pumpVsFirstBuyPct: null,
        pumpVsWeightedEntryPct: null,
        minutesFromFirstBuy,
        isReentry,
      };
    });

    const sellPctInitials = sellEvents
      .map((event) => event.sellPctOfInitialInventory)
      .filter((value) => value != null);

    const firstSellEvent = sellEvents[0] ?? null;
    const secondSellEvent = sellEvents[1] ?? null;
    const activityEvents = [...buyEvents, ...sellEvents]
      .sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        return a.signature.localeCompare(b.signature);
      })
      .map((event, activityIndex) => ({
        ...event,
        activityIndex: activityIndex + 1,
      }));

    return {
      mint: row.tokenAddress,
      sequenceIndex: index + 1,
      outcome: getOutcome(row.realizedPnlSol),
      realizedPnlSol: row.realizedPnlSol ?? null,
      totalAmountIn: row.totalAmountIn,
      totalAmountOut: row.totalAmountOut,
      firstTransferTimestamp: row.firstTransferTimestamp ?? null,
      lastTransferTimestamp: row.lastTransferTimestamp ?? null,
      firstBuyTimestamp: firstBuy?.timestamp ?? null,
      firstBuyAmount: firstBuy?.amount ?? null,
      firstBuyMarketCapUsd: firstBuy?.marketCapUsd ?? null,
      firstBuyUsdValue: firstBuy?.usdValue ?? null,
      secondBuyTimestamp: secondBuy?.timestamp ?? null,
      secondBuyMarketCapUsd: secondBuy?.marketCapUsd ?? null,
      secondBuyUsdValue: secondBuy?.usdValue ?? null,
      buyCount: buyRows.length,
      reentryCount: buyRows.length > 1 && firstSell != null
        ? buyRows.filter((buy) => buy.timestamp > firstSell.timestamp).length
        : 0,
      hasReentry: buyRows.length > 1 && firstSell != null
        ? buyRows.some((buy) => buy.timestamp > firstSell.timestamp)
        : false,
      firstSellTimestamp: firstSell?.timestamp ?? null,
      firstSellMarketCapUsd: firstSell?.marketCapUsd ?? null,
      buyCountBeforeFirstSell: buyStats.buyCountBeforeFirstSell,
      sellCount: sellRows.length,
      totalBoughtBeforeFirstSell: buyStats.totalBoughtBeforeFirstSell > 0 ? buyStats.totalBoughtBeforeFirstSell : null,
      weightedBuyMcapBeforeFirstSell: buyStats.weightedMcapBeforeFirstSell,
      totalSoldPctOfTotalBought: safePercent(row.totalAmountOut, row.totalAmountIn),
      firstSellPctInitial: firstSellEvent?.sellPctOfInitialInventory ?? null,
      firstSellPumpPct: firstSellEvent?.pumpVsFirstBuyPct ?? null,
      secondSellPctInitial: secondSellEvent?.sellPctOfInitialInventory ?? null,
      secondSellPumpPct: secondSellEvent?.pumpVsFirstBuyPct ?? null,
      maxSellPumpPct: sellEvents.reduce((max, event) => {
        if (event.pumpVsFirstBuyPct == null) return max;
        if (max == null) return event.pumpVsFirstBuyPct;
        return Math.max(max, event.pumpVsFirstBuyPct);
      }, null),
      medianSellSlicePctInitial: getMedian(sellPctInitials),
      activityEvents,
      sellEvents,
    };
  });

  let winCount = 0;
  let lossCount = 0;
  let flatCount = 0;
  let totalWinSol = 0;
  let totalLossSol = 0;
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  const cadenceTokens = tokens.filter((token) => token.outcome !== 'FLAT');

  for (const token of tokens) {
    if (token.outcome === 'WIN') {
      winCount += 1;
      totalWinSol += token.realizedPnlSol ?? 0;
      currentWinStreak += 1;
      currentLossStreak = 0;
      longestWinStreak = Math.max(longestWinStreak, currentWinStreak);
    } else if (token.outcome === 'LOSS') {
      lossCount += 1;
      totalLossSol += token.realizedPnlSol ?? 0;
      currentLossStreak += 1;
      currentWinStreak = 0;
      longestLossStreak = Math.max(longestLossStreak, currentLossStreak);
    } else {
      flatCount += 1;
      currentWinStreak = 0;
      currentLossStreak = 0;
    }
  }

  const gapBetweenWins = {};
  const cadenceWinPositions = cadenceTokens
    .map((token, index) => (token.outcome === 'WIN' ? index : null))
    .filter((value) => value != null);

  for (let index = 1; index < cadenceWinPositions.length; index += 1) {
    const previous = cadenceWinPositions[index - 1];
    const current = cadenceWinPositions[index];
    if (previous == null || current == null) continue;
    const gap = current - previous - 1;
    const key = String(gap);
    gapBetweenWins[key] = (gapBetweenWins[key] ?? 0) + 1;
  }

  const summary = {
    totalTokens: tokens.length,
    winCount,
    lossCount,
    flatCount,
    winRatePct: tokens.length > 0 ? (winCount / tokens.length) * 100 : 0,
    totalWinSol,
    totalLossSol,
    avgWinSol: winCount > 0 ? totalWinSol / winCount : null,
    avgLossSol: lossCount > 0 ? totalLossSol / lossCount : null,
    longestWinStreak,
    longestLossStreak,
    gapBetweenWins,
  };

  return {
    status: 200,
    data: {
      walletAddress: wallet,
      summary,
      orderedOutcomes,
      tokens,
    },
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (!hasAuth(req)) {
      unauthorized(res);
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${HOST}:${PORT}`}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      send(res, 200, JSON.stringify({
        ok: true,
        databaseConfigured: DATABASE_CONFIGURED,
        databaseConnected,
        authEnabled: REQUIRE_BASIC_AUTH,
      }), { 'Content-Type': 'application/json; charset=utf-8' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/strategy') {
      const wallet = (url.searchParams.get('wallet') ?? '').trim();
      if (!isLikelyWallet(wallet)) {
        send(res, 400, JSON.stringify({ message: 'Invalid wallet address.' }), {
          'Content-Type': 'application/json; charset=utf-8',
        });
        return;
      }

      try {
        const result = await fetchStrategy(wallet);
        send(res, result.status, JSON.stringify(result.data), {
          'Content-Type': 'application/json; charset=utf-8',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown database error';
        send(res, 503, JSON.stringify({ message }), {
          'Content-Type': 'application/json; charset=utf-8',
        });
      }
      return;
    }

    const assetName = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const assetPath = path.join(publicDir, assetName);

    if (!assetPath.startsWith(publicDir)) {
      send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }

    try {
      const file = await readFile(assetPath);
      const ext = path.extname(assetName).toLowerCase();
      send(res, 200, file, {
        'Content-Type': MIME_TYPES.get(ext) ?? 'application/octet-stream',
      });
    } catch {
      const file = await readAsset('index.html');
      send(res, 200, file, { 'Content-Type': 'text/html; charset=utf-8' });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    send(res, 500, JSON.stringify({ message }), {
      'Content-Type': 'application/json; charset=utf-8',
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Wallet Strategy Lab running at http://${HOST}:${PORT}`);
  if (DATABASE_CONFIGURED) {
    console.log('Reading strategy data directly from DATABASE_URL.');
  } else {
    console.log('DATABASE_URL is not configured. The strategy endpoint will fail until it is provided.');
  }
  if (REQUIRE_BASIC_AUTH) {
    console.log('Basic auth enabled for local access.');
  } else {
    console.log('Basic auth not configured. Bind remains localhost-only by default.');
  }
});
