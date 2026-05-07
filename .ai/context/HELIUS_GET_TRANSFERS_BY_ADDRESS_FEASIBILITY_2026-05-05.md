# Helius `getTransfersByAddress` Feasibility - 2026-05-05

## Scope

Evaluate whether Sova Analyzer should switch wallet-history ingestion from the current signature + parsed-transaction pipeline to Helius `getTransfersByAddress`.

This is research only. No ingestion code was changed.

## Repo Context Confirmed

Project purpose: Sova Analyzer builds wallet intelligence from Solana wallet history, persists normalized `SwapAnalysisInput` rows, enriches market context, then derives PnL, behavior, HUD, profile, holder-profile, similarity, and dashboard projections.

Key structure:

- Wallet sync: `src/core/services/helius-sync-service.ts`
- Helius API wrapper: `src/core/services/helius-api-client.ts`
- Transaction-to-analysis mapper: `src/core/services/helius-transaction-mapper.ts`
- Helius transaction types: `src/types/helius-api.ts`
- Runtime sync consumers: `src/queues/processors/analysis-operations.processor.ts`, `src/queues/processors/wallet-operations.processor.ts`, `src/queues/processors/similarity-operations.processor.ts`, `src/api/services/wallet-preparation.service.ts`
- Tuning: `src/config/constants.ts`

Setup/scripts: TypeScript/Nest repo using `pnpm`; project guidance says TS scripts should run with `npx ts-node -r tsconfig-paths/register`.

Conventions/patterns: keep changes minimal, preserve the established `sync -> enrich -> analyze` pipeline, avoid second serving models, and prefer persisted projections over adding ad-hoc paths.

## Current Behavior Observed In Code

Current wallet-history ingestion is `HeliusSyncService.syncWalletData()` -> `HeliusApiClient.getAllTransactionsForAddress()` -> `mapHeliusTransactionsToIntermediateRecords()` -> `DatabaseService.saveSwapAnalysisInputs()`.

`getAllTransactionsForAddress()` currently does two conceptual phases:

1. Signature discovery
   - Default path: Solana RPC `getSignaturesForAddress`.
   - Optional feature-flag path: Helius `getTransactionsForAddress` in `transactionDetails: "signatures"` mode, controlled by `ENABLE_HELIUS_TX_FOR_ADDRESS_SIGNATURES`, default `false`.
   - Page limit is 1,000 signatures.
   - Stops at `maxSignatures`, timestamp cursor, explicit signature cursor, or safety multiplier.

2. Parsed transaction detail fetch
   - Missing signatures are fetched with `POST /v0/transactions`.
   - Batch size is `HELIUS_CONFIG.BATCH_SIZE = 100`.
   - Internal concurrency defaults to `HELIUS_CONFIG.INTERNAL_CONCURRENCY = 10`.
   - The DB transaction cache is lightweight. It avoids re-fetching signatures already mapped for the same wallet, but cached transaction payloads are not reused as full parsed payloads for new wallet contexts.

The mapper depends on full enhanced transaction shape:

- `tokenTransfers`
- `nativeTransfers`
- `accountData.tokenBalanceChanges`
- `instructions` and `innerInstructions`
- `events.swap`
- `fee`, `feePayer`
- `type`, `source`, `signature`, `slot`, `timestamp`

Those fields are used to infer buys/sells, assign SOL/USDC economic value, handle routed WSOL/stable flows, filter intermediates, calculate fee fields, and avoid double counting.

## External Endpoint Facts Confirmed

Official Helius credit docs state:

- Enhanced Transactions parsing: 100 credits.
- `getTransactionsForAddress`: 50 credits, returning 100 full transactions or 1,000 signatures.
- `getTransfersByAddress`: 10 credits, returning up to 100 transfers.
- `getTransactionsForAddress` and `getTransfersByAddress` require Developer plan or higher.

Sources:

- https://www.helius.dev/docs/billing/credits
- https://www.helius.dev/docs/rpc/gettransactionsforaddress
- https://www.helius.dev/docs/rpc/gettransfersbyaddress
- https://helius.mintlify.app/api-reference/rpc/http/gettransfersbyaddress

I attempted one live `getTransfersByAddress` call with `limit: 2` using the local `HELIUS_API_KEY`. Helius returned:

```json
{
  "code": -32403,
  "message": "This feature is only available for paid plans. Please upgrade if you would like to gain access."
}
```

So the current local key cannot verify live response shape until it is upgraded or replaced with a paid Developer-or-higher key.

## `getTransfersByAddress` Shape And Parameters

Method:

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "getTransfersByAddress",
  "params": [
    "OWNER_WALLET_ADDRESS",
    {
      "limit": 100,
      "sortOrder": "desc"
    }
  ]
}
```

Important parameters:

| Parameter | Meaning | Notes |
|---|---|---|
| `address` | Owner wallet address | Not ATA; Helius finds token-account transfer activity for the owner. |
| `with` | Counterparty filter | Only transfers to/from this address. |
| `direction` | `in`, `out`, `any` | Relative to owner address. Default `any`. |
| `mint` | Mint filter | Native SOL uses `So11111111111111111111111111111111111111111`; WSOL uses `So11111111111111111111111111111111111111112`. |
| `solMode` | `merged`, `separate` | Default `merged`; `separate` keeps WSOL/wrap/unwrap rows visible. |
| `filters.amount` | raw amount comparisons | `gt`, `gte`, `lt`, `lte`; raw amount, not UI amount. |
| `filters.blockTime` | Unix timestamp comparisons | `gt`, `gte`, `lt`, `lte`. |
| `filters.slot` | slot comparisons | `gt`, `gte`, `lt`, `lte`. |
| `limit` | max transfer rows | Range 1-100; default 100. |
| `paginationToken` | cursor | From prior response. |
| `commitment` | `finalized`, `confirmed` | Default `finalized`. |
| `sortOrder` | `desc`, `asc` | Default `desc`. |

Response fields include:

| Field | Meaning |
|---|---|
| `signature` | Transaction signature. |
| `slot` | Slot. |
| `blockTime` | Unix timestamp seconds. |
| `type` | `transfer`, `mint`, `burn`, `wrap`, `unwrap`, `changeOwner`, `withdrawWithheldFee`. |
| `fromUserAccount`, `toUserAccount` | Wallet sides; can be `null` for mints/burns. |
| `fromTokenAccount`, `toTokenAccount` | Present when applicable; omitted for native SOL rows. |
| `mint` | Token mint; native SOL uses special native SOL mint. |
| `amount` | Raw string amount. |
| `feeAmount` | Token-2022 withheld transfer fee, only when present. |
| `decimals` | Token decimals. |
| `uiAmount` | UI amount string. |
| `feeUiAmount` | UI fee string, only when present. |
| `confirmationStatus` | `finalized` or `confirmed`. |
| `transactionIdx`, `instructionIdx`, `innerInstructionIdx` | Position metadata. |
| `paginationToken` | Cursor for next page. |

Limitations from docs:

- Only the most recent 1 year of transfer history is currently available.
- Failed transactions are not included in V1.
- Hidden SOL movements inferred only from balance changes are not supported in V1.
- Intermediary account flows are not reduced; underlying transfer records are returned.
- It returns transfer rows, not full transaction payloads. Helius docs explicitly say to page transfers, dedupe signatures, then fetch full transactions if full payloads are needed.
- Not batchable across multiple owner addresses.

## Comparison Matrix

| Dimension | Current Path: signatures + `/v0/transactions` | Optional Existing Path: `getTransactionsForAddress` signatures mode + `/v0/transactions` | New Candidate: `getTransfersByAddress` |
|---|---|---|---|
| Credit model | Signature discovery is cheap, but parsed detail fetch uses Enhanced Transactions at 100 credits per request. With 100 signatures per batch, effective parsed-detail cost is roughly 1 credit/signature before cache. | Signature discovery can cost 50 credits/page for 1,000 signatures, then still pays `/v0/transactions` for details. | 10 credits/page for up to 100 transfer rows. Potentially ~10x cheaper than Enhanced Transactions parsing per 100 items, but transfer rows are not equivalent to full transactions. |
| Plan gate | Current endpoints mostly work with current local key. | Developer-or-higher for `getTransactionsForAddress`. | Developer-or-higher. Local key returned 403. |
| Returned unit | Full enhanced transaction objects. | Signatures only unless full mode is used. | Individual transfer rows. A single signature can produce many rows. |
| Page size | 1,000 signatures discovery; 100 parsed transactions per `/v0/transactions` batch. | 1,000 signatures or 100 full transactions. | 100 transfer rows. |
| Retention | Current path depends on Helius enhanced history/RPC availability; repo logic targets up to configured signature caps. | Mainnet docs say unlimited for `getTransactionsForAddress`; token-account metadata limitation prior to Dec 2022. | Only most recent 1 year. This is the largest product-fit blocker for deep/full-history analysis. |
| ATA coverage | Current code has a warning that wallet-address signature discovery can miss SPL transfers where wallet appears only via token account. | `filters.tokenAccounts: balanceChanged/all` can include owned token-account history. Current code does not set this filter. | Designed around owner wallet address and token accounts owned by that wallet. Strong positive. |
| Mapper compatibility | Native. Existing mapper consumes this shape. | Full mode could be compatible if response matches enhanced transaction shape; current code mostly uses signatures mode only. | Not compatible with current mapper. Requires a new transfer-row mapper or a grouping/reconstruction layer. |
| SOL/stable value attribution | Current mapper uses full transaction context, swap events, instructions, native transfers, WSOL lifecycle heuristics. | Full mode may preserve enough context; signatures mode does not. | Transfer rows alone do not include `events.swap`, full instructions, fee payer, transaction fee, or complete account data. Simple reconstruction may work for simple swaps, but complex routed swaps and hidden SOL movements are risky. |
| PnL correctness | Current behavior is imperfect but deeply tuned to existing projections. | Could reduce signature discovery cost and improve ATA coverage if adopted carefully. | Good for balance movement ledger; risky as the sole source for trade economics. |
| Backfill/migration cost | None. | Small-medium if enabling signatures mode with token-account filter and validating response shape. | Medium-large. Needs new types, client, mapper, tests, dual-run comparison, and possible schema/logging adjustments. |
| Failure mode | Expensive, and may miss ATA-only transfer signatures in some cases. | Paid-plan gate, response-shape drift, pagination-token handling. | Under-counting value, double-counting intermediary rows, losing >1 year history, generating many rows per transaction, wrong cost basis for DeFi swaps. |

## Root Cause Of Current Credit Pain

The expensive part is not just "getting signatures"; it is fetching parsed transaction details for those signatures via `/v0/transactions`.

For a cold wallet capped at 4,000 signatures:

- Current detail fetch: about 40 `/v0/transactions` requests at 100 credits each = about 4,000 credits, before considering signature discovery and cache hits.
- `getTransfersByAddress`: about 10 credits per 100 transfer rows. If transfer-row count roughly equals transaction count, this is about 400 credits for 4,000 rows. If a wallet emits 2-5 transfer rows per transaction, savings shrink but can still be material. If every transfer row later needs full transaction fetching, savings disappear.

So the user's "10x cheaper" intuition is directionally correct only if we can avoid fetching full transaction payloads for most rows.

## Positives

- Big credit reduction for transfer-ledger ingestion if transfer rows can be mapped directly.
- Better owner-wallet token-account coverage than native `getSignaturesForAddress`.
- Server-side filters for mint, time, slot, direction, amount, counterparty.
- Built-in parsed Token-2022 fee fields.
- Built-in SOL/WSOL normalization controls.
- Cursor pagination is simpler than signature pagination for transfer rows.
- Good fit for wallet activity views, balance reconciliation, transfer history, and possibly raw inflow/outflow features.

## Risks And Possible Breakage

1. Full-history blocker
   - Docs say only the most recent 1 year of transfer history is available. Dashboard deep analysis currently treats deep as full-ish history up to signature caps, and many persisted projections assume history completeness matters.

2. Mapper contract mismatch
   - Current `SwapAnalysisInput` rows include `associatedSolValue`, `associatedUsdcValue`, `interactionType`, `feeAmount`, and `feePercentage`.
   - `getTransfersByAddress` has raw movement rows but not enough transaction context to reproduce all current mapper heuristics.

3. Swap economics can be wrong
   - A simple swap may be reconstructable by grouping transfer rows by signature.
   - Routed swaps, WSOL temporary accounts, intermediary accounts, and hidden balance-change-only SOL movements are explicitly risky.
   - Docs state intermediary flows are returned as underlying records, not reduced.

4. Row count can exceed transaction count
   - The endpoint returns transfer rows. A single transaction may return multiple rows. The 10 credits per 100 transfers is not the same as 10 credits per 100 transactions.

5. Existing cache model does not directly apply
   - `HeliusTransactionCache` is signature/timestamp oriented. A transfer-row pipeline needs either separate cache/projection or direct `SwapAnalysisInput` persistence with careful idempotency.

6. Cannot batch owner addresses
   - For favorites/import/background refresh across many wallets, this remains one wallet per request page.

7. Paid-plan operational gate
   - Local key returned 403. We cannot validate actual response shape or edge cases until a paid Developer-or-higher Helius key is available.

8. Layer ownership risk
   - Replacing wallet sync wholesale would introduce a second ingestion model unless it writes the same projection (`SwapAnalysisInput`) and respects current `WalletPreparationService` orchestration.

## Feasibility Verdict

Do not switch the canonical wallet-analysis ingestion fully to `getTransfersByAddress` yet.

It is very likely worth building a controlled prototype, but only as a behind-flag ingestion candidate that writes the existing `SwapAnalysisInput` projection and is compared against the current mapper on the same wallets.

Best near-term uses:

- Transfer-ledger features.
- Cheap pre-scan of recent wallet activity.
- Recent-history wallet flash/working analysis, if comparison proves acceptable.
- Supplemental ATA coverage for missed token-account transfers.

Poor fit as-is:

- Deep/full-history PnL where history older than 1 year matters.
- Exact swap cost basis for complex DeFi routes.
- Replacing the existing full enhanced transaction mapper without a validation phase.

## Minimal Adoption Plan

1. Add a tiny `getTransfersByAddress` client method behind `ENABLE_HELIUS_TRANSFERS_BY_ADDRESS`.
   - Keep it in `HeliusApiClient`.
   - Return typed transfer rows.
   - No pipeline behavior change.

2. Add a standalone comparison script.
   - Input: wallet, limit/window.
   - Fetch current enhanced transactions and new transfer rows for the same recent window.
   - Group transfers by signature.
   - Compare signature coverage, token movement, SOL/stable value recoverability, and generated `SwapAnalysisInput` equivalence.

3. Build a pure function mapper for transfer rows only if comparison is promising.
   - `mapHeliusTransfersToIntermediateRecords(walletAddress, transferRows)`.
   - No class.
   - Group by signature.
   - Start conservative: produce rows only where value attribution is unambiguous.
   - Mark/measure skipped ambiguous groups.

4. Dual-run in development.
   - For a fixed wallet set: simple swaps, Jupiter/Raydium users, WSOL-heavy wallets, high-frequency wallets, airdrop-heavy wallets, Token-2022 transfers, old wallets.
   - Compare PnL deltas and row deltas.

5. Only then consider routing flash/working sync through transfers.
   - Keep deep analysis on current full transaction path unless Helius changes retention or comparison proves 1-year history is acceptable for the requested scope.

## Architecture Re-Check

Minimality: the smallest safe next step is a client method plus comparison script, not replacing sync.

Layer ownership: transfer rows should feed the existing projection (`SwapAnalysisInput`) or a clearly separate transfer-ledger projection. They should not bypass `WalletPreparationService` or create a second analysis serving model.

Migration/backfill cost: full replacement would need backfill/reconciliation. A behind-flag prototype has no migration cost. A production switch would need strategy for older-than-1-year history and for existing wallets already synced with enhanced transactions.

## Required Before Final Decision

- Paid Helius Developer-or-higher API key available in local/prod env.
- Live sample shape captured for `getTransfersByAddress` across at least 10 representative wallets.
- Current-vs-new mapper comparison on persisted `SwapAnalysisInput` rows.
- Explicit acceptance threshold for PnL/volume/position deltas.

