# Wallet Analysis Bot

A Telegram bot for analyzing wallet activity and identifying correlated wallet clusters on Solana.

## Features

- Analyze multiple wallet addresses simultaneously via command or CSV upload.
- Fetch and store transaction history (leveraging Helius API and Prisma for persistence).
- Filter out potential bot wallets based on activity patterns.
- Identify correlated wallet clusters based on shared non-obvious token activity and synchronized transactions.
- Calculate PNL (Profit and Loss) estimates for each wallet.
- Generate detailed Telegram reports with cluster information, PNL estimates, and top correlated pairs.
- Restricted access control with admin notifications for unauthorized attempts.
- Handles transaction fetching strategically, including incremental updates and cache utilization.

## Setup

1. Install dependencies:
```bash
npm install
```

2. If you are using Prisma for database operations (as implied by `database-service.ts`), ensure your Prisma client is generated and migrations are run:
```bash
npx prisma generate
npx prisma migrate dev # For development; use 'deploy' for production
```

3. Create a `.env` file in the project root with the following variables:
```env
# Your Telegram Bot Token
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# Your Helius API Key (essential for fetching transaction data)
HELIUS_API_KEY=your_helius_api_key

# Comma-separated list of Telegram User IDs allowed to use the bot
# Example: ALLOWED_TELEGRAM_USER_IDS=12345678,98765432
ALLOWED_TELEGRAM_USER_IDS=

# Optional: Your Telegram User ID to receive notifications for unauthorized access attempts
# Example: ADMIN_TELEGRAM_ID=12345678
ADMIN_TELEGRAM_ID=

# Database connection string for Prisma
# Example: DATABASE_URL="postgresql://user:password@host:port/database?schema=public"
DATABASE_URL=
```

4. Build the project:
```bash
npm run build
```

## Usage

The bot supports the following commands:

- `/start` - Displays a welcome message and basic instructions.
- `/help` - Shows detailed help information, including command usage and CSV upload instructions.
- `/analyze <wallet1> [wallet2] ... [tx_count]`
  - Analyzes one or more Solana wallet addresses.
  - `wallet1`, `wallet2`, etc.: Space-separated Solana wallet addresses.
  - `tx_count` (optional): Number of recent transactions to analyze per wallet.
    - Defaults to 300 if not specified.
    - Maximum allowed is 1000.
    - Example: `/analyze ADDR1 ADDR2 500`
  - A maximum of 30 addresses can be provided directly in the command.

### CSV File Upload

- You can also upload a CSV file to analyze multiple wallets.
- The bot looks for wallet addresses in the first column of the CSV.
- A maximum of 100 wallets will be processed from a single file.
- For file uploads, the analysis uses a default transaction count (currently 300 per wallet).
- Supported file types: `text/csv`, `application/vnd.ms-excel`, or any file ending with `.csv`.
- Maximum file size: 1MB.

## Report Format

The analysis report, delivered via Telegram, includes:

- **Summary**:
  - Number of wallets requested for analysis.
  - Number of wallets filtered out (e.g., suspected bot activity).
  - Number of wallets actually analyzed.
  - Total unique mints found in the analyzed wallets' transactions.
- **Identified Wallet Clusters (3+ members)**:
  - Cluster identifier.
  - Average pair correlation score within the cluster.
  - Number of shared non-obvious tokens among cluster members.
  - List of wallets in the cluster, each with:
    - Address (code-formatted).
    - Number of unique tokens traded.
    - Approximate PNL in SOL.
- **Top Correlated Wallet Pairs**:
  - Pair identifier and overall correlation score.
  - Details for each wallet in the pair:
    - Address (code-formatted).
    - Approximate PNL in SOL.
    - Number of unique tokens traded.
- *Disclaimer: PNL is approximate and should be verified independently.*

## Running in Production with PM2

The project is configured to run with PM2 (Process Manager 2) using the `ecosystem.config.js` file. PM2 provides features like process monitoring, automatic restarts, and log management.

1. Ensure PM2 is installed globally:
```bash
npm install pm2 -g
```
2. Navigate to the project root directory.
3. Start the bot using PM2:
```bash
pm2 start ecosystem.config.js
```

### Common PM2 Commands:

- `pm2 list` or `pm2 ls`: List all running processes managed by PM2.
- `pm2 logs wallet-analysis-bot`: View real-time logs for the bot.
  - (Log files are stored in the `./logs/` directory as defined in `ecosystem.config.js`)
- `pm2 stop wallet-analysis-bot`: Stop the bot.
- `pm2 restart wallet-analysis-bot`: Restart the bot.
- `pm2 delete wallet-analysis-bot`: Stop the bot and remove it from PM2's list.
- `pm2 startup`: To make PM2 automatically restart processes on server reboot (follow on-screen instructions).
- `pm2 save`: Save the current PM2 process list.

## Architecture

The bot is built with:

- TypeScript for type safety and robust development.
- Telegraf.js for Telegram bot functionality.
- Prisma ORM for database interactions (PostgreSQL recommended).
- Helius API for fetching Solana transaction data (with caching and strategic fetching logic).
- PapaParse for efficient CSV file parsing.
- Axios for HTTP requests.
- Winston for logging.

## Development

To run in development mode with hot reloading (using `ts-node-dev`):
```bash
npm run dev:wallet-analysis
```

## Testing

Run tests (if configured):
```bash
npm test
``` 