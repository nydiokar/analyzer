# Helius Transaction Analyzer Usage Guide

## Overview

The Helius Transaction Analyzer integrates with the Helius API to fetch and analyze Solana wallet transaction history, focusing on SOL Profit/Loss from token swaps. Unlike analyzers requiring pre-exported CSV files, this version fetches transaction data directly from the blockchain using the Helius API.

## Features

- Direct blockchain data access via Helius API (Signatures via RPC, Details via Helius Parse API)
- Maps SOL and SPL token transfers from Helius transaction data.
- Calculates SOL Profit/Loss attributed to SPL token swaps.
- Groups results by SPL token for analysis.
- Generates CSV and TXT reports summarizing P/L per token.
- Caches Helius API responses locally (`./.cache/helius/`) to speed up subsequent runs.
- Optionally saves intermediate token/SOL transfer records to CSV (`./data/`).

## Code Organization

The analyzer is organized into a modular structure:

```
src/
├── types/
│   └── helius-api.ts            # Type definitions for API responses and analysis results
├── services/
│   ├── helius-api-client.ts     # Client for interacting with Helius API & Solana RPC
│   ├── helius-transaction-mapper.ts  # Maps Helius TX data to intermediate records
│   └── transfer-analyzer-service.ts  # Core SOL P/L analysis logic & reporting
├── cli/
│   └── display-utils.ts         # Console output formatting utilities
└── scripts/
    └── helius-analyzer.ts       # Main CLI script entry point using yargs
```

This modular design ensures separation of concerns and reusability of components.

## Prerequisites

1.  **Helius API Key**
    *   Sign up for an API key at [https://dev.helius.xyz/](https://dev.helius.xyz/)
    *   The free tier is generally sufficient for moderate usage.

2.  **Environment Setup**
    *   Create a `.env` file in the project root.
    *   Add your Helius API key to the `.env` file:
        ```dotenv
        HELIUS_API_KEY=your_helius_api_key_here
        ```

## Usage

Run the analyzer directly using `ts-node` (recommended via `npx`):

```bash
npx ts-node src/scripts/helius-analyzer.ts --address <WALLET_ADDRESS> [options]
```

### Required Parameters:

*   `--address`, `-a`: (String) The Solana wallet address to analyze.

### Optional Parameters:

*   `--limit`, `-l`: (Number, Default: 100) The batch size used when fetching *parsed transaction details* from the Helius API `/v0/transactions` endpoint. Does **not** limit the total number of transactions fetched.
*   `--fetchAll`, `--fa`: (Boolean, Default: false) If set, attempts to fetch all available transaction signatures via RPC. By default (false), it relies on Helius's default limits unless `--maxSignatures` is used. *Use with caution for wallets with very long histories.*
*   `--saveIntermediateCsv`, `-s`: (Boolean, Default: true) Save the intermediate list of SOL and SPL token movements (used as input for the P/L analysis) to a CSV file in the `./data/` directory. Useful for debugging the mapping step.
*   `--verbose`, `-v`: (Boolean, Default: false) Show detailed P/L results (Top 10 Gainers/Losers by SOL P/L) in the console output, in addition to the summary.
*   `--skipApi`: (Boolean, Default: false) Completely skip fetching data from Helius/RPC. The script will attempt to load data *only* from a previously saved intermediate CSV file in `./data/`. Fails if no suitable file is found.
*   `--maxSignatures`, `--ms`: (Number) Optionally limit the maximum number of transaction *signatures* to fetch via the Solana RPC `getSignaturesForAddress` method during Phase 1. If omitted, the script attempts to fetch all signatures up to RPC limits or Helius limits (unless `--fetchAll` is true).
*   `--help`, `-h`: Show help message.
*   `--version`, `-V`: Show script version.

### Examples:

**1. Basic Analysis (Recommended starting point):**
Fetch recent transactions (up to RPC/Helius limits), analyze SOL P/L of SPL trades, save reports.

```bash
npx ts-node src/scripts/helius-analyzer.ts --address YOUR_WALLET_ADDRESS_HERE
```

**2. Analyze with a Limit on Fetched Signatures:**
Fetch up to 5000 transaction signatures, then fetch details & analyze. Good for active wallets to limit initial scope.

```bash
npx ts-node src/scripts/helius-analyzer.ts --address 8z5awGJDDYVy1j2oeKP1nUauPDkhxnNGEZDkX8tNSQdb --ms 5000
```

**3. Analyze with Verbose Console Output:**
Show the Top 10 gainers/losers by SOL P/L directly in the console.

```bash
npx ts-node src/scripts/helius-analyzer.ts --address YOUR_WALLET_ADDRESS_HERE --verbose
```
*Or using aliases:*
```bash
npx ts-node src/scripts/helius-analyzer.ts -a YOUR_WALLET_ADDRESS_HERE -v
```

**4. Skip API Fetch & Analyze Cached Intermediate Data:**
If you previously ran with `-s` (default), this re-runs the P/L analysis using the intermediate CSV from `./data/` without hitting the API again.

```bash
npx ts-node src/scripts/helius-analyzer.ts --address YOUR_WALLET_ADDRESS_HERE --skipApi
```

**5. Disable Saving of Intermediate CSV:**
Run the analysis and generate final reports, but don't save the intermediate data file.

```bash
npx ts-node src/scripts/helius-analyzer.ts --address YOUR_WALLET_ADDRESS_HERE -s false
```

## Limitations

1.  **SOL P/L Attribution Complexity:**
    *   In transactions involving multiple SPL token movements alongside SOL movement (e.g., complex swaps, routing through multiple pools), precisely attributing the SOL cost/proceeds to *each specific* SPL token can be ambiguous solely based on transfer data.
    *   The current implementation attributes the *total* SOL change in such signatures to *each* involved SPL token's P/L calculation. This is noted in the logs (`Found X signatures with multiple SPL tokens...`) and means the per-token SOL P/L might be approximate in these complex cases. The overall SOL P/L remains accurate.

2.  **API Rate Limits & Performance:**
    *   Fetching and parsing data for wallets with extensive history can be time-consuming and may hit API rate limits.
    *   The script includes basic rate limiting (`MIN_REQUEST_INTERVAL`) and retry logic.
    *   Use `--maxSignatures` to limit the scope for very active wallets initially.
    *   Concurrency (`Promise.all`) is used for fetching transaction details to improve speed.

3.  **Transaction Type Focus:**
    *   The analyzer primarily focuses on SOL and SPL token *transfers* as recorded by Helius to calculate P/L from swaps. It may not interpret all possible DeFi interactions (e.g., providing liquidity, complex derivatives) correctly for P/L purposes.

## Performance Tips

*   **Use `--maxSignatures`:** Limit the initial signature fetch for very active wallets to get a faster preliminary analysis.
*   **Utilize Cache:** Subsequent runs for the same wallet will be much faster as API responses are cached in `./.cache/helius/`.
*   **Use `--skipApi`:** If you only want to re-run the analysis/reporting step on existing intermediate data, use this flag.

## Output Files

The analyzer generates report files in the `./analysis_reports/` directory:

1.  **SOL P/L CSV Report:**
    *   Filename: `onchain_sol_pnl_report_WALLET_ADDRESS_TIMESTAMP.csv`
    *   Contains per-token analysis detailing SOL spent/received and net P/L attributed to swaps involving that token.

2.  **SOL P/L Text Summary:**
    *   Filename: `onchain_sol_pnl_summary_WALLET_ADDRESS_TIMESTAMP.txt`
    *   Provides a high-level summary including overall net SOL P/L and lists the top gainers/losers by token.

*(Optional) Intermediate Data:*
If run with `--saveIntermediateCsv true` (default):
3.  **Intermediate CSV:**
    *   Filename: `intermediate_swaps_WALLET_ADDRESS_TIMESTAMP.csv`
    *   Located in: `./data/`
    *   Contains the raw list of SOL and SPL token movements extracted from Helius transactions, used as input for the P/L analysis.

## Extending the Analyzer

The modular design facilitates extensions:

1.  **Refining SOL Attribution:** Modify the logic in `transfer-analyzer-service.ts` to implement more sophisticated methods for attributing SOL costs in multi-token swaps (e.g., attempting value estimation).
2.  **Supporting New Transaction Interpretations:** Extend the `mapHeliusTransactionsToIntermediateRecords` function in `helius-transaction-mapper.ts` if Helius adds more detailed event types relevant to P/L.
3.  **Adding Value Calculation:** Integrate a price API service to fetch historical token prices and calculate approximate USD P/L (currently only SOL P/L is calculated). 