# Solana On-Chain Swap & P/L Analyzer

This tool helps you understand your Solana wallet's trading performance by analyzing your on-chain transaction history. It focuses on SOL swaps, calculating your Profit and Loss (P/L) for each token you've traded against SOL. It uses the Helius API for fetching data and an SQLite database for efficient storage and quick re-analysis.

## What Can You Do With This Tool?

-   **Track Your SOL Swap P/L:** See exactly how much SOL you've gained or lost on each token.
-   **Get Key Trading Stats:** Understand your trading patterns with metrics like win rate, average P/L per trade, and more.
-   **Keep Your Data Updated:** Easily fetch only the newest transactions since your last analysis.
-   **Analyze Specific Periods:** Look at your performance over the last day, week, month, quarter, year, or a custom date range.
-   **Efficient Data Handling:** Fetches data smartly, stores it locally, and can re-analyze existing data without hitting the API every time.
-   **Export Your Results:** Get your P/L data in CSV and a summary report in TXT format.

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

3.  **Set up Prisma (for the database):**
    *   Generate Prisma Client:
        ```bash
        npx prisma generate
        ```
    *   Apply database migrations (this creates the `dev.db` SQLite database file):
        ```bash
        npx prisma migrate dev --name init
        ```
        *(If you run this again, use a different migration name if `init` already exists, e.g., `--name some_update`)*

4.  **Create your `.env` file:**
    Copy the example file:
    ```bash
    cp .env.example .env
    ```
    Then, edit `.env` and add your Helius API Key:
    ```dotenv
    HELIUS_API_KEY=YOUR_HELIUS_API_KEY_HERE
    DATABASE_URL="file:./prisma/dev.db"
    # LOG_LEVEL=debug # Optional: uncomment for more detailed logs, or use --verbose flag
    ```

## How to Use It: Analyzing Your Wallet

The main script is `src/scripts/helius-analyzer.ts`. You run it with `npx ts-node` and provide your Solana wallet address.

**Basic Analysis (Fetches new transactions, calculates P/L, saves results):**

```bash
npx ts-node ./src/scripts/helius-analyzer.ts --address YOUR_SOLANA_WALLET_ADDRESS
```
*Example:*
```bash
npx ts-node ./src/scripts/helius-analyzer.ts --address So1anaD1e52aaJ2q1NkfWB6YYYEYDv9sbL1EtouWXk
```

### Common Scenarios & Examples:

**1. Initial Deep Dive (Fetch a large chunk of history):**
If it's your first time or you want to ensure a substantial amount of history is fetched.

*   Fetch up to 5000 of the latest transactions:
    ```bash
    npx ts-node ./src/scripts/helius-analyzer.ts --address YOUR_WALLET -ms 5000
    ```
*   Use "Smart Fetch" to get new transactions first, then fill with older ones up to a target (e.g., 3000 total):
    ```bash
    npx ts-node ./src/scripts/helius-analyzer.ts --address YOUR_WALLET --smartFetch --ms 3000
    ```
*   Attempt to fetch all available relevant swap transaction history (be mindful of API limits):
    ```bash
    npx ts-node ./src/scripts/helius-analyzer.ts --address YOUR_WALLET --fetchAll
    ```

**2. Quick Update (Fetch only new transactions since last run):**
This is the default behavior if you've run it before.
```bash
npx ts-node ./src/scripts/helius-analyzer.ts --address YOUR_WALLET
```

**3. Analyze Past Performance (Using already downloaded data):**

*   Analyze data from the last month (uses data already in your local database):
    ```bash
    npx ts-node ./src/scripts/helius-analyzer.ts --address YOUR_WALLET --period month --skipApi
    ```
    *Supported periods: `day`, `week`, `month`, `quarter`, `year`*

*   Analyze a specific date range (e.g., June 1, 2023, to December 31, 2023):
    ```bash
    npx ts-node ./src/scripts/helius-analyzer.ts --address YOUR_WALLET --startDate 2023-06-01 --endDate 2023-12-31 --skipApi
    ```
    *(Using `--skipApi` is recommended here if you believe the data for this period is already fetched to avoid unnecessary API calls. If not, omit it to fetch data for the range if missing.)*

**4. View Detailed Swap Info & Export:**

*   Show detailed P/L for each token directly in your console (top 10 by P/L):
    ```bash
    npx ts-node ./src/scripts/helius-analyzer.ts --address YOUR_WALLET --verbose
    ```
*   Save the P/L analysis to a CSV file:
    ```bash
    npx ts-node ./src/scripts/helius-analyzer.ts --address YOUR_WALLET --saveAnalysisCsv
    ```
    *(A TXT summary report is always generated.)*

**5. Offline Analysis (Use only local database, no internet needed after initial fetch):**
```bash
npx ts-node ./src/scripts/helius-analyzer.ts --address YOUR_WALLET --skipApi
```

### Full List of Command Line Options:

You can see all options by running:
```bash
npx ts-node ./src/scripts/helius-analyzer.ts --help
```

Key options include:
```
Options:
  --help                 Show help                                            [boolean]
  --version              Show version number                                  [boolean]
  --address, -a          Solana wallet address to analyze           [string] [required]
  --limit, -l            Helius transaction parse batch size (default: 100)
                                                          [number] [default: 100]
  --fetchAll, --fa       Attempt to fetch all available relevant SWAP transactions
                         (respects internal Helius API limits) [boolean] [default: false]
  --verbose, -v          Show detailed token swap P/L activity in console (Top 10)
                                                            [boolean] [default: false]
  --skipApi              Skip Helius API calls, rely solely on data in the local
                         database                      [boolean] [default: false]
  --smartFetch, --sf     Smart fetch: gets new transactions, then older ones up to
                         --maxSignatures (if specified)    [boolean] [default: false]
  --fetchOlder           Legacy: Ignore saved state and fetch older transaction history
                         (respects --maxSignatures)        [boolean] [default: false]
  --maxSignatures, --ms  Max transactions to fetch. With --smartFetch, it's a target
                         for the database.                                  [number]
  --period, -p           Analyze a pre-defined period (day, week, month, quarter,
                         year) using data in the local DB.            [string]
  --startDate            Start date for analysis (YYYY-MM-DD). Use with --skipApi
                         for historical DB analysis, or fetches data for this range.
                                                                          [string]
  --endDate              End date for analysis (YYYY-MM-DD). See --startDate. [string]
  --saveAnalysisCsv      Save aggregated P/L results per token to a CSV file.
                                                            [boolean] [default: false]
```

## How It Works (Simplified)

1.  **Fetches Transactions:** Connects to Helius API to get your wallet's transaction history.
    *   *Smart Fetching:* On subsequent runs, it only gets transactions newer than the last one it processed, saving time and API calls. You can also control how much history is fetched.
2.  **Identifies Swaps:** Filters these transactions to find SOL swaps (where you traded SOL for another token, or vice-versa).
3.  **Calculates P/L:** For each token traded against SOL, it uses a FIFO (First-In, First-Out) method to determine your cost basis and calculate realized profit or loss in SOL.
4.  **Stores Data:** Saves raw transaction data and the processed swap information into a local SQLite database. This makes future analysis much faster.
5.  **Generates Reports:** Creates a text summary and an optional CSV file with your P/L breakdown and trading statistics.

## Database Details

The tool uses an SQLite database (managed with Prisma ORM) to store:
-   Your wallet address and the timestamp of its most recently processed transaction.
-   Raw transaction details from Helius.
-   Records of identified swaps ready for P/L calculation.
-   Results of each analysis run (P/L per token, advanced stats).

You can find the database schema in `prisma/schema.prisma`.

## Technical Notes & Testing

### SPL-to-SPL Transaction Mapping
The system correctly handles SPL-to-SPL swaps that use Wrapped SOL (WSOL) as an intermediary, ensuring SOL P/L is accurately attributed. For testing this specific mapper logic:
```bash
npx ts-node ./src/scripts/test-spl-to-spl-mapper.ts
```

### Reliance on Helius Transaction Parsing
This tool relies on the Helius API for fetching and parsing transaction data, including the identification of swap events and their constituent transfers. The accuracy of the P/L analysis is therefore dependent on the stability and correctness of Helius's parsing logic. Changes or inconsistencies in how Helius parses transactions from various DEXs or DeFi protocols could impact the P/L calculations. While Helius provides a convenient way to access structured transaction data, this dependency is a trade-off for broader protocol support without needing to implement custom parsers for each.
