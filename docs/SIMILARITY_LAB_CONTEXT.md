# Similarity Lab Context

This document provides a high-level overview of the "Similarity Lab" feature, which focuses on on-demand, multi-wallet analysis. It serves as a living document to provide context for development sessions.

## 1. Feature Overview

The Similarity Lab is a web-based UI within the application that allows a user to analyze a group of Solana wallets to discover hidden connections and behavioral similarities. Unlike the single-wallet PNL and behavior analysis, this tool is designed for comparative analysis across multiple addresses.

The core user flow involves:
1.  Providing a list of wallet addresses.
2.  Checking which wallets are already indexed in the database.
3.  For any wallets not present, triggering a background sync and analysis job.
4.  Polling for the completion of these sync jobs.
5.  Once all wallets are ready, running the final similarity analysis and displaying the results.

## 2. Architecture & Key Components

The feature is split between the `dashboard` (Next.js frontend) and the `src/api` (NestJS backend).

### Frontend (`dashboard/`)

| File Path                                                               | Role                                                                                                                                                               |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dashboard/src/app/similarity-lab/page.tsx`                               | **Entrypoint & UI Orchestrator**. Manages user input, state (loading, errors, results), and orchestrates the entire multi-step analysis flow from the client-side.     |
| `dashboard/src/components/similarity-lab/results/SimilarityResultDisplay.tsx` | **Results Rendering**. A dedicated component to display the final analysis results in a structured and digestible format.                                        |
| `dashboard/src/components/similarity-lab/results/types.ts`                  | **Frontend Data Types**. Defines the TypeScript types for the analysis results (`CombinedSimilarityResult`, `PairwiseSimilarity`, etc.) used to render the data.     |
| `dashboard/src/components/similarity-lab/SyncConfirmationDialog.tsx`        | **UX Component**. A modal dialog to inform the user about missing wallets and ask for confirmation before triggering the background sync and analysis process.      |
| `dashboard/src/lib/fetcher.ts`                                            | **API Client**. A wrapper around `fetch` used by the frontend to make requests to the backend API.                                                                 |

### Backend (`src/`)

| File Path                                 | Role                                                                                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/api/analyses/analyses.controller.ts` | **API Endpoint Layer**. Exposes the REST API endpoints (`/similarity`, `/wallets/status`, `/wallets/trigger-analysis`) that the frontend interacts with.                                 |
| `src/api/analyses/similarity/similarity.service.ts` | **Orchestration Service**. This service is responsible for orchestrating the similarity analysis. It likely gathers the required data from the database and invokes the core analyzer. |
| `src/core/analysis/similarity/analyzer.ts` | **Core Logic (Assumption)**. Analogous to `CorrelationAnalyzer`, this is presumed to contain the core algorithms for calculating similarity scores, pairs, and clusters.                   |
| `src/core/services/helius-sync-service.ts` | **Data Ingestion**. A crucial service called by the `/trigger-analysis` endpoint to fetch and store transaction data for wallets that are not yet in the database.                    |
| `src/api/database/database.service.ts`    | **Database Abstraction**. Provides methods for interacting with the database, such as `getWalletsStatus` and fetching the underlying data needed for analysis.                               |

## 3. API Endpoints

The following endpoints in `analyses.controller.ts` support the Similarity Lab flow:

-   `POST /analyses/wallets/status`
    -   **Request Body**: `{ walletAddresses: string[] }`
    -   **Response Body**: `{ statuses: { walletAddress: string; exists: boolean; }[] }`
    -   **Purpose**: Checks which of the provided wallets already exist in the database.

-   `POST /analyses/wallets/trigger-analysis`
    -   **Request Body**: `{ walletAddresses: string[] }`
    -   **Response Body**: `{ message: string; triggeredAnalyses: string[]; skippedAnalyses: string[] }`
    -   **Purpose**: Triggers a background job to sync data for the given wallets. It runs analysis (Helius sync, PNL, Behavior) and does not block.

-   `POST /analyses/similarity`
    -   **Request Body**: `{ walletAddresses: string[] }`
    -   **Response Body**: `CombinedSimilarityResult` (structure defined in frontend types)
    -   **Purpose**: Executes the final similarity analysis on a set of wallets that are confirmed to exist in the database and returns the detailed results. 