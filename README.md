# Crypto Price Monitor

A simple script that retrieves real-time cryptocurrency price data, stores it in SQLite, and generates alerts based on configurable thresholds.

## Features

- Real-time price data fetching from CoinGecko API
- SQLite storage for historical price data
- Configurable price and volume alerts
- Automatic tracking of top 50 cryptocurrencies
- Rate limiting to respect API constraints
- CLI and Telegram bot interfaces for alert management
- Daily OHLC analysis with technical indicators and trading signals

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

## Price Change Analyzer

The project includes a powerful price change analysis tool that processes OHLC (Open, High, Low, Close) data with technical indicators to identify potential trading opportunities.

### Quick Start
```bash
# Analyze recent price changes for a specific cryptocurrency (e.g., bitcoin)
npm run analyze-changes bitcoin

# Analyze with custom time period
npm run analyze-changes ethereum --days 14

# Find the correct CoinGecko ID for a cryptocurrency
npm run find-coin-id BTC        # search by symbol
npm run find-coin-id bitcoin    # search by name
```

### Finding Coin IDs

If you're unsure of the exact CoinGecko ID for a cryptocurrency, use the built-in search utility:

```bash
npm run find-coin-id <query>
```

Example output:
```
Found 3 potential match(es) for "BTC":
  - ID: bitcoin                    Symbol: btc       Name: Bitcoin
  - ID: bitcoin-cash               Symbol: bch       Name: Bitcoin Cash
  - ID: bitcoin-cash-sv            Symbol: bsv       Name: Bitcoin SV

Use the 'ID' value with the analyze-changes script.
```

### Features
- Daily OHLC data analysis with technical indicators (SMA, RSI)
- Automatic identification of buy/sell signals based on price movements
- Technical trend analysis and pattern recognition
- Comprehensive CSV reports for detailed analysis
- Concise summary reports highlighting recent trading opportunities

### Sample Output
```
## Daily OHLC & Indicator Analysis
*   Coin: ethereum (Requested period: 30 days)
*   Analysis Period: 2025-03-24 to 2025-04-23 (180 data points)
*   Latest Data (2025-04-23):
*     OHLC: Open=$1695.26, High=$1761.19, Low=$1695.26, Close=$1759.71
*     Indicators: SMA(20)=1620.47, SMA(50)=1606.73, RSI(14)=75.4
*   Interpretation: RSI Overbought (>70); Trend Up (SMA20>SMA50)
*   Recent Signals:
*     2025-04-10: Sell signal at $1501.95 (-5.60% change)
*     2025-04-09: Buy signal at $1640.06 (10.40% change)
*     2025-04-07: Sell signal at $1455.24 (-5.73% change)
*     2025-04-06: Sell signal at $1623.55 (-7.58% change)
*     2025-04-03: Sell signal at $1795.76 (-6.03% change)
*   Signal Summary: Found 1 Buy and 4 Sell signals during analyzed period
```

### Options
```bash
npm run analyze-changes -- --help

Options:
  --days, -d     Number of past days to fetch data for  [number] [default: 30]
  --coinId       Coin ID from CoinGecko (e.g., bitcoin, ethereum, solana)
                                                        [string] [required]
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
   - Additional technical analysis indicators
   - Automated pattern detection
   - Machine learning predictions
   - Custom trading strategy backtesting

3. **Notification Systems**
   - Email notifications
   - SMS alerts
   - Telegram/Discord bots

## Testing

Run the test suite:
```bash
npm test
```

## Solana Staking Calculator

The project now includes a powerful Solana staking calculator that helps you estimate potential returns from staking SOL.

### Quick Start
```bash
# Calculate returns for native staking
.\run-staking.bat 100 365 native

# Calculate returns for Marinade liquid staking
.\run-staking.bat 100 365 marinade
```

### Options
```bash
npm run calc-staking -- --help

Options:
  --amount, -a  Amount of SOL to stake              [number] [required]
  --days, -d    Staking duration in days            [number] [default: 365]
  --type        Staking type (native or marinade)   [choices: "native", "marinade"]
```

### Sample Output
```
=== Solana Staking Calculator Report ===

Input Parameters:
  Amount: 100 SOL
  Duration: 365 days
  Staking Method: Marinade Liquid Staking

Current Market Data:
  SOL Price: $133.07
  Initial Value: $13,307.00

Projected Returns:
  APY: 6.8% (Live Rate)
  Total SOL: 106.8000 SOL
  Earned SOL: 6.8000 SOL
  Projected Value: $14,211.88
  Profit (USD): $904.88
```

### Features
- Real-time SOL price data from CoinGecko
- Live Marinade protocol APY rates
- Compound interest calculations
- Detailed risk assessment
- Support for both native and liquid staking

## License

ISC 