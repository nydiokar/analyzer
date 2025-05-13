import { DataFetcher } from '../fetcher/data-fetcher';
import { ProtocolFetcher } from '../fetcher/protocol-fetcher';
import { StakingInput, StakingReport } from '../types/staking';
import { createLogger } from '@/utils/logger';

const logger = createLogger('StakingCalculator');

export class StakingCalculator {
  private dataFetcher: DataFetcher;
  private protocolFetcher: ProtocolFetcher;

  constructor(dataFetcher: DataFetcher) {
    this.dataFetcher = dataFetcher;
    this.protocolFetcher = new ProtocolFetcher();
  }

  async calculateReturns(input: StakingInput): Promise<StakingReport> {
    try {
      // Get protocol info first to fail fast if not supported
      const protocolInfo = await this.protocolFetcher.getProtocolInfo(
        input.tokenSymbol, 
        input.protocol || 'native'
      );
      
      if (!protocolInfo) {
        throw new Error(`Protocol ${input.protocol || 'native'} not found for ${input.tokenSymbol}`);
      }

      // For testing/demo purposes, use a fixed price if data fetching fails
      let currentPrice = 100; // Default price for demonstration
      try {
        const data = await this.dataFetcher.fetchLatestData();
        if (data?.data?.[0]?.current_price) {
          currentPrice = data.data[0].current_price;
          logger.info('Using live price data', { price: currentPrice, token: input.tokenSymbol });
        } else {
          logger.warn('Using default price for demonstration', { price: currentPrice, token: input.tokenSymbol });
        }
      } catch (error) {
        logger.warn('Failed to fetch live price, using default for demonstration', { 
          error, 
          defaultPrice: currentPrice,
          token: input.tokenSymbol 
        });
      }

      // Calculate returns
      const apy = protocolInfo.apy / 100; // Convert percentage to decimal
      const years = input.durationDays / 365;
      
      // Calculate compound interest: A = P(1 + r)^t
      const projectedTokenAmount = input.amount * Math.pow(1 + apy, years);
      const projectedReturns = projectedTokenAmount - input.amount;
      const projectedUsdValue = projectedTokenAmount * currentPrice;

      const report: StakingReport = {
        input,
        returns: {
          estimatedApy: protocolInfo.apy,
          projectedReturns,
          tokenAmount: projectedTokenAmount,
          usdValue: projectedUsdValue
        },
        risks: protocolInfo.risks,
        stakingDetails: {
          unstakingPeriod: protocolInfo.unstakingPeriod,
          minimumStake: protocolInfo.minimumStake,
          protocolInfo: protocolInfo.name
        }
      };

      logger.info('Staking calculation completed', {
        token: input.tokenSymbol,
        protocol: input.protocol || 'native',
        apy: protocolInfo.apy,
        currentPrice
      });

      return report;
    } catch (error) {
      logger.error('Error calculating staking returns', {
        error,
        input
      });
      throw error;
    }
  }

  // Utility method to get supported tokens
  getSupportedTokens(): string[] {
    return this.protocolFetcher.getSupportedTokens();
  }

  // Utility method to get supported protocols for a token
  getSupportedProtocols(token: string): string[] {
    return this.protocolFetcher.getSupportedProtocols(token);
  }
} 