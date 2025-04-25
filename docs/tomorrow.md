Initial Test Run & Verification (Small Scale):

Action: Run the helius-analyzer.ts script on the target wallet (EaVboaPxFCYanjoNWdkxTbPvt57nhXGu5i6m9m6ZS2kK or another problematic one) but use the --max-signatures (or --ms) option to limit the initial RPC fetch to a manageable number (e.g., --ms 5000 or --ms 10000). Keep the parse batch limit (-l) at the default (100).

Check:
Monitor the logs closely. Verify Phase 1 (RPC signature fetch) completes and reports fetching up to the limit set.
Verify Phase 2 (Helius parsing) processes the fetched signatures in batches. Note any errors or warnings, especially related to rate limits or missing transactions during the parsing step.
Check if the intermediate CSV (intermediate_swaps_...csv) is created/updated correctly in the ./data directory.
Check if the final analysis reports (_onchain_analysis.csv and .txt) are generated.

Review Helius Parsing Robustness:

Action: Re-examine the getTransactionsBySignatures function in src/services/helius-api-client.ts.
Check:
Confirm the batching logic (parseBatchLimit) and retry mechanism seem appropriate for potentially large signature lists.
Crucially: Re-check Helius documentation specifically for the /v0/transactions endpoint (the one used for parsing). Does it have specific rate limits or recommendations we need to adhere to more strictly than the generic MIN_REQUEST_INTERVAL we have? (We might need different delays or batch sizes for this endpoint compared to the RPC calls).

Review Mapping & Relevance Filtering:

Action: Examine mapHeliusTransactionsToIntermediateRecords in src/services/helius-transaction-mapper.ts and the final filtering step within getAllTransactionsForAddress in helius-api-client.ts.

Check:

How does the mapper currently identify relevant transfers (token/native)? Is it correctly handling different event types within a Helius transaction?
Is the final filter in getAllTransactionsForAddress (checking if fromUserAccount or toUserAccount matches the target wallet in tokenTransfers or nativeTransfers) the correct way to determine relevance for our PNL calculation? Could it be missing important interactions (e.g., interactions via specific program accounts where the wallet isn't directly the sender/receiver in the transfer event but is the authority/owner)?

Full Scale Test Run (If Step 1 Successful):

Action: Run the helius-analyzer.ts script without the --max-signatures limit. Let it attempt to fetch all 
signatures via RPC. Be prepared for this to take significantly longer.

Check:

Monitor logs for successful completion of both Phase 1 and Phase 2.
Note the total number of unique signatures fetched via RPC and the number processed by Helius.
Examine the final output reports (_onchain_analysis.csv / .txt). Do the numbers look plausible given the wallet's activity? Are tokens previously missing now showing up? Does the overall PNL seem directionally correct?

Refine Analysis Logic (If Needed):

Action: Based on the full run results, review analyzeSwapRecords in src/services/
transfer-analyzer-service.ts.

Check: With the complete dataset, does the logic for pairing buys/sells and calculating SOL PNL still hold up? Are there edge cases (like fees, complex swaps, non-swap SOL movements) that are now apparent and need handling?