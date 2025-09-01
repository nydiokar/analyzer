# 🤖 Bot Integration Examples

## Quick Integration for Common Bot Frameworks

### 🔵 Telegram Bot Integration

```javascript
// Add to your existing Telegram bot
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');

class TelegramSecurityMonitor {
  constructor(bot, chatId) {
    this.bot = bot;
    this.chatId = chatId;
    this.lastCheck = 0;
  }

  async checkSecurity() {
    try {
      const response = await this.fetchHealth();
      
      if (response.status === 'critical') {
        const summary = await this.fetchSummary();
        const message = `🚨 *ANALYZER SECURITY ALERT*\n\n${summary.summary}\n\n📊 Critical Alerts: ${summary.details.criticalAlerts}\n🚫 Blocked IPs: ${summary.details.blockedIPs}`;
        await this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
      }
      
      // Send daily reports
      if (Date.now() - this.lastCheck > 24 * 60 * 60 * 1000) {
        const summary = await this.fetchSummary();
        if (response.status === 'healthy') {
          await this.bot.sendMessage(this.chatId, `✅ Analyzer Security: ${summary.summary}`);
        }
        this.lastCheck = Date.now();
      }
      
    } catch (error) {
      console.error('Security check failed:', error);
    }
  }

  async fetchHealth() {
    return this.makeRequest('/bot/health');
  }

  async fetchSummary() {
    return this.makeRequest('/bot/security-summary');
  }

  makeRequest(endpoint) {
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:3000${endpoint}`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
  }
}

// Usage in your Telegram bot:
const securityMonitor = new TelegramSecurityMonitor(yourTelegramBot, YOUR_CHAT_ID);
setInterval(() => securityMonitor.checkSecurity(), 5 * 60 * 1000);
```

### 🟣 Discord Bot Integration

```javascript
// Add to your existing Discord bot
const { Client } = require('discord.js');
const http = require('http');

class DiscordSecurityMonitor {
  constructor(client, channelId) {
    this.client = client;
    this.channelId = channelId;
    this.lastCheck = 0;
  }

  async checkSecurity() {
    try {
      const channel = this.client.channels.cache.get(this.channelId);
      const health = await this.makeRequest('/bot/health');
      
      if (health.status === 'critical') {
        const summary = await this.makeRequest('/bot/security-summary');
        const embed = {
          color: 0xff0000,
          title: '🚨 Analyzer Security Alert',
          description: summary.summary,
          fields: [
            { name: 'Critical Alerts', value: summary.details.criticalAlerts.toString(), inline: true },
            { name: 'Blocked IPs', value: summary.details.blockedIPs.toString(), inline: true },
            { name: 'System Health', value: summary.details.systemHealth, inline: true }
          ],
          timestamp: new Date()
        };
        await channel.send({ embeds: [embed] });
      }
      
    } catch (error) {
      console.error('Security check failed:', error);
    }
  }

  makeRequest(endpoint) {
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:3000${endpoint}`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
  }
}

// Usage in your Discord bot:
const securityMonitor = new DiscordSecurityMonitor(client, 'YOUR_CHANNEL_ID');
setInterval(() => securityMonitor.checkSecurity(), 5 * 60 * 1000);
```

### 🟢 Generic Webhook Integration

```javascript
// For any bot with webhook capabilities
const https = require('https');
const http = require('http');

async function checkAnalyzerSecurity() {
  try {
    const health = await makeRequest('/bot/health');
    
    if (health.status !== 'healthy') {
      const summary = await makeRequest('/bot/security-summary');
      
      // Send to your webhook
      const payload = {
        text: `${summary.emoji} Analyzer Security: ${summary.summary}`,
        severity: health.status,
        details: summary.details,
        timestamp: new Date().toISOString()
      };
      
      await sendWebhook('YOUR_WEBHOOK_URL', payload);
    }
    
  } catch (error) {
    console.error('Security check failed:', error);
  }
}

function makeRequest(endpoint) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3000${endpoint}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function sendWebhook(url, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const protocol = url.startsWith('https:') ? https : http;
    
    const req = protocol.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, resolve);
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Run every 5 minutes
setInterval(checkAnalyzerSecurity, 5 * 60 * 1000);
```

## 📡 Simple curl Testing

Before integrating, test the endpoints:

```bash
# Test health endpoint
curl http://localhost:3000/bot/health

# Test security summary  
curl http://localhost:3000/bot/security-summary

# Test critical alerts
curl http://localhost:3000/bot/critical-alerts
```

## 🚀 Integration Steps

1. **Choose your bot framework** from examples above
2. **Copy the relevant code** into your existing bot
3. **Replace the placeholder values**:
   - `YOUR_CHAT_ID` / `YOUR_CHANNEL_ID` / `YOUR_WEBHOOK_URL`
   - `http://localhost:3000` (if your analyzer runs elsewhere)
4. **Add the security check to your bot's main loop**
5. **Test with** `curl` commands above

## ⚙️ Configuration Options

```javascript
// Adjust these in your bot integration:
const CHECK_INTERVAL = 5 * 60 * 1000;        // How often to check (5 minutes)
const DAILY_REPORT_INTERVAL = 24 * 60 * 60 * 1000; // Daily report frequency
const ANALYZER_URL = 'http://localhost:3000';  // Your analyzer service URL
```

## 🔧 Troubleshooting

### Common Issues:

1. **Connection Refused**: Make sure analyzer service is running on port 3000
2. **No Notifications**: Check your bot token/channel ID/webhook URL
3. **Too Many Notifications**: Increase `CHECK_INTERVAL` or adjust severity thresholds
4. **Missing Alerts**: Lower the security thresholds in analyzer `.env` file

### Debug Mode:

```javascript
// Add this to debug your integration:
console.log('Security check result:', await makeRequest('/bot/health'));
```