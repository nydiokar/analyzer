import fs from 'fs';
import Database from 'better-sqlite3';
import { CryptoPrice } from '../../types/crypto';
import { createLogger } from '../../utils/logger';
import path from 'path';

const logger = createLogger('SQLiteManager');

export class SQLiteManager {
  private db: Database.Database;

  constructor(dbPath: string = './data/crypto.db') {
    this.ensureDirectoryExists(path.dirname(dbPath));
    this.db = new Database(dbPath);
    this.initializeDatabase();
  }

  private ensureDirectoryExists(dir: string) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info(`Created directory: ${dir}`);
    }
  }

  private initializeDatabase() {
    // Create tables if they don't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        coin_id TEXT NOT NULL,
        price REAL NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        coin_id TEXT NOT NULL,
        price REAL NOT NULL,
        threshold REAL NOT NULL,
        type TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  async storePrice(price: CryptoPrice) {
    const stmt = this.db.prepare(`
      INSERT INTO prices (coin_id, price)
      VALUES (?, ?)
    `);
    
    stmt.run(price.id, price.current_price);
    logger.info(`Stored price for ${price.id}: ${price.current_price}`);
  }

  async storeAlert(coinId: string, price: number, threshold: number, type: string) {
    const stmt = this.db.prepare(`
      INSERT INTO alerts (coin_id, price, threshold, type)
      VALUES (?, ?, ?, ?)
    `);
    
    stmt.run(coinId, price, threshold, type);
    logger.info(`Alert stored for ${coinId}: ${type} threshold ${threshold} at price ${price}`);
  }

  getRecentPrices(coinId: string, limit: number = 100) {
    const stmt = this.db.prepare(`
      SELECT * FROM prices 
      WHERE coin_id = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `);
    
    return stmt.all(coinId, limit);
  }

  getRecentAlerts(coinId: string, limit: number = 10) {
    const stmt = this.db.prepare(`
      SELECT * FROM alerts 
      WHERE coin_id = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `);
    
    return stmt.all(coinId, limit);
  }

  close() {
    this.db.close();
  }
} 