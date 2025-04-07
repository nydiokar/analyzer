import { expect } from 'chai';
import { CryptoAnalyzer } from '../src/core/analysis/analyzer';
import { CryptoPrice } from '../src/types/crypto';

describe('CryptoAnalyzer', () => {
  const analyzer = new CryptoAnalyzer();

  const mockCryptoData: CryptoPrice = {
    id: 'bitcoin',
    symbol: 'btc',
    name: 'Bitcoin',
    current_price: 50000,
    market_cap: 1000000000000,
    market_cap_rank: 1,
    total_volume: 50000000000,
    high_24h: 51000,
    low_24h: 49000,
    price_change_24h: 1000,
    price_change_percentage_24h: 2,
    last_updated: new Date().toISOString()
  };

  it('should analyze crypto data and provide insights', () => {
    const result = analyzer.analyzeData(mockCryptoData);

    expect(result).to.have.property('coin').equal('bitcoin');
    expect(result).to.have.property('timestamp');
    expect(result).to.have.property('metrics');
    expect(result).to.have.property('signals');

    // Check metrics
    expect(result.metrics).to.have.property('volatility24h');
    expect(result.metrics).to.have.property('priceChange24h');
    expect(result.metrics).to.have.property('volumeChange24h');
    expect(result.metrics).to.have.property('marketCapChange24h');

    // Check signals
    expect(result.signals).to.have.property('isVolatile');
    expect(result.signals).to.have.property('trendDirection');
    expect(result.signals).to.have.property('volumeAlert');

    // Verify calculations
    const expectedVolatility = ((51000 - 49000) / ((51000 + 49000) / 2)) * 100;
    expect(result.metrics.volatility24h).to.be.approximately(expectedVolatility, 0.01);
  });

  it('should handle missing high/low data', () => {
    const dataWithoutHighLow = {
      ...mockCryptoData,
      high_24h: 0,
      low_24h: 0
    };

    const result = analyzer.analyzeData(dataWithoutHighLow);
    // Should fallback to using price_change_percentage
    expect(result.metrics.volatility24h).to.equal(Math.abs(dataWithoutHighLow.price_change_percentage_24h));
  });

  it('should correctly determine trend direction', () => {
    // Upward trend
    const upTrendData = { ...mockCryptoData, price_change_percentage_24h: 2.5 };
    expect(analyzer.analyzeData(upTrendData).signals.trendDirection).to.equal('up');

    // Downward trend
    const downTrendData = { ...mockCryptoData, price_change_percentage_24h: -2.5 };
    expect(analyzer.analyzeData(downTrendData).signals.trendDirection).to.equal('down');

    // Neutral trend
    const neutralTrendData = { ...mockCryptoData, price_change_percentage_24h: 0.5 };
    expect(analyzer.analyzeData(neutralTrendData).signals.trendDirection).to.equal('neutral');
  });

  it('should detect high volatility', () => {
    const highVolatilityData = {
      ...mockCryptoData,
      high_24h: 55000,
      low_24h: 45000
    };

    const result = analyzer.analyzeData(highVolatilityData);
    expect(result.signals.isVolatile).to.be.true;
  });

  it('should detect volume alerts', () => {
    const highVolumeData = {
      ...mockCryptoData,
      total_volume: mockCryptoData.market_cap * 0.75 // 75% of market cap
    };

    const result = analyzer.analyzeData(highVolumeData);
    expect(result.signals.volumeAlert).to.be.true;
  });
});
