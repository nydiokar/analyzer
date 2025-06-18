/**
 * Test script to verify the FIFO holding time calculation works correctly.
 * Run with: npx ts-node src/core/analysis/behavior/test-fifo-holding-time.ts
 */

import { BehaviorAnalyzer } from './analyzer';
import { BehaviorAnalysisConfig } from '../../../types/analysis';

// Mock data structure that matches TokenTrade interface
interface TestTrade {
  timestamp: number;
  direction: 'in' | 'out';
  amount: number;
  associatedSolValue: number;
}

// Test scenarios
const testScenarios = [
  {
    name: "Simple Buy-Sell",
    trades: [
      { timestamp: 1000, direction: 'in' as const, amount: 100, associatedSolValue: 1 },
      { timestamp: 5000, direction: 'out' as const, amount: 100, associatedSolValue: 1 }
    ],
    expectedDurations: [4000 / 3600], // 4000 seconds = ~1.11 hours
    expectedPairs: 1
  },
  {
    name: "Multiple Buys, Single Sell (FIFO)",
    trades: [
      { timestamp: 1000, direction: 'in' as const, amount: 50, associatedSolValue: 0.5 },
      { timestamp: 2000, direction: 'in' as const, amount: 30, associatedSolValue: 0.3 },
      { timestamp: 6000, direction: 'out' as const, amount: 70, associatedSolValue: 0.7 }
    ],
    expectedDurations: [
      5000 / 3600, // First buy (50 tokens) held for 5000 seconds
      4000 / 3600  // Second buy (20 of 30 tokens) held for 4000 seconds
    ],
    expectedPairs: 2
  },
  {
    name: "Partial Sells",
    trades: [
      { timestamp: 1000, direction: 'in' as const, amount: 100, associatedSolValue: 1 },
      { timestamp: 3000, direction: 'out' as const, amount: 30, associatedSolValue: 0.3 },
      { timestamp: 5000, direction: 'out' as const, amount: 70, associatedSolValue: 0.7 }
    ],
    expectedDurations: [
      2000 / 3600, // First partial sell (30 tokens) held for 2000 seconds
      4000 / 3600  // Second partial sell (70 tokens) held for 4000 seconds
    ],
    expectedPairs: 2
  },
  {
    name: "Complex Mixed Pattern",
    trades: [
      { timestamp: 1000, direction: 'in' as const, amount: 100, associatedSolValue: 1 },
      { timestamp: 2000, direction: 'out' as const, amount: 50, associatedSolValue: 0.5 },
      { timestamp: 3000, direction: 'in' as const, amount: 80, associatedSolValue: 0.8 },
      { timestamp: 4000, direction: 'out' as const, amount: 100, associatedSolValue: 1 },
      { timestamp: 5000, direction: 'in' as const, amount: 20, associatedSolValue: 0.2 }
    ],
    expectedDurations: [
      1000 / 3600, // First buy partial sell (50 tokens) held for 1000 seconds
      3000 / 3600, // First buy remaining (50 tokens) held for 3000 seconds (1000→4000)
      1000 / 3600  // Second buy partial sell (50 of 80 tokens) held for 1000 seconds
    ],
    expectedPairs: 3
  },
  {
    name: "Sell Without Any Buys (Edge Case)",
    trades: [
      { timestamp: 1000, direction: 'out' as const, amount: 50, associatedSolValue: 0.5 }
    ],
    expectedDurations: [], // No durations since no buy positions to match
    expectedPairs: 0
  },
  {
    name: "Only Buys, No Sells",
    trades: [
      { timestamp: 1000, direction: 'in' as const, amount: 100, associatedSolValue: 1 },
      { timestamp: 2000, direction: 'in' as const, amount: 50, associatedSolValue: 0.5 }
    ],
    expectedDurations: [], // No completed pairs
    expectedPairs: 0
  },
  {
    name: "Sell More Than Bought (Excess Sell)",
    trades: [
      { timestamp: 1000, direction: 'in' as const, amount: 50, associatedSolValue: 0.5 },
      { timestamp: 3000, direction: 'out' as const, amount: 100, associatedSolValue: 1 } // Selling 100, only bought 50
    ],
    expectedDurations: [2000 / 3600], // Should only count the 50 we actually bought
    expectedPairs: 1
  },
  {
    name: "Same Timestamps (Simultaneous Trades)",
    trades: [
      { timestamp: 1000, direction: 'in' as const, amount: 100, associatedSolValue: 1 },
      { timestamp: 1000, direction: 'out' as const, amount: 50, associatedSolValue: 0.5 } // Same timestamp
    ],
    expectedDurations: [0], // Zero duration since same timestamp
    expectedPairs: 1
  },
  {
    name: "Out-of-Order Timestamps (Should Auto-Sort)",
    trades: [
      { timestamp: 3000, direction: 'out' as const, amount: 50, associatedSolValue: 0.5 }, // Later timestamp first
      { timestamp: 1000, direction: 'in' as const, amount: 100, associatedSolValue: 1 }   // Earlier timestamp second
    ],
    expectedDurations: [2000 / 3600], // Should still work due to sorting
    expectedPairs: 1
  }
];

async function runTests() {
  console.log('🧪 Testing FIFO Holding Time Calculation\n');
  
  // Create analyzer instance
  const config: BehaviorAnalysisConfig = {
    sessionGapThresholdHours: 2
  };
  const analyzer = new BehaviorAnalyzer(config);

  // Access private methods through reflection for testing
  const calculateFlipDurations = (analyzer as any).calculateFlipDurations.bind(analyzer);
  const countBuySellPairs = (analyzer as any).countBuySellPairs.bind(analyzer);

  let passedTests = 0;
  let totalTests = 0;

  for (const scenario of testScenarios) {
    console.log(`📊 Testing: ${scenario.name}`);
    totalTests++;

    try {
      // Test flip durations
      const actualDurations = calculateFlipDurations(scenario.trades);
      const actualPairs = countBuySellPairs(scenario.trades);

      console.log(`  Expected durations: [${scenario.expectedDurations.map(d => d.toFixed(3)).join(', ')}] hours`);
      console.log(`  Actual durations:   [${actualDurations.map(d => d.toFixed(3)).join(', ')}] hours`);
      console.log(`  Expected pairs: ${scenario.expectedPairs}`);
      console.log(`  Actual pairs:   ${actualPairs}`);

      // Check durations (with some tolerance for floating point precision)
      const durationsMatch = actualDurations.length === scenario.expectedDurations.length &&
        actualDurations.every((duration, i) => 
          Math.abs(duration - scenario.expectedDurations[i]) < 0.001
        );

      // Check pairs count
      const pairsMatch = actualPairs === scenario.expectedPairs;

      if (durationsMatch && pairsMatch) {
        console.log(`  ✅ PASSED\n`);
        passedTests++;
      } else {
        console.log(`  ❌ FAILED`);
        if (!durationsMatch) console.log(`     - Duration mismatch`);
        if (!pairsMatch) console.log(`     - Pairs count mismatch`);
        console.log('');
      }

    } catch (error) {
      console.log(`  ❌ FAILED - Error: ${error}\n`);
    }
  }

  console.log(`\n📋 Test Results: ${passedTests}/${totalTests} tests passed`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed! FIFO implementation is working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Please review the implementation.');
  }
}

// Run the tests
runTests().catch(console.error); 