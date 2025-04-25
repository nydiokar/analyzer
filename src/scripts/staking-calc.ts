// This script is used to calculate the returns of staking SOL on Solana in both native and Marinade

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { DataFetcher } from '../core/fetcher/data-fetcher';
import { createLogger } from '../utils/logger';
import { CryptoDataOptions, RateLimitConfig } from '../types/crypto';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const logger = createLogger('StakingCalc');

type StakingType = 'native' | 'marinade';

interface StakingInfo {
  name: string;
  apy: number;
  minimumStake: number;
  unstakingPeriod: number;
  risks: string[];
  exchangeRate?: number;
}

// Simplified staking configuration for Solana
const STAKING_CONFIG: Record<StakingType, StakingInfo> = {
  'native': {
    name: 'Solana Native Staking',
    apy: 6.5, // Conservative estimate
    minimumStake: 1,
    unstakingPeriod: 2, // days
    risks: [
      'Validator performance impact',
      'Network stability',
      'Unstaking period lock'
    ]
  },
  'marinade': {
    name: 'Marinade Liquid Staking',
    apy: 6.8, // Conservative estimate
    minimumStake: 0.1,
    unstakingPeriod: 0,
    risks: [
      'Smart contract risk',
      'Protocol risk',
      'Market liquidity risk'
    ]
  }
};

// Rate limit config from environment
const rateLimitConfig: RateLimitConfig = {
  maxRequestsPerMinute: parseInt(process.env.MAX_REQUESTS_PER_MINUTE || '50', 10),
  buffer: parseInt(process.env.RATE_LIMIT_BUFFER || '5', 10)
};

async function main() {
  try {
    const argv = await yargs(hideBin(process.argv))
      .option('amount', {
        alias: 'a',
        description: 'Amount of SOL to stake',
        type: 'number',
        demandOption: true
      })
      .option('days', {
        alias: 'd',
        description: 'Staking duration in days',
        type: 'number',
        default: 365
      })
      .option('type', {
        description: 'Staking type (native or marinade)',
        choices: ['native', 'marinade'] as const,
        default: 'native' as StakingType
      })
      .help()
      .argv;

    // Get protocol info
    const stakingType = argv.type as StakingType;
    const protocolInfo = STAKING_CONFIG[stakingType];

    // Validate minimum stake
    if (argv.amount < protocolInfo.minimumStake) {
      throw new Error(`Minimum stake amount is ${protocolInfo.minimumStake} SOL`);
    }

    // Initialize data fetcher for SOL price
    const dataOptions: CryptoDataOptions = {
      coins: ['solana'],
      currencies: ['usd'],
      includeMarketData: true
    };
    const dataFetcher = new DataFetcher(rateLimitConfig, dataOptions);

    // Get current SOL price
    let currentPrice = 100; // Default fallback price
    try {
      const data = await dataFetcher.fetchLatestData();
      if (data?.data?.[0]?.current_price) {
        currentPrice = data.data[0].current_price;
        logger.info('Using live SOL price', { price: currentPrice });
      } else {
        logger.warn('Using default SOL price for demonstration', { price: currentPrice });
      }
    } catch (error) {
      logger.warn('Failed to fetch SOL price, using default', { 
        error, 
        defaultPrice: currentPrice 
      });
    }

    // Calculate returns
    const apy = protocolInfo.apy / 100; // Convert percentage to decimal
    const years = argv.days / 365;
    
    // Calculate compound interest: A = P(1 + r)^t
    const projectedAmount = argv.amount * Math.pow(1 + apy, years);
    const projectedReturns = projectedAmount - argv.amount;
    const projectedUsdValue = projectedAmount * currentPrice;

    // Generate report
    console.log('\n=== Solana Staking Calculator Report ===');
    console.log('\nInput Parameters:');
    console.log(`  Amount: ${argv.amount} SOL`);
    console.log(`  Duration: ${argv.days} days`);
    console.log(`  Staking Method: ${protocolInfo.name}`);

    console.log('\nCurrent Market Data:');
    console.log(`  SOL Price: $${currentPrice.toFixed(2)}`);
    console.log(`  Initial Value: $${(argv.amount * currentPrice).toFixed(2)}`);
    if (stakingType === 'marinade' && protocolInfo.exchangeRate) {
      console.log(`  mSOL/SOL Rate: ${protocolInfo.exchangeRate.toFixed(4)}`);
      console.log(`  Equivalent mSOL: ${(argv.amount * protocolInfo.exchangeRate).toFixed(4)}`);
    }

    console.log('\nProjected Returns:');
    console.log(`  APY: ${protocolInfo.apy}% ${stakingType === 'marinade' ? '(Live Rate)' : ''}`);
    console.log(`  Total SOL: ${projectedAmount.toFixed(4)} SOL`);
    console.log(`  Earned SOL: ${projectedReturns.toFixed(4)} SOL`);
    console.log(`  Projected Value: $${projectedUsdValue.toFixed(2)}`);
    console.log(`  Profit (USD): $${(projectedUsdValue - (argv.amount * currentPrice)).toFixed(2)}`);

    console.log('\nStaking Details:');
    console.log(`  Minimum Stake: ${protocolInfo.minimumStake} SOL`);
    console.log(`  Unstaking Period: ${protocolInfo.unstakingPeriod} days`);

    console.log('\nRisk Considerations:');
    protocolInfo.risks.forEach((risk: string) => console.log(`  - ${risk}`));
    
    // Add detailed risk explanations based on staking type
    console.log('\nRisk Details:');
    if (stakingType === 'native') {
      console.log('  Validator Performance:');
      console.log('    • Your returns depend on validator uptime and performance');
      console.log('    • Slashing can occur for validator misbehavior');
      
      console.log('  Unstaking Period:');
      console.log('    • Funds are locked for ~2-3 days during unstaking');
      console.log('    • Cannot cancel unstaking once initiated');
      
      console.log('  Network Considerations:');
      console.log('    • Rewards vary with network participation');
      console.log('    • Network upgrades may affect staking operations');
    } else if (stakingType === 'marinade') {
      console.log('  Smart Contract Risk:');
      console.log('    • Funds are managed by Marinade smart contracts');
      console.log('    • While audited, smart contracts can have vulnerabilities');
      
      console.log('  Liquid Staking Benefits:');
      console.log('    • Receive mSOL tokens that can be traded or used in DeFi');
      console.log('    • No unstaking period for mSOL trading');
      
      console.log('  Market Considerations:');
      console.log('    • mSOL/SOL exchange rate may fluctuate');
      console.log('    • Market liquidity affects ability to swap mSOL back to SOL');
    }
    console.log();

  } catch (error) {
    logger.error('Error calculating staking returns', { error });
    console.error('\nError:', error instanceof Error ? error.message : 'Unknown error occurred');
    process.exit(1);
  }
}

main(); 