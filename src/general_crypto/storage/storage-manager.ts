import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto-js';
import { StoredCryptoData, StorageConfig } from '../types/crypto';
import { createLogger } from '../../utils/logger';

const logger = createLogger('StorageManager');

export class StorageManager {
  private readonly config: StorageConfig;

  constructor(config: StorageConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.config.directory, { recursive: true });
      logger.info(`Storage directory initialized: ${this.config.directory}`);
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Failed to initialize storage directory', { error: error.message });
      }
      throw error;
    }
  }

  private getFilePath(timestamp: string): string {
    const fileName = `crypto_data_${timestamp.replace(/[:.]/g, '-')}.${this.config.format}`;
    return path.join(this.config.directory, fileName);
  }

  async store(data: StoredCryptoData): Promise<string> {
    try {
      const filePath = this.getFilePath(data.timestamp);
      const content = this.config.format === 'json' 
        ? JSON.stringify(data, null, 2)
        : this.convertToCSV(data);

      await fs.writeFile(filePath, content, 'utf-8');
      logger.info(`Data stored successfully`, { path: filePath });
      
      return filePath;
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Failed to store data', { error: error.message });
      }
      throw error;
    }
  }

  async verify(filePath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data: StoredCryptoData = this.config.format === 'json'
        ? JSON.parse(content)
        : this.parseCSV(content);

      const calculatedSignature = crypto.SHA256(JSON.stringify(data.data)).toString();
      const isValid = calculatedSignature === data.signature;

      if (!isValid) {
        logger.warn('Data verification failed', { path: filePath });
      }

      return isValid;
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Failed to verify data', { error: error.message, path: filePath });
      }
      throw error;
    }
  }

  private convertToCSV(data: StoredCryptoData): string {
    const headers = ['timestamp', 'coin_id', 'price', 'market_cap', 'volume_24h', 'change_24h'];
    const rows = [headers.join(',')];

    for (const coin of data.data) {
      const row = [
        data.timestamp,
        coin.id,
        coin.current_price,
        coin.market_cap,
        coin.total_volume,
        coin.price_change_percentage_24h
      ].join(',');
      rows.push(row);
    }

    // Add signature as metadata
    rows.push(`# Signature: ${data.signature}`);
    return rows.join('\n');
  }

  private parseCSV(content: string): StoredCryptoData {
    const lines = content.split('\n');
    const signature = lines[lines.length - 1].split('# Signature: ')[1];
    const [headers, ...dataRows] = lines
      .filter(line => !line.startsWith('#') && line.trim().length > 0);

    const headerMap = headers.split(',').reduce((acc, header, index) => {
      acc[header] = index;
      return acc;
    }, {} as { [key: string]: number });

    const data = dataRows.map(row => {
      const values = row.split(',');
      return {
        id: values[headerMap.coin_id],
        symbol: values[headerMap.coin_id],
        name: values[headerMap.coin_id],
        current_price: parseFloat(values[headerMap.price]),
        market_cap: parseFloat(values[headerMap.market_cap]),
        market_cap_rank: 0,
        total_volume: parseFloat(values[headerMap.volume_24h]),
        high_24h: 0,
        low_24h: 0,
        price_change_24h: 0,
        price_change_percentage_24h: parseFloat(values[headerMap.change_24h]),
        last_updated: values[headerMap.timestamp]
      };
    });

    return {
      timestamp: dataRows[0].split(',')[headerMap.timestamp],
      data,
      signature
    };
  }

  async listStoredFiles(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.config.directory);
      return files
        .filter(file => file.endsWith(`.${this.config.format}`))
        .map(file => path.join(this.config.directory, file));
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Failed to list stored files', { error: error.message });
      }
      throw error;
    }
  }
}
