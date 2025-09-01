/**
 * Example integration script for your existing bot
 * This shows how to fetch security data from the analyzer service
 * 
 * Usage: Include these functions in your existing bot and call them periodically
 */

const https = require('https');
const http = require('http');

class AnalyzerSecurityMonitor {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.lastCheckTime = 0;
    this.knownAlerts = new Set();
  }

  /**
   * Main monitoring function - call this every 5-10 minutes from your existing bot
   */
  async checkSecurityStatus() {
    try {
      // Get health status
      const health = await this.fetchHealthStatus();
      
      // Get security summary for reporting
      const summary = await this.fetchSecuritySummary();
      
      // Check for critical alerts
      const alerts = await this.fetchCriticalAlerts();
      
      // Process and send notifications
      await this.processSecurityData(health, summary, alerts);
      
    } catch (error) {
      console.error('[Security Monitor] Error checking analyzer security:', error.message);
      
      // Send error notification through your existing bot
      await this.sendErrorNotification('Failed to fetch security data from analyzer service');
    }
  }

  /**
   * Fetch health status
   */
  async fetchHealthStatus() {
    return this.makeRequest('/bot/health');
  }

  /**
   * Fetch security summary
   */
  async fetchSecuritySummary() {
    return this.makeRequest('/bot/security-summary');
  }

  /**
   * Fetch critical alerts
   */
  async fetchCriticalAlerts() {
    return this.makeRequest('/bot/critical-alerts');
  }

  /**
   * Process security data and send notifications
   */
  async processSecurityData(health, summary, alerts) {
    const now = Date.now();
    
    // Check if we need to send a health update (every hour)
    const shouldSendHealthUpdate = (now - this.lastCheckTime) > (60 * 60 * 1000);
    
    // Always notify on critical status
    if (health.status === 'critical' || summary.details.criticalAlerts > 0) {
      await this.sendCriticalAlert(health, summary, alerts);
    }
    // Send warning notifications every 30 minutes
    else if (health.status === 'warning' && shouldSendHealthUpdate) {
      await this.sendWarningNotification(health, summary);
    }
    // Send regular health updates every hour
    else if (shouldSendHealthUpdate) {
      await this.sendHealthUpdate(summary);
    }

    // Check for new alerts
    await this.checkForNewAlerts(alerts);
    
    this.lastCheckTime = now;
  }

  /**
   * Send critical security alert
   */
  async sendCriticalAlert(health, summary, alerts) {
    const message = `🚨 **ANALYZER SECURITY ALERT** 🚨
    
${summary.emoji} **Status**: ${summary.summary}

📊 **Details**:
• System Health: ${health.status.toUpperCase()}
• Critical Alerts: ${summary.details.criticalAlerts}
• Blocked IPs: ${summary.details.blockedIPs}
• Active Alerts: ${health.activeAlerts}

${alerts.hasAlerts ? `🔍 **Active Alerts**:\n${alerts.alerts.map(a => `• ${a.title} (${a.severity})`).join('\n')}` : ''}

⚡ **Action Required**: Check security dashboard immediately`;

    await this.sendNotification(message, 'critical');
  }

  /**
   * Send warning notification
   */
  async sendWarningNotification(health, summary) {
    const message = `⚠️ **Analyzer Security Warning**

${summary.emoji} ${summary.summary}

📊 System Health: ${health.status.toUpperCase()}
🛡️ Events: ${summary.details.totalEvents} in last hour
🚫 Blocked IPs: ${summary.details.blockedIPs}

💡 Recommendations: ${summary.recommendations.join(', ')}`;

    await this.sendNotification(message, 'warning');
  }

  /**
   * Send regular health update
   */
  async sendHealthUpdate(summary) {
    if (summary.details.systemHealth === 'HEALTHY') {
      // Only send healthy updates once per day or if specifically requested
      const message = `✅ Analyzer Security: All systems normal (${summary.details.totalEvents} events monitored)`;
      await this.sendNotification(message, 'info');
    }
  }

  /**
   * Check for new alerts we haven't seen before
   */
  async checkForNewAlerts(alerts) {
    if (!alerts.hasAlerts) return;

    for (const alert of alerts.alerts) {
      const alertKey = `${alert.title}-${alert.timestamp}`;
      
      if (!this.knownAlerts.has(alertKey)) {
        this.knownAlerts.add(alertKey);
        
        const message = `🚨 **New Security Alert**

**${alert.title}**
Severity: ${alert.severity}
Time: ${new Date(alert.timestamp).toLocaleString()}

${alert.message}`;

        await this.sendNotification(message, alert.severity.toLowerCase());
      }
    }

    // Clean up old alert tracking (keep last 100)
    if (this.knownAlerts.size > 100) {
      const alertArray = Array.from(this.knownAlerts);
      this.knownAlerts = new Set(alertArray.slice(-50));
    }
  }

  /**
   * Make HTTP request to analyzer service
   */
  async makeRequest(endpoint) {
    return new Promise((resolve, reject) => {
      const url = `${this.baseUrl}${endpoint}`;
      const protocol = url.startsWith('https:') ? https : http;
      
      const req = protocol.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(JSON.parse(data));
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        });
      });
      
      req.on('error', (error) => {
        reject(new Error(`Request failed: ${error.message}`));
      });
      
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  /**
   * Send notification through your existing bot
   * Replace this with your actual notification method
   */
  async sendNotification(message, severity = 'info') {
    // Replace with your existing bot's notification method
    console.log(`[${severity.toUpperCase()}] Security Notification:`, message);
    
    // Example: if you have a Telegram bot
    // await yourTelegramBot.sendMessage(CHAT_ID, message);
    
    // Example: if you have a Discord bot  
    // await yourDiscordChannel.send(message);
    
    // Example: if you have a Slack bot
    // await yourSlackClient.chat.postMessage({ channel: CHANNEL_ID, text: message });
  }

  /**
   * Send error notification
   */
  async sendErrorNotification(errorMessage) {
    const message = `❌ **Analyzer Monitoring Error**

Failed to check analyzer security status:
${errorMessage}

Please check the analyzer service manually.`;
    
    await this.sendNotification(message, 'error');
  }
}

// Usage example:
// Add this to your existing bot's main loop

/*
// In your existing bot initialization:
const securityMonitor = new AnalyzerSecurityMonitor('http://localhost:3000');

// In your bot's main loop or cron job:
setInterval(async () => {
  await securityMonitor.checkSecurityStatus();
}, 5 * 60 * 1000); // Check every 5 minutes

// Or call manually when needed:
// await securityMonitor.checkSecurityStatus();
*/

module.exports = { AnalyzerSecurityMonitor };