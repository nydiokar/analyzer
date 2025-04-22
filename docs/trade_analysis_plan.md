# Wallet Transfer Analysis Script Plan

## 1. Goal

Build a script to analyze historical **transfer data** for a specific token address within a wallet, calculate net changes in amount and value (based on provided data), and generate a summary report (CSV and console output). This script should integrate reasonably within the existing `analyzer` project structure and provide insights into wallet activity and value flow.

## 2. Data Input

*   **Source:** CSV file containing historical transfer data, typically exported from a block explorer like Solscan.
*   **Expected Format:** Based on the provided example (`export_transfer_...csv`), columns should include:
    *   `Signature` (Transaction ID)
    *   `Time` (Timestamp, e.g., `YYYY-MM-DD HH:MM:SS`)
    *   `Action` (e.g., `TRANSFER`, `TOKEN_TRANSFER`) - May not be directly used if filtering by `TokenAddress`.
    *   `From` (Source Wallet Address)
    *   `To` (Destination Wallet Address)
    *   `Amount` (Quantity of the token transferred)
    *   `Flow` (`In` or `Out` relative to the analyzed wallet)
    *   `Value` (Estimated value, likely in USD, at the time of transfer)
    *   `Decimals` (Token decimals for accurate `Amount` interpretation)
    *   `TokenAddress` (Mint address of the token, or `11111111111111111111111111111111` for SOL)
*   **Input Method:** The script will accept the CSV file path and the target `TokenAddress` as command-line arguments.

## 3. Implementation Strategy

*   **Location:** Create a new standalone script within the existing `src/scripts/` directory (e.g., `src/scripts/transfer-analyzer.ts`). This follows the pattern of `staking-calc.ts`.
*   **Execution:** Add a script runner command to `package.json` for easy execution (e.g., `npm run analyze-transfers -- --inputFile=path/to/transfers.csv --tokenAddress=TOKEN_MINT_ADDRESS`).

## 4. Component Reuse & Creation

*   **Reuse:**
    *   **Project Structure:** Leverage the existing `src/scripts/` pattern.
    *   **Utilities (`src/utils/`):**
        *   `logger.ts`: For logging.
        *   `config.ts`: Potentially for defaults.
    *   **TypeScript Setup:** Use existing `tsconfig.json`.
    *   **Dependencies:** Use `yargs` (existing) for argument parsing. Check `package.json` for date/CSV libraries before adding new ones.
*   **Creation:**
    *   `src/scripts/transfer-analyzer.ts`: The main script.
    *   Helper functions within `transfer-analyzer.ts` for:
        *   CSV Parsing (using `papaparse` - add dependency if needed).
        *   Data Cleaning/Transformation (handling `Amount` based on `Decimals`).
        *   Analysis Logic (calculating sums, net changes based on `Flow`).
        *   Report Generation (CSV and console table).
    *   New entry in `package.json` scripts section.
    *   New dependencies if needed (e.g., `papaparse`, `@types/papaparse`).

## 5. Core Logic (`transfer-analyzer.ts`)

1.  **Argument Parsing:** Use `yargs` to parse `--inputFile` and `--tokenAddress`.
2.  **CSV Loading & Parsing:** Read the CSV. Parse rows into structured transfer objects. Handle errors.
3.  **Data Filtering & Preparation:**
    *   Filter records matching the specified `--tokenAddress`.
    *   Convert `Amount` string to number, adjusting for `Decimals`.
    *   Convert `Value` string to number.
    *   Parse `Time` into Date objects.
4.  **Data Sorting:** Sort transfers chronologically by `Time`.
5.  **Analysis Calculation:**
    *   Iterate through filtered and sorted transfers.
    *   Calculate:
        *   Total Amount In (sum `Amount` where `Flow` == 'In')
        *   Total Amount Out (sum `Amount` where `Flow` == 'Out')
        *   Net Amount Change (In - Out)
        *   Total Value In (sum `Value` where `Flow` == 'In')
        *   Total Value Out (sum `Value` where `Flow` == 'Out')
        *   Net Value Change (In - Out) - *This is the proxy for P/L requested in the original task.*
        *   Number of In-Transfers
        *   Number of Out-Transfers
        *   First Transfer Timestamp
        *   Last Transfer Timestamp
6.  **Report Generation:**
    *   **CSV Output:** Create `transfer_analysis_report_TOKENADDRESS.csv` summarizing the calculated metrics (Total In/Out Amount, Total In/Out Value, Net Changes, Counts, Timestamps).
    *   **Console Output:** Print a concise summary table of these metrics.

## 6. Future Considerations (Optional Enhancements)

*   Identify transfers to/from known CEX/DEX addresses.
*   Calculate average holding time proxies.
*   Fetch current price to value the net amount change.
*   Group analysis by time periods (e.g., weekly, monthly).

## 7. Next Steps

1.  **Confirm Dependencies:** Check `package.json` for `papaparse` or similar; add if necessary.
2.  **Implement Script:** Develop `src/scripts/transfer-analyzer.ts`.
3.  **Add Runner:** Update `package.json`.
4.  **Test:** Run with the provided sample CSV and verify calculations. 