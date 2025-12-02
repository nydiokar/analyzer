/**
 * Test script to verify the current holdings calculation works correctly
 * and that the deterministic timestamp fix is working.
 * Run with: npx ts-node src/core/analysis/behavior/test-current-holdings-fix.ts
 */

import { BehaviorAnalyzer } from './analyzer';
import { BehaviorAnalysisConfig } from '../../../types/analysis';
import { SwapAnalysisInput } from '@prisma/client';

// Test scenarios for current holdings (positions not yet sold)
const currentHoldingsScenarios = [
  {
    name: "Simple Current Holdings - Buy Only",
    swapRecords: [
      { 
        mint: 'TOKEN1',
        timestamp: 1000, 
        direction: 'in' as const, 
        amount: 100, 
        associatedSolValue: 1.0 
      } as SwapAnalysisInput
    ],
    // Analyzer uses latestTimestamp(1000) + 3600 = 4600 for analysis
    // Current holding duration = 4600 - 1000 = 3600 seconds = 1.0 hour
    expectedCurrentHoldingDuration: 1.0, // 3600 seconds / 3600 = 1.0 hour
    expectedPercentOfValueInCurrentHoldings: 100 // 100% of value still held
  },
  {
    name: "Partial Holdings - Some Sold, Some Held",
    swapRecords: [
      { 
        mint: 'TOKEN1',
        timestamp: 1000, 
        direction: 'in' as const, 
        amount: 100, 
        associatedSolValue: 1.0 
      } as SwapAnalysisInput,
      { 
        mint: 'TOKEN1',
        timestamp: 3000, 
        direction: 'out' as const, 
        amount: 40, 
        associatedSolValue: 0.4 
      } as SwapAnalysisInput
    ],
    // Analyzer uses latestTimestamp(3000) + 3600 = 6600 for analysis
    // Remaining 60 tokens held for 6600 - 1000 = 5600 seconds = 1.556 hours
    expectedCurrentHoldingDuration: 1.556, // 5600 seconds / 3600 = 1.556 hours
    expectedPercentOfValueInCurrentHoldings: 42.86 // 0.6 / (1.0 + 0.4) * 100
  },
  {
    name: "Multiple Tokens with Mixed Holdings",
    swapRecords: [
      // Token 1: Complete cycle (should not contribute to current holdings)
      { 
        mint: 'TOKEN1',
        timestamp: 1000, 
        direction: 'in' as const, 
        amount: 100, 
        associatedSolValue: 1.0 
      } as SwapAnalysisInput,
      { 
        mint: 'TOKEN1',
        timestamp: 2000, 
        direction: 'out' as const, 
        amount: 100, 
        associatedSolValue: 1.0 
      } as SwapAnalysisInput,
      // Token 2: Still holding
      { 
        mint: 'TOKEN2',
        timestamp: 3000, 
        direction: 'in' as const, 
        amount: 50, 
        associatedSolValue: 0.5 
      } as SwapAnalysisInput
    ],
    // Analyzer uses latestTimestamp(3000) + 3600 = 6600 for analysis
    // TOKEN2 held for 6600 - 3000 = 3600 seconds = 1.0 hour
    expectedCurrentHoldingDuration: 1.0, // 3600 seconds / 3600 = 1.0 hour
    expectedPercentOfValueInCurrentHoldings: 20 // 0.5 / (1.0 + 1.0 + 0.5) * 100
  },
  {
    name: "Dust Filtering Test - Very Small Holdings",
    swapRecords: [
      // Large position (should be included)
      { 
        mint: 'TOKEN1',
        timestamp: 1000, 
        direction: 'in' as const, 
        amount: 1000, 
        associatedSolValue: 0.1 // 0.1 SOL (above dust threshold)
      } as SwapAnalysisInput,
      // Dust position (should be filtered out)
      { 
        mint: 'TOKEN2',
        timestamp: 2000, 
        direction: 'in' as const, 
        amount: 10, 
        associatedSolValue: 0.0001 // 0.0001 SOL (below dust threshold)
      } as SwapAnalysisInput
    ],
    // Analyzer uses latestTimestamp(2000) + 3600 = 5600 for analysis
    // TOKEN1 held for 5600 - 1000 = 4600 seconds = 1.278 hours
    expectedCurrentHoldingDuration: 1.278, // 4600 seconds / 3600 = 1.278 hours
    expectedPercentOfValueInCurrentHoldings: 99.9 // Should be close to 100% since dust is filtered
  }
];

async function runCurrentHoldingsTests() {
  console.log('🧪 Testing Current Holdings Calculation & Deterministic Fix\n');
  
  const config: BehaviorAnalysisConfig = {
    sessionGapThresholdHours: 2,
    holdingThresholds: {
      minimumSolValue: 0.001,
      minimumPercentageRemaining: 0.05,
      minimumHoldingTimeSeconds: 300
    }
  };
  
  let passedTests = 0;
  let totalTests = 0;

  // Test 1: Deterministic behavior (same input should produce same output)
  console.log('🔄 Testing: Deterministic Behavior');
  totalTests++;
  
  const testInput = currentHoldingsScenarios[1].swapRecords;
  const analyzer1 = new BehaviorAnalyzer(config);
  const analyzer2 = new BehaviorAnalyzer(config);
  
  const result1 = analyzer1.analyze(testInput, 'test-wallet-address');
  // Wait a bit to ensure Date.now() would be different if used
  await new Promise(resolve => setTimeout(resolve, 10));
  const result2 = analyzer2.analyze(testInput, 'test-wallet-address');
  
  const isDeterministic = 
    result1.averageCurrentHoldingDurationHours === result2.averageCurrentHoldingDurationHours &&
    result1.percentOfValueInCurrentHoldings === result2.percentOfValueInCurrentHoldings;
  
  if (isDeterministic) {
    console.log('  ✅ PASSED - Results are deterministic');
    passedTests++;
  } else {
    console.log('  ❌ FAILED - Results vary between runs');
    console.log(`     Run 1: avgDuration=${result1.averageCurrentHoldingDurationHours}, percentValue=${result1.percentOfValueInCurrentHoldings}`);
    console.log(`     Run 2: avgDuration=${result2.averageCurrentHoldingDurationHours}, percentValue=${result2.percentOfValueInCurrentHoldings}`);
  }
  console.log('');

  // Test 2: Current holdings scenarios
  for (const scenario of currentHoldingsScenarios) {
    console.log(`📊 Testing: ${scenario.name}`);
    totalTests++;

    try {
      const analyzer = new BehaviorAnalyzer(config);
      
      // The analyzer correctly uses latestTimestamp + 3600 for current holdings analysis
      // This provides deterministic results for historical data analysis
      
      const result = analyzer.analyze(scenario.swapRecords, 'test-wallet-address');
      
      console.log(`  Expected current holding duration: ${scenario.expectedCurrentHoldingDuration?.toFixed(3)} hours`);
      console.log(`  Actual current holding duration:   ${result.averageCurrentHoldingDurationHours.toFixed(3)} hours`);
      console.log(`  Expected % value in holdings: ${scenario.expectedPercentOfValueInCurrentHoldings}%`);
      console.log(`  Actual % value in holdings:   ${result.percentOfValueInCurrentHoldings.toFixed(1)}%`);

      // Check current holdings duration (with tolerance for floating point)
      const durationMatch = scenario.expectedCurrentHoldingDuration === undefined || 
        Math.abs(result.averageCurrentHoldingDurationHours - scenario.expectedCurrentHoldingDuration) < 0.01;
      
      // Check percentage of value in current holdings (with tolerance)
      const percentageMatch = Math.abs(result.percentOfValueInCurrentHoldings - scenario.expectedPercentOfValueInCurrentHoldings) < 5;

      if (durationMatch && percentageMatch) {
        console.log(`  ✅ PASSED\n`);
        passedTests++;
      } else {
        console.log(`  ❌ FAILED`);
        if (!durationMatch) console.log(`     - Current holding duration mismatch`);
        if (!percentageMatch) console.log(`     - Percentage value mismatch`);
        console.log('');
      }

    } catch (error) {
      console.log(`  ❌ FAILED - Error: ${error}\n`);
    }
  }

  // Test 3: Edge case - No current holdings (all positions sold)
  console.log('📊 Testing: No Current Holdings (All Sold)');
  totalTests++;
  
  const noHoldingsInput: SwapAnalysisInput[] = [
    { 
      mint: 'TOKEN1',
      timestamp: 1000, 
      direction: 'in' as const, 
      amount: 100, 
      associatedSolValue: 1.0 
    } as SwapAnalysisInput,
    { 
      mint: 'TOKEN1',
      timestamp: 2000, 
      direction: 'out' as const, 
      amount: 100, 
      associatedSolValue: 1.0 
    } as SwapAnalysisInput
  ];
  
  const analyzer = new BehaviorAnalyzer(config);
  const result = analyzer.analyze(noHoldingsInput, 'test-wallet-address');
  
  if (result.averageCurrentHoldingDurationHours === 0 && result.percentOfValueInCurrentHoldings === 0) {
    console.log('  ✅ PASSED - No current holdings correctly handled\n');
    passedTests++;
  } else {
    console.log('  ❌ FAILED - Should have zero current holdings');
    console.log(`     Duration: ${result.averageCurrentHoldingDurationHours}, Percentage: ${result.percentOfValueInCurrentHoldings}\n`);
  }

  console.log(`\n📋 Test Results: ${passedTests}/${totalTests} tests passed`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed! Current holdings calculation and deterministic fix are working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Current holdings calculation needs review.');
  }
}

// Run the tests
runCurrentHoldingsTests().catch(console.error); 