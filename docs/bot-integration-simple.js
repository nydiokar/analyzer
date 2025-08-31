/**
 * SIMPLE ANALYZER SECURITY INTEGRATION
 * Add this to your existing bot to get security notifications
 * 
 * MINIMAL SETUP - Just 2 functions to add to your existing bot!
 */

const http = require('http');

// Configuration - adjust these for your setup
const ANALYZER_URL = 'http://localhost:3000';  // Your analyzer service URL
const CHECK_INTERVAL = 5 * 60 * 1000;          // Check every 5 minutes
const HEALTH_REPORT_INTERVAL = 60 * 60 * 1000; // Health reports every hour

class SimpleSecurityMonitor {
  constructor() {
    this.lastHealthReport = 0;
    this.knownCriticalAlerts = new Set();
  }

  /**
   * ADD THIS TO YOUR EXISTING BOT'S MAIN LOOP
   * This is the ONLY function you need to call periodically
   */
  async checkAndNotify() {
    try {
      const health = await this.fetchJson('/bot/health');
      const now = Date.now();
      
      // CRITICAL: Always notify immediately
      if (health.status === 'critical') {
        await this.handleCriticalStatus();
        return;
      }
      
      // WARNING: Notify every 30 minutes
      if (health.status === 'warning') {
        const timeSinceLastReport = now - this.lastHealthReport;
        if (timeSinceLastReport > (30 * 60 * 1000)) {
          await this.handleWarningStatus();
          this.lastHealthReport = now;
        }
        return;
      }
      
      // HEALTHY: Send report every hour
      if (health.status === 'healthy') {
        const timeSinceLastReport = now - this.lastHealthReport;
        if (timeSinceLastReport > HEALTH_REPORT_INTERVAL) {
          await this.handleHealthyStatus();
          this.lastHealthReport = now;
        }
      }
      
    } catch (error) {
      // Notify about monitoring failures (but don't spam)
      const timeSinceLastReport = Date.now() - this.lastHealthReport;
      if (timeSinceLastReport > (30 * 60 * 1000)) {
        await this.sendMessage(`❌ Can't reach analyzer security monitor: ${error.message}`, 'error');
        this.lastHealthReport = Date.now();
      }
    }
  }

  /**
   * Handle critical security status
   */
  async handleCriticalStatus() {
    try {
      const summary = await this.fetchJson('/bot/security-summary');
      const alerts = await this.fetchJson('/bot/critical-alerts');
      
      let message = `🚨 **ANALYZER SECURITY CRITICAL** 🚨\n\n`;
      message += `${summary.emoji} ${summary.summary}\n\n`;
      message += `📊 **Details:**\n`;
      message += `• System Health: ${summary.details.systemHealth}\n`;
      message += `• Critical Alerts: ${summary.details.criticalAlerts}\n`;
      message += `• Blocked IPs: ${summary.details.blockedIPs}\n`;
      message += `• Total Events: ${summary.details.totalEvents}\n\n`;
      
      if (alerts.hasAlerts) {
        message += `🔍 **Active Alerts:**\n`;
        alerts.alerts.forEach(alert => {
          message += `• ${alert.title} (${alert.severity})\n`;
        });
        message += `\n`;
      }
      
      message += `⚡ **ACTION REQUIRED**: Check analyzer dashboard immediately`;
      
      await this.sendMessage(message, 'critical');
      
    } catch (error) {
      await this.sendMessage(`🚨 ANALYZER CRITICAL STATUS - Can't get details: ${error.message}`, 'critical');
    }
  }

  /**
   * Handle warning security status
   */
  async handleWarningStatus() {
    try {
      const summary = await this.fetchJson('/bot/security-summary');
      
      let message = `⚠️ **Analyzer Security Warning**\n\n`;
      message += `${summary.emoji} ${summary.summary}\n\n`;
      message += `📊 **Details:**\n`;
      message += `• System Health: ${summary.details.systemHealth}\n`;
      message += `• Events (last hour): ${summary.details.totalEvents}\n`;
      message += `• Blocked IPs: ${summary.details.blockedIPs}\n\n`;
      message += `💡 **Recommendations:** ${summary.recommendations.join(', ')}`;
      
      await this.sendMessage(message, 'warning');
      
    } catch (error) {
      await this.sendMessage(`⚠️ ANALYZER WARNING STATUS - Can't get details: ${error.message}`, 'warning');
    }
  }

  /**
   * Handle healthy status (daily report)
   */
  async handleHealthyStatus() {
    try {
      const summary = await this.fetchJson('/bot/security-summary');
      
      const message = `✅ **Analyzer Security Daily Report**\n\n` +
                     `${summary.emoji} ${summary.summary}\n` +
                     `📊 Events monitored: ${summary.details.totalEvents}\n` +
                     `🛡️ Blocked threats: ${summary.details.blockedIPs}\n` +
                     `💡 Status: All systems nominal`;
      
      await this.sendMessage(message, 'info');
      
    } catch (error) {
      // Don't notify about healthy status fetch failures
      console.log('Failed to get healthy status details:', error.message);
    }
  }

  /**
   * Fetch JSON from analyzer endpoint
   */
  async fetchJson(endpoint) {
    return new Promise((resolve, reject) => {
      const url = `${ANALYZER_URL}${endpoint}`;
      
      const req = http.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(JSON.parse(data));
            } else {
              reject(new Error(`HTTP ${res.statusCode}`));
            }
          } catch (error) {
            reject(new Error(`Parse error: ${error.message}`));
          }
        });
      });
      
      req.on('error', error => reject(error));
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    });
  }

  /**
   * REPLACE THIS WITH YOUR BOT'S SEND MESSAGE METHOD
   * This is the ONLY method you need to customize!
   */
  async sendMessage(message, severity = 'info') {
    console.log(`[${severity.toUpperCase()}] ANALYZER SECURITY:`, message);
    
    // 🔥 REPLACE WITH YOUR ACTUAL BOT SEND METHOD:
    
    // If you have Telegram bot:
    // await yourTelegramBot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
    
    // If you have Discord bot:
    // await yourDiscordChannel.send(message);
    
    // If you have Slack bot:
    // await yourSlackClient.chat.postMessage({ channel: CHANNEL_ID, text: message });
    
    // If you have generic webhook:
    // await fetch(WEBHOOK_URL, { 
    //   method: 'POST', 
    //   headers: {'Content-Type': 'application/json'}, 
    //   body: JSON.stringify({ text: message, severity }) 
    // });
  }
}

// ============================================================================
// USAGE: Add these lines to your existing bot
// ============================================================================

// 1. CREATE INSTANCE (add to your bot initialization)
const securityMonitor = new SimpleSecurityMonitor();

// 2. ADD TO YOUR BOT'S MAIN LOOP (or cron job)
setInterval(async () => {
  await securityMonitor.checkAndNotify();
}, CHECK_INTERVAL);

// 3. OPTIONAL: Manual check command for your bot
// async function checkAnalyzerSecurity() {
//   await securityMonitor.checkAndNotify();
// }

// ============================================================================
// THAT'S IT! Your bot will now monitor analyzer security automatically
// ============================================================================

module.exports = { SimpleSecurityMonitor };