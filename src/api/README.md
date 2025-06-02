# API Layer Documentation

This document provides an overview of the API layer for the Wallet Analysis System.

## General Overview

The API layer exposes functionalities of the wallet analysis system to client applications (e.g., dashboards). It follows RESTful principles and is built using NestJS.

## Common Conventions

- **Base Path**: All API endpoints are prefixed with `/api/v1/`.
- **Authentication**: Secured endpoints require an `X-API-Key` header for authentication. User and activity logging are tied to this key.
- **DTOs (Data Transfer Objects)**: Request bodies and response payloads should ideally be validated using DTOs defined with NestJS pipes and class-validator decorators (though not all may be explicitly shown in this initial documentation).
- **Error Handling**: Standard HTTP status codes are used. Errors typically return a JSON object with `statusCode`, `message`, and optionally `error` details.

## Directory Structure (`src/api/`)

- `analyses/`: Contains modules and controllers for triggering wallet fetching and analysis processes.
- `database/`: Houses the `DatabaseModule`, responsible for providing `DatabaseService` to other API modules.
- `helius/`: Contains the `HeliusModule`, responsible for providing Helius-related services like `HeliusSyncService`.
- `wallets/`: Contains modules and controllers for fetching wallet-specific information. This is typically broken down further by data type or feature:
    - `behavior/`: For behavioral analysis data.
    - `notes/`: For user-specific notes on wallets.
    - `pnl_overview/`: For P&L (Profit and Loss) overview data.
    - `summary/`: For general wallet summary information.
    - `token_performance/`: For detailed token performance metrics.
- `README.md`: This file.

## Module Breakdown

### 1. `AnalysesModule`
   - **Location**: `src/api/analyses/analyses.module.ts`
   - **Purpose**: To provide endpoints for triggering synchronization and comprehensive analysis of wallets.
   - **Controllers**:
     - `AnalysesController`
   - **Key Dependencies (Imports)**:
     - `DatabaseModule`: To access `DatabaseService`.
     - `HeliusModule`: To access `HeliusSyncService`.
     - `PnlOverviewModule`: Expected to provide `PnlAnalysisService`.
     - `BehaviorModule`: Expected to provide `BehaviorService`.

### 2. `HeliusModule`
   - **Location**: `src/api/helius/helius.module.ts`
   - **Purpose**: To manage Helius-related services, primarily data synchronization.
   - **Services Provided/Exported**:
     - `HeliusSyncService`: Orchestrates fetching transaction data from the Helius API and caching it.
   - **Internal Providers**:
     - `HeliusApiClient`: A client to interact with the Helius API, configured with the API key.
   - **Key Dependencies (Imports)**:
     - `ConfigModule`: To access environment variables (e.g., `HELIUS_API_KEY`).
     - `DatabaseModule`: To provide `DatabaseService` to `HeliusApiClient` and `HeliusSyncService`.

### 3. `DatabaseModule`
   - **Location**: `src/api/database/database.module.ts` (Path inferred from usage)
   - **Purpose**: To provide and export `DatabaseService` for other API modules to interact with the database.
   - **Services Provided/Exported**:
     - `DatabaseService` (from `src/core/services/database-service.ts`)
   - **Note**: This module centralizes access to the `DatabaseService` for the API layer.

### 4. Wallet-Specific Modules (under `src/api/wallets/`)

   General pattern: Each feature under `/wallets/{walletAddress}/<feature>` will have its own module and controller.

   - **`PnlOverviewModule`** (Example)
     - **Location**: `src/api/wallets/pnl_overview/pnl-overview.module.ts` (Path inferred)
     - **Purpose**: To provide P&L related data for a wallet.
     - **Expected Services Provided/Exported**: `PnlAnalysisService` (from `src/core/services/pnl-analysis-service.ts`). This service is crucial for the `AnalysesController`.
     - **Controllers**: Likely a `PnlOverviewController` exposing `GET /wallets/{walletAddress}/pnl-overview`.

   - **`BehaviorModule`** (Example)
     - **Location**: `src/api/wallets/behavior/behavior.module.ts` (Path inferred)
     - **Purpose**: To provide behavioral analysis data for a wallet.
     - **Expected Services Provided/Exported**: `BehaviorService` (from `src/core/analysis/behavior/behavior-service.ts`). This service is crucial for the `AnalysesController`.
     - **Controllers**: Likely a `BehaviorController` exposing `GET /wallets/{walletAddress}/behavior-analysis`.

   - **Other Wallet Modules** (`SummaryModule`, `TokenPerformanceModule`, `NotesModule`):
     - Follow a similar pattern, providing controllers and services for their specific data domains.
     - `WalletsModule` (`src/api/wallets/wallets.module.ts`) likely acts as an aggregator, importing these feature-specific modules.

## Controller Breakdown

### 1. `AnalysesController`
   - **Module**: `AnalysesModule`
   - **Base Route**: `/api/v1/analyses`
   - **Endpoints**:
     - **`POST /wallets/{walletAddress}/trigger-analysis`**
       - **Description**: Synchronously triggers a full data synchronization and re-analysis (PNL and Behavior) for the specified wallet. New wallets are onboarded, existing wallets are updated.
       - **Request Parameters**: `walletAddress` (path parameter).
       - **Core Services Used**:
         - `DatabaseService`: To fetch initial and current wallet state.
         - `HeliusSyncService`: To synchronize transaction data.
         - `PnlAnalysisService`: To perform PNL analysis.
         - `BehaviorService`: To perform behavioral analysis.
       - **Response**: `201 Created` on success with a confirmation message.

## Core Services (External to `src/api/` but used by it)

Many core business logic and data interaction services are defined in `src/core/`. The API modules (like `HeliusModule`, `DatabaseModule`, or feature modules under `wallets/`) are responsible for providing these core services to the API controllers using NestJS dependency injection.

- **`DatabaseService`** (`src/core/services/database-service.ts`): Manages all database interactions via Prisma.
- **`HeliusApiClient`** (`src/core/services/helius-api-client.ts`): Client for fetching data from the Helius API.
- **`HeliusSyncService`** (`src/core/services/helius-sync-service.ts`): Orchestrates data synchronization using `HeliusApiClient` and `DatabaseService`.
- **`PnlAnalysisService`** (`src/core/services/pnl-analysis-service.ts`): Calculates P&L and related statistics for wallets.
- **`BehaviorService`** (`src/core/analysis/behavior/behavior-service.ts`): Performs behavioral analysis on wallet activity.

This documentation should be kept up-to-date as the API evolves. 