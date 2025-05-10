# Wallet Analysis Bot

A Telegram bot for analyzing wallet activity and identifying correlated wallet clusters on Solana.

## Features

- Analyze multiple wallet addresses simultaneously
- Fetch and store transaction history
- Identify correlated wallet clusters based on token activity
- Calculate PNL (Profit and Loss) for each wallet
- Generate detailed reports with cluster information

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the project root with the following variables:
```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
HELIUS_API_KEY=your_helius_api_key
```

3. Build the project:
```bash
npm run build
```

4. Start the bot:
```bash
npm run start:wallet-analysis
```

## Usage

The bot supports the following commands:

- `/analyze <wallet_addresses>` - Analyze one or more wallet addresses
  Example: `/analyze 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM`

- `/help` - Display help information and usage examples

## Report Format

The analysis report includes:
- Number of wallets analyzed
- Total transactions processed
- Time range of analysis
- Identified wallet clusters with:
  - Number of wallets in cluster
  - Number of mutual tokens
  - PNL for each wallet
  - Total cluster PNL

## Architecture

The bot is built with:
- TypeScript for type safety
- Telegraf for Telegram bot functionality
- Prisma for database operations
- Helius API for Solana transaction data

## Development

To run in development mode with hot reloading:
```bash
npm run dev:wallet-analysis
```

## Testing

Run tests:
```bash
npm test
``` 