# Realistic Plan: Evolving the Similarity Job for True Parallelism

This document outlines a realistic plan to refactor the existing `SimilarityOperationsProcessor`. The goal is to evolve the "Advanced Analysis" from a simple job that uses existing data into a true, deep analysis engine that intelligently runs operations in parallel to minimize user wait time.

## 1. The Goal (Corrected Understanding)

Our "Advanced Analysis" button in the Similarity Lab triggers a BullMQ job (`similarity-analysis-flow`). Currently, this job is fast because it only fetches current balances and uses whatever historical data is already in the database.

The goal is to make this job perform a **full historical data sync and analysis** *before* calculating similarity, but to do so efficiently by running independent I/O operations in parallel.

The correct, optimized workflow inside the `processSimilarityFlow` job is:
1.  **Parallel I/O Kick-off**: The job starts and immediately fires two independent, long-running network operations in parallel:
    *   **Operation A (The Deep Sync)**: A comprehensive, awaitable process that ensures each wallet's full transaction history is fetched (`HeliusSyncService`), and that PnL and Behavior stats are analyzed and stored in the database. This is the slowest part of the entire flow.
    *   **Operation B (The Broad Fetch)**: An I/O operation to fetch the current SPL token balances for all wallets using `WalletBalanceService`.
2.  **Synchronization Point**: The job waits for **both** Operation A and Operation B to complete. At this point, our database is guaranteed to be up-to-date, and we have the wallets' current holdings in memory.
3.  **Final Analysis & Enrichment**: With all data now present, the job performs its final step: running the core similarity calculation and enriching the balance data with metadata. This reuses the existing parallel logic.
    *   **Task C (Core Similarity Calculation)**: `similarityApiService.runAnalysis` is called, which now has access to the fresh historical data from Operation A and the balances from Operation B.
    *   **Task D (Token Enrichment)**: `enrichTokenMetadataInParallel` is called, using the balances from Operation B.
4.  **Completion**: The results from C and D are merged, and the job completes.

## 2. Realistic Implementation Plan

This plan modifies only the necessary components and reuses the maximum amount of existing, working code.

### Step 1: Granting Permissions for Deep Sync (Dependency Injection)

The `SimilarityOperationsProcessor` currently doesn't have the tools to perform a deep sync. We need to provide them via NestJS's dependency injection.

*   **File to Edit:** `src/queues/processors/similarity-operations.processor.ts`
*   **Action:** Inject the services required for the deep sync. `HeliusSyncService` and `HeliusApiClient` are globally available, but we'll need to explicitly inject the others and update their modules.

```typescript
// In src/queues/processors/similarity-operations.processor.ts constructor

// ... other services
import { HeliusSyncService } from '../../core/services/helius-sync-service';
import { PnlAnalysisService } from '../../api/pnl_analysis/pnl-analysis.service';
import { BehaviorService } from '../../api/wallets/behavior/behavior.service';

// ...
export class SimilarityOperationsProcessor {
  // ...
  constructor(
    // ... existing dependencies
    private readonly heliusSyncService: HeliusSyncService,
    private readonly pnlAnalysisService: PnlAnalysisService,
    private readonly behaviorService: BehaviorService,
  ) {
    // ...
  }
  // ...
}
```

*   **Supporting Action:** To make the services above injectable, we must ensure their parent modules export them and that `QueueModule` imports those modules. I will verify and perform these changes if needed in `pnl-analysis.module.ts`, `behavior.module.ts`, and `queue.module.ts`.

### Step 2: Creating the Deep Sync Orchestrator

We will create a new, private helper method inside `SimilarityOperationsProcessor` that is responsible for executing **Operation A**. This logic will be carefully adapted from the `triggerAnalyses` method in `analyses.controller.ts`, ensuring it is awaitable and reports progress.

*   **File to Edit:** `src/queues/processors/similarity-operations.processor.ts`
*   **Action:** Add a new private method `_orchestrateDeepSync`.

```typescript
// Add this new private method to SimilarityOperationsProcessor

private async _orchestrateDeepSync(walletAddresses: string[], job: Job): Promise<void> {
  this.logger.log(`Orchestrating deep sync for ${walletAddresses.length} wallets...`);
  // This part of the flow will account for up to 50% of the progress bar.
  const progressStep = 50 / walletAddresses.length;

  // We can process each wallet's full sync pipeline in parallel.
  await Promise.all(
    walletAddresses.map(async (walletAddress) => {
      try {
        const syncOptions = { fetchAll: true, smartFetch: true };
        await this.heliusSyncService.syncWalletData(walletAddress, syncOptions);

        const behaviorConfig = this.behaviorService.getDefaultBehaviorAnalysisConfig();
        // These can also run in parallel as they depend only on the sync
        await Promise.all([
            this.pnlAnalysisService.analyzeWalletPnl(walletAddress),
            this.behaviorService.getWalletBehavior(walletAddress, behaviorConfig),
        ]);

        // Increment progress safely after each wallet is fully processed
        await job.incrementProgress(progressStep);

      } catch (error) {
        this.logger.error(`Deep sync failed for wallet ${walletAddress}`, error);
        // We throw to ensure the entire job fails if one wallet cannot be synced,
        // guaranteeing data integrity for the final similarity analysis.
        throw new Error(`Failed to sync and analyze wallet: ${walletAddress}`);
      }
    })
  );

  this.logger.log('All wallets have completed the deep sync process.');
}
```

### Step 3: Rewiring `processSimilarityFlow` for True Parallelism

This is the core of the change. We will refactor the main process method to execute the new workflow, reusing the existing parallel logic for the final steps.

*   **File to Edit:** `src/queues/processors/similarity-operations.processor.ts`
*   **Action:** Replace the implementation of `processSimilarityFlow`.

```typescript
// This will be the new implementation of processSimilarityFlow

async processSimilarityFlow(job: Job<SimilarityAnalysisFlowData>): Promise<SimilarityFlowResult> {
  const { walletAddresses, requestId, failureThreshold = 0.8, timeoutMinutes = 30, similarityConfig } = job.data;
  
  // ... existing job ID check and lock acquisition ...

  try {
    this.logger.log(`Starting ADVANCED similarity analysis for ${walletAddresses.length} wallets.`);
    await job.updateProgress(5);

    // STEP 1: PARALLEL I/O KICK-OFF
    this.logger.log('Kicking off deep sync and balance fetch in parallel.');
    const [syncSettlement, balancesSettlement] = await Promise.allSettled([
      this._orchestrateDeepSync(walletAddresses, job), // Operation A
      this.walletBalanceService.fetchWalletBalances(walletAddresses) // Operation B
    ]);

    // Critical Path Failure Handling
    if (syncSettlement.status === 'rejected') {
      throw new Error(`Critical failure during historical sync: ${syncSettlement.reason}`);
    }
    if (balancesSettlement.status === 'rejected') {
      throw new Error(`Critical failure during balance fetching: ${balancesSettlement.reason}`);
    }
    const balancesMap = balancesSettlement.value;
    
    this.logger.log('Deep sync and balance fetch complete. DB is ready.');
    await job.updateProgress(60); // Progress checkpoint after the slowest parts

    // STEP 2: FINAL ANALYSIS & ENRICHMENT (Reusing existing parallel logic)
    this.logger.log('Starting final similarity calculation and enrichment...');
    const [similarityResult, enrichedBalances] = await Promise.allSettled([
      // Task C: Now uses the fresh data in the DB
      this.similarityApiService.runAnalysis({
        walletAddresses: walletAddresses,
        vectorType: similarityConfig?.vectorType || 'capital'
      }, balancesMap),
      
      // Task D: Reuses the exact same enrichment helper as before
      this.enrichTokenMetadataInParallel(balancesMap)
    ]);
    
    await job.updateProgress(90);

    // STEP 3: MERGE RESULTS (Reusing existing merge logic)
    let finalResult;
    // ... This logic for merging finalResult remains the same as before ...
    // ...

    await job.updateProgress(100);
    this.logger.log(`Advanced similarity analysis completed successfully in ${Date.now() - startTime}ms.`);
    return result;

  } catch (error) {
    // ... existing error handling ...
  } finally {
    // ... existing lock release ...
  }
}
```
This refactoring achieves the desired parallelism with minimal new code, by orchestrating our existing, powerful service components in a smarter sequence within the job processor.
