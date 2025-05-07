# Solana Wallet Behavior Analysis & KPIs

This document outlines the wallet-specific KPIs we've implemented to identify trading behavior patterns, with a specific focus on detecting "fast flipper" behavior.

## Key Performance Indicators (KPIs)

### Core Behavioral Metrics

1. **Buy-Sell Symmetry Ratio** (0.0 - 1.0)
   - Measures how balanced buys and sells are
   - Formula: `1 - |buys - sells| / (buys + sells)`
   - Value close to 1.0 indicates perfect balance between buys/sells
   - Value close to 0.0 indicates highly imbalanced trading (accumulator or distributor)

2. **Average Flip Duration** (in hours)
   - Measures the average time between buying and selling the same token
   - Lower values indicate faster trading
   - Categorized as:
     - Ultra-Fast (<1 hour)
     - Fast (1-24 hours)
     - Medium (1-7 days)
     - Slow (>7 days)

3. **Trade Sequence Consistency** (0.0 - 1.0)
   - Measures how consistently the wallet follows a clean buy→sell pattern
   - Formula: `consecutiveBuySellPairs / Math.min(buyCount, sellCount)`
   - Value close to 1.0 indicates highly structured trading (buy→sell→buy→sell)
   - Value close to 0.0 indicates chaotic or random trading patterns

4. **Flipper Score** (0.0 - 1.0)
   - Combined score derived from the three metrics above
   - Formula: `(symmetryRatio * 0.3) + (normalizedFlipDuration * 0.4) + (sequenceConsistency * 0.3)`
   - Values above 0.7 strongly indicate a fast-flipper trading style

### Supporting Metrics

- **Unique Tokens Traded**: Number of different tokens the wallet has interacted with
- **Total Trade Count**: Total number of buy/sell transactions
- **Tokens With Complete Pairs**: Number of tokens with at least one buy-sell pair
- **Average Trades Per Token**: How focused or scattered the trading is

## Trading Style Classification

Based on the metrics above, wallets are classified into several trading styles:

- **Fast Flipper**: Rapid buy/sell cycles with high consistency
- **Swing Trader**: Medium-term holds (1-7 days) with consistent patterns
- **Positional Trader**: Longer-term holds (>7 days) with some consistency
- **Accumulator**: Significantly more buys than sells, building positions
- **Chaotic Trader**: Inconsistent patterns across many tokens

Each classification includes a confidence score indicating the strength of the pattern match.

## Usage

### Individual Wallet Analysis

```bash
npx ts-node ./src/scripts/wallet-behavior-analyzer.ts --address YOUR_WALLET_ADDRESS
```

Options:
- `--period <day|week|month|quarter|year>`: Analyze a specific time period
- `--startDate <YYYY-MM-DD>`: Custom start date
- `--endDate <YYYY-MM-DD>`: Custom end date
- `--saveReport`: Save the report to a file (default: true)

### Comparative Wallet Analysis

```bash
npx ts-node ./src/scripts/kpi-comparison-report.ts --wallets "address1,address2,address3"
```

Or using a JSON file:
```bash
npx ts-node ./src/scripts/kpi-comparison-report.ts --walletsFile "./wallets-example.json"
```

The JSON file should be formatted as:
```json
[
  {
    "address": "wallet_address_1",
    "label": "Optional Label 1"
  },
  {
    "address": "wallet_address_2",
    "label": "Optional Label 2"
  }
]
```

## Example Report Output

### Individual Wallet Report

```
=== WALLET TRADING BEHAVIOR ANALYSIS ===
Wallet: 28825R3yfxFwQXTPxXxwe3K7mJRssRwXcNBtWArbJcJAhXc4r4

TRADING STYLE CLASSIFICATION
Primary Trading Style: Fast Flipper
Classification Confidence: 82.5%

CORE BEHAVIORAL METRICS
Flipper Score: 0.825 (0-1 scale, higher = more flipping)
Buy/Sell Symmetry: 0.950 (1.0 = perfectly balanced)
Trade Sequence Consistency: 0.885 (1.0 = perfect alternation)
Average Flip Duration: 3.2 hours

TRADING WINDOW DISTRIBUTION
Ultra-Fast Flips (<1h): 28.5%
Fast Flips (1-24h): 65.3%
Medium Flips (1-7d): 6.2%
Slow Flips (>7d): 0.0%

ACTIVITY SUMMARY
Unique Tokens Traded: 34
Total Trade Count: 112
Tokens With Complete Buy/Sell Pairs: 31
Average Trades Per Token: 3.3

BEHAVIORAL INSIGHTS
This wallet exhibits strong "Fast Flipper" behavior, characterized by:
• Rapid buy/sell cycles (avg 3.2 hours between buy & sell)
• Highly consistent buy-sell patterns (88.5% of possible pairs)
• Balanced buys and sells (95.0% symmetry)

This trader likely focuses on short-term price movements and quick profits,
rather than fundamental conviction in the tokens they trade.
```

### Comparative Report

The comparative report provides tables comparing multiple wallets across all metrics, with additional insights into trading styles and patterns.

## Implementation Details

The behavioral KPIs are calculated by:

1. Grouping transactions by token
2. Sorting each token's transactions chronologically
3. Identifying buy-sell pairs and measuring their duration
4. Calculating metrics based on overall patterns
5. Classifying the wallet based on the metrics

These KPIs provide meaningful insights into trading behavior without requiring current token balances or market data, making them particularly useful for on-chain analysis. 