## Top Holders + Similarity Integration Plan

### Goals
- Provide a minimal, fast way to fetch top 20 holders for a token and display copyable owner addresses.
- Allow users to optionally push selected holders into Similarity Lab and run a similarity job.
- Support multi-token workflow (aggregate holders from several mints before running similarity).

### Current Backend Status
- Endpoint: `GET /api/v1/token-info/:mint/top-holders?commitment=finalized|confirmed|processed`
  - Returns: `mint`, `context`, `holders[]` where each holder includes:
    - `tokenAccount`: SPL token account (from Helius `getTokenLargestAccounts`)
    - `ownerAccount`: resolved wallet owner (via `getMultipleAccounts` with `jsonParsed`)
    - `amount`, `uiAmount`, `uiAmountString`, `decimals`, `rank`
- Similarity queue: `POST /api/v1/analyses/similarity/queue` (existing)
- Core Helius client: `getTokenLargestAccounts(mint, commitment?)` per Helius docs (fixed top-20)

### API Contract (Frontend-facing)
- Path: `GET /token-info/:mint/top-holders`
- Query: `commitment` optional
- Response shape:
```json
{
  "mint": "<token mint>",
  "context": { "slot": 0, "apiVersion": "..." },
  "holders": [
    {
      "tokenAccount": "<token-account>",
      "ownerAccount": "<owner-wallet|undefined>",
      "amount": "<raw>",
      "uiAmount": 0,
      "uiAmountString": "0",
      "decimals": 6,
      "rank": 1
    }
  ]
}
```

### Frontend UX Plan
1) Add a "Top Holders" panel inside Similarity Lab
   - Inputs: `mint` (required), `commitment` (optional; default finalized)
   - CTA: Fetch → renders a table (rank, ownerAccount, tokenAccount, uiAmountString)
   - Selection: checkboxes + "Select all"
   - Actions:
     - "Add selected to Similarity Set" → merges owner addresses into the Similarity Lab set (dedupe)
     - "+ Add another token" → allows multiple mints; aggregate holders across tokens
2) Similarity Set summary
   - Shows unique wallets collected; supports remove and clear
   - CTA: "Run Similarity" → POST `/analyses/similarity/queue` with set

### Edge Cases / Considerations
- Owner resolution failures: show tokenAccount, but exclude from set by default or warn user.
- Program-owned/vault accounts: optional UI toggle "Hide program-owned accounts" (later enhancement).
- Caps: optionally warn if set exceeds N (e.g., 200 wallets) before queueing similarity.
- No pagination for top holders (per Helius); fetching additional holders is out of scope.

### Implementation Steps
1. Define typed DTO for API response (TopHoldersResponseDto) and use it in controller.
2. Frontend: add API hook `getTopHolders(mint, commitment?)`.
3. Frontend: build "Top Holders" panel with selection and add-to-set.
4. Frontend: implement Similarity Set state, dedupe, "Run Similarity" using existing endpoint.
5. Optional: add "Hide program-owned accounts" UI filter (client-side heuristic or backend tag later).
6. Docs: Update API documentation with endpoint usage and curl examples.

### References
- Helius RPC docs: getTokenLargestAccounts — fixed top-20, commitment only.


