import { CryptoPrice, AnalysisResult } from '../../types/crypto';
import { createLogger } from '../../utils/logger';
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

  analyzeData(current: CryptoPrice): AnalysisResult {
    const initialPrice = this.initialPrices[current.id];
    const priceChange = ((current.current_price - initialPrice) / initialPrice) * 100;
    const threshold = this.alertThresholds[current.id];

    const isVolatile = threshold !== undefined && Math.abs(priceChange) > threshold.percentage;

    return {
      coin: current.id,
      timestamp: new Date().toISOString(),
      metrics: {
        volatility24h: 0,
        priceChange24h: 0,
        volumeChange24h: 0,
        marketCapChange24h: 0
      },
      signals: {
        isVolatile,
        trendDirection: 'neutral',
        volumeAlert: false
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
