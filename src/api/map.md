# Dependency Injection Map

This project uses NestJS modules and providers with the default singleton scope. Below is a concise map of modules, providers, factory tokens, and how dependencies are wired across the app.

## Overview

- App root: `src/app.module.ts` imports core feature and infrastructure modules and sets global guards.
- Config: `ConfigModule.forRoot({ isGlobal: true })` makes `ConfigService` available app‑wide.
- Global modules: `DatabaseModule`, `HeliusModule`, `AuthModule`, `CreditsModule`, `MetricsModule`, `QueueModule` export shared providers for use anywhere.
- Queues: `QueueModule` wires BullMQ queues, processors, Redis token, and monitoring services.

## Root Modules

- AppModule
  - imports: `SentryModule`, `MetricsModule`, `ScheduleModule`, `ThrottlerModule`, `ConfigModule`, `DatabaseModule` (Global), `HeliusModule` (Global), `AuthModule` (Global), `CreditsModule` (Global), `QueueModule`, `ApiModule`, `UsersModule`
  - providers (global guards): `APP_GUARD => CompositeAuthGuard`, `APP_GUARD => ThrottlerGuard`, `APP_GUARD => AdminGuard`, `APP_GUARD => CreditGuard`
  - interceptors: `APP_INTERCEPTOR => CreditInterceptor`

 - ApiModule
  - imports: `DatabaseModule`, `WalletsModule`, `AnalysesModule`, `UsersModule`, `DexscreenerModule`, `TokenInfoModule`, `HealthModule`, `JobsModule`, `WebSocketModule`, `HeliusWebhookModule`, `AdminModule`, `DiscoverModule`, `WalletHudModule`, `WalletHuntModule`, `PaymentModule`, `AuthModule`
  - controllers: `TestController`

## Global Modules (shared singletons)

- DatabaseModule (`@Global`)
  - provides/exports: `DatabaseService` (extends core `DatabaseService` for Nest DI)

- HeliusModule (`@Global`)
  - imports: `ConfigModule`, `DatabaseModule`
  - factory providers:
    - `HeliusApiClient`: needs `ConfigService`, `DatabaseService`
    - `SmartFetchService`: needs `WalletClassificationService`
    - `HeliusSyncService`: needs `DatabaseService`, `HeliusApiClient`, `SmartFetchService`
  - class providers: `WalletClassificationService`
  - exports: `HeliusApiClient`, `HeliusSyncService`, `SmartFetchService`, `WalletClassificationService`

- AuthModule (`@Global`)
  - imports: `ConfigModule`, `DatabaseModule`, `JwtModule`
  - providers/exports: `AuthService`, `JwtStrategy`, `ApiKeyStrategy`, `ApiKeyService`, `RegistrationCodeService`, `CsrfService`, `EmailService`, `SecurityLoggerService`

- CreditsModule (`@Global`)
  - imports: `DatabaseModule`
  - providers/exports: `CreditsService` (atomic topUp/deduct, append-only ledger)

- MetricsModule (`@Global`)
  - provides/exports: Prometheus metrics client

## Feature Modules

- UsersModule
  - imports: `DatabaseModule`
  - controllers: `UserFavoritesController`, `UsersController`
  - providers/exports: `UserFavoritesService`

- WalletsModule
  - imports: `DatabaseModule`, `PnlOverviewModule`, `BehaviorModule`, `TokenPerformanceModule`, `TokenInfoModule`, `DexscreenerModule`
  - controllers: `WalletsController`

- AnalysesModule
  - imports: `ConfigModule`, `DatabaseModule`, `PnlAnalysisModule`, `BehaviorModule`, `SimilarityModule`, `QueueModule`, `JobsModule`
  - controllers: `AnalysesController`
  - providers: `EnrichmentStrategyService`, `MintParticipantsService`

- AdminModule
  - imports: `DatabaseModule`, `AuthModule`
  - controllers: `AdminController`
  - uses: `ApiKeyService`, `RegistrationCodeService` from AuthModule

- TokenInfoModule
  - imports: `DatabaseModule`, `DexscreenerModule`, `HeliusModule`
  - controllers: `TokenInfoController`
  - providers/exports: `TokenInfoService`, `TokenHoldersService`

- DexscreenerModule
  - imports: `HttpModule`, `DatabaseModule`
  - providers/exports: `DexscreenerService`, `DexscreenerPriceProvider`, `IPriceProvider`

- PnlAnalysisModule
  - imports: `DatabaseModule`, `HeliusModule`, `TokenInfoModule`
  - providers/exports: `PnlAnalysisService`

- PnlOverviewModule
  - imports: `DatabaseModule`, `TokenInfoModule`, `HeliusModule`, `DexscreenerModule`
  - providers: `PnlOverviewService`, `PnlAnalysisService`
  - exports: `PnlOverviewService`

- BehaviorModule
  - imports: `DatabaseModule`
  - providers/exports: `BehaviorService`

- SimilarityModule
  - imports: `DatabaseModule`, `HeliusModule`, `TokenInfoModule`, `DexscreenerModule`, `BalanceCacheModule`
  - providers/exports: `SimilarityApiService`

- BalanceCacheModule
  - imports: `DatabaseModule`, `TokenInfoModule`
  - providers/exports: `BalanceCacheService`

- HealthModule
  - imports: `TerminusModule`, `DatabaseModule`, `QueueModule`
  - controllers: `HealthController`

- HeliusWebhookModule
  - imports: (uses globals)
  - controllers: `HeliusWebhookController`

- DiscoverModule
  - imports: `DatabaseModule`
  - controllers: `DiscoverController` (@Public endpoints)

- WalletHudModule
  - imports: `DatabaseModule`
  - controllers: `WalletHudController` (@Public endpoints)
  - providers: `WalletHudService`

- WalletHuntModule
  - imports: `DatabaseModule`, `ThrottlerModule`
  - controllers: `WalletHuntController`
  - providers: `WalletHuntService`, `WalletHuntValidationService`

- PaymentModule
  - imports: `DatabaseModule`, `CreditsModule`
  - controllers: `PaymentController`, `UserCreditsController`
  - providers: `PaymentService`

- WebSocketModule
  - imports: `RedisModule`
  - providers/exports: `JobProgressGateway`

## Queue/Infra Modules

- RedisModule
  - provider token: `REDIS_CLIENT` (IoRedis client) via `redisProvider`
  - exports: `REDIS_CLIENT`

- QueueModule (`@Global`)
  - imports: `ConfigModule`, `RedisModule`, `BullModule.forRootAsync(ConfigService)`, `HolderProfilesCacheModule`, `WalletHudModule`
  - queue services: `DashboardAnalysisQueue`, `PnlAnalysisQueue`, `BehaviorAnalysisQueue`, `SimilarityAnalysisQueue`, `HolderProfilesQueue`, `PaymentReconciliationQueue`
  - processors: `DashboardAnalysisProcessor`, `PnlAnalysisProcessor`, `BehaviorAnalysisProcessor`, `SimilarityAnalysisProcessor`, `HolderProfilesCacheProcessor`, `PaymentReconciliationProcessor`
  - core services: `RedisLockService`, `AlertingService`, `DeadLetterQueueService`, `QueueHealthService`, `JobPayloadCacheService`, `SystemWalletDetectionService`, `PaymentConfirmationService`
  - exports: all of above

## DI Tokens and Factories

- `REDIS_CLIENT`: IoRedis instance provided by `redisProvider`; injected into `RedisLockService`, `JobProgressGateway` (publisher), others via Nest `@Inject(REDIS_CLIENT)`.
- `HeliusApiClient`: created via factory using `ConfigService` (`HELIUS_API_KEY`) and `DatabaseService` in `HeliusModule`.
- `SmartFetchService`: factory depending on `WalletClassificationService` in `HeliusModule`.
- `HeliusSyncService`: factory depending on `DatabaseService`, `HeliusApiClient`, `SmartFetchService` in `HeliusModule`.

## Key Providers and Their Constructor Dependencies

- DatabaseService (Api)
  - extends core `DatabaseService`; no injected deps
  - provided by: `DatabaseModule`

- DexscreenerService
  - injects: `DatabaseService`, `HttpService`
  - provided by: `DexscreenerModule`
  - notes: wraps core `DexscreenerService` via manual instantiation

- TokenInfoService
  - injects: `DatabaseService`, `DexscreenerService`
  - provided by: `TokenInfoModule`

- PnlAnalysisService (Api wrapper)
  - injects: `DatabaseService`, `HeliusApiClient`, `TokenInfoService`
  - provided by: `PnlAnalysisModule`
  - notes: wraps core `PnlAnalysisService` via manual instantiation

- PnlOverviewService
  - injects: `PnlAnalysisService`, `TokenInfoService`, `DexscreenerService`
  - provided by: `PnlOverviewModule`

- BehaviorService (Api wrapper)
  - injects: `DatabaseService`
  - provided by: `BehaviorModule`
  - notes: instantiates core `BehaviorService` per call

- SimilarityApiService
  - injects: `DatabaseService`, `TokenInfoService`
  - provided by: `SimilarityModule`
  - notes: instantiates core `SimilarityService` per request

- BalanceCacheService
  - injects: `DatabaseService`, `HeliusApiClient`
  - provided by: `BalanceCacheModule`
  - notes: creates its own IoRedis client and core `WalletBalanceService`

- TokenPerformanceService
  - injects: `DatabaseService`, `TokenInfoService`, `DexscreenerService`
  - provided by: `TokenPerformanceModule`

- JobsService
  - injects: queues (DashboardAnalysisQueue, etc), `RedisLockService`, `DatabaseService`
  - provided by: `JobsModule`

- CreditsService
  - injects: `DatabaseService`
  - provided by: `CreditsModule`
  - notes: atomic topUp/deduct via Prisma $transaction; append-only ledger

- PaymentService
  - injects: `DatabaseService`, `CreditsService`
  - provided by: `PaymentModule`
  - notes: Solana Pay checkout, QR generation via qrcode library

- PaymentConfirmationService
  - injects: `DatabaseService`, `HeliusApiClient`, `CreditsService`, `JobProgressGateway`
  - provided by: `QueueModule`
  - notes: Helius webhook handler; verifies USDC payment + tops up credits

- PaymentReconciliationProcessor
  - injects: `DatabaseService`, `HeliusApiClient`, `CreditsService`
  - provided by: `QueueModule`
  - notes: BullMQ processor; runs @Cron('*/5 * * * *') to reconcile pending intents

- RedisLockService
  - injects: `REDIS_CLIENT`
  - provided by: `QueueModule`

- JobProgressGateway (WebSocket)
  - injects: `REDIS_CLIENT` (publisher); internally duplicates for a subscriber
  - provided by: `WebSocketModule`

- Processors (BullMQ Workers)
  - DashboardAnalysisProcessor: injects `RedisLockService`, `PnlAnalysisService`, `BehaviorService`, `DatabaseService`, `HeliusSyncService`, `JobProgressGateway`
  - SimilarityAnalysisProcessor: injects `RedisLockService`, `SimilarityApiService`, `DatabaseService`, `HeliusApiClient`, `TokenInfoService`, `HeliusSyncService`, `BalanceCacheService`, `JobProgressGateway`
  - HolderProfilesCacheProcessor: injects `DatabaseService`, `HeliusApiClient`, `WalletHudService`, `JobProgressGateway`
  - PaymentReconciliationProcessor: injects `DatabaseService`, `HeliusApiClient`, `CreditsService`

- AuthService
  - injects: `DatabaseService`, `JwtService`, `ConfigService`
  - provided by: `AuthModule`
  - notes: register, login, JWT refresh, email verification, password reset

- ApiKeyService
  - injects: `DatabaseService`, `ConfigService`
  - provided by: `AuthModule`
  - notes: create, list, revoke, update, delete API keys

- RegistrationCodeService
  - injects: `DatabaseService`, `ConfigService` (for Redis)
  - provided by: `AuthModule`
  - notes: code CRUD + kill-switch + requirement toggle (Redis-backed)

## Controllers and Injected Providers (high‑level)

- WalletsController
  - injects: `DatabaseService`, `BehaviorService`, `TokenPerformanceService`, `PnlOverviewService`, `TokenInfoService`, `WalletClassificationService`, `SmartFetchService`, `DexscreenerService`

- AnalysesController
  - injects: `DatabaseService`, queues, `EnrichmentStrategyService`, `RedisLockService`

- JobsController
  - injects: `JobsService`, `DeadLetterQueueService`

- TokenInfoController
  - injects: `TokenInfoService`

- HealthController
  - injects: `HealthCheckService`, `HttpHealthIndicator`, `DatabaseService`, `QueueHealthService`

- HeliusWebhookController
  - injects: `ConfigService`, queues

- AdminController
  - injects: `ApiKeyService`, `RegistrationCodeService`, `DatabaseService`

- AuthController
  - injects: `AuthService`, `AdminGuard`, `ConfigService`, `CsrfService`, `SecurityLoggerService`, `EmailService`, `RegistrationCodeService`

- PaymentController
  - injects: `PaymentService`, `CreditsService`

- UserCreditsController
  - injects: `CreditsService`

- DiscoverController (public)
  - injects: `DatabaseService`

- WalletHudController (public)
  - injects: `WalletHudService`

- WalletHuntController
  - injects: `WalletHuntService`, `DatabaseService`

## Guards, Interceptors, and Decorators

### Global Guards (in order)
- CompositeAuthGuard: routes JWT/API Key; allows `@Public()` decorator
- ThrottlerGuard: rate limiting (200 req/min default)
- AdminGuard: checks `User.isAdmin` flag for `@AdminOnly()` endpoints
- CreditGuard: pre-checks balance for `@RequireCredits(N)` endpoints; throws HTTP 402 if insufficient

### Global Interceptors
- CreditInterceptor: post-deducts credits on successful response (async, non-blocking)

### Custom Decorators
- `@Public()`: skip auth
- `@AdminOnly()`: require admin privileges
- `@RequireCredits(N)`: check/deduct credits
- `@AllowUnverifiedEmail()`: allow unverified email for specific auth routes

## Notes on Manual Instantiation

- Several wrappers instantiate core services directly instead of having them as Nest providers:
  - `DexscreenerService` -> new core `DexscreenerService`
  - `PnlAnalysisService` -> new core `PnlAnalysisService`
  - `BehaviorService` -> new core `BehaviorService` per call
  - `SimilarityApiService` -> new core `SimilarityService` per request
  - `BalanceCacheService` -> new core `WalletBalanceService`
- Queue services (`*.queue.ts`) and processors (`*.processor.ts`) create `Queue`/`Worker` instances in constructors; they are still Nest providers but the BullMQ objects themselves are not via Nest DI.

## Lifetimes and Scope

- All providers listed are singletons by default (no `scope` specified).
- `ConfigModule` is global; `DatabaseModule`, `HeliusModule`, `AuthModule`, `CreditsModule`, `MetricsModule` are global and export their providers to all other modules.

---

This map is sourced from the current code under `src/`, including modules in `src/api/**` and queues in `src/queues/**`.

## Visual Diagrams (Mermaid)

Below are Mermaid graphs you can view directly on GitHub or in editors that support Mermaid.

### Module Imports

```mermaid
graph TD
  %% Root
  AppModule --> ConfigModule
  AppModule --> ThrottlerModule
  AppModule --> ScheduleModule
  AppModule --> SentryModule
  AppModule --> DatabaseModule
  AppModule --> HeliusModule
  AppModule --> AuthModule
  AppModule --> CreditsModule
  AppModule --> MetricsModule
  AppModule --> QueueModule
  AppModule --> ApiModule
  AppModule --> UsersModule

  %% ApiModule imports
  ApiModule --> DatabaseModule
  ApiModule --> WalletsModule
  ApiModule --> AnalysesModule
  ApiModule --> UsersModule
  ApiModule --> DexscreenerModule
  ApiModule --> TokenInfoModule
  ApiModule --> HealthModule
  ApiModule --> JobsModule
  ApiModule --> WebSocketModule
  ApiModule --> HeliusWebhookModule
  ApiModule --> AdminModule
  ApiModule --> DiscoverModule
  ApiModule --> WalletHudModule
  ApiModule --> WalletHuntModule
  ApiModule --> PaymentModule

  %% Wallets
  WalletsModule --> DatabaseModule
  WalletsModule --> PnlOverviewModule
  WalletsModule --> BehaviorModule
  WalletsModule --> TokenPerformanceModule
  WalletsModule --> TokenInfoModule
  WalletsModule --> DexscreenerModule

  %% Analyses
  AnalysesModule --> ConfigModule
  AnalysesModule --> DatabaseModule
  AnalysesModule --> PnlAnalysisModule
  AnalysesModule --> BehaviorModule
  AnalysesModule --> SimilarityModule
  AnalysesModule --> QueueModule
  AnalysesModule --> JobsModule

  %% PnL Overview
  PnlOverviewModule --> DatabaseModule
  PnlOverviewModule --> TokenInfoModule
  PnlOverviewModule --> HeliusModule
  PnlOverviewModule --> DexscreenerModule

  %% Similarity
  SimilarityModule --> DatabaseModule
  SimilarityModule --> HeliusModule
  SimilarityModule --> TokenInfoModule
  SimilarityModule --> DexscreenerModule
  SimilarityModule --> BalanceCacheModule

  %% Pnl Analysis
  PnlAnalysisModule --> DatabaseModule
  PnlAnalysisModule --> HeliusModule
  PnlAnalysisModule --> TokenInfoModule

  %% Token info
  TokenInfoModule --> DatabaseModule
  TokenInfoModule --> DexscreenerModule
  TokenInfoModule --> HeliusModule

  %% Admin
  AdminModule --> DatabaseModule
  AdminModule --> AuthModule

  %% Discover
  DiscoverModule --> DatabaseModule

  %% Wallet HUD
  WalletHudModule --> DatabaseModule

  %% Wallet Hunt
  WalletHuntModule --> DatabaseModule
  WalletHuntModule --> ThrottlerModule

  %% Payment
  PaymentModule --> DatabaseModule
  PaymentModule --> CreditsModule

  %% WebSocket / Queue Infra
  WebSocketModule --> RedisModule
  QueueModule --> ConfigModule
  QueueModule --> RedisModule
  QueueModule --> DatabaseModule
  QueueModule --> HeliusModule
  QueueModule --> SimilarityModule
  QueueModule --> BehaviorModule
  QueueModule --> PnlAnalysisModule
  QueueModule --> TokenInfoModule
  QueueModule --> DexscreenerModule
  QueueModule --> WebSocketModule
  QueueModule --> BalanceCacheModule
  QueueModule --> HolderProfilesCacheModule
  QueueModule --> WalletHudModule
```

### Core Providers and Dependencies

```mermaid
graph LR
  %% Globals
  subgraph DatabaseModule
    DB[DatabaseService]
  end

  subgraph HeliusModule
    HClient[HeliusApiClient]
    WClass[WalletClassificationService]
    SFetch[SmartFetchService]
    HSync[HeliusSyncService]
  end

  subgraph AuthModule
    AuthS[AuthService]
    ApiKeyS[ApiKeyService]
    RegCodeS[RegistrationCodeService]
  end

  subgraph CreditsModule
    CredS[CreditsService]
  end

  Cfg[ConfigService]
  Http[HttpService]

  %% Helius factories
  HClient --> Cfg
  HClient --> DB
  SFetch --> WClass
  HSync --> DB
  HSync --> HClient
  HSync --> SFetch

  %% Auth
  AuthS --> DB
  AuthS --> Cfg
  ApiKeyS --> DB
  ApiKeyS --> Cfg
  RegCodeS --> DB
  RegCodeS --> Cfg

  %% Credits
  CredS --> DB

  %% Dexscreener
  subgraph DexscreenerModule
    DEX[DexscreenerService]
  end
  DEX --> DB
  DEX --> Http

  %% Token Info
  subgraph TokenInfoModule
    TInfo[TokenInfoService]
  end
  TInfo --> DB
  TInfo --> DEX

  %% PnL
  subgraph PnlAnalysisModule
    PnlA[PnlAnalysisService]
  end
  PnlA --> DB
  PnlA --> HClient
  PnlA --> TInfo

  subgraph PnlOverviewModule
    PnlO[PnlOverviewService]
  end
  PnlO --> PnlA
  PnlO --> TInfo
  PnlO --> DEX

  %% Behavior
  subgraph BehaviorModule
    Beh[BehaviorService]
  end
  Beh --> DB

  %% Similarity
  subgraph SimilarityModule
    SimAPI[SimilarityApiService]
  end
  SimAPI --> DB
  SimAPI --> TInfo

  %% Balance Cache
  subgraph BalanceCacheModule
    BCache[BalanceCacheService]
  end
  BCache --> DB
  BCache --> HClient

  %% Payments
  subgraph PaymentModule
    PayS[PaymentService]
  end
  PayS --> DB
  PayS --> CredS

  %% WebSocket / Redis
  subgraph RedisModule
    REDIS[REDIS_CLIENT]
  end
  subgraph WebSocketModule
    JGW[JobProgressGateway]
  end
  JGW --> REDIS

  %% Guards
  subgraph Guards
    Guard[CompositeAuthGuard]
    CreditG[CreditGuard]
    Refl[Reflector]
  end
  Guard --> DB
  Guard --> Cfg
  Guard --> Refl
  CreditG --> DB
  CreditG --> CredS
```

### Controllers and Injected Services

```mermaid
graph LR
  WCtrl[WalletsController] --> DB
  WCtrl --> Beh
  WCtrl --> TPerf[TokenPerformanceService]
  WCtrl --> PnlO
  WCtrl --> TInfo
  WCtrl --> WClass
  WCtrl --> SFetch
  WCtrl --> DEX

  ACtrl[AnalysesController] --> DB
  ACtrl --> SimilarityQ[SimilarityAnalysisQueue]
  ACtrl --> DashboardQ[DashboardAnalysisQueue]
  ACtrl --> EStrat[EnrichmentStrategyService]

  JCtrl[JobsController] --> JSvc[JobsService]
  JCtrl --> DLQ[DeadLetterQueueService]

  TICtrl[TokenInfoController] --> TInfo
  HCtrl[HealthController] --> HCS[HealthCheckService]
  HCtrl --> HH[HttpHealthIndicator]
  HCtrl --> DB
  HCtrl --> QHS[QueueHealthService]

  Webhook[HeliusWebhookController] --> Cfg
  Webhook --> PaymentRecQ[PaymentReconciliationQueue]

  AdminCtrl[AdminController] --> DB
  AdminCtrl --> ApiKeyS
  AdminCtrl --> RegCodeS

  AuthCtrl[AuthController] --> AuthS
  AuthCtrl --> RegCodeS
  AuthCtrl --> CsrfS[CsrfService]

  PayCtrl[PaymentController] --> PayS
  PayCtrl --> CredS

  DiscCtrl[DiscoverController] --> DB

  HudCtrl[WalletHudController] --> HudS[WalletHudService]

  HuntCtrl[WalletHuntController] --> HuntS[WalletHuntService]
```

### Queues, Processors, and Tokens

```mermaid
graph LR
  subgraph QueueModule
    RLock[RedisLockService]
    Alert[AlertingService]
    DLQ[DeadLetterQueueService]
    QHS[QueueHealthService]
    JobCache[JobPayloadCacheService]
    SysWallet[SystemWalletDetectionService]
    PaymentConfirm[PaymentConfirmationService]

    DashQ[DashboardAnalysisQueue]
    PnlQ[PnlAnalysisQueue]
    BehQ[BehaviorAnalysisQueue]
    SimilQ[SimilarityAnalysisQueue]
    HolderQ[HolderProfilesQueue]
    PaymentRecQ[PaymentReconciliationQueue]

    DashP[DashboardAnalysisProcessor]
    PnlP[PnlAnalysisProcessor]
    BehP[BehaviorAnalysisProcessor]
    SimilP[SimilarityAnalysisProcessor]
    HolderP[HolderProfilesCacheProcessor]
    PaymentRecP[PaymentReconciliationProcessor]
  end

  REDIS --> RLock
  REDIS --> JGW

  %% Processor injections
  DashP --> RLock
  DashP --> PnlA
  DashP --> Beh
  DashP --> DB
  DashP --> HSync
  DashP --> JGW

  SimilP --> RLock
  SimilP --> SimAPI
  SimilP --> DB
  SimilP --> HClient
  SimilP --> TInfo
  SimilP --> HSync
  SimilP --> BCache
  SimilP --> JGW

  HolderP --> RLock
  HolderP --> DB
  HolderP --> HClient
  HolderP --> HudS
  HolderP --> JGW

  PaymentRecP --> RLock
  PaymentRecP --> DB
  PaymentRecP --> HClient
  PaymentRecP --> CredS
```

---

**Last Updated**: 2026-02-24
**All modules and providers current through PAY-1/PAY-2 complete**
