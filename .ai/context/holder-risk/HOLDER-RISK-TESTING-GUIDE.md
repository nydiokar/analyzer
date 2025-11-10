# Holder Risk Analysis - Testing Guide

Quick reference for testing and validating holder risk analysis.

---

## 🚀 Quick Start

### Test a Single Wallet
```bash
npx ts-node -r tsconfig-paths/register src/scripts/test-holder-risk-sampled.ts \
  --wallet YOUR_WALLET_ADDRESS \
  --maxSignatures 2000
```

### Analyze Results with Granular Time Buckets
```bash
npx ts-node -r tsconfig-paths/register src/scripts/analyze-hold-time-distribution.ts
```

---

## 📖 Complete Workflows

### Workflow 1: Test Your Own Observation

**Scenario**: You spotted a wallet that looks like it flips very fast. Test it.

```bash
# Step 1: Test the wallet
npx ts-node -r tsconfig-paths/register src/scripts/test-holder-risk-sampled.ts \
  --wallet ABC123YourWalletAddress \
  --outputFile my-observation.json

# Step 2: See which time bucket it falls into
npx ts-node -r tsconfig-paths/register src/scripts/analyze-hold-time-distribution.ts \
  --resultsFile my-observation.json
```

**Output**:
- Total exits found
- Average hold time (e.g., 23 minutes)
- Median hold time
- Behavior classification (ULTRA_FLIPPER, FLIPPER, etc.)
- Time bucket breakdown (<1min, 1-3min, 5-10min, etc.)

---

### Workflow 2: Test Multiple Wallets

**Scenario**: You have a list of wallet addresses to test.

```bash
# Create a text file with wallet addresses (one per line)
echo "Wallet1Address" > my-wallets.txt
echo "Wallet2Address" >> my-wallets.txt
echo "Wallet3Address" >> my-wallets.txt

# Test all wallets
npx ts-node -r tsconfig-paths/register src/scripts/test-holder-risk-sampled.ts \
  --walletsFile my-wallets.txt \
  --maxSignatures 2000 \
  --outputFile my-batch-test.json

# Analyze distribution
npx ts-node -r tsconfig-paths/register src/scripts/analyze-hold-time-distribution.ts \
  --resultsFile my-batch-test.json
```

---

### Workflow 3: Discover Active Traders

**Scenario**: You want to find active trader wallets to test.

```bash
# Step 1: Find active wallets (200-3000 token accounts)
npx ts-node -r tsconfig-paths/register src/scripts/find-active-wallets.ts \
  --targetWallets 10 \
  --minTokenAccounts 200 \
  --maxTokenAccounts 3000 \
  --outputFile my-discovered-wallets.json

# This creates:
# - my-discovered-wallets.json (full details)
# - my-discovered-wallets-addresses.txt (just addresses)

# Step 2: Test the discovered wallets
npx ts-node -r tsconfig-paths/register src/scripts/test-holder-risk-sampled.ts \
  --walletsFile my-discovered-wallets-addresses.txt \
  --maxSignatures 2000 \
  --outputFile my-discovered-test.json

# Step 3: Analyze
npx ts-node -r tsconfig-paths/register src/scripts/analyze-hold-time-distribution.ts \
  --resultsFile my-discovered-test.json
```

---

## 🎯 Time Buckets Explained

When you run the analysis, wallets are classified into these time buckets:

| Bucket | Range | Typical Trader Type |
|--------|-------|---------------------|
| **<1 min** | 0-60 seconds | Bots, MEV traders |
| **1-3 min** | 1-3 minutes | Ultra-fast scalpers |
| **3-5 min** | 3-5 minutes | Fast scalpers |
| **5-10 min** | 5-10 minutes | Quick flippers |
| **10-30 min** | 10-30 minutes | Fast traders |
| **30-60 min** | 30-60 minutes | Sub-hour traders |
| **1-24 hours** | 1-24 hours | Intraday traders |
| **1-7 days** | 1-7 days | Swing traders |
| **>7 days** | 7+ days | Position holders |

---

## 📊 Example Output

### test-holder-risk-sampled.ts

```
================================================================================
TESTING WALLET: H8fbk6ct...D4Nt
================================================================================

📊 RESULTS:
  Total Swaps: 737
  Unique Tokens: 299
  Completed Cycles: 293 (exited positions)
  Active Tokens: 6

✅ PATTERN CALCULATED:
  Behavior: ULTRA_FLIPPER
  Avg Hold: 0.4h (0.0d)
  Median Hold: 0.1h
  Exit Pattern: ALL_AT_ONCE
  Data Quality: 100%

⏱️  Performance:
  Sync: 1.8s
  Analysis: 0.0s
  Total: 1.8s
```

### analyze-hold-time-distribution.ts

```
====================================================================================================
HOLD TIME DISTRIBUTION ANALYSIS
====================================================================================================

Time Bucket       | Wallets | Exits | % of Total | Avg Hold  | Median Hold | Examples
----------------------------------------------------------------------------------------------------
10-30 min         | 2       | 650   | 16.2      % | 20.8m     | 6.5m        | 6MbQ7CG7(357), H8fbk6ct(293)
30-60 min         | 4       | 1138  | 28.4      % | 46.1m     | 12.0m       | AowTUid5(559), 4e2vfSkr(211)
1-24 hours        | 13      | 2219  | 55.4      % | 5.5h      | 59.3m       | 8iDHRbmX(292), EFJExAiA(257)

====================================================================================================
KEY INSIGHTS
====================================================================================================

Ultra-Fast Traders (<5 min):     0 exits (0.0%)
Fast Traders (5-30 min):         650 exits (16.2%)
Sub-Hour Traders (30-60 min):    1138 exits (28.4%)
Intraday Traders (1-24 hours):   2219 exits (55.4%)
Multi-Day Traders (1-7 days):    0 exits (0.0%)
```

---

## 🔧 Script Parameters

### test-holder-risk-sampled.ts

| Parameter | Alias | Default | Description |
|-----------|-------|---------|-------------|
| `--wallet` | `-w` | - | Single wallet address to test |
| `--walletsFile` | `-f` | - | File with wallet addresses (one per line) |
| `--maxSignatures` | `-m` | 2000 | Max signatures to fetch per wallet |
| `--outputFile` | `-o` | `holder-risk-test-results.json` | Output file path |

**Note**: Must specify either `--wallet` OR `--walletsFile`

### analyze-hold-time-distribution.ts

| Parameter | Alias | Default | Description |
|-----------|-------|---------|-------------|
| `--resultsFile` | `-f` | `./data/holding_time/holder-risk-test-results.json` | Path to test results JSON |

### find-active-wallets.ts

| Parameter | Alias | Default | Description |
|-----------|-------|---------|-------------|
| `--targetWallets` | `-n` | 20 | Number of wallets to find |
| `--minTokenAccounts` | `-m` | 100 | Minimum token accounts |
| `--maxTokenAccounts` | `-x` | 4000 | Maximum token accounts |
| `--trendingTokens` | `-t` | 10 | Trending tokens to check |
| `--outputFile` | `-o` | `active-wallets.json` | Output file |

---

## 💡 Common Use Cases

### 1. Validate a Specific Wallet You're Watching

```bash
# You noticed this wallet on the dashboard
npx ts-node -r tsconfig-paths/register src/scripts/test-holder-risk-sampled.ts \
  --wallet XYZ123... \
  --outputFile wallet-xyz-test.json

# See the results
npx ts-node -r tsconfig-paths/register src/scripts/analyze-hold-time-distribution.ts \
  --resultsFile wallet-xyz-test.json
```

### 2. Find Ultra-Fast Traders (<5 min holds)

```bash
# Look for wallets with fewer token accounts (might be more focused traders)
npx ts-node -r tsconfig-paths/register src/scripts/find-active-wallets.ts \
  --targetWallets 20 \
  --minTokenAccounts 50 \
  --maxTokenAccounts 200 \
  --outputFile fast-traders.json

# Test them
npx ts-node -r tsconfig-paths/register src/scripts/test-holder-risk-sampled.ts \
  --walletsFile fast-traders-addresses.txt \
  --outputFile fast-traders-test.json

# Check if any fall into <5min buckets
npx ts-node -r tsconfig-paths/register src/scripts/analyze-hold-time-distribution.ts \
  --resultsFile fast-traders-test.json
```

### 3. Daily Validation Check

```bash
# Use the pre-existing wallet list
npx ts-node -r tsconfig-paths/register src/scripts/test-holder-risk-sampled.ts \
  --walletsFile active-wallets-addresses.txt \
  --maxSignatures 2000

# Check distribution hasn't changed
npx ts-node -r tsconfig-paths/register src/scripts/analyze-hold-time-distribution.ts
```

---

## 📁 Output Files

### test-holder-risk-sampled.ts produces:

**`holder-risk-test-results.json`** (or your custom name):
```json
{
  "generatedAt": "2025-11-08T15:29:51.383Z",
  "config": {
    "maxSignatures": 2000
  },
  "summary": {
    "walletsTest": 19,
    "successfulPatterns": 19,
    "totalSwaps": 16142,
    "totalUniqueTokens": 4188,
    "totalCompletedCycles": 4007,
    "avgSyncTimeSeconds": 12.84
  },
  "results": [
    {
      "walletAddress": "H8fbk6ct...",
      "totalSwaps": 737,
      "exitedTokens": 293,
      "pattern": {
        "behaviorType": "ULTRA_FLIPPER",
        "avgHoldTimeHours": 0.39,
        "medianHoldTimeHours": 0.14,
        "exitPattern": "ALL_AT_ONCE",
        "dataQuality": 1
      }
    }
  ]
}
```

### find-active-wallets.ts produces:

**`active-wallets.json`**:
```json
{
  "generatedAt": "2025-11-08T13:55:04.352Z",
  "summary": {
    "totalWallets": 17,
    "avgTokenAccounts": 624
  },
  "wallets": [
    {
      "address": "H8fbk6ct...",
      "tokenAccountCount": 2272,
      "foundViaToken": "DdCstfjh..."
    }
  ]
}
```

**`active-wallets-addresses.txt`**:
```
H8fbk6ctVvmcCFayg59egxhsisYcK2Y7ACFTzx8ZD4Nt
EFJExAiAU6cnWkGvZzX3UNpXjtjuETGgK4e3zyABhXtf
...
```

---

## 🐛 Troubleshooting

### "No pattern calculated - need 3+ completed cycles"

**Problem**: Wallet doesn't have enough exited positions.

**Solutions**:
- Increase `--maxSignatures` to fetch more history (e.g., 5000)
- Wallet might be too new or not active enough
- Try a different wallet

### "File not found"

**Problem**: Wrong path to results file.

**Solution**:
```bash
# Check where the file was created
find . -name "*.json" -mtime -1

# Use absolute path
npx ts-node -r tsconfig-paths/register src/scripts/analyze-hold-time-distribution.ts \
  --resultsFile /full/path/to/results.json
```

### Rate Limiting (429 errors)

**Problem**: Hitting Helius API rate limits.

**Solution**:
- Script has built-in retry logic (3 attempts with exponential backoff)
- Wait 2 seconds between wallets automatically
- If persistent, wait a few minutes and retry

---

## 📚 Related Documentation

- **Architecture**: `.ai/context/architecture-holder-risk-analysis.md`
- **Validation Report**: `holder-risk-test-report.md`
- **Context**: `.ai/CONTEXT.md` (Phase 1 completion notes)

---

## ✅ Validation Status

**Phase 1 (Core Calculation)**: ✅ COMPLETE (2025-11-08)

- Tested: 19 wallets
- Total exits: 4,007 positions
- Success rate: 100%
- Data quality: 100%
- Critical bug fixed: Exit detection logic

**Ready for**: Phase 2 (Prediction Layer)
