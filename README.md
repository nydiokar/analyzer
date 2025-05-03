# Solana On-Chain Swap & P/L Analyzer

This project analyzes a Solana wallet's on-chain transaction history using the Helius API to calculate Profit and Loss (P/L) specifically from SOL swaps. It utilizes a database (SQLite via Prisma) to store transaction data for efficient incremental fetching and analysis.

## Core Features

-   **Helius API Integration:** Fetches detailed transaction history directly from the Helius API.
-   **Database Caching:** Stores fetched transactions and intermediate swap records in an SQLite database using Prisma ORM.
-   **Incremental Fetching:** Efficiently fetches only new transactions since the last run by tracking the latest processed transaction signature and timestamp in the database.
-   **Swap Analysis:** Processes token transfers (SPL and SOL) to identify swaps involving SOL.
-   **SOL P/L Calculation:** Calculates the realized Profit or Loss in SOL for each token swapped against SOL, using a FIFO (First-In, First-Out) cost basis approach.
-   **Advanced Trading Stats:** Computes metrics like win rate, median P/L, standard deviation, etc., based on the swap results.
-   **Reporting:** Generates CSV and TXT summary reports of the P/L analysis.
-   **On-Demand Analysis:** Capable of re-analyzing historical data stored in the database for specific time ranges (future enhancement via CLI options).

## Setup

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd <repository-directory>
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set up Prisma:**
    *   Generate Prisma Client:
        ```bash
        npx prisma generate
        ```
    *   Apply database migrations (creates the SQLite database file if it doesn't exist):
        ```bash
        npx prisma migrate dev --name init 
        ``` 
        *(Use a different migration name if `init` already exists)*

4.  **Create `.env` file:** Copy `.env.example` to `.env` and add your Helius API Key:
    ```dotenv
    HELIUS_API_KEY=YOUR_HELIUS_API_KEY_HERE
    DATABASE_URL="file:./prisma/dev.db" 
    # LOG_LEVEL=debug # Optional: uncomment for more detailed logs
    ```

## Usage

Run the analysis script via `ts-node`:

```bash
npx ts-node ./src/scripts/helius-analyzer.ts --address <YOUR_SOLANA_WALLET_ADDRESS> [options]
```

**Example:**

```bash
# Analyze a wallet, fetching new transactions and saving results
npx ts-node ./src/scripts/helius-analyzer.ts --address So1anaD1e52aaJ2q1NkfWB6YYYEYDv9sbL1EtouWXk

# Analyze using only data already stored in the database (skips API calls)
npx ts-node ./src/scripts/helius-analyzer.ts --address So1anaD1e52aaJ2q1NkfWB6YYYEYDv9sbL1EtouWXk --skipApi

# Fetch a maximum of 5000 signatures during the initial fetch or if history is large
npx ts-node ./src/scripts/helius-analyzer.ts --address So1anaD1e52aaJ2q1NkfWB6YYYEYDv9sbL1EtouWXk --maxSignatures 5000

# Display detailed token swap results in the console (Top 10 by P/L)
npx ts-node ./src/scripts/helius-analyzer.ts --address So1anaD1e52aaJ2q1NkfWB6YYYEYDv9sbL1EtouWXk --verbose 
```

### Command Line Options

```
Options:
  --help              Show help                                       [boolean]
  --version           Show version number                             [boolean]
  --address, -a       Solana wallet address to analyze      [string] [required]
  --limit, -l         Helius transaction parse batch size (default: 100) [number] [default: 100]
  --fetchAll, --fa    Attempt to fetch all available relevant SWAP transactions (respects internal limits) [boolean] [default: false]
  --saveIntermediateCsv, -s Save intermediate swap data to CSV (optional export)[boolean] [default: true]
  --verbose, -v       Show detailed token swap activity in console [boolean] [default: false]
  --skipApi           Skip Helius API calls, rely solely on database cache [boolean] [default: false]
  --maxSignatures, -ms Optional maximum number of signatures to fetch via RPC [number]
  --startDate         Optional start date for analysis (YYYY-MM-DD) [string]
  --endDate           Optional end date for analysis (YYYY-MM-DD)   [string]
```


## Database Schema

The application uses an SQLite database managed by Prisma. See `prisma/schema.prisma` for the detailed table structure, including:

-   `Wallet`: Tracks analyzed wallets and the latest processed transaction state.
-   `HeliusTransactionCache`: Stores raw transaction details fetched from Helius.
-   `SwapAnalysisInput`: Stores standardized transfer records used as input for P/L analysis.
-   `AnalysisRun`: (Planned) Stores metadata about each analysis execution.
-   `AnalysisResult`: (Planned) Stores the calculated P/L results per token for each run.
-   `AdvancedStatsResult`: (Planned) Stores the calculated advanced statistics for each run.

## Recent Fixes & Improvements

### SPL-to-SPL Transaction Mapping Fix

The mapper has been updated to correctly handle SPL-to-SPL swaps with WSOL as an intermediary. Previously, for some transactions like SPL to SPL swaps involving WSOL as an intermediary, the `associatedSolValue` could be doubled because both the primary token flow and the WSOL flow were counted. The fix includes:

1. A specialized detector for SPL-to-SPL swap patterns with WSOL intermediaries
2. Logic to use the proper WSOL movement value instead of the doubled net SOL change
3. Safeguards to ensure the associated SOL value is accurate even in edge cases

To test the fix with a specific transaction:
```bash
npx ts-node ./src/scripts/test-spl-to-spl-mapper.ts
```

## Testing

```bash
npm test
```
*(Note: Test suite may need updates to reflect the current Helius/DB implementation)* 