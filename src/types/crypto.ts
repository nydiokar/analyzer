export interface CryptoPrice {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  total_volume: number;
  high_24h: number;
  low_24h: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  last_updated: string;
}

export interface StoredCryptoData {
  timestamp: string;
  data: CryptoPrice[];
  signature: string; // For data verification
}

export interface CryptoDataOptions {
  coins: string[];
  currencies: string[];
  includeMarketData?: boolean;
}

export interface RateLimitConfig {
  maxRequestsPerMinute: number;
  buffer: number;
}

export interface StorageConfig {
  format: 'json' | 'csv';
  directory: string;
}

export interface AnalysisResult {
  coin: string;
  timestamp: string;
  metrics: {
    volatility24h: number;
    priceChange24h: number;
    volumeChange24h: number;
    marketCapChange24h: number;
  };
  signals: {
    isVolatile: boolean;
    trendDirection: 'up' | 'down' | 'neutral';
    volumeAlert: boolean;
  };
}
