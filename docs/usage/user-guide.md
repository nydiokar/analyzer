# Crypto Data Analyzer - User Guide

This guide explains how to use the analysis and utility scripts available in this project.

## Scripts

### 1. Analyze Daily Price Changes & Indicators

**Command:**
```bash
npm run analyze-changes <coinId> [--days <number>]
```

**Purpose:**
Fetches daily historical Open, High, Low, Close (OHLC) data for a specified cryptocurrency from the CoinGecko API. It calculates technical indicators (SMA 20, SMA 50, RSI 14) and generates potential buy/sell signals based on SMA crossovers qualified by RSI levels. 

**Arguments:**
*   `<coinId>`: **Required**. The unique ID of the coin on CoinGecko (e.g., `bitcoin`, `ethereum`, `solana`, `fetch-ai`). Use the `find-coin` script (see below) to find the correct ID if you only know the symbol or name.
*   `--days <number>`: *Optional*. The number of past days of historical data to fetch and analyze. 
    *   Defaults to ~90 days (enough for the 50-day SMA calculation).
    *   More days provide more historical context for indicators.

**Output:**
1.  **CSV Report:** A detailed report saved in the `./analysis_reports/` directory (e.g., `price_change_report_bitcoin_...csv`). This file contains:
    *   Date
    *   Coin ID
    *   Open, High, Low, Close prices (USD)
    *   SMA Short (20-day), SMA Long (50-day) values
    *   RSI (14-day) value
    *   Signal (Hold, Buy (SMA Crossover), Sell (SMA Crossover))
2.  **Summary Update:** A summary section is appended to `./analysis_reports/analysis_summary.md`, including:
    *   Basic run info (Coin, Date)
    *   Latest day's OHLC values
    *   Latest day's calculated indicator values (SMAs, RSI)
    *   The most recent Buy/Sell signal generated during the analyzed period and its date.

### 2. Find CoinGecko Coin ID

**Command:**
```bash
npm run find-coin <query>
```

**Purpose:**
Helps find the correct CoinGecko `coinId` needed for the `analyze-changes` script when you only know the coin's ticker symbol or part of its name.

**Arguments:**
*   `<query>`: **Required**. The ticker symbol (e.g., `BTC`, `FET`) or a part of the coin's name (e.g., `Fetch`, `Solana`) to search for.

**Output:**
*   Prints a list of potential matching coins found on CoinGecko, including their:
    *   ID (Use this value for `<coinId>` in `analyze-changes`)
    *   Symbol
    *   Name
*   The output is limited to the first 20 matches.

---
*Remember to run `npm install` first if you haven't already to ensure all dependencies are available.* 