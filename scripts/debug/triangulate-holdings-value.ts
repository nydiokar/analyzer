/**
 * Triangulate holdings value across three different data sources:
 * 1. Token Performance API (fresh calculation from current prices)
 * 2. Holder Profiles API (cached data with currentHoldings array)
 * 3. Wallet HUD API (aggregates from AnalysisResult table)
 */

import { prisma } from '../../src/core/services/database-service';
import axios from 'axios';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function main() {
  const walletAddress = process.argv[2] || 'DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm';

  console.log(`\n🔍 Triangulating holdings value for: ${walletAddress}\n`);
  console.log('='.repeat(80));

  // ============================================================================
  // SOURCE 1: DATABASE RAW - What's actually stored in AnalysisResult
  // ============================================================================
  console.log('\n📊 SOURCE 1: DATABASE RAW (AnalysisResult table)');
  console.log('-'.repeat(80));

  const analysisResults = await prisma.analysisResult.findMany({
    where: { walletAddress },
    select: {
      tokenAddress: true,
      currentUiBalance: true,
      currentHoldingsValueSol: true,
      currentHoldingsValueUsd: true,
      currentHoldingsCostBasisSol: true,
      unrealizedPnlSol: true,
    },
    orderBy: {
      currentHoldingsValueSol: 'desc',
    },
  });

  // Aggregate - exactly as HUD does (gt: 0 filter)
  const dbAggregateFiltered = await prisma.analysisResult.aggregate({
    where: {
      walletAddress,
      currentHoldingsValueSol: { not: null, gt: 0 },
    },
    _sum: {
      currentHoldingsValueSol: true,
      currentHoldingsValueUsd: true,
    },
  });

  // Aggregate - no filter (include all)
  const dbAggregateAll = await prisma.analysisResult.aggregate({
    where: {
      walletAddress,
      currentHoldingsValueSol: { not: null },
    },
    _sum: {
      currentHoldingsValueSol: true,
      currentHoldingsValueUsd: true,
      unrealizedPnlSol: true,
    },
  });

  console.log('With gt: 0 filter (HUD query):');
  console.log(`  Sum currentHoldingsValueSol: ${dbAggregateFiltered._sum.currentHoldingsValueSol} SOL`);
  console.log(`  Sum currentHoldingsValueUsd: $${dbAggregateFiltered._sum.currentHoldingsValueUsd}`);

  console.log('\nWithout filter (all non-null):');
  console.log(`  Sum currentHoldingsValueSol: ${dbAggregateAll._sum.currentHoldingsValueSol} SOL`);
  console.log(`  Sum currentHoldingsValueUsd: $${dbAggregateAll._sum.currentHoldingsValueUsd}`);
  console.log(`  Sum unrealizedPnlSol: ${dbAggregateAll._sum.unrealizedPnlSol} SOL`);

  // Show top 5 holdings with actual values
  console.log('\nTop 5 holdings in database:');
  analysisResults.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.tokenAddress.slice(0, 8)}...`);
    console.log(`     currentUiBalance: ${r.currentUiBalance}`);
    console.log(`     currentHoldingsValueSol: ${r.currentHoldingsValueSol}`);
    console.log(`     currentHoldingsValueUsd: ${r.currentHoldingsValueUsd}`);
    console.log(`     unrealizedPnlSol: ${r.unrealizedPnlSol}`);
  });

  // ============================================================================
  // SOURCE 2: TOKEN PERFORMANCE API (fresh price calculation)
  // ============================================================================
  console.log('\n📊 SOURCE 2: TOKEN PERFORMANCE API');
  console.log('-'.repeat(80));

  try {
    const tokenPerfResponse = await axios.get(
      `${API_BASE}/api/analyses/${walletAddress}/token-performance`,
      {
        params: {
          showOnlyHoldings: true,
        },
      }
    );

    const tokens = tokenPerfResponse.data.tokenPerformanceData || [];
    const tokensWithHoldings = tokens.filter((t: any) => (t.currentUiBalance ?? 0) > 0);

    console.log(`Found ${tokensWithHoldings.length} tokens with current holdings`);

    // Calculate total from Token Performance data
    let totalSolFromTokenPerf = 0;
    let totalUsdFromTokenPerf = 0;

    tokensWithHoldings.slice(0, 5).forEach((token: any, i: number) => {
      console.log(`\n  ${i + 1}. ${token.tokenAddress?.slice(0, 8)}...`);
      console.log(`     currentUiBalance: ${token.currentUiBalance}`);
      console.log(`     currentHoldingsValueSol: ${token.currentHoldingsValueSol}`);
      console.log(`     currentHoldingsValueUsd: ${token.currentHoldingsValueUsd}`);
      console.log(`     unrealizedPnlSol: ${token.unrealizedPnlSol}`);
      console.log(`     priceUsd: $${token.priceUsd}`);

      if (token.currentHoldingsValueSol) totalSolFromTokenPerf += token.currentHoldingsValueSol;
      if (token.currentHoldingsValueUsd) totalUsdFromTokenPerf += token.currentHoldingsValueUsd;
    });

    // Sum ALL holdings
    tokensWithHoldings.forEach((token: any) => {
      if (token.currentHoldingsValueSol && tokensWithHoldings.indexOf(token) >= 5) {
        totalSolFromTokenPerf += token.currentHoldingsValueSol;
      }
      if (token.currentHoldingsValueUsd && tokensWithHoldings.indexOf(token) >= 5) {
        totalUsdFromTokenPerf += token.currentHoldingsValueUsd;
      }
    });

    console.log(`\nToken Performance Total (calculated):`);
    console.log(`  Total currentHoldingsValueSol: ${totalSolFromTokenPerf.toFixed(2)} SOL`);
    console.log(`  Total currentHoldingsValueUsd: $${totalUsdFromTokenPerf.toFixed(2)}`);
  } catch (error: any) {
    console.error(`  ❌ Error fetching Token Performance: ${error.message}`);
  }

  // ============================================================================
  // SOURCE 3: WALLET HUD API
  // ============================================================================
  console.log('\n📊 SOURCE 3: WALLET HUD API');
  console.log('-'.repeat(80));

  try {
    const hudResponse = await axios.get(`${API_BASE}/api/wallet-hud/${walletAddress}`);
    const hudData = hudResponse.data;

    console.log('HUD Data:');
    console.log(`  currentHoldingsSol: ${hudData.currentHoldingsSol} SOL`);
    console.log(`  currentHoldingsUsd: $${hudData.currentHoldingsUsd}`);
    console.log(`  trimmedMeanPnl: ${hudData.trimmedMeanPnl} SOL`);
    console.log(`  isWhale: ${hudData.isWhale}`);
    console.log(`  calculatedAt: ${hudData.calculatedAt}`);
  } catch (error: any) {
    console.error(`  ❌ Error fetching HUD: ${error.message}`);
  }

  // ============================================================================
  // SOURCE 4: HOLDER PROFILES API (if available)
  // ============================================================================
  console.log('\n📊 SOURCE 4: HOLDER PROFILES API (checking...)');
  console.log('-'.repeat(80));

  // Note: Holder profiles require a token mint, so we'll skip for now
  console.log('  ⏭️  Skipped (requires token mint parameter)');

  // ============================================================================
  // SUMMARY & COMPARISON
  // ============================================================================
  console.log('\n');
  console.log('='.repeat(80));
  console.log('📊 SUMMARY & ANALYSIS');
  console.log('='.repeat(80));

  console.log(`\nDatabase (filtered gt:0):   ${dbAggregateFiltered._sum.currentHoldingsValueSol?.toFixed(2)} SOL`);
  console.log(`Database (all):             ${dbAggregateAll._sum.currentHoldingsValueSol?.toFixed(2)} SOL`);
  console.log(`Unrealized P/L (database):  ${dbAggregateAll._sum.unrealizedPnlSol?.toFixed(2)} SOL`);

  console.log('\n✅ Investigation complete!\n');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
