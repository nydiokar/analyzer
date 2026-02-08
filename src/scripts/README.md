# Analysis & Reporting Scripts

Scripts for data analysis, research, and generating insights from wallet and token data.

## Holder Analysis
- `generate-holder-analysis.ts` - Generate comprehensive holder behavior analysis reports with predictions
- `generate-detailed-holder-report.ts` - Create detailed holder analysis reports
- `generate-prediction-report.ts` - Generate holder exit prediction reports
- `analyze-hold-time-distribution.ts` - Analyze holding time patterns and distributions
- `find-active-wallets.ts` - Discover and analyze active wallet addresses

## Risk Assessment
- `validate-holder-risk.ts` - Validate and test holder risk assessment algorithms
- `test-holder-risk-sampled.ts` - Test risk analysis on sampled wallet data
- `validate-behavior-metrics.ts` - Validate behavior analysis metrics and calculations

## Token Analysis
- `significantBuyersAnalysis.ts` - Analyze significant token buyers (high SOL spend, low TX count)
- `topTokenHolders.ts` - Display top token holders for a given mint address
- `fetch-token-metadata.ts` - Fetch and analyze token metadata from blockchain
- `mint-participants.ts` - Analyze participants in token minting events
- `get-first-token-buyers.ts` - Identify and analyze first buyers of tokens

## Wallet Research
- `helius-analyzer.ts` - Comprehensive wallet analysis using Helius API (P&L, behavior, reports)
- `walletSimilarity.ts` - Analyze wallet similarity patterns and clustering
- `tokenAffinityAnalysis.ts` - Find wallets that hold the most tokens from a given set
- `analyze-unknown-tx-patterns.ts` - Identify and analyze unknown transaction patterns
- `behaviorAnalysis.ts` - Analyze wallet behavior patterns and characteristics
- `activityCorrelator.ts` - Correlate wallet activities and find patterns

## Testing & Validation
- `test-holder-profiles-cache.ts` - Test holder profiles cache functionality
- `test-metadata-security.ts` - Test metadata security and validation
- `kpiComparison.ts` - Compare and analyze key performance indicators

## Utilities
- `fix-image-urls.ts` - Fix and update image URLs in token metadata
- `send-mint-participants-alert.ts` - Send alerts for mint participant activities
- `clean-redis-locks.ts` - Clean Redis locks (duplicate - see scripts/clean-redis-locks.ts)

## Usage
Most scripts use yargs for CLI arguments. Run with `--help` for options:

```bash
npx ts-node -r tsconfig-paths/register src/scripts/helius-analyzer.ts --help
npx ts-node -r tsconfig-paths/register src/scripts/significantBuyersAnalysis.ts <MINT_ADDRESS>
```
