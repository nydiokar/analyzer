import { expect } from 'chai';
import { DataFetcher } from '../src/core/fetcher/data-fetcher';
import { StorageManager } from '../src/core/storage/storage-manager';
import { CryptoDataOptions, RateLimitConfig, StorageConfig } from '../src/types/crypto';
import path from 'path';
import fs from 'fs/promises';

describe('Crypto Data Collection Suite', () => {
  const testDataOptions: CryptoDataOptions = {
    coins: ['bitcoin', 'ethereum'],
    currencies: ['usd'],
    includeMarketData: true
  };

  const rateLimitConfig: RateLimitConfig = {
    maxRequestsPerMinute: 50,
    buffer: 5
  };

  const testStorageConfig: StorageConfig = {
    format: 'json',
    directory: path.join(__dirname, 'test_data')
  };

  let fetcher: DataFetcher;
  let storage: StorageManager;

  before(async () => {
    // Initialize components
    fetcher = new DataFetcher(rateLimitConfig, testDataOptions);
    storage = new StorageManager(testStorageConfig);
    
    // Create test directory
    await fs.mkdir(testStorageConfig.directory, { recursive: true });
  });

  after(async () => {
    // Cleanup test directory
    await fs.rm(testStorageConfig.directory, { recursive: true, force: true });
  });

  describe('DataFetcher', () => {
    it('should fetch latest crypto data', async () => {
      const data = await fetcher.fetchLatestData();
      
      expect(data).to.have.property('timestamp');
      expect(data).to.have.property('data');
      expect(data).to.have.property('signature');
      expect(data.data).to.be.an('array');
      expect(data.data).to.have.lengthOf(testDataOptions.coins.length);
      
      // Verify data structure for each coin
      data.data.forEach(coin => {
        expect(coin).to.have.property('id');
        expect(coin).to.have.property('current_price');
        expect(coin).to.have.property('market_cap');
        expect(coin.current_price).to.be.a('number');
      });
    }).timeout(10000); // Increase timeout for API call
  });

  describe('StorageManager', () => {
    it('should initialize storage directory', async () => {
      await storage.initialize();
      const exists = await fs.access(testStorageConfig.directory)
        .then(() => true)
        .catch(() => false);
      expect(exists).to.be.true;
    });

    it('should store and verify data', async () => {
      // Fetch some real data
      const data = await fetcher.fetchLatestData();
      
      // Store it
      const filePath = await storage.store(data);
      expect(filePath).to.be.a('string');
      
      // Verify it was stored correctly
      const exists = await fs.access(filePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).to.be.true;
      
      // Verify data integrity
      const isValid = await storage.verify(filePath);
      expect(isValid).to.be.true;
    }).timeout(15000);

    it('should list stored files', async () => {
      const files = await storage.listStoredFiles();
      expect(files).to.be.an('array');
      expect(files.length).to.be.greaterThan(0);
    });
  });

  describe('Integration', () => {
    it('should complete a full data collection cycle', async () => {
      // Fetch data
      const data = await fetcher.fetchLatestData();
      expect(data).to.have.property('timestamp');
      
      // Store data
      const filePath = await storage.store(data);
      expect(filePath).to.be.a('string');
      
      // Verify stored data
      const isValid = await storage.verify(filePath);
      expect(isValid).to.be.true;
      
      // Check file exists
      const exists = await fs.access(filePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).to.be.true;
    }).timeout(20000);
  });
});
