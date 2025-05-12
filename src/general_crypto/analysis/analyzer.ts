import { CryptoPrice, AnalysisResult } from '../types/crypto';
import { createLogger } from '../utils/logger';
import fs from 'fs';

const logger = createLogger('Analyzer');

export class CryptoAnalyzer {
  private initialPrices: Record<string, number> = {};
  private alertThresholds: Record<string, { percentage: number, addedAt: string }> = {};

  constructor() {
    this.loadAlerts();
  }

  setInitialPrice(coinId: string, price: number) {
    this.initialPrices[coinId] = price;
  }

  setAlertThreshold(coinId: string, threshold: number) {
    this.alertThresholds[coinId] = {
      percentage: threshold,
      addedAt: new Date().toISOString()
    };
    this.saveAlerts();
  }

  analyzeData(current: CryptoPrice, previousDay?: CryptoPrice): AnalysisResult {
    const initialPrice = this.initialPrices[current.id];
    
    // Use CoinGecko's reported price change if available, otherwise calculate our own
    let priceChange24h = current.price_change_percentage_24h;
    
    // If CoinGecko's data is not available, calculate from our stored data
    if (priceChange24h === undefined || isNaN(priceChange24h)) {
      if (previousDay && previousDay.current_price) {
        priceChange24h = ((current.current_price - previousDay.current_price) / previousDay.current_price) * 100;
      } else if (initialPrice) {
        // Fallback to using initial price if no previous day data
        priceChange24h = ((current.current_price - initialPrice) / initialPrice) * 100;
      } else {
        // If all else fails, default to zero
        priceChange24h = 0;
      }
    }
    
    // Calculate our threshold comparison (always against initial price)
    const thresholdChange = initialPrice ? ((current.current_price - initialPrice) / initialPrice) * 100 : 0;
    const threshold = this.alertThresholds[current.id];
    
    // Check if price movement exceeds threshold
    const isVolatile = threshold !== undefined && Math.abs(thresholdChange) > threshold.percentage;

    // Calculate other metrics
    let volatility24h = 0;
    let volumeChange24h = 0;
    let marketCapChange24h = 0;
    let trendDirection: 'up' | 'down' | 'neutral' = 'neutral';
    let volumeAlert = false;

    // Set trend direction based on 24h price change
    if (priceChange24h > 1) trendDirection = 'up';
    else if (priceChange24h < -1) trendDirection = 'down';
    
    // Use CoinGecko's reported data for other metrics when available
    if (current.price_change_percentage_24h !== undefined) {
      // CoinGecko already provides these metrics
      volatility24h = Math.abs(current.price_change_percentage_24h);
      
      if (current.market_cap_change_percentage_24h !== undefined) {
        marketCapChange24h = current.market_cap_change_percentage_24h;
      }
      
      // Calculate volume change if we have previous data
      if (previousDay && previousDay.total_volume && previousDay.total_volume > 0) {
        volumeChange24h = ((current.total_volume - previousDay.total_volume) / previousDay.total_volume) * 100;
        volumeAlert = volumeChange24h > 50;
      }
      
      // Use high/low range for additional volatility measurement
      if (current.high_24h && current.low_24h && current.low_24h > 0) {
        const highLowRange = current.high_24h - current.low_24h;
        const rangePercentage = (highLowRange / current.low_24h) * 100;
        // Combine both volatility metrics
        volatility24h = Math.max(volatility24h, rangePercentage);
      }
    }

    return {
      coin: current.id,
      timestamp: new Date().toISOString(),
      metrics: {
        volatility24h,
        priceChange24h,
        volumeChange24h,
        marketCapChange24h
      },
      signals: {
        isVolatile,
        trendDirection,
        volumeAlert
      }
    };
  }

  getInitialPrice(coinId: string): number | undefined {
    return this.initialPrices[coinId];
  }

  getAlertThreshold(coinId: string): number | undefined {
    const alert = this.alertThresholds[coinId];
    return alert ? alert.percentage : undefined;
  }

  getAlertThresholds() {
    return this.alertThresholds;
  }

  removeAlertThreshold(coinId: string) {
    delete this.alertThresholds[coinId];
    this.saveAlerts();
  }

  public loadAlerts() {
    if (fs.existsSync('alerts.json')) {
      this.alertThresholds = JSON.parse(fs.readFileSync('alerts.json', 'utf-8'));
    }
  }

  private saveAlerts() {
    fs.writeFileSync('alerts.json', JSON.stringify(this.alertThresholds, null, 2));
  }

  async isValidCoin(coinId: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/coins/list');
      const coins = await response.json();
      return coins.some((coin: { id: string }) => coin.id === coinId);
    } catch (error) {
      logger.error('Error validating coin', { error });
      return false;
    }
  }
}
