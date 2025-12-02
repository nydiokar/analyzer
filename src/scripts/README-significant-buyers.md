# Significant Buyers Analysis Script

This script analyzes wallets that bought significant amounts (50+ SOL by default) of a specific token with fewer than 5 transactions, to filter out bots and focus on genuine large buyers.

## Features

- Finds all wallets who interacted with a token
- Filters for wallets that:
  - Spent minimum SOL amount (default: 50 SOL)
  - Made fewer than maximum transactions (default: 5 tx)
- Calculates for each wallet:
  - Total SOL spent
  - Total SOL received (from selling)
  - Net PnL
  - Current token balance
  - Current SOL balance
  - Transaction count
- Generates comprehensive reports (CSV, Markdown, TXT)

## Usage

### Basic Usage
```bash
npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts <MINT_ADDRESS>
```

### Example with the specified token
```bash
npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts HJ88bA3HJKgKfDUWEoTqTvvhMng5E6RSAMjwTetCvibe
```

### Advanced Options

```bash
npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts <MINT_ADDRESS> [options]
```

**Available Options:**

- `--min-sol=N` - Minimum SOL spent to include wallet (default: 50)
- `--max-tx=N` - Maximum transaction count to exclude bots (default: 5)
- `--address-type=TYPE` - Address type to search: `bonding-curve`, `mint`, or `auto` (default: auto)
- `--bonding-curve=ADDRESS` - Bonding curve address for pump.fun tokens
- `--max-signatures=N` - Maximum signatures to process (default: 5000)

### Examples

**Find wallets that spent 100+ SOL:**
```bash
npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts HJ88bA3HJKgKfDUWEoTqTvvhMng5E6RSAMjwTetCvibe --min-sol=100
```

**Find wallets with exactly 1-3 transactions:**
```bash
npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts HJ88bA3HJKgKfDUWEoTqTvvhMng5E6RSAMjwTetCvibe --max-tx=3
```

**For pump.fun token with bonding curve:**
```bash
npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts MINT_ADDRESS --address-type=bonding-curve --bonding-curve=BONDING_CURVE_ADDRESS
```

## Output Files

The script generates three files in the `analysis_reports/` directory:

1. **CSV Report** - `significant_buyers_{MINT}_{TIMESTAMP}.csv`
   - Detailed spreadsheet with all matching wallets
   - Includes: Rank, Wallet Address, SOL Spent, SOL Received, Net PnL, TX Count, Token Balance, SOL Balance, First Buy Date

2. **Markdown Report** - `significant_buyers_{MINT}_{TIMESTAMP}.md`
   - Formatted report with summary statistics
   - Top 50 wallets table
   - Easy to read and share

3. **Wallet List** - `wallet_addresses_{MINT}_{TIMESTAMP}.txt`
   - Simple list of wallet addresses
   - One per line, ready for copy-paste

## Console Output

The script displays:
- Progress updates during analysis
- Summary statistics
- Top 20 wallets by PnL
- File locations

Example output:
```
====================================================================================================
SIGNIFICANT BUYERS ANALYSIS COMPLETE
====================================================================================================
Token Mint: HJ88bA3HJKgKfDUWEoTqTvvhMng5E6RSAMjwTetCvibe
Criteria: Min 50 SOL spent, Max 5 transactions
Total Wallets Analyzed: 234
Wallets Matching Criteria: 45
Successful Analyses: 45
Total SOL Invested: 3456.78 SOL
Average PnL: 12.34 SOL
Winners: 28 (62.2%)
Losers: 17 (37.8%)
Processing Time: 123.45 seconds
====================================================================================================
```

## Requirements

- **Environment Variable**: `HELIUS_API_KEY` must be set in your `.env` file
- **Database**: Prisma database must be set up and migrations applied
- **Dependencies**: All project dependencies installed

## How It Works

1. **Fetch Interactions**: Uses the same infrastructure as `get-first-token-buyers.ts` to find all wallets who interacted with the token
2. **Fetch Transaction History**: For each wallet, fetches their full transaction history and filters for transactions involving the target token
3. **Calculate Metrics**: Analyzes swap records to calculate SOL spent, received, and PnL
4. **Fetch Current Balances**: Queries on-chain data for current SOL and token balances
5. **Filter & Rank**: Applies criteria (min SOL, max TX) and sorts by PnL
6. **Generate Reports**: Creates CSV, Markdown, and TXT reports

## Performance Notes

- Processing time depends on the number of wallets (typically 1-5 minutes for 100-500 wallets)
- Uses batched API calls and database operations for efficiency
- Respects Helius API rate limits (20 req/s by default)
- Progress updates every 50 wallets

## Troubleshooting

**"No wallets found"**
- Token might not have any activity yet
- Try different `--address-type` (bonding-curve vs mint)
- Verify the mint address is correct

**"HELIUS_API_KEY is not set"**
- Add `HELIUS_API_KEY=your_key_here` to your `.env` file

**Analysis taking too long**
- Reduce `--max-signatures` to process fewer transactions per wallet
- The script shows progress every 50 wallets

## Related Scripts

- `get-first-token-buyers.ts` - Analyze first buyers and top traders
- `topTokenHolders.ts` - Get current top token holders (top 20 only)
- `helius-analyzer.ts` - Comprehensive wallet PnL analysis across all tokens

