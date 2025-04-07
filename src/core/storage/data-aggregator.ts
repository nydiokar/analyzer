import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../../utils/logger';
import { StoredCryptoData, AnalysisResult, CryptoPrice } from '../../types/crypto';
import crypto from 'crypto-js';

const logger = createLogger('DataAggregator');

interface AggregatedData {
  timestamp: string;
  interval: '1h' | '4h' | '24h';
  data: {
    [coinId: string]: {
      prices: {
        open: number;
        high: number;
        low: number;
        close: number;
        timestamp: string;
      }[];
      volumes: number[];
      analysis: {
        volatility: number;
        trendStrength: number;
        volumeProfile: number;
        support: number;
        resistance: number;
        momentum: number;
      };
      signals: {
        trend: 'up' | 'down' | 'neutral';
        breakout: boolean;
        volumeSpike: boolean;
        momentumShift: boolean;
      };
    };
  };
  signature: string;
}

export class DataAggregator {
  private readonly dataDir: string;
  private aggregatedData: { [interval: string]: AggregatedData } = {};

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private calculateTechnicals(prices: number[], volumes: number[]) {
    const sma20 = this.calculateSMA(prices, 20);
    const momentum = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
    const volumeAvg = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    
    return {
      sma: sma20,
      momentum,
      volumeAvg
    };
  }

  private calculateSMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1];
    const slice = prices.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  private async saveAggregatedData(interval: '1h' | '4h' | '24h') {
    const fileName = `aggregated_${interval}_${new Date().toISOString().split('T')[0]}.json`;
    const filePath = path.join(this.dataDir, fileName);
    
    try {
      await fs.writeFile(filePath, JSON.stringify(this.aggregatedData[interval], null, 2));
      logger.info(`Saved aggregated ${interval} data`, { file: filePath });
    } catch (error) {
      logger.error(`Failed to save aggregated data`, { error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  public async addData(newData: StoredCryptoData & { analysis: AnalysisResult[] }) {
    try {
      const timestamp = new Date(newData.timestamp);
      
      // Initialize intervals if needed
      ['1h', '4h', '24h'].forEach((interval) => {
        if (!this.aggregatedData[interval]) {
          this.aggregatedData[interval] = {
            timestamp: timestamp.toISOString(),
            interval: interval as '1h' | '4h' | '24h',
            data: {},
            signature: ''
          };
        }
      });

      // Update data for each coin
      newData.data.forEach((coinData: CryptoPrice) => {
        const analysis = newData.analysis.find(a => a.coin === coinData.id);
        if (!analysis) return;

        ['1h', '4h', '24h'].forEach((interval) => {
          if (!this.aggregatedData[interval].data[coinData.id]) {
            this.aggregatedData[interval].data[coinData.id] = {
              prices: [],
              volumes: [],
              analysis: {
                volatility: 0,
                trendStrength: 0,
                volumeProfile: 0,
                support: 0,
                resistance: 0,
                momentum: 0
              },
              signals: {
                trend: 'neutral',
                breakout: false,
                volumeSpike: false,
                momentumShift: false
              }
            };
          }

          const intervalData = this.aggregatedData[interval].data[coinData.id];
          intervalData.prices.push({
            open: coinData.current_price,
            high: coinData.high_24h || coinData.current_price,
            low: coinData.low_24h || coinData.current_price,
            close: coinData.current_price,
            timestamp: timestamp.toISOString()
          });
          intervalData.volumes.push(coinData.total_volume);

          // Keep only relevant timeframe of data
          const timeframes: Record<'1h' | '4h' | '24h', number> = {
            '1h': 60,
            '4h': 240,
            '24h': 1440
          };
          const maxDataPoints = timeframes[interval as '1h' | '4h' | '24h'];
          if (intervalData.prices.length > maxDataPoints) {
            intervalData.prices = intervalData.prices.slice(-maxDataPoints);
            intervalData.volumes = intervalData.volumes.slice(-maxDataPoints);
          }

          // Update analysis
          const technicals = this.calculateTechnicals(
            intervalData.prices.map(p => p.close),
            intervalData.volumes
          );

          intervalData.analysis = {
            volatility: analysis.metrics.volatility24h,
            trendStrength: Math.abs(technicals.momentum),
            volumeProfile: coinData.total_volume / technicals.volumeAvg,
            support: Math.min(...intervalData.prices.map(p => p.low)),
            resistance: Math.max(...intervalData.prices.map(p => p.high)),
            momentum: technicals.momentum
          };

          intervalData.signals = {
            trend: analysis.signals.trendDirection,
            breakout: coinData.current_price > intervalData.analysis.resistance,
            volumeSpike: intervalData.analysis.volumeProfile > 2,
            momentumShift: Math.abs(technicals.momentum) > 5
          };
        });
      });

      // Generate signatures and save
      for (const interval of ['1h', '4h', '24h'] as const) {
        this.aggregatedData[interval].signature = crypto
          .SHA256(JSON.stringify(this.aggregatedData[interval].data))
          .toString();
        await this.saveAggregatedData(interval);
      }

    } catch (error) {
      logger.error('Failed to aggregate data', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}
