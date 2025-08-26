# 🌐 Backend API Layer - Deep Dive

## 🎯 Overview

The Backend API Layer provides a **RESTful interface** to the Wallet Analysis System, built with **NestJS** and **TypeScript**. It exposes analysis capabilities, manages user authentication, and handles background job processing through **WebSocket connections**. This layer acts as the bridge between the core analysis engine and client applications (dashboard, mobile apps, third-party integrations).

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        API LAYER                               │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   Controllers   │  │   Middleware    │  │     Guards      │  │
│  │                 │  │                 │  │                 │  │
│  │ • Wallet        │  │ • CORS          │  │ • API Key Auth  │  │
│  │ • Analysis      │  │ • Rate Limiting │  │ • Role-based    │  │
│  │ • User          │  │ • Logging       │  │   Access        │  │
│  │ • Jobs          │  │ • Error         │  │ • IP Whitelist  │  │
│  │ • Health        │  │   Handling      │  │                 │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │    Services     │  │   Modules       │  │  Integrations   │  │
│  │                 │  │                 │  │                 │  │
│  │ • Business      │  │ • NestJS        │  │ • Helius API    │  │
│  │   Logic         │  │   Modules       │  │ • DexScreener   │  │
│  │ • Data          │  │ • Dependency    │  │ • Token Info    │  │
│  │   Processing    │  │   Injection     │  │ • WebSocket     │  │
│  │ • Caching       │  │ • Configuration │  │   Gateway       │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 📁 Directory Structure

```
src/api/
├── controllers/                 # HTTP request handlers
│   ├── analyses.controller.ts   # Analysis triggers & operations
│   ├── health.controller.ts     # Health check endpoints
│   ├── jobs.controller.ts       # Job management & status
│   ├── test.controller.ts       # Testing endpoints
│   ├── token-info.controller.ts # Token information
│   ├── user-favorites.controller.ts # User favorites
│   ├── users.controller.ts      # User management
│   └── wallets.controller.ts    # Wallet-specific data
├── services/                    # Business logic layer
│   ├── balance-cache.service.ts # Wallet balance caching
│   ├── behavior.service.ts      # Behavioral analysis
│   ├── database.service.ts      # Database operations
│   ├── dexscreener.service.ts   # DexScreener integration
│   ├── enrichment-strategy.service.ts # Data enrichment
│   ├── jobs.service.ts          # Job management
│   ├── pnl-analysis.service.ts  # P&L analysis
│   ├── pnl-overview.service.ts  # P&L overview
│   ├── similarity.service.ts    # Similarity analysis
│   ├── token-info.service.ts    # Token information
│   ├── token-performance.service.ts # Token performance
│   └── user-favorites.service.ts # User favorites
├── modules/                     # NestJS module organization
│   ├── analyses.module.ts       # Analysis operations
│   ├── auth.middleware.ts       # Authentication middleware
│   ├── balance-cache.module.ts  # Balance caching
│   ├── behavior.module.ts       # Behavioral analysis
│   ├── database.module.ts       # Database operations
│   ├── health.module.ts         # Health checks
│   ├── job-progress.gateway.ts  # WebSocket gateway
│   ├── jobs.module.ts           # Job management
│   ├── pnl-analysis.module.ts   # P&L analysis
│   ├── pnl-overview.module.ts   # P&L overview
│   ├── similarity.module.ts     # Similarity analysis
│   ├── token-performance.module.ts # Token performance
│   ├── users.module.ts          # User management
│   ├── wallets.module.ts        # Wallet operations
│   └── websocket.module.ts      # WebSocket handling
├── integrations/                # External service integrations
│   ├── dexscreener.module.ts    # DexScreener API
│   ├── helius.module.ts         # Helius API
│   └── token-info.module.ts     # Token information
├── shared/                      # Common utilities & components
│   ├── decorators/              # Custom decorators
│   │   └── public.decorator.ts  # Public endpoint marker
│   ├── dto/                     # Data Transfer Objects
│   │   ├── behavior-analysis-query.dto.ts
│   │   ├── behavior-analysis-response.dto.ts
│   │   ├── create-note.dto.ts
│   │   ├── pnl-analysis-query.dto.ts
│   │   ├── pnl-analysis-response.dto.ts
│   │   ├── similarity-analysis-query.dto.ts
│   │   ├── similarity-analysis-response.dto.ts
│   │   ├── token-performance-query.dto.ts
│   │   ├── token-performance-response.dto.ts
│   │   ├── update-user.dto.ts
│   │   ├── user-favorites.dto.ts
│   │   ├── wallet-analysis-query.dto.ts
│   │   ├── wallet-analysis-response.dto.ts
│   │   ├── wallet-note.dto.ts
│   │   ├── wallet-overview.dto.ts
│   │   ├── wallet-pnl.dto.ts
│   │   └── wallet-similarity.dto.ts
│   ├── guards/                  # Authentication & authorization
│   │   ├── api-key-auth.guard.ts # API key authentication
│   │   └── auth.middleware.ts   # Authentication middleware
│   ├── filters/                 # Exception handling
│   │   └── forbidden-exception.filter.ts
│   └── pipes/                   # Data validation & transformation
│       └── solana-address.pipe.ts # Solana address validation
├── API_DOCUMENTATION.md         # API endpoint documentation
└── README.md                    # This file
```

## 🔐 **Authentication & Security**

### **API Key Authentication**
- **Header**: `X-API-Key: your_api_key_here`
- **Guard**: `ApiKeyAuthGuard` validates API keys against database
- **Middleware**: `AuthMiddleware` logs user activity and validates keys
- **Public Endpoints**: Marked with `@Public()` decorator (health checks, etc.)

### **Security Features**
- **Rate Limiting**: Prevents API abuse
- **CORS Configuration**: Configurable cross-origin resource sharing
- **Input Validation**: DTOs with class-validator decorators
- **SQL Injection Protection**: Prisma ORM with parameterized queries
- **XSS Protection**: Input sanitization and output encoding

## 🚀 **Core Controllers Deep Dive**

### **1. Analyses Controller** (`/api/v1/analyses`)

#### **Purpose**
Orchestrates wallet analysis operations, including data synchronization, behavioral analysis, and P&L calculations.

#### **Key Endpoints**

##### **POST `/wallets/{walletAddress}/trigger-analysis`**
```typescript
// Triggers comprehensive wallet analysis
POST /api/v1/analyses/wallets/{walletAddress}/trigger-analysis

// Request
{
  "forceRefresh": boolean,        // Force data refresh
  "analysisTypes": string[],      // Specific analysis types
  "timeRange": {                  // Optional time constraints
    "start": number,              // Unix timestamp
    "end": number                 // Unix timestamp
  }
}

// Response (201 Created)
{
  "message": "Analysis triggered successfully",
  "jobId": "uuid-string",
  "estimatedDuration": "2-5 minutes"
}
```

#### **Core Services Used**
- **`DatabaseService`**: Fetches wallet state and stores results
- **`HeliusSyncService`**: Synchronizes transaction data from blockchain
- **`PnlAnalysisService`**: Calculates profit/loss metrics
- **`BehaviorService`**: Performs behavioral pattern analysis

#### **Analysis Flow**
```typescript
1. Validate wallet address format
2. Check existing wallet state
3. Fetch latest transactions from Helius
4. Run P&L analysis (FIFO method)
5. Run behavioral analysis
6. Store results in database
7. Return job status for progress tracking
```

### **2. Wallets Controller** (`/api/v1/wallets`)

#### **Purpose**
Provides comprehensive wallet data access, including summaries, P&L analysis, behavioral metrics, and user notes.

#### **Key Endpoints**

##### **GET `/wallets/{walletAddress}/overview`**
```typescript
// Returns comprehensive wallet overview
GET /api/v1/wallets/{walletAddress}/overview

// Response
{
  "walletAddress": "string",
  "lastAnalyzed": "2025-01-15T10:30:00Z",
  "totalTransactions": 1250,
  "totalValue": {
    "sol": 45.67,
    "usd": 2345.67
  },
  "performance": {
    "realizedPnl": 123.45,
    "unrealizedPnl": 67.89,
    "totalReturn": 8.2
  },
  "behavior": {
    "tradingStyle": "Day Trader",
    "confidenceScore": 0.85,
    "riskLevel": "Medium"
  }
}
```

##### **GET `/wallets/{walletAddress}/pnl`**
```typescript
// Returns detailed P&L analysis
GET /api/v1/wallets/{walletAddress}/pnl?timeRange=30d

// Query Parameters
{
  "timeRange": "7d" | "30d" | "90d" | "1y" | "all",
  "includeUnrealized": boolean,
  "groupBy": "day" | "week" | "month"
}

// Response
{
  "walletAddress": "string",
  "timeRange": "30d",
  "summary": {
    "totalRealizedPnl": 123.45,
    "totalUnrealizedPnl": 67.89,
    "winRate": 0.68,
    "totalTrades": 45
  },
  "timeline": [
    {
      "date": "2025-01-15",
      "realizedPnl": 12.34,
      "unrealizedPnl": 5.67,
      "tradeCount": 3
    }
  ],
  "tokenBreakdown": [
    {
      "mint": "token_mint_address",
      "name": "Token Name",
      "realizedPnl": 23.45,
      "unrealizedPnl": 12.34,
      "tradeCount": 8
    }
  ]
}
```

##### **GET `/wallets/{walletAddress}/behavior`**
```typescript
// Returns behavioral analysis results
GET /api/v1/wallets/{walletAddress}/behavior

// Response
{
  "walletAddress": "string",
  "analysisTimestamp": "2025-01-15T10:30:00Z",
  "tradingStyle": "Day Trader",
  "confidenceScore": 0.85,
  "metrics": {
    "buySellRatio": 1.2,
    "averageHoldTime": 4.5,
    "tradesPerDay": 2.3,
    "sessionCount": 15,
    "avgTradesPerSession": 3.1
  },
  "riskMetrics": {
    "averageTransactionValue": 0.5,
    "largestTransaction": 2.1,
    "riskLevel": "Medium"
  },
  "timeDistribution": {
    "ultraFast": 0.15,
    "veryFast": 0.25,
    "fast": 0.35,
    "moderate": 0.20,
    "dayTrader": 0.05
  }
}
```

##### **GET `/wallets/{walletAddress}/similarity`**
```typescript
// Returns similarity analysis with other wallets
GET /api/v1/wallets/{walletAddress}/similarity?limit=10

// Query Parameters
{
  "limit": number,               // Number of similar wallets
  "minSimilarity": number,       // Minimum similarity threshold
  "vectorType": "capital" | "binary"
}

// Response
{
  "walletAddress": "string",
  "vectorType": "capital",
  "similarWallets": [
    {
      "address": "similar_wallet_address",
      "similarityScore": 0.87,
      "sharedTokens": 12,
      "commonPatterns": ["Day Trading", "High Frequency"]
    }
  ],
  "globalMetrics": {
    "averageSimilarity": 0.45,
    "totalWalletsAnalyzed": 1250
  }
}
```

### **3. Users Controller** (`/api/v1/users`)

#### **Purpose**
Manages user accounts, profiles, and preferences.

#### **Key Endpoints**

##### **GET `/users/profile`**
```typescript
// Returns current user profile
GET /api/v1/users/profile

// Response
{
  "id": "user_uuid",
  "email": "user@example.com",
  "apiKey": "masked_api_key",
  "createdAt": "2025-01-01T00:00:00Z",
  "lastActive": "2025-01-15T10:30:00Z",
  "isDemo": false,
  "preferences": {
    "defaultTimeRange": "30d",
    "currency": "USD",
    "notifications": true
  }
}
```

##### **PUT `/users/profile`**
```typescript
// Updates user profile
PUT /api/v1/users/profile

// Request Body
{
  "email": "newemail@example.com",
  "preferences": {
    "defaultTimeRange": "90d",
    "currency": "EUR",
    "notifications": false
  }
}
```

### **4. Jobs Controller** (`/api/v1/jobs`)

#### **Purpose**
Provides job status tracking and management for long-running operations.

#### **Key Endpoints**

##### **GET `/jobs/{jobId}`**
```typescript
// Returns job status and progress
GET /api/v1/jobs/{jobId}

// Response
{
  "jobId": "uuid-string",
  "status": "processing" | "completed" | "failed",
  "type": "wallet-analysis" | "similarity-analysis" | "data-sync",
  "progress": {
    "current": 75,
    "total": 100,
    "percentage": 75,
    "currentStep": "Running behavioral analysis",
    "estimatedTimeRemaining": "2 minutes"
  },
  "result": {
    "walletAddress": "string",
    "analysisId": "uuid-string"
  },
  "error": null,
  "createdAt": "2025-01-15T10:30:00Z",
  "updatedAt": "2025-01-15T10:32:00Z"
}
```

## 🔧 **Core Services Deep Dive**

### **1. Behavior Service**

#### **Purpose**
Wraps the core `BehaviorAnalyzer` with API-specific functionality, caching, and error handling.

#### **Key Methods**
```typescript
class BehaviorService {
  // Analyze wallet behavior with caching
  async analyzeWalletBehavior(
    walletAddress: string,
    config?: BehaviorAnalysisConfig
  ): Promise<BehavioralMetrics>
  
  // Get cached behavior results
  async getCachedBehavior(
    walletAddress: string
  ): Promise<BehavioralMetrics | null>
  
  // Force refresh of behavior analysis
  async refreshBehaviorAnalysis(
    walletAddress: string
  ): Promise<BehavioralMetrics>
}
```

### **2. PnL Analysis Service**

#### **Purpose**
Calculates comprehensive profit/loss metrics using FIFO methodology and real-time price data.

#### **Key Methods**
```typescript
class PnlAnalysisService {
  // Calculate realized P&L for completed trades
  async calculateRealizedPnl(
    walletAddress: string,
    timeRange?: TimeRange
  ): Promise<RealizedPnlResult>
  
  // Calculate unrealized P&L for current holdings
  async calculateUnrealizedPnl(
    walletAddress: string
  ): Promise<UnrealizedPnlResult>
  
  // Get comprehensive P&L overview
  async getPnlOverview(
    walletAddress: string,
    timeRange?: TimeRange
  ): Promise<PnlOverviewResult>
}
```

### **3. Similarity Service**

#### **Purpose**
Manages wallet similarity analysis, including caching and batch processing.

#### **Key Methods**
```typescript
class SimilarityService {
  // Find similar wallets
  async findSimilarWallets(
    walletAddress: string,
    config?: SimilarityConfig
  ): Promise<SimilarityResult>
  
  // Batch similarity analysis
  async analyzeWalletBatch(
    walletAddresses: string[],
    config?: SimilarityConfig
  ): Promise<BatchSimilarityResult>
  
  // Get similarity matrix
  async getSimilarityMatrix(
    walletAddresses: string[]
  ): Promise<SimilarityMatrix>
}
```

## 🌐 **WebSocket Integration**

### **Job Progress Gateway**
```typescript
// Real-time job progress updates
@WebSocketGateway()
export class JobProgressGateway {
  @SubscribeMessage('subscribe-to-job')
  handleSubscribeToJob(
    @MessageBody() data: { jobId: string }
  ): void {
    // Subscribe client to job progress updates
  }
  
  @SubscribeMessage('unsubscribe-from-job')
  handleUnsubscribeFromJob(
    @MessageBody() data: { jobId: string }
  ): void {
    // Unsubscribe client from job updates
  }
}
```

### **WebSocket Events**
- **`job-progress`**: Real-time progress updates
- **`job-completed`**: Job completion notification
- **`job-failed`**: Job failure notification
- **`analysis-ready`**: Analysis completion notification

## 📊 **Data Transfer Objects (DTOs)**

### **Request Validation**
All API endpoints use DTOs with comprehensive validation:

```typescript
export class WalletAnalysisQueryDto {
  @IsString()
  @IsSolanaAddress()
  walletAddress: string;
  
  @IsOptional()
  @IsBoolean()
  forceRefresh?: boolean;
  
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  analysisTypes?: string[];
  
  @IsOptional()
  @ValidateNested()
  timeRange?: TimeRangeDto;
}

export class TimeRangeDto {
  @IsNumber()
  @Min(0)
  start: number;
  
  @IsNumber()
  @Min(0)
  end: number;
}
```

### **Response Structures**
All responses follow consistent patterns:
- **Success**: `{ data: T, message?: string }`
- **Error**: `{ error: string, statusCode: number, details?: any }`
- **Paginated**: `{ data: T[], pagination: PaginationInfo }`

## 🔄 **Error Handling**

### **Exception Filters**
```typescript
@Catch(ForbiddenException)
export class ForbiddenExceptionFilter implements ExceptionFilter {
  catch(exception: ForbiddenException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    
    response.status(403).json({
      statusCode: 403,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: 'Access denied: Invalid or missing API key'
    });
  }
}
```

### **Common Error Codes**
- **400**: Bad Request (invalid input)
- **401**: Unauthorized (missing API key)
- **403**: Forbidden (invalid API key)
- **404**: Not Found (wallet not found)
- **429**: Too Many Requests (rate limit exceeded)
- **500**: Internal Server Error (server-side issue)

## 📈 **Performance & Caching**

### **Caching Strategy**
- **Redis Cache**: For frequently accessed data
- **In-Memory Cache**: For session data and temporary results
- **Database Cache**: For computed analysis results

### **Cache Keys**
```typescript
// Wallet behavior cache
`wallet:behavior:${walletAddress}:${analysisHash}`

// P&L analysis cache
`wallet:pnl:${walletAddress}:${timeRange}:${analysisHash}`

// Similarity analysis cache
`wallet:similarity:${walletAddress}:${vectorType}:${limit}`
```

### **Cache TTL (Time To Live)**
- **Behavior Analysis**: 1 hour (behavior patterns change slowly)
- **P&L Analysis**: 15 minutes (prices change frequently)
- **Similarity Analysis**: 6 hours (similarity patterns are stable)
- **Token Information**: 24 hours (token metadata is stable)

## 🧪 **Testing & Validation**

### **Test Coverage**
- **Unit Tests**: Individual service methods
- **Integration Tests**: API endpoint workflows
- **E2E Tests**: Complete user journeys
- **Performance Tests**: Load testing and benchmarking

### **Test Utilities**
```typescript
// Mock services for testing
export class MockBehaviorService {
  async analyzeWalletBehavior(): Promise<BehavioralMetrics> {
    return mockBehavioralMetrics;
  }
}

// Test data factories
export class TestDataFactory {
  static createWalletAnalysisQuery(): WalletAnalysisQueryDto {
    return {
      walletAddress: 'valid_solana_address',
      forceRefresh: false,
      analysisTypes: ['behavior', 'pnl']
    };
  }
}
```

## 🔮 **Future Enhancements**

### **Planned Features**
- **GraphQL Support**: Alternative to REST API
- **Real-time Streaming**: Live transaction updates
- **Advanced Filtering**: Complex query language
- **Bulk Operations**: Batch processing endpoints

### **Performance Improvements**
- **Response Compression**: Gzip/Brotli compression
- **Connection Pooling**: Database connection optimization
- **CDN Integration**: Static asset delivery
- **Microservices**: Service decomposition for scalability

---

## 📚 **Related Documentation**

- **[Core Analysis Engine](./../core/README.md)** - Business logic implementation
- **[Database Schema](./../database/README.md)** - Data structures and relationships
- **[Frontend Dashboard](./../frontend/README.md)** - User interface implementation
- **[Deployment Guide](./../deployment/README.md)** - Production deployment
- **[API Reference](./API_DOCUMENTATION.md)** - Complete endpoint documentation
