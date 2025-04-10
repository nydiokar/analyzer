import { expect } from 'chai';
import { SQLiteManager } from '../src/core/storage/sqlite-manager';
import { CryptoPrice } from '../src/types/crypto';

interface PriceRecord {
  coin_id: string;
  price: number;
  timestamp: string;
}

interface AlertRecord {
  coin_id: string;
  price: number;
  threshold: number;
  type: string;
  timestamp: string;
}

describe('SQLiteManager', () => {
  let storage: SQLiteManager;
  const testDbPath = './test/test.db';

  beforeEach(() => {
    storage = new SQLiteManager(testDbPath);
  });

  afterEach(() => {
    storage.close();
  });

  it('should store and retrieve price data', async () => {
    const testPrice: CryptoPrice = {
      id: 'bitcoin',
      symbol: 'btc',
      name: 'Bitcoin',
      current_price: 50000,
      market_cap: 1000000000,
      market_cap_rank: 1,
      total_volume: 1000000,
      high_24h: 51000,
      low_24h: 49000,
      price_change_24h: 1000,
      price_change_percentage_24h: 5,
      last_updated: new Date().toISOString()
    };

    await storage.storePrice(testPrice);
    const prices = storage.getRecentPrices('bitcoin', 1) as PriceRecord[];
    
    expect(prices).to.have.lengthOf(1);
    expect(prices[0].coin_id).to.equal('bitcoin');
    expect(prices[0].price).to.equal(50000);
  });

  it('should store and retrieve alerts', async () => {
    await storage.storeAlert('bitcoin', 50000, 5, 'volatility');
    const alerts = storage.getRecentAlerts('bitcoin', 1) as AlertRecord[];
    
    expect(alerts).to.have.lengthOf(1);
    expect(alerts[0].coin_id).to.equal('bitcoin');
    expect(alerts[0].price).to.equal(50000);
    expect(alerts[0].threshold).to.equal(5);
    expect(alerts[0].type).to.equal('volatility');
  });
}); 