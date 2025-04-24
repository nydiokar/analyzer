# Helius Transaction Analyzer Usage Guide

## Overview

The Helius Transaction Analyzer integrates with the Helius API to fetch and analyze Solana wallet transaction history. Unlike the original analyzer that required a pre-exported CSV file from Solscan, this version fetches transaction data directly from the blockchain using the Helius API.

## Features

- Direct blockchain data access via Helius API
- Filters out NFT-only transactions (as requested)
- Handles both SOL and token transfers
- Groups transactions by token for analysis
- Generates detailed reports for wallet activity
- Calculates net changes in token amount and value
- Identifies potential airdrop/spam tokens
- Date filtering to analyze specific time periods

## Code Organization

The analyzer is organized into a modular structure:

```
src/
├── types/
│   └── helius-api.ts            # Type definitions for API responses and analysis
├── services/
│   ├── helius-api-client.ts     # Client for interacting with Helius API
│   ├── helius-transaction-mapper.ts  # Maps API responses to transfer records
│   └── transfer-analyzer-service.ts  # Core analysis functionality
├── cli/
│   └── display-utils.ts         # Console output utilities
└── scripts/
    └── helius-analyzer.ts       # Main CLI entry point
```

This modular design ensures separation of concerns and reusability of components.

## Prerequisites

1. **Helius API Key**
   - Sign up for a free API key at [https://dev.helius.xyz/](https://dev.helius.xyz/)
   - The free tier allows 100 transactions per request and has a decent rate limit for testing

2. **Environment Setup**
   - Create a `.env` file in the project root with your Helius API key:
     ```
     HELIUS_API_KEY=your_helius_api_key_here
     ```

## Usage

Run the analyzer with the following command:

```bash
npm run analyze-helius -- --address=WALLET_ADDRESS [options]
```

### Required Parameters:

- `--address` or `-a`: The Solana wallet address to analyze

### Optional Parameters:

- `--limit` or `-l`: Maximum number of transactions to fetch (default: 100)
- `--saveCsv` or `-s`: Save raw transaction data to a CSV file (default: true)
- `--excludeAirdrops` or `-e`: Exclude likely airdrop/spam tokens (default: true)
- `--verbose` or `-v`: Show detailed token analysis in console (default: false)
- `--last30Days` or `--30d`: Only analyze transactions from the last 30 days (default: false)
- `--startDate`: Start date for filtering transactions (format: YYYY-MM-DD)
- `--endDate`: End date for filtering transactions (format: YYYY-MM-DD)

### Examples:

Basic analysis of a wallet with default settings:
```bash
npm run analyze-helius -- -a 8z5awGJDDYVy1j2oeKP1nUauPDkhxnNGEZDkX8tNSQdb
```

Fetch more transactions (up to 1000, may be limited by API):
```bash
npm run analyze-helius -- -a 8z5awGJDDYVy1j2oeKP1nUauPDkhxnNGEZDkX8tNSQdb -l 500
```

Only analyze transactions from the last 30 days (faster and less resource-intensive):
```bash
npm run analyze-helius -- -a 8z5awGJDDYVy1j2oeKP1nUauPDkhxnNGEZDkX8tNSQdb --last30Days
```

Analyze transactions within a specific date range:
```bash
npm run analyze-helius -- -a 8z5awGJDDYVy1j2oeKP1nUauPDkhxnNGEZDkX8tNSQdb --startDate 2023-01-01 --endDate 2023-03-31
```

Include detailed analysis output:
```bash
npm run analyze-helius -- -a 8z5awGJDDYVy1j2oeKP1nUauPDkhxnNGEZDkX8tNSQdb -v
```

## Limitations

1. **Historical Token Values**
   - The Helius API doesn't provide historical USD values for tokens at transaction time
   - The current implementation sets all token values to 0, which affects "Net Realized Value" calculations
   - Future enhancements could integrate a price API to estimate historical values

2. **API Rate Limits**
   - The free tier of Helius API has rate limitations
   - Consider implementing backoff strategies for larger transaction histories
   - Use the date filtering options to reduce the number of transactions processed

3. **Transaction Types**
   - The analyzer focuses on transfer transactions and may not capture all DeFi interactions
   - Swap data is available in the API response but requires additional parsing logic

## Performance Tips

To improve performance and reduce resource usage:

1. **Use date filtering**: The `--last30Days` option significantly reduces processing time by filtering out older transactions.
2. **Set appropriate limits**: Only fetch as many transactions as you need with the `--limit` option.
3. **Exclude airdrops**: Using `--excludeAirdrops` filters out spam tokens that don't provide meaningful analysis.

## Output Files

The analyzer generates two types of files:

1. **Raw Transaction Data** (if `--saveCsv` is enabled)
   - Located in: `./data/export_transfer_WALLET_ADDRESS_TIMESTAMP.csv`
   - Format matches the original Solscan CSV format for compatibility

2. **Analysis Report**
   - Located in: `./analysis_reports/wallet_analysis_report_WALLET_ADDRESS_TIMESTAMP.csv`
   - Contains per-token analysis with metrics like amounts, transfers, and value changes

## Extending the Analyzer

The modular design makes it easy to extend the analyzer:

1. Adding price API integration:
   - Create a new service in `services/price-api-service.ts`
   - Call this service from the transaction mapper

2. Supporting new transaction types:
   - Extend the `mapHeliusTransactionsToTransferRecords` function to handle additional transaction types

3. Implementing additional analysis metrics:
   - Add new fields to the `AnalysisResults` interface
   - Update the analysis logic in `transfer-analyzer-service.ts`
   - Modify the CSV output and display utilities 