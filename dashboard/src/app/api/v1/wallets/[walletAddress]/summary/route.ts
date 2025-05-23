import { NextResponse } from 'next/server';
import type { WalletSummaryData, AdvancedStatsResult, BehaviorMetrics } from '@/types/api';

// Helper function to generate a random float within a range
function getRandomFloat(min: number, max: number, decimals: number): number {
  const str = (Math.random() * (max - min) + min).toFixed(decimals);
  return parseFloat(str);
}

// Helper function to generate a random integer within a range
function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function GET(
  request: Request,
  { params }: { params: { walletAddress: string } }
) {
  const awaitedParams = await params;
  const { walletAddress } = awaitedParams;

  const { searchParams } = new URL(request.url);
  const startDateParam: string | null = searchParams.get('startDate');
  const endDateParam: string | null = searchParams.get('endDate');

  // Simulate a delay
  await new Promise(resolve => setTimeout(resolve, getRandomInt(300, 1000)));

  if (walletAddress === "empty-wallet" || walletAddress === "new-wallet") {
    const mockEmptyData: WalletSummaryData = {
      walletAddress,
      lastActiveTimestamp: null,
      daysActive: 0,
      keyPerformanceIndicators: {
        latestPnl: null,
        tokenWinRate: null,
      },
      behaviorClassification: "New Wallet",
      rawAdvancedStats: { latestPnl: null, tokenWinRate: null },
      rawBehaviorMetrics: { classification: "New Wallet" },
      // Include received dates for verification
      receivedStartDate: startDateParam,
      receivedEndDate: endDateParam,
    };
    return NextResponse.json(mockEmptyData);
  }

  if (walletAddress === "error-wallet") {
    return NextResponse.json({ message: "Simulated server error for this wallet." }, { status: 500 });
  }

  // More detailed mock data for a typical wallet
  const daysActive: number = getRandomInt(1, 365);
  const lastActiveDate = new Date();
  lastActiveDate.setDate(lastActiveDate.getDate() - getRandomInt(0, daysActive)); // Active within its active period

  // Slightly adjust PNL if a startDate is provided, for visual feedback
  const basePnl: number = getRandomFloat(-5000, 20000, 2);
  const adjustedPnl: number = startDateParam ? basePnl * 0.8 : basePnl; // Simulate PNL change with time filter

  const mockData: WalletSummaryData = {
    walletAddress,
    lastActiveTimestamp: lastActiveDate.toISOString(),
    daysActive: daysActive,
    keyPerformanceIndicators: {
      latestPnl: adjustedPnl,
      tokenWinRate: getRandomFloat(0.3, 0.85, 2), // win rate between 30% and 85%
    },
    behaviorClassification: ["Conservative Trader", "Active Swapper", "Occasional Investor"][getRandomInt(0,2)],
    rawAdvancedStats: {
        latestPnl: adjustedPnl, 
        tokenWinRate: getRandomFloat(0.3, 0.85, 2),
    },
    rawBehaviorMetrics: {
        classification: ["Conservative", "Aggressive", "Passive"][getRandomInt(0,2)],
    },
    // Include received dates for verification
    receivedStartDate: startDateParam,
    receivedEndDate: endDateParam,
  };

  return NextResponse.json(mockData);
}

// Opt-out of caching for this dynamic route
export const dynamic = 'force-dynamic'; 