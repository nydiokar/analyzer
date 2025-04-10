import fs from 'fs';
import Database from 'better-sqlite3';
import { CryptoPrice, AnalysisResult } from '../../types/crypto';
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
      
      CREATE TABLE IF NOT EXISTS analysis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        coin_id TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        volatility_24h REAL NOT NULL,
        price_change_24h REAL NOT NULL,
        volume_change_24h REAL NOT NULL,
        market_cap_change_24h REAL NOT NULL,
        is_volatile BOOLEAN NOT NULL,
        trend_direction TEXT NOT NULL,
        volume_alert BOOLEAN NOT NULL
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

  async storeAnalysis(analysis: AnalysisResult) {
    const stmt = this.db.prepare(`
      INSERT INTO analysis (
        coin_id, 
        volatility_24h, 
        price_change_24h, 
        volume_change_24h, 
        market_cap_change_24h, 
        is_volatile, 
        trend_direction, 
        volume_alert
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      analysis.coin,
      analysis.metrics.volatility24h,
      analysis.metrics.priceChange24h,
      analysis.metrics.volumeChange24h,
      analysis.metrics.marketCapChange24h,
      analysis.signals.isVolatile ? 1 : 0,
      analysis.signals.trendDirection,
      analysis.signals.volumeAlert ? 1 : 0
    );
    
    logger.info(`Analysis stored for ${analysis.coin}`);
  }

  getRecentAnalysis(coinId: string, limit: number = 10) {
    const stmt = this.db.prepare(`
      SELECT * FROM analysis 
      WHERE coin_id = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `);
    
    return stmt.all(coinId, limit);
  }

  getPreviousDayPrice(coinId: string): any | null {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    const stmt = this.db.prepare(`
      SELECT * FROM prices 
      WHERE coin_id = ? AND timestamp <= ?
      ORDER BY timestamp DESC 
      LIMIT 1
    `);
    
    const result = stmt.get(coinId, oneDayAgo.toISOString());
    return result || null;
  }

  getMarketSummary(hours: number = 24, limit: number = 10) {
    const timeAgo = new Date();
    timeAgo.setHours(timeAgo.getHours() - hours);
    
    try {
      // First check if we have any analysis data
      const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM analysis');
      const countResult = countStmt.get() as { count: number } | undefined;
      
      if (!countResult || countResult.count === 0) {
        // If no analysis data, try to get data directly from prices table
        const pricesCountStmt = this.db.prepare('SELECT COUNT(*) as count FROM prices');
        const pricesCount = pricesCountStmt.get() as { count: number } | undefined;
        
        if (!pricesCount || pricesCount.count === 0) {
          // No price data at all
          return [];
        }
        
        // Try to find coins with historical data
        const fallbackStmt = this.db.prepare(`
          SELECT 
            p1.coin_id,
            p1.timestamp,
            COALESCE((p1.price - p2.price) / NULLIF(p2.price, 0) * 100, 0) as price_change_24h,
            0 as volume_change_24h,
            0 as volatility_24h,
            CASE 
              WHEN p1.price > COALESCE(p2.price, p1.price) THEN 'up'
              WHEN p1.price < COALESCE(p2.price, p1.price) THEN 'down'
              ELSE 'neutral'
            END as trend_direction,
            p1.price as current_price
          FROM prices p1
          JOIN (
            SELECT coin_id, MAX(timestamp) as max_time
            FROM prices
            GROUP BY coin_id
          ) latest ON p1.coin_id = latest.coin_id AND p1.timestamp = latest.max_time
          LEFT JOIN (
            SELECT coin_id, price, MAX(timestamp) as timestamp
            FROM prices
            WHERE timestamp <= datetime('now', '-' || ? || ' hours')
            GROUP BY coin_id
          ) p2 ON p1.coin_id = p2.coin_id
          ORDER BY p1.coin_id
          LIMIT ?
        `);
        
        const results = fallbackStmt.all(hours, limit);
        
        // If we still got no results, just return the latest prices with zero change
        if (results.length === 0) {
          const latestPricesStmt = this.db.prepare(`
            SELECT 
              p.coin_id,
              p.timestamp,
              0 as price_change_24h,
              0 as volume_change_24h,
              0 as volatility_24h,
              'neutral' as trend_direction,
              p.price as current_price
            FROM prices p
            JOIN (
              SELECT coin_id, MAX(timestamp) as max_time
              FROM prices
              GROUP BY coin_id
            ) latest ON p.coin_id = latest.coin_id AND p.timestamp = latest.max_time
            LIMIT ?
          `);
          
          return latestPricesStmt.all(limit);
        }
        
        return results;
      }
      
      // Otherwise use the analysis table as before
      const stmt = this.db.prepare(`
        SELECT 
          a.coin_id, 
          a.timestamp,
          a.price_change_24h,
          a.volume_change_24h, 
          a.volatility_24h,
          a.trend_direction,
          p.price AS current_price
        FROM analysis a
        JOIN (
          SELECT coin_id, MAX(timestamp) as max_time
          FROM analysis
          GROUP BY coin_id
        ) latest ON a.coin_id = latest.coin_id AND a.timestamp = latest.max_time
        JOIN prices p ON a.coin_id = p.coin_id
        JOIN (
          SELECT coin_id, MAX(timestamp) as max_time
          FROM prices
          GROUP BY coin_id
        ) latest_prices ON p.coin_id = latest_prices.coin_id AND p.timestamp = latest_prices.max_time
        WHERE a.timestamp >= ?
        ORDER BY ABS(a.price_change_24h) DESC
        LIMIT ?
      `);
      
      return stmt.all(timeAgo.toISOString(), limit);
    } catch (error) {
      console.error('Error getting market summary:', error);
      return [];
    }
  }

  getTopMovers(hours: number = 24, limit: number = 5) {
    const timeAgo = new Date();
    timeAgo.setHours(timeAgo.getHours() - hours);
    
    try {
      // First check if we have any analysis data
      const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM analysis');
      const countResult = countStmt.get() as { count: number } | undefined;
      
      if (!countResult || countResult.count === 0) {
        // If no analysis data, try to get data directly from prices table
        const pricesCountStmt = this.db.prepare('SELECT COUNT(*) as count FROM prices');
        const pricesCount = pricesCountStmt.get() as { count: number } | undefined;
        
        if (!pricesCount || pricesCount.count === 0) {
          // No price data at all
          return [];
        }
        
        // Try to find coins with historical data
        const fallbackStmt = this.db.prepare(`
          SELECT 
            p1.coin_id,
            COALESCE((p1.price - p2.price) / NULLIF(p2.price, 0) * 100, 0) as price_change_24h,
            CASE 
              WHEN p1.price > COALESCE(p2.price, p1.price) THEN 'up'
              WHEN p1.price < COALESCE(p2.price, p1.price) THEN 'down'
              ELSE 'neutral'
            END as trend_direction,
            p1.price as current_price
          FROM prices p1
          JOIN (
            SELECT coin_id, MAX(timestamp) as max_time
            FROM prices
            GROUP BY coin_id
          ) latest ON p1.coin_id = latest.coin_id AND p1.timestamp = latest.max_time
          LEFT JOIN (
            SELECT coin_id, price, MAX(timestamp) as timestamp
            FROM prices
            WHERE timestamp <= datetime('now', '-' || ? || ' hours')
            GROUP BY coin_id
          ) p2 ON p1.coin_id = p2.coin_id
          ORDER BY COALESCE((p1.price - p2.price) / NULLIF(p2.price, 0) * 100, 0) DESC
          LIMIT ?
        `);
        
        const results = fallbackStmt.all(hours, limit);
        
        // If we still got no results, just return the latest prices with zero change
        if (results.length === 0) {
          const latestPricesStmt = this.db.prepare(`
            SELECT 
              p.coin_id,
              0 as price_change_24h,
              'neutral' as trend_direction,
              p.price as current_price
            FROM prices p
            JOIN (
              SELECT coin_id, MAX(timestamp) as max_time
              FROM prices
              GROUP BY coin_id
            ) latest ON p.coin_id = latest.coin_id AND p.timestamp = latest.max_time
            LIMIT ?
          `);
          
          return latestPricesStmt.all(limit);
        }
        
        return results;
      }
      
      // Otherwise use the analysis table as before
      const stmt = this.db.prepare(`
        SELECT 
          a.coin_id, 
          a.price_change_24h,
          a.trend_direction,
          p.price AS current_price
        FROM analysis a
        JOIN (
          SELECT coin_id, MAX(timestamp) as max_time
          FROM analysis
          GROUP BY coin_id
        ) latest ON a.coin_id = latest.coin_id AND a.timestamp = latest.max_time
        JOIN prices p ON a.coin_id = p.coin_id
        JOIN (
          SELECT coin_id, MAX(timestamp) as max_time
          FROM prices
          GROUP BY coin_id
        ) latest_prices ON p.coin_id = latest_prices.coin_id AND p.timestamp = latest_prices.max_time
        WHERE a.timestamp >= ?
        ORDER BY a.price_change_24h DESC
        LIMIT ?
      `);
      
      return stmt.all(timeAgo.toISOString(), limit);
    } catch (error) {
      console.error('Error getting top movers:', error);
      return [];
    }
  }

  getTopLosers(hours: number = 24, limit: number = 5) {
    const timeAgo = new Date();
    timeAgo.setHours(timeAgo.getHours() - hours);
    
    try {
      // First check if we have any analysis data
      const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM analysis');
      const countResult = countStmt.get() as { count: number } | undefined;
      
      if (!countResult || countResult.count === 0) {
        // If no analysis data, try to get data directly from prices table
        const pricesCountStmt = this.db.prepare('SELECT COUNT(*) as count FROM prices');
        const pricesCount = pricesCountStmt.get() as { count: number } | undefined;
        
        if (!pricesCount || pricesCount.count === 0) {
          // No price data at all
          return [];
        }
        
        // Try to find coins with historical data
        const fallbackStmt = this.db.prepare(`
          SELECT 
            p1.coin_id,
            COALESCE((p1.price - p2.price) / NULLIF(p2.price, 0) * 100, 0) as price_change_24h,
            CASE 
              WHEN p1.price > COALESCE(p2.price, p1.price) THEN 'up'
              WHEN p1.price < COALESCE(p2.price, p1.price) THEN 'down'
              ELSE 'neutral'
            END as trend_direction,
            p1.price as current_price
          FROM prices p1
          JOIN (
            SELECT coin_id, MAX(timestamp) as max_time
            FROM prices
            GROUP BY coin_id
          ) latest ON p1.coin_id = latest.coin_id AND p1.timestamp = latest.max_time
          LEFT JOIN (
            SELECT coin_id, price, MAX(timestamp) as timestamp
            FROM prices
            WHERE timestamp <= datetime('now', '-' || ? || ' hours')
            GROUP BY coin_id
          ) p2 ON p1.coin_id = p2.coin_id
          ORDER BY COALESCE((p1.price - p2.price) / NULLIF(p2.price, 0) * 100, 0) ASC
          LIMIT ?
        `);
        
        const results = fallbackStmt.all(hours, limit);
        
        // If we still got no results, just return the latest prices with zero change
        if (results.length === 0) {
          const latestPricesStmt = this.db.prepare(`
            SELECT 
              p.coin_id,
              0 as price_change_24h,
              'neutral' as trend_direction,
              p.price as current_price
            FROM prices p
            JOIN (
              SELECT coin_id, MAX(timestamp) as max_time
              FROM prices
              GROUP BY coin_id
            ) latest ON p.coin_id = latest.coin_id AND p.timestamp = latest.max_time
            LIMIT ?
          `);
          
          return latestPricesStmt.all(limit);
        }
        
        return results;
      }
      
      // Otherwise use the analysis table as before
      const stmt = this.db.prepare(`
        SELECT 
          a.coin_id, 
          a.price_change_24h,
          a.trend_direction,
          p.price AS current_price
        FROM analysis a
        JOIN (
          SELECT coin_id, MAX(timestamp) as max_time
          FROM analysis
          GROUP BY coin_id
        ) latest ON a.coin_id = latest.coin_id AND a.timestamp = latest.max_time
        JOIN prices p ON a.coin_id = p.coin_id
        JOIN (
          SELECT coin_id, MAX(timestamp) as max_time
          FROM prices
          GROUP BY coin_id
        ) latest_prices ON p.coin_id = latest_prices.coin_id AND p.timestamp = latest_prices.max_time
        WHERE a.timestamp >= ?
        ORDER BY a.price_change_24h ASC
        LIMIT ?
      `);
      
      return stmt.all(timeAgo.toISOString(), limit);
    } catch (error) {
      console.error('Error getting top losers:', error);
      return [];
    }
  }

  close() {
    this.db.close();
  }
} 