import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { createLogger } from '@/utils/logger';
import { CryptoAnalyzer } from '../analysis/analyzer';

const logger = createLogger('AlertManager');

export class AlertManager {
  private alertsDir: string;
  private telegramToken: string | null = null;
  private telegramChatId: string | null = null;

  constructor(
    alertsDir: string = './alerts',
    telegramToken?: string,
    telegramChatId?: string
  ) {
    this.alertsDir = alertsDir;
    this.initializeAlertDirectory();
    
    // Store Telegram credentials if provided
    if (telegramToken && telegramChatId) {
      this.telegramToken = telegramToken;
      this.telegramChatId = telegramChatId;
      logger.info('Telegram alerts enabled');
    }
  }

  private initializeAlertDirectory() {
    if (!fs.existsSync(this.alertsDir)) {
      fs.mkdirSync(this.alertsDir, { recursive: true });
    }
  }

  public async sendTelegramMessage(message: string): Promise<void> {
    if (!this.telegramToken || !this.telegramChatId) return;

    try {
      const url = `https://api.telegram.org/bot${this.telegramToken}/sendMessage`;
      await axios.post(url, {
        chat_id: this.telegramChatId,
        text: message,
        parse_mode: 'HTML'
      });
      logger.info('Alert sent to Telegram');
    } catch (error) {
      logger.error('Failed to send Telegram alert', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  async sendAlert(message: string) {
    const timestamp = new Date().toISOString();
    const alertFile = path.join(this.alertsDir, 'alerts.txt');
    const alertMessage = `[${timestamp}] ${message}\n`;

    try {
      // Write to file
      fs.appendFileSync(alertFile, alertMessage);
      
      // Send to Telegram if configured
      await this.sendTelegramMessage(message);
      
      logger.info(`Alert sent: ${message}`);
    } catch (error) {
      logger.error('Failed to send alert', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  async sendPriceAlert(coin: string, price: number, threshold: number, type: string) {
    const message = `PRICE ALERT: ${coin.toUpperCase()} triggered ${type} alert! Current price: $${price.toFixed(2)}, Threshold: ${threshold}%`;
    await this.sendAlert(message);
  }

  async sendVolumeAlert(coin: string, volume: number, threshold: number) {
    const message = `VOLUME ALERT: ${coin.toUpperCase()} volume change exceeded ${threshold}%! Current volume: $${volume.toFixed(2)}`;
    await this.sendAlert(message);
  }

  async listenForCommands(analyzer: CryptoAnalyzer) {
    if (!this.telegramToken) return;

    const url = `https://api.telegram.org/bot${this.telegramToken}/getUpdates`;

    setInterval(async () => {
      try {
        const response = await axios.get(url);
        const updates = response.data.result;

        updates.forEach((update: any) => {
          const message = update.message?.text;
          if (message && message.startsWith('/setalert')) {
            this.handleCommand(message, analyzer);
          }
        });
      } catch (error) {
        logger.error('Failed to fetch updates', { error: error instanceof Error ? error.message : String(error) });
      }
    }, 5000); // Poll every 5 seconds
  }

  async handleCommand(command: string, analyzer: CryptoAnalyzer) {
    const [action, coin, threshold] = command.split(' ');

    if (action === '/setalert' && coin && threshold) {
      analyzer.setAlertThreshold(coin, parseFloat(threshold));
      logger.info(`Alert set for ${coin} at ${threshold}%`);
    }
  }
} 