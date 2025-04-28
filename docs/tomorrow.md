# P/L Analysis Refactor Plan (WSOL Bridge Handling)

## Goal & Desired Logic:

1.  **Problem:** Accurately calculate Profit/Loss (P/L) for token swaps, especially SPL-to-SPL swaps using Wrapped SOL (WSOL) as an intermediate bridge (e.g., via Jupiter, Pump.fun).
2.  **Core Insight:** Intermediate WSOL transfers within the same transaction signature (even if not directly involving the user's wallet) contain the necessary wSOL value information.
3.  **Mapper's Role:**
    *   Process transactions involving the target `walletAddress`.
    *   For each relevant transaction signature, record **ALL** token transfers (SPL and WSOL) within that transaction.
    *   **DO NOT** filter transfers based on direct wallet involvement (sender/receiver).
    *   **DO NOT** calculate or store native SOL balance changes (`solSpentInTx`, `solReceivedInTx`).
    *   Store: `signature`, `timestamp`, `mint`, `amount`, `fromUserAccount`, `toUserAccount` for every transfer.
4.  **Analyzer's Role:**
    *   Receive the comprehensive list of all transfers.
    *   Group transfers by `signature`.
    *   Within each transaction group:
        *   Identify SPL tokens sent/received by the `walletAddress`.
        *   Identify corresponding WSOL transfers within the group.
        *   Use WSOL transfer `amount`s to determine SOL cost basis or proceeds for the SPL tokens.
        *   Identify and account for potential WSOL protocol fees within the group.
        *   Aggregate calculated SOL costs/proceeds per token.

## Summary of Changes Needed:

1.  **Data Structure (`IntermediateSwapRecord` type / `SwapAnalysisInput` model):**
    *   Remove `direction`, `solSpentInTx`, `solReceivedInTx`.
    *   Add `fromUserAccount: string | null`, `toUserAccount: string | null`. - HOW DO WE HANDLE SITUATION WHERE THE WSOL IS EXCHANGED BETWEEN OTHER WALLETS (RAYDIUM AND PUMPFUN) THAN OURS - SHOULD INDICATE IN AND OUT OF WSOL FOR RESPECTIVE TOK 
2.  **Mapper (`src/services/helius-transaction-mapper.ts`):**
    *   Remove native SOL calculation logic.
    *   Remove filtering; save *all* transfers for relevant signatures.
    *   Store actual `fromUserAccount` and `toUserAccount` for each transfer.
3.  **Database (`prisma/schema.prisma`, `src/services/database-service.ts`):**
    *   Update Prisma schema.
    *   Run database migration.
    *   Update `saveIntermediateRecords` function.
4.  **Analyzer (`src/services/transfer-analyzer-service.ts`):**
    *   Major refactor: Group by signature, parse flow using `fromUserAccount`/`toUserAccount`, calculate cost/proceeds from linked WSOL amounts. 