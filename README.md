# Crypto Price Monitor

A simple script that retrieves real-time cryptocurrency price data, stores it in SQLite, and generates alerts based on configurable thresholds.

## Features

- Real-time price data fetching from CoinGecko API
- SQLite storage for historical price data
- Configurable price and volume alerts
- Automatic tracking of top 50 cryptocurrencies
- Rate limiting to respect API constraints
- CLI and Telegram bot interfaces for alert management

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file based on `.env.example`:
```bash
COINS_TO_TRACK=bitcoin,ethereum
CURRENCIES=usd,eur
UPDATE_INTERVAL=30000
MAX_REQUESTS_PER_MINUTE=50
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

3. Run the application:
```bash
npm start
```

## Command Line Interface

The application provides a CLI for managing alerts:

### Setting Alerts

Set a price change alert for a specific coin:

```bash
npm run manage-alerts -- setalert <coin_id> <threshold_percentage>
```

Example:
```bash
npm run manage-alerts -- setalert bitcoin 5
```
This sets an alert for Bitcoin when its price changes by 5% or more.

### Listing Alerts

List all currently set alerts:

```bash
npm run manage-alerts -- listalerts
```

### Removing Alerts

Remove an alert for a specific coin:

```bash
npm run manage-alerts -- removealert <coin_id>
```

Example:
```bash
npm run manage-alerts -- removealert bitcoin
```

### Market Summary

Get a summary of the market for the last N hours:

```bash
npm run manage-alerts -- market [hours]
```

Example:
```bash
npm run manage-alerts -- market 12
```
This shows the market summary for the last 12 hours, including top gainers, losers, and coins with highest volatility.

## Telegram Bot Commands

The application also provides a Telegram bot for managing alerts:

- `/addcoin <coin_id> <percentage>` - Add an alert for a coin with threshold
- `/removecoin <coin_id>` - Remove an alert for a coin
- `/listcoins` - List all monitored coins with their thresholds
- `/market [hours]` - Show market summary for the last N hours (default: 24)
- `/help` - Show help message with available commands

Example:
```
/addcoin bitcoin 5
```
This sets an alert for Bitcoin when its price changes by 5% or more.

## Monetization Possibilities

1. **Premium Features**
   - Custom alert thresholds
   - Additional technical indicators
   - Higher frequency updates
   - Export data to different formats

2. **API Access**
   - Expose historical price data via REST API
   - Provide aggregated market insights
   - Custom webhook notifications

3. **Trading Integration**
   - Add automated trading capabilities
   - Connect to popular exchanges
   - Implement trading strategies

## Extension Ideas

1. **Additional Data Sources**
   - Add support for traditional stocks
   - Include more crypto exchanges
   - Integrate news feeds

2. **Advanced Analytics**
   - Technical analysis indicators
   - Machine learning predictions
   - Pattern recognition

3. **Notification Systems**
   - Email notifications
   - SMS alerts
   - Telegram/Discord bots

## Testing

Run the test suite:
```bash
npm test
```

## License

ISC 