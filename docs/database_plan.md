**Plan Document: Helius Analyzer Database Integration Strategy**

**1. Goals:**

*   Replace current file-based storage (JSON cache, CSV intermediate/results, TXT summary) with a structured database.
*   Improve performance and scalability for handling large transaction histories (10k+ signatures) and potentially multiple wallets.
*   Enable robust, on-demand analysis of historical data (including specific time ranges) stored in the database.
*   Provide a clean data foundation for potential future dashboards or APIs.
*   Implement efficient incremental fetching to only retrieve *new* transactions since the last run.
*   Increase overall application robustness and maintainability using modern tools (Prisma).

**2. Core Approach:**

*   **Database System:** Utilize **SQLite** initially for simplicity and file-based portability.
*   **ORM:** Employ **Prisma** for type safety, migrations, developer experience, and easier future database migration.
*   **Phased Integration:** Introduce the database incrementally.

**3. Proposed Database Schema (`prisma/schema.prisma`):**

*   **`Wallet`**: Stores metadata for each analyzed wallet, crucial for incremental fetching.
    ```prisma
    model Wallet {
      address                   String    @id @unique // Solana wallet address
      // Oldest transaction timestamp ever processed for this wallet
      firstProcessedTimestamp   Int?
      // Signature of the absolute newest transaction processed for this wallet
      newestProcessedSignature  String?
      // Timestamp of the absolute newest transaction processed for this wallet
      newestProcessedTimestamp  Int?
      // Timestamp of the last time a fetch was successfully run for this wallet
      lastSuccessfulFetchTimestamp DateTime?
    }
    ```
    *   *Purpose:* Central point for wallet info. `newestProcessedSignature` & `newestProcessedTimestamp` mark the boundary for incremental updates (fetch latest, stop when this is seen). `firstProcessedTimestamp` tracks the beginning of the analyzed history.

*   **`HeliusTransactionCache`**: Stores raw Helius transaction details.
    ```prisma
    model HeliusTransactionCache {
      signature   String   @id @unique
      timestamp   Int      
      rawData     Json     
      fetchedAt   DateTime @default(now())

      @@index([timestamp])
    }
    ```
    *   *Purpose:* Avoid re-fetching details. Fast lookups by `signature`.

*   **`SwapAnalysisInput`**: Stores mapped transfers used as input for analysis.
    ```prisma
    model SwapAnalysisInput {
      id            Int      @id @default(autoincrement())
      walletAddress String   
      signature     String   
      timestamp     Int      // Unix seconds
      mint          String   // Token mint address (SOL_MINT for SOL)
      amount        Float    // Decimal-adjusted amount
      direction     String   // "in" or "out" relative to walletAddress

      // Indices for efficient querying by wallet, time, token, or signature
      @@index([walletAddress, timestamp])
      @@index([walletAddress, mint])
      @@index([signature])
    }
    ```
    *   *Purpose:* Input for `analyzeSwapRecords`. Indexed for efficient on-demand analysis filtering (by wallet, time range, token).

*   **`AnalysisRun`**: Tracks metadata for each analysis execution.
    ```prisma
    model AnalysisRun {
      id                   Int       @id @default(autoincrement())
      walletAddress        String
      runTimestamp         DateTime  @default(now())
      status               String    // e.g., 'completed', 'failed', 'in_progress'
      // Time range covered by this specific analysis run
      analysisStartTs      Int?      
      analysisEndTs        Int?
      signaturesProcessed  Int?      
      errorMessage         String?   

      results              AnalysisResult[]
      advancedStats        AdvancedStatsResult?

      @@index([walletAddress, runTimestamp])
    }
    ```
    *   *Purpose:* Provides history and context for stored results. `analysisStartTs`/`analysisEndTs` record the time window analyzed.

*   **`AnalysisResult`**: Stores calculated per-token results for an `AnalysisRun`.
    ```prisma
    model AnalysisResult {
      id                     Int      @id @default(autoincrement())
      runId                  Int      
      tokenAddress           String
      totalAmountIn          Float
      totalAmountOut         Float
      netAmountChange        Float
      totalSolSpent          Float
      totalSolReceived       Float
      netSolProfitLoss       Float
      transferCountIn        Int
      transferCountOut       Int
      firstTransferTimestamp Int?
      lastTransferTimestamp  Int?

      run                    AnalysisRun @relation(fields: [runId], references: [id], onDelete: Cascade)

      @@index([runId])
      @@index([runId, tokenAddress])
      @@index([runId, netSolProfitLoss])
    }
    ```
    *   *Purpose:* Stores detailed outcomes per token, linked to a specific run.

*   **`AdvancedStatsResult`**: Stores calculated advanced metrics for an `AnalysisRun`.
    ```prisma
    model AdvancedStatsResult {
      id                           Int     @id @default(autoincrement())
      runId                        Int     @unique 
      medianPnlPerToken            Float
      trimmedMeanPnlPerToken       Float
      tokenWinRatePercent          Float
      standardDeviationPnl         Float
      profitConsistencyIndex       Float
      weightedEfficiencyScore      Float
      averagePnlPerDayActiveApprox Float

      run                          AnalysisRun @relation(fields: [runId], references: [id], onDelete: Cascade)
    }
    ```
    *   *Purpose:* Stores summary metrics, linked to a specific run.

**4. Smart Implementation & Integration Strategy:**

1.  **Setup Prisma:** Install, `init` with SQLite, define schema above.
2.  **Initial Migration:** `npx prisma migrate dev --name init`, `npx prisma generate`.
3.  **Create `DatabaseService`:** Instantiate `PrismaClient`, implement CRUD functions for models using Prisma methods.
4.  **Integrate Caching:** Replace `HeliusApiClient` file I/O with `DatabaseService` calls for cache operations.
5.  **Integrate Fetch Logic (Incremental Fetching - Corrected):**
    *   Before fetching, call `DatabaseService.getWallet(walletAddress)` to retrieve `newestProcessedSignature` and `newestProcessedTimestamp`.
    *   Fetch the *latest* batch of signatures using `getSignaturesForAddress` *without* the `before` parameter.
    *   Begin processing this batch (fetch details via cache/API, map to `SwapAnalysisInput`, save inputs). Assume transactions in the batch are ordered newest to oldest.
    *   For each transaction processed, compare its signature to the retrieved `newestProcessedSignature`.
    *   **If a match is found**, stop processing further transactions in this batch and consider the incremental update complete for this run. Do not fetch older batches.
    *   **If the entire first batch is processed without a match** (i.e., all transactions are newer than `newestProcessedSignature`), this means there might be more new transactions than fit in one batch. *(Optional advanced strategy: Fetch the next older batch using `before` with the signature of the last item in the current batch, and repeat the process until the `newestProcessedSignature` is found or no more transactions are returned. Initial implementation can just process the first batch).*.
    *   After processing stops, identify the `signature` and `timestamp` of the **most recent transaction successfully processed in this specific run**.
    *   Call `DatabaseService.updateWallet(walletAddress, { newestProcessedSignature: ..., newestProcessedTimestamp: ..., lastSuccessfulFetchTimestamp: new Date(), firstProcessedTimestamp: ... })` to update the wallet's marker. Update `firstProcessedTimestamp` only if necessary (e.g., first run).
6.  **Integrate Intermediate Storage:**
    *   After mapping, call `DatabaseService.saveSwapAnalysisInputs`. Remove intermediate CSV writing.
    *   Modify `--skipApi` logic to use `DatabaseService.getSwapAnalysisInputs(walletAddress)`.
7.  **Integrate Results Storage & Reporting:**
    *   After analysis is complete:
        *   Call `DatabaseService.createAnalysisRun` (recording status, wallet, analysis time range, etc.).
        *   Call `DatabaseService.saveAnalysisResults` and `DatabaseService.saveAdvancedStats`, linking them to the `runId`.
    *   **Reporting/Export:** Create separate functions (e.g., `generateTxtReport(runId)`, `exportResultsToCsv(runId)`) that *query* the `AnalysisResult` and `AdvancedStatsResult` tables for a specific `runId` and format the data. The main analysis script no longer needs to write these files directly.
8.  **Enable On-Demand Analysis (Decoupling - Crucial Step):**
    *   Create a function `performAnalysisForWallet(walletAddress: string, timeRange?: { startTs?: number, endTs?: number }) : Promise<SwapAnalysisSummary>`.
    *   This function queries `DatabaseService.getSwapAnalysisInputs(walletAddress, { after: timeRange?.startTs, before: timeRange?.endTs })`.
    *   It runs the *existing* analysis logic (`analyzeSwapRecords`, `calculateAdvancedStats`) on the retrieved records.
    *   It returns the calculated `SwapAnalysisSummary` (results + advanced stats).
    *   **Dual Use:**
        *   The main script (`helius-analyzer.ts`) will call this function *without* a time range after fetching/saving new data to get the *latest full analysis*. It will then save *this* result using the `DatabaseService` (step 7).
        *   This function can *also* be called independently (e.g., by a future API or CLI command) with a specific `timeRange` to perform historical analysis on demand, without necessarily saving the results.

**5. Future Considerations:**

*   Job Queue, API/UI, Database Scaling (Postgres), Advanced Spam Filtering (e.g., `SpamToken` table). 