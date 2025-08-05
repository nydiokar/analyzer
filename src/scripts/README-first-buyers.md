# First Token Buyers Script

This script fetches the first buyers of a specific token mint by analyzing transaction history chronologically. **IMPORTANT**: For pump.fun tokens, use the bonding curve address to get the actual first buyers before migration to AMM.

## Usage

```bash
npx ts-node src/scripts/get-first-token-buyers.ts <MINT_ADDRESS> [maxBuyers] [maxSignatures] [addressType] [bondingCurveAddress]
```

## Parameters

- `MINT_ADDRESS` (required): The token mint address to analyze
- `maxBuyers` (optional, default: 200): Maximum number of unique first buyers to find
- `maxSignatures` (optional, default: 3000): Maximum signatures to process (safety limit)
- `addressType` (optional, default: 'bonding-curve'): Address type to use for transaction fetching
  - `'bonding-curve'`: Use bonding curve address (recommended for pump.fun tokens)
  - `'mint'`: Use mint address directly (for post-migration or non-pump.fun tokens)
  - `'auto'`: Attempt automatic detection (defaults to mint with warning)
- `bondingCurveAddress` (optional): Specific bonding curve address for pump.fun tokens

## Examples

### Pump.fun Tokens (Recommended)
```bash
# Get actual first buyers from bonding curve (before AMM migration)
npx ts-node src/scripts/get-first-token-buyers.ts 5ACzG28LjHwRTu5jGeCzR4M92zMRxN3c9jKfg5tQpump 200 3000 bonding-curve 7c6W1BDorJSRcf1iLQYvJEynnwjpyVED6KUfaZ64j5pV

# Get first 100 buyers from bonding curve
npx ts-node src/scripts/get-first-token-buyers.ts 5ACzG28LjHwRTu5jGeCzR4M92zMRxN3c9jKfg5tQpump 100 3000 bonding-curve 7c6W1BDorJSRcf1iLQYvJEynnwjpyVED6KUfaZ64j5pV
```

### Regular Tokens (Non-pump.fun)
```bash
# Get first 200 buyers using mint address
npx ts-node src/scripts/get-first-token-buyers.ts EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 200 3000 mint

# Get first 500 buyers from mint address
npx ts-node src/scripts/get-first-token-buyers.ts EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 500 5000 mint
```

### Auto Detection (Fallback)
```bash
# Let script attempt detection (will default to mint address with warning)
npx ts-node src/scripts/get-first-token-buyers.ts 5ACzG28LjHwRTu5jGeCzR4M92zMRxN3c9jKfg5tQpump
```

## Environment Variables

Make sure you have your Helius API key set:

```bash
HELIUS_API_KEY=your_helius_api_key_here
```

## Output

The script will:
1. Process token mint transaction history from oldest to newest
2. Identify wallets that received the token (indicating purchases)
3. Save results to `analysis_reports/first_buyers_MINT_TIMESTAMP.json`
4. Display summary and first 10 buyers in console

## How It Works

### Address Selection Strategy
1. **Bonding Curve Mode** (recommended for pump.fun):
   - Fetches signatures from the bonding curve address
   - Gets transactions from the pre-migration trading period
   - Captures the actual first buyers before AMM migration

2. **Mint Address Mode** (for regular tokens):
   - Fetches signatures from the token mint address
   - Suitable for tokens that launched directly on AMM
   - May miss early trading activity for pump.fun tokens

### Processing Flow
1. **Determines fetch address** based on addressType parameter
2. **Fetches signatures** using Helius RPC from the chosen address
3. **Processes chronologically** from oldest to newest transactions
4. **Filters for token receives** - wallets that received the token (buys)
5. **Tracks unique wallets** - only the first interaction per wallet counts
6. **Stops at target** - when reaching maxBuyers limit

### Critical Difference
- **Bonding curve**: Gets actual first buyers from launch (21:16)
- **Mint address**: May get post-migration buyers (hours later)

This ensures you get the **real** first buyers, not just post-migration traders.