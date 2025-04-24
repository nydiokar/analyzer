# Solana Wallet Swap Analysis Pipeline

## Goal

To analyze the swap transaction history of a given Solana wallet address, providing insights into token activity and eventually profit/loss.

## Phased Approach

Due to the limitations of data sources (Helius API does not provide historical prices), the analysis is implemented in two phases:

1.  **Phase 1: On-Chain Data Extraction & Analysis (Current Focus)**
    *   Reliably fetch all relevant SWAP transaction data involving token transfers from the Helius API.
    *   Process and map this data into a clean intermediate format (`IntermediateSwapRecord[]`), suitable for both on-chain analysis and future price enrichment.
    *   Perform analysis based purely on verifiable on-chain metrics (token flow, interaction counts, timestamps).
    *   Generate reports based on these on-chain metrics.
2.  **Phase 2: Off-Chain Price Integration & P/L Analysis (Future)**
    *   Utilize the `IntermediateSwapRecord[]` generated in Phase 1.
    *   Integrate an external API (e.g., Birdeye) to fetch historical token prices for each record based on its `mint` address and `timestamp`.
    *   Enrich the intermediate data with USD values.
    *   Calculate Profit/Loss (P/L) metrics per token.
    *   Enhance reports with financial analysis (P/L, volumes in USD, etc.).

---

## Detailed Pipeline Steps:

### Phase 1: Helius On-Chain Data Pipeline (Current Implementation)

**Step 1.1: Fetch SWAP Signatures (Helius API)**

*   **API:** `GET /v0/addresses/{address}/transactions`
*   **Parameters:** Use `type=SWAP` to filter efficiently at the source.
*   **Method:** Implement the Helius-recommended two-step process for robustness:
    1.  Fetch batches of *signatures* only, handling pagination (`before` parameter).
*   **Note:** Helius transaction history retrieval might have practical depth limits (observed ~6 months for very active wallets), although the protocol allows deeper pagination. Very old data might be incomplete.

**Step 1.2: Fetch Full SWAP Transaction Details (Helius API)**

*   **API:** `POST /v0/transactions`
*   **Method:** For the unique signatures gathered in Step 1.1, fetch the full transaction details in batches.

**Step 1.3: Filter & Map to Intermediate Format**

*   **Input:** Full `HeliusTransaction[]` objects from Step 1.2.
*   **Filtering:**
    *   Keep only transactions fetched (confirming they are `SWAP` type).
    *   Further filter client-side to ensure each transaction includes actual token movements (`tokenTransfers` array is present and non-empty).
*   **Mapping:** Process *only* the `tokenTransfers` array within each valid Helius transaction. Ignore `nativeTransfers` (SOL fees/movements).
*   **Output:** An array of `IntermediateSwapRecord` objects (see format below).

**Step 1.4: Save Intermediate Data**

*   **Format:** CSV file (e.g., `data/intermediate_swaps_{wallet}_{timestamp}.csv`).
*   **Content:** Persist the `IntermediateSwapRecord[]` array. This file serves as the clean, foundational dataset for subsequent steps (both Phase 1 analysis and Phase 2 price fetching).

**Step 1.5: Perform On-Chain Analysis**

*   **Input:** `IntermediateSwapRecord[]` from the saved file or memory.
*   **Logic:** Aggregate data per token (`mint`).
*   **Metrics:**
    *   Total Amount In / Out (token units, adjusted for decimals)
    *   Net Amount Change (token units, adjusted for decimals)
    *   Interaction Count (In/Out counts)
    *   First Interaction Timestamp
    *   Last Interaction Timestamp
    *   *Future:* Holding periods, transaction frequency.

**Step 1.6: Generate On-Chain Report**

*   **Input:** Results from Step 1.5.
*   **Formats:**
    *   CSV: Detailed breakdown per token with calculated on-chain metrics.
    *   Text (`.txt`): Console summary showing key overall stats and top tokens based on interaction count or net amount.

### Phase 2: Birdeye Price Integration & Financial Analysis (Future Implementation)

**Step 2.1: Fetch Historical Prices (Birdeye API)**

*   **Input:** `IntermediateSwapRecord[]` (specifically `mint` and `timestamp` for each record).
*   **API:** `GET https://public-api.birdeye.so/public/price?address=<mint>&time=<unix_timestamp>` (or similar Birdeye endpoint).
*   **Method:**
    *   For each unique `mint` + `timestamp` combination present in the intermediate data, query the Birdeye API.
    *   Handle rate limits and potential errors from the Birdeye API.
    *   **Crucially: Implement caching** (e.g., in a local database or file) to store fetched prices (keyed by `mint`+`timestamp`) and avoid redundant API calls on subsequent runs or for the same token/time across different records.
*   **Output:** A mapping or enriched dataset linking `mint`+`timestamp` to its historical USD price.

**Step 2.2: Calculate Financial Metrics**

*   **Input:** `IntermediateSwapRecord[]` and the fetched historical prices from Step 2.1.
*   **Logic:**
    *   For each `IntermediateSwapRecord`, calculate its USD `value` (`amount` / 10^`decimals` * `price_at_timestamp`).
    *   Group records by `mint`.
    *   Calculate P/L per token: Requires matching inflows and outflows (e.g., using FIFO/LIFO or average cost basis methods) and their calculated USD values. P/L = Σ(Value Out) - Σ(Value In).
    *   Calculate Total Volume In/Out (USD).
    *   Calculate Average Buy/Sell Price (USD).

**Step 2.3: Generate Enhanced Report**

*   **Input:** Results from Step 2.2.
*   **Formats:**
    *   CSV/JSON/Database: Update reports to include USD values, P/L, volume, average prices per token.
    *   Text (`.txt`): Enhance console summary with overall P/L, top gainers/losers based on USD value.

---

## Key Data Format: IntermediateSwapRecord

This structure links on-chain events with the necessary info for future price lookups.

```typescript
interface IntermediateSwapRecord {
  signature: string;      // Transaction signature
  timestamp: number;      // Unix timestamp of the transaction
  mint: string;           // Token mint address
  amount: number;         // Raw token amount (smallest unit, e.g., lamports for SPL tokens)
  decimals: number;       // Token decimals
  direction: 'in' | 'out'; // Direction relative to the analyzed wallet
}
```

## Current Limitations (Phase 1)

*   **No Historical Price Data:** The Helius API does not provide USD values at the time of transactions. All value-based calculations (P/L) are deferred to Phase 2.
*   **Transaction History Depth:** Fetching very deep history via Helius can be slow or incomplete due to API/node limitations. 