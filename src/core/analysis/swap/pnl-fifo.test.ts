import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { SwapAnalyzer } from './analyzer';
import { WalletBalance } from '@/types/wallet';
import type { SwapAnalysisInput } from '@prisma/client';

const WALLET = 'TestWalletPnLFifo1111111111111111111111111111';
const TOKEN_MINT = 'TestTokenPnLFifo1111111111111111111111111';

function makeSwapInput(params: {
  signature: string;
  timestamp: number;
  direction: 'in' | 'out';
  amount: number;
  associatedSolValue: number;
}): SwapAnalysisInput {
  return {
    id: 0,
    walletAddress: WALLET,
    signature: params.signature,
    timestamp: params.timestamp,
    mint: TOKEN_MINT,
    amount: params.amount,
    direction: params.direction,
    associatedSolValue: params.associatedSolValue,
    associatedUsdcValue: null,
    interactionType: 'SWAP',
    feeAmount: 0,
    feePercentage: null,
  };
}

function approxEqual(actual: number, expected: number, epsilon = 1e-9): boolean {
  return Math.abs(actual - expected) <= epsilon;
}

describe('PnL FIFO regression – partial sells', () => {
  it('SwapAnalyzer should realize FIFO profit for partial sell (expected 200 SOL)', () => {
    const analyzer = new SwapAnalyzer();

    const inputs: SwapAnalysisInput[] = [
      makeSwapInput({ signature: 'sig-1', timestamp: 1, direction: 'in', amount: 100, associatedSolValue: 100 }),
      makeSwapInput({ signature: 'sig-2', timestamp: 2, direction: 'in', amount: 100, associatedSolValue: 200 }),
      makeSwapInput({ signature: 'sig-3', timestamp: 3, direction: 'out', amount: 100, associatedSolValue: 300 }),
    ];

    const { results } = analyzer.analyze(inputs, WALLET);
    const result = results.find(r => r.tokenAddress === TOKEN_MINT);

    assert.ok(result, 'Expected analysis result for test token');
    const netPnl = result!.netSolProfitLoss;
    assert.ok(netPnl !== null && netPnl !== undefined, 'Expected non-null netSolProfitLoss');
    assert.ok(
      approxEqual(netPnl, 200),
      `Expected FIFO realized PnL of 200 SOL, got ${netPnl}`,
    );
  });

  it('SwapAnalyzer should treat transfer-out as zero-proceeds disposal', () => {
    const analyzer = new SwapAnalyzer();

    const inputs: SwapAnalysisInput[] = [
      makeSwapInput({ signature: 'sig-1', timestamp: 1, direction: 'in', amount: 100, associatedSolValue: 100 }),
      makeSwapInput({ signature: 'sig-2', timestamp: 2, direction: 'out', amount: 100, associatedSolValue: 0 }),
    ];

    const { results } = analyzer.analyze(inputs, WALLET);
    const result = results.find(r => r.tokenAddress === TOKEN_MINT);

    assert.ok(result, 'Expected analysis result for test token');
    const netPnl = result!.netSolProfitLoss;
    assert.ok(netPnl !== null && netPnl !== undefined, 'Expected non-null netSolProfitLoss');
    assert.ok(
      approxEqual(netPnl, -100),
      `Expected transfer-out PnL of -100 SOL, got ${netPnl}`,
    );
  });

  it('PnlAnalysisService total PnL should match (received + holdings - spent) for partial exit', async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/db';
    const { PnlAnalysisService } = await import('../../services/pnl-analysis-service');
    const inputs: SwapAnalysisInput[] = [
      makeSwapInput({ signature: 'sig-1', timestamp: 1, direction: 'in', amount: 100, associatedSolValue: 100 }),
      makeSwapInput({ signature: 'sig-2', timestamp: 2, direction: 'in', amount: 100, associatedSolValue: 200 }),
      makeSwapInput({ signature: 'sig-3', timestamp: 3, direction: 'out', amount: 100, associatedSolValue: 300 }),
    ];

    const fakeDatabaseService = {
      getSwapAnalysisInputs: async () => inputs,
    };

    const fakeTokenInfoService = {
      getSolPrice: async () => 1,
      findMany: async (tokenAddresses: string[]) =>
        tokenAddresses.map(tokenAddress => ({ tokenAddress, priceUsd: '3' })),
    };

    const pnlService = new PnlAnalysisService(
      fakeDatabaseService as any,
      null,
      fakeTokenInfoService as any,
    );

    const balances: WalletBalance = {
      solBalance: 0,
      tokenBalances: [
        {
          mint: TOKEN_MINT,
          tokenAccountAddress: 'TokenAccount111',
          balance: '100',
          decimals: 0,
          uiBalance: 100,
          uiBalanceString: '100',
          priceUsd: 3,
          valueUsd: 300,
        },
      ],
      fetchedAt: new Date(),
    };

    const summary = await pnlService.analyzeWalletPnl(
      WALLET,
      undefined,
      { isViewOnly: true, preFetchedBalances: new Map([[WALLET, balances]]), solPriceUsd: 1 },
    );

    assert.ok(summary, 'Expected non-null PnL summary');
    assert.ok(
      approxEqual(summary!.netPnl, 300),
      `Expected total PnL of 300 SOL, got ${summary!.netPnl}`,
    );
  });
});
