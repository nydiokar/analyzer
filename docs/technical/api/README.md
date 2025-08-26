# 🌐 Backend API Layer

## 🎯 Overview

The Backend API Layer provides a RESTful interface to the Wallet Analysis System, built with NestJS and TypeScript. It exposes analysis capabilities, manages user authentication, and handles background job processing through WebSocket connections.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        API LAYER                               │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   Controllers   │  │   Middleware    │  │     Guards      │  │
│  │                 │  │                 │  │                 │  │
│  │ • Wallet        │  │ • CORS          │  │ • API Key Auth  │  │
│  │ • Analysis      │  │ • Rate Limiting│  │ • Role-based    │  │
│  │ • Jobs          │  │ • Logging       │  │ • Validation    │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │     Services    │  │     DTOs        │  │   Pipes         │  │
│  │                 │  │                 │  │                 │  │
│  │ • Business      │  │ • Request       │  │ • Validation    │  │
│  │   Logic         │  │   Validation    │  │ • Transformation│  │
│  │ • Data Access   │  │ • Response      │  │ • Type Safety   │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CORE SERVICES                               │
├─────────────────────────────────────────────────────────────────┤
│  • DatabaseService    • BehaviorService    • SimilarityService │
│  • HeliusApiClient    • TokenInfoService    • JobQueueService  │
└─────────────────────────────────────────────────────────────────┘
```

## 🔑 Authentication & Security

### **API Key Authentication**
- **Header**: `X-API-Key: your_api_key_here`
- **Storage**: Hashed in database using bcrypt
- **Validation**: Middleware validates on every request
- **Rate Limiting**: Global and per-user limits

### **Rate Limiting Strategy**
```typescript
// Global limits
{
  ttl: 60000,        // 1 minute window
  limit: 100         // 100 requests per minute
}

// Per-user limits (stricter)
{
  ttl: 60000,        // 1 minute window  
  limit: 30          // 30 requests per minute per user
}

// Special endpoints (analysis triggers)
{
  ttl: 60000,        // 1 minute window
  limit: 3           // 3 analysis triggers per minute per user
}
```

## 📡 API Endpoints

### **Base URL**
```
Production: https://your-api-domain.com/api/v1
Development: http://localhost:3001/api/v1
```

### **Core Endpoints**

#### **Wallet Analysis**
```
GET    /wallets/{address}/summary           # Wallet overview
GET    /wallets/{address}/token-performance # Token-level performance
GET    /wallets/{address}/pnl-overview      # P&L details
GET    /wallets/{address}/behavior-analysis # Behavioral patterns
```

#### **Analysis Management**
```
POST   /analyses/wallets/{address}/trigger-analysis  # Start analysis
GET    /analyses/jobs/{jobId}/status                # Job status
GET    /analyses/jobs/{jobId}/progress              # Real-time progress
```

#### **User Management**
```
POST   /users                                      # Create user
GET    /users/{userId}/activity                    # User activity log
PUT    /users/{userId}/api-key                     # Regenerate API key
```

#### **System Health**
```
GET    /health                                     # System health check
GET    /metrics                                    # Performance metrics
```

## 🔄 Request/Response Flow

### **Typical Request Flow**
```
1. Client Request → X-API-Key header
2. Authentication Middleware → Validate API key
3. Rate Limiting → Check user limits
4. Request Validation → DTO validation
5. Controller → Route to appropriate handler
6. Service Layer → Business logic execution
7. Database → Data retrieval/storage
8. Response → Formatted API response
9. Activity Logging → Record user activity
```

### **Response Format**
```typescript
// Success Response
{
  success: true,
  data: { /* response data */ },
  timestamp: "2025-01-27T10:30:00Z",
  requestId: "req_123456789"
}

// Error Response
{
  success: false,
  error: {
    code: "VALIDATION_ERROR",
    message: "Invalid wallet address format",
    details: { /* validation errors */ }
  },
  timestamp: "2025-01-27T10:30:00Z",
  requestId: "req_123456789"
}
```

## 📊 Data Transfer Objects (DTOs)

### **Request DTOs**
```typescript
// Wallet Analysis Request
export class WalletAnalysisRequestDto {
  @IsString()
  @IsSolanaAddress()
  walletAddress: string;

  @IsOptional()
  @IsEnum(['pnl', 'behavior', 'all'])
  analysisType?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

// Similarity Analysis Request
export class SimilarityAnalysisRequestDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(100)
  @IsSolanaAddress({ each: true })
  walletAddresses: string[];

  @IsEnum(['capital', 'binary'])
  vectorType: 'capital' | 'binary';
}
```

### **Response DTOs**
```typescript
// Wallet Summary Response
export class WalletSummaryResponseDto {
  @Expose()
  walletAddress: string;

  @Expose()
  lastActiveTimestamp: Date;

  @Expose()
  daysActive: number;

  @Expose()
  totalPnl: number;

  @Expose()
  winRate: number;

  @Expose()
  behaviorClassification: string;

  @Expose()
  advancedStats: AdvancedStatsResult;

  @Expose()
  behaviorMetrics: BehaviorMetrics;
}
```

## 🔌 WebSocket Integration

### **Job Progress Tracking**
```typescript
// WebSocket Connection
const socket = new WebSocket('ws://localhost:3001/jobs');

// Subscribe to job progress
socket.send(JSON.stringify({
  action: 'subscribe',
  jobId: 'job_123456789'
}));

// Receive progress updates
socket.onmessage = (event) => {
  const update = JSON.parse(event.data);
  console.log(`Job ${update.jobId}: ${update.progress}%`);
};
```

### **Real-time Events**
- **Job Started**: `job.started`
- **Job Progress**: `job.progress`
- **Job Completed**: `job.completed`
- **Job Failed**: `job.failed`
- **Job Cancelled**: `job.cancelled`

## 🧪 Testing & Validation

### **API Testing**
```bash
# Run API tests
npm run test:api

# Test specific endpoint
npm run test:api -- --testNamePattern="WalletController"

# Integration tests
npm run test:e2e
```

### **Validation Testing**
```bash
# Test DTO validation
npm run test:api -- --testNamePattern="DTO"

# Test authentication
npm run test:api -- --testNamePattern="Auth"
```

## 📈 Performance & Monitoring

### **Response Time Targets**
- **Simple Queries**: <100ms
- **Complex Analysis**: <500ms
- **Background Jobs**: Async with progress tracking

### **Monitoring Endpoints**
```
GET /health                    # Basic health check
GET /metrics                   # Performance metrics
GET /health/detailed          # Detailed system status
```

### **Health Check Response**
```typescript
{
  status: "healthy",
  timestamp: "2025-01-27T10:30:00Z",
  uptime: 86400000,
  services: {
    database: "healthy",
    redis: "healthy",
    helius: "healthy"
  },
  metrics: {
    activeConnections: 15,
    requestsPerMinute: 45,
    averageResponseTime: 125
  }
}
```

## 🚨 Error Handling

### **Error Categories**
- **Validation Errors**: Invalid input data (400)
- **Authentication Errors**: Invalid API key (401)
- **Authorization Errors**: Insufficient permissions (403)
- **Not Found Errors**: Resource doesn't exist (404)
- **Rate Limit Errors**: Too many requests (429)
- **Server Errors**: Internal system errors (500)

### **Error Response Format**
```typescript
{
  success: false,
  error: {
    code: "RATE_LIMIT_EXCEEDED",
    message: "Rate limit exceeded. Try again in 60 seconds.",
    details: {
      limit: 30,
      remaining: 0,
      resetTime: "2025-01-27T10:31:00Z"
    }
  }
}
```

## 🔮 Future Enhancements

### **Planned Features**
- **GraphQL Support**: Alternative to REST for complex queries
- **Webhook Integration**: Notify external systems of job completion
- **API Versioning**: Support multiple API versions
- **Advanced Caching**: Redis-based response caching

### **Scalability Improvements**
- **Load Balancing**: Multiple API instances
- **Database Sharding**: Distribute data across multiple databases
- **Microservices**: Break into smaller, focused services

## 📚 Related Documentation

- **[Core Engine](../core/README.md)** - Analysis logic implementation
- **[Database Schema](../database/README.md)** - Data models and relationships
- **[Infrastructure](../infrastructure/README.md)** - Deployment and scaling
- **[Frontend Integration](../frontend/README.md)** - Dashboard API usage

---

**Last Updated**: August 2025  
**API Version**: v1.0  
**Maintainer**: API Team  
**Status**: Production Ready
