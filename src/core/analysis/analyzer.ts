import { CryptoPrice, AnalysisResult } from '../../types/crypto';
import { createLogger } from '../../utils/logger';

const logger = createLogger('Analyzer');

export class CryptoAnalyzer {
  // Threshold for considering price movement volatile (in percentage)
  private readonly VOLATILITY_THRESHOLD = 5;
  // Threshold for significant volume change (in percentage)
  private readonly VOLUME_ALERT_THRESHOLD = 50;

  analyzeData(current: CryptoPrice): AnalysisResult {
    try {
      const volatility24h = this.calculateVolatility(current);
      const volumeChange = this.calculateVolumeChange(current);
      
      const analysis: AnalysisResult = {
        coin: current.id,
        timestamp: new Date().toISOString(),
        metrics: {
          volatility24h,
          priceChange24h: current.price_change_24h,
          volumeChange24h: volumeChange,
          marketCapChange24h: this.calculateMarketCapChange(current)
        },
        signals: {
          isVolatile: Math.abs(volatility24h) > this.VOLATILITY_THRESHOLD,
          trendDirection: this.determineTrend(current.price_change_percentage_24h),
          volumeAlert: Math.abs(volumeChange) > this.VOLUME_ALERT_THRESHOLD
        }
      };

      logger.info(`Analysis completed for ${current.id}`, {
        volatility: volatility24h,
        trend: analysis.signals.trendDirection
      });

      return analysis;
    } catch (error) {
      logger.error(`Analysis failed for ${current.id}`, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  private calculateVolatility(data: CryptoPrice): number {
    if (data.high_24h && data.low_24h) {
      const range = data.high_24h - data.low_24h;
      const average = (data.high_24h + data.low_24h) / 2;
      return (range / average) * 100;
    }
    // Fallback to price change percentage if high/low not available
    return Math.abs(data.price_change_percentage_24h);
  }

  private calculateVolumeChange(data: CryptoPrice): number {
    // This is a simplified calculation as we don't have historical volume
    // In a real implementation, we would compare with previous period
    return data.total_volume ? (data.total_volume / data.market_cap) * 100 : 0;
  }

  private calculateMarketCapChange(data: CryptoPrice): number {
    // In a real implementation, we would compare with previous period
    return data.market_cap ? (data.price_change_percentage_24h * data.market_cap) / 100 : 0;
  }

  private determineTrend(priceChange: number): 'up' | 'down' | 'neutral' {
    if (priceChange > 1) return 'up';
    if (priceChange < -1) return 'down';
    return 'neutral';
  }
}
