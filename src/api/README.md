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

The API layer is organized into a clean, modular structure:

- `controllers/`: Contains all API controllers that handle HTTP requests and responses.
- `services/`: Contains all business logic services used by controllers.
- `modules/`: Contains all NestJS modules that organize and configure the application.
- `integrations/`: Contains modules for external service integrations (Helius, Dexscreener, etc.).
- `shared/`: Contains common utilities, guards, decorators, pipes, filters, and DTOs used across the API.
- `wallet-balance/`: Contains wallet balance specific functionality.
- `README.md`: This file.

## Module Breakdown

### 1. Controllers (`src/api/controllers/`)
   - **Purpose**: Handle HTTP requests and responses for all API endpoints.
   - **Files**:
     - `analyses.controller.ts`: Handles wallet analysis triggers and operations.
     - `health.controller.ts`: Health check endpoints.
     - `jobs.controller.ts`: Job management and status endpoints.
     - `test.controller.ts`: Testing endpoints.
     - `token-info.controller.ts`: Token information endpoints.
     - `user-favorites.controller.ts`: User favorites management.
     - `users.controller.ts`: User management endpoints.
     - `wallets.controller.ts`: Wallet-specific data endpoints.

### 2. Services (`src/api/services/`)
   - **Purpose**: Contain business logic and data processing operations.
   - **Files**:
     - `balance-cache.service.ts`: Caching service for wallet balances.
     - `behavior.service.ts`: Behavioral analysis service.
     - `database.service.ts`: Database interaction service.
     - `dexscreener.service.ts`: Dexscreener API integration service.
     - `enrichment-strategy.service.ts`: Data enrichment strategies.
     - `jobs.service.ts`: Job management service.
     - `pnl-analysis.service.ts`: Profit & Loss analysis service.
     - `pnl-overview.service.ts`: P&L overview service.
     - `similarity.service.ts`: Similarity analysis service.
     - `token-info.service.ts`: Token information service.
     - `token-performance.service.ts`: Token performance analysis service.
     - `user-favorites.service.ts`: User favorites management service.

### 3. Modules (`src/api/modules/`)
   - **Purpose**: NestJS modules that organize and configure the application.
   - **Files**:
     - `analyses.module.ts`: Analysis operations module.
     - `auth.middleware.ts`: Authentication middleware.
     - `balance-cache.module.ts`: Balance caching module.
     - `behavior.module.ts`: Behavioral analysis module.
     - `database.module.ts`: Database module.
     - `health.module.ts`: Health check module.
     - `job-progress.gateway.ts`: WebSocket gateway for job progress.
     - `jobs.module.ts`: Job management module.
     - `pnl-analysis.module.ts`: P&L analysis module.
     - `pnl-overview.module.ts`: P&L overview module.
     - `similarity.module.ts`: Similarity analysis module.
     - `token-performance.module.ts`: Token performance module.
     - `users.module.ts`: User management module.
     - `wallets.module.ts`: Wallet operations module.
     - `websocket.module.ts`: WebSocket module.

### 4. Integrations (`src/api/integrations/`)
   - **Purpose**: External service integrations and their modules.
   - **Files**:
     - `dexscreener.module.ts`: Dexscreener API integration module.
     - `helius.module.ts`: Helius API integration module.
     - `token-info.module.ts`: Token information integration module.

### 5. Shared (`src/api/shared/`)
   - **Purpose**: Common utilities, guards, decorators, pipes, filters, and DTOs.
   - **Structure**:
     - `decorators/`: Custom decorators (e.g., `public.decorator.ts`).
     - `dto/`: Data Transfer Objects for request/response validation.
     - `guards/`: Authentication and authorization guards (e.g., `api-key-auth.guard.ts`).
     - `filters/`: Exception filters (e.g., `forbidden-exception.filter.ts`).
     - `pipes/`: Custom pipes (e.g., `solana-address.pipe.ts`).

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

### 2. `WalletsController`
   - **Module**: `WalletsModule`
   - **Base Route**: `/api/v1/wallets`
   - **Endpoints**: Various wallet-specific data endpoints for summaries, P&L, behavior analysis, token performance, and notes.

### 3. `UsersController`
   - **Module**: `UsersModule`
   - **Base Route**: `/api/v1/users`
   - **Endpoints**: User management and profile endpoints.

### 4. `JobsController`
   - **Module**: `JobsModule`
   - **Base Route**: `/api/v1/jobs`
   - **Endpoints**: Job status and management endpoints.

## Core Services (External to `src/api/` but used by it)

Many core business logic and data interaction services are defined in `src/core/`. The API modules are responsible for providing these core services to the API controllers using NestJS dependency injection.

- **`DatabaseService`** (`src/core/services/database-service.ts`): Manages all database interactions via Prisma.
- **`HeliusApiClient`** (`src/core/services/helius-api-client.ts`): Client for fetching data from the Helius API.
- **`HeliusSyncService`** (`src/core/services/helius-sync-service.ts`): Orchestrates data synchronization using `HeliusApiClient` and `DatabaseService`.
- **`PnlAnalysisService`** (`src/core/services/pnl-analysis-service.ts`): Calculates P&L and related statistics for wallets.
- **`BehaviorService`** (`src/core/analysis/behavior/behavior-service.ts`): Performs behavioral analysis on wallet activity.

## Key Benefits of the New Structure

1. **Separation of Concerns**: Controllers, services, and modules are clearly separated.
2. **Shared Resources**: Common utilities are centralized in the `shared/` directory.
3. **Integration Clarity**: External service integrations are isolated in their own directory.
4. **Maintainability**: Easier to locate and modify specific components.
5. **Scalability**: New features can be added following the established patterns.

This documentation should be kept up-to-date as the API evolves. 