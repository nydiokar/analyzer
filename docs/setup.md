# Setup and Configuration Guide

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)
- SQLite3
- Telegram Bot Token (for notifications)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd crypto-price-monitor
```

2. Install dependencies:
```bash
npm install
```

3. Create environment file:
```bash
cp .env.example .env
```

## Configuration

### Environment Variables

Edit the `.env` file with your configuration:

```env
# Coin Configuration
COINS_TO_TRACK=bitcoin,ethereum
CURRENCIES=usd,eur

# Update Settings
UPDATE_INTERVAL=30000
MAX_REQUESTS_PER_MINUTE=50

# Telegram Configuration
TELEGRAM_BOT_TOKEN_GENERAL=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

TELEGRAM_BOT_TOKEN=your_bot_token // this is used by the wallet analyzer

# Database Settings
DB_PATH=./data/crypto.db
LOG_PATH=./logs/app.log
```

### Coin Configuration

- `COINS_TO_TRACK`: Comma-separated list of coin IDs to monitor
- `CURRENCIES`: Comma-separated list of currencies to track

### Update Settings

- `UPDATE_INTERVAL`: Time between updates in milliseconds
- `MAX_REQUESTS_PER_MINUTE`: Maximum API requests per minute

### Telegram Setup

1. Create a Telegram bot using [@BotFather](https://t.me/botfather)
2. Get your bot token
3. Start a chat with your bot
4. Get your chat ID using [@userinfobot](https://t.me/userinfobot)

## Database Setup

The application uses SQLite for data storage. The database is automatically created and initialized on first run.

### Database Structure

- `prices`: Stores historical price data
- `alerts`: Stores alert configurations
- `market_data`: Stores market statistics

## Running the Application

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

### Managing Alerts

Set an alert:
```bash
npm run manage-alerts -- setalert <coin_id> <threshold_percentage>
```

List alerts:
```bash
npm run manage-alerts -- listalerts
```

Remove an alert:
```bash
npm run manage-alerts -- removealert <coin_id>
```

## Monitoring and Logs

Logs are stored in the `logs` directory:
- `app.log`: Application logs
- `error.log`: Error logs
- `access.log`: API access logs

## Backup and Maintenance

### Database Backup

1. Stop the application
2. Copy the database file:
```bash
cp data/crypto.db data/crypto.db.backup
```

### Log Rotation

Logs are automatically rotated based on size:
- Maximum log size: 10MB
- Maximum backup files: 5

## Troubleshooting

### Common Issues

1. **API Rate Limiting**
   - Solution: Increase `UPDATE_INTERVAL` or decrease `MAX_REQUESTS_PER_MINUTE`

2. **Database Errors**
   - Solution: Check database permissions and disk space

3. **Telegram Notifications**
   - Solution: Verify bot token and chat ID

### Debug Mode

Enable debug logging:
```bash
DEBUG=true npm start
```

## Security Considerations

1. Keep your `.env` file secure
2. Regularly rotate API keys
3. Monitor API usage
4. Keep dependencies updated

## Updating

1. Pull latest changes:
```bash
git pull
```

2. Update dependencies:
```bash
npm install
```

3. Restart the application 