## Mint Participants CLI (Lean MVP)

### Goal
- Build a standalone CLI that, for a given mint and cutoff time, extracts the last N wallets that bought the token before the cutoff and outputs a simple, append-only dataset for verification and later automation.

### Non-goals (MVP)
- No database writes or schema changes.
- No full PnL or deep behavior analysis.
- Minimize heavy transaction-detail fetching; only fetch details for the small set needed to confirm buys and compute stake.

### Inputs
- mint: token mint address (required)
- until: cutoff timestamp (ISO or unix, required)
- limitBuyers: number of buyers to return (default 20)
- addressType: one of mint | bonding-curve | auto (default auto)
- txCountLimit: cap for wallet tx count scanning (default 500)
- output: jsonl | csv (default jsonl)
- outFile: path to output file (default analyses/mint_participants/index.jsonl)
- verbose, dryRun (optional)

### Output (per wallet record)
- wallet: base58 address
- mint: token mint
- cutoffTs: number (seconds)
- firstBuyTs: number (the transaction timestamp for this wallet’s buy)
- firstBuySignature: string
- tokenAmount: number (amount of mint received in the buy tx)
- stakeSol: number (SOL spent attributed to this mint in the buy tx; derived via mapper)
- stats:
  - txCountScanned: number (e.g., last 500)
  - totalTxCount: number | null (optional; only if we scan full history)
  - firstSeenTs: number | null (earliest blockTime from signatures scan)
  - accountAgeDays: number | null (derived from firstSeenTs)
  - tokenAccountsCount: number (from getTokenAccountsByOwner)
- runMeta:
  - scannedAtIso: string
  - source: "mint" | "bonding-curve" | "auto"

### High-level Flow
1) Resolve fetch address
   - addressType=auto → default to mint for MVP; allow bonding-curve address optionally later.
2) Smart pre-filter (signatures-only, batched)
   - Use RPC getSignaturesForAddress(mint-or-bonding-curve) with pagination (newest→older), but do NOT reverse.
   - Apply cutoff early using signature metadata: keep only signatures where blockTime ≤ cutoff.
   - Continue paging until we accumulate a small candidate pool around the cutoff (e.g., 200–400 signatures) OR until we’ve found N buyers (see step 3). This avoids scanning everyone.
3) Minimal parsed fetch (batched), stop-early when N reached
   - Fetch parsed details only for the current candidate pool using Helius /v0/transactions in batches of ~100.
   - From newest→older txs, detect token transfers where the mint is received by a user wallet and ts ≤ cutoff.
   - Collect unique wallets and their exact buy tx (signature, ts, amount). Stop as soon as limitBuyers is reached. If not enough, fetch the next page of signatures and repeat.
4) For each selected buyer (N wallets)
   - stake: run the existing transaction mapper against that single buy transaction for this wallet and sum associatedSolValue for the target mint (direction=in) → stakeSol.
   - tokenAmount: from the transfer row for the mint in that transaction.
   - tokenAccountsCount: call getTokenAccountsByOwner(owner) and count entries.
   - tx counts & creation time:
     - Quick txCountScanned: getSignaturesForAddress(owner, limit=txCountLimit) → use length.
     - Creation scan by default: walk signatures to earliest page to get firstSeenTs; auto-skip/cap for very large wallets (tokenAccountsCount > 10k → treat as old, use first page).
5) Append results to file (JSONL default)
   - Ensure directory exists; append one JSON object per wallet to outFile.
   - CSV option writes/updates a flat CSV with the same core fields.

### Batching & Smart Concurrency
- Signatures paging: request 1000 per page; stop once we hold enough candidates to find N buyers or when older than necessary.
- Parsed tx details: batch requests of ~100 signatures per POST to /v0/transactions.
- Buyer stats (for N buyers): run in parallel with a concurrency cap (e.g., 5–10) for:
  - getTokenAccountsByOwner(owner)
  - getSignaturesForAddress(owner, limit=txCountLimit)
- Early-stop: as soon as we reach N buyers, stop both signature paging and parsed fetches.
- Tunable candidate window: expose `--candidateWindow` (default 300) to cap how many latest signatures (≤ cutoff) we consider per iteration before fetching parsed details; increases responsiveness while preserving correctness.

### Minimal Technical Design
- Reuse HeliusApiClient for RPC and batched transaction details.
- Implement a tiny selector that:
  - Paginates signatures newest→older for the mint (or bonding-curve) with early cutoff filtering.
  - Batches details fetch only for the rolling candidate window and stops immediately when N is reached.
- Use existing mapHeliusTransactionsToIntermediateRecords to compute stakeSol precisely from the buy transaction (single-tx mapping per wallet, very fast).
- Wallet stats:
  - tokenAccountsCount via getTokenAccountsByOwner(owner).
  - txCountScanned via getSignaturesForAddress(owner, limit=txCountLimit).
  - Optional full creation scan function (disabled by default) that walks signatures to the earliest page and returns firstSeenTs and totalTxCount; bounded by a max-pages guard.

### CLI Sketch
- Command: mint-participants scan
- Example:
  - mint-participants scan \
    --mint <MINT> \
    --until 2025-09-01T12:00:00Z \
    --limitBuyers 20 \
    --txCountLimit 500 \
    --output jsonl

### Performance & Safety
- Only fetch parsed tx details for the candidate set required to confirm N buyers and compute stake; all other counts use signature metadata only.
- Built-in pacing from HeliusApiClient protects against rate limits.
- Creation scan is enabled by default with safeguards: auto-skip for massive wallets and a max-page cap to avoid hangs; we record scan mode (first_page | full | capped) and pages.

### Later (Non-breaking) Enhancements
- Add explicit bonding-curve discovery or parameter for more accurate pre-migration buyers.
- Enrich stats (tokens traded count, recent activity windows) still via signature metadata.
- Add DB-backed mode (new table) behind a flag; default remains file-only.

### Acceptance (MVP)
- Given mint + cutoff, returns up to N last buyers with: wallet, firstBuyTs/signature, tokenAmount, stakeSol, tokenAccountsCount, txCountScanned, firstSeenTs/accountAgeDays, creationScanMode/pages for transparency.

### Implementation Status (current)
- CLI implemented at `src/scripts/mint-participants.ts`.
- Detection: newest→older across candidate transactions; stop when N wallets found.
- Enrichment: stake via mapper on the buy tx; tokenAccountsCount via SPL program; txCountScanned from signature metadata.
- Creation scan: default full scan with auto-skip for `tokenAccountsCount > 10k` and a safety page cap; output records scan mode and pages.
- Output JSONL/CSV schema includes: wallet, mint, cutoffTs, buyTs/buyIso, signature, tokenAmount, stakeSol, tokenAccountsCount, txCountScanned, walletCreatedAtTs/ISO, accountAgeDays, creationScanMode, creationScanPages.
- Writes append-only JSONL/CSV to a single file without touching the database.

