# Sova Intel API Documentation

## Overview

Sova Intel is a comprehensive Solana wallet analysis platform that provides detailed insights into trading behavior, PnL analysis, and wallet similarity comparisons. The API follows RESTful principles and uses NestJS with Swagger documentation.

## Base Information

- **Application**: Sova Intel v0.14.6
- **Technology Stack**: NestJS, TypeScript, BullMQ, Prisma, Redis
- **Base URL**: `/api` (configurable)
- **Authentication**: API Key based authentication
- **Rate Limiting**: Applied per endpoint (varies by endpoint)

## API Modules

### 1. Health Module (`/health`)

Basic health check endpoint for monitoring system status.

**Endpoints:**
- `GET /health` - System health check

### 2. Authentication Module (`/auth`)

Complete JWT-based authentication system with email verification and security features.

**Endpoints:**
- `POST /auth/register` - Register new user account
- `POST /auth/login` - Login with email and password
- `GET /auth/me` - Get current user profile
- `POST /auth/logout` - Logout user (clear cookies if enabled)
- `POST /auth/request-verification` - Request email verification
- `POST /auth/verify-email` - Verify email with token

**Authentication:** Registration/Login are public, others require authentication  
**Rate Limiting:** 
- Registration: 5 requests/minute
- Login: 10 requests/minute  
- Email verification request: 10 requests per 5 minutes
- Email verification: 3 attempts per 5 minutes
- Profile access: No rate limiting

### 3. Users Module (`/users`)

User profile management for authenticated users.

**Endpoints:**
- `GET /users/me` - Get authenticated user profile

**Authentication:** Required  
**Rate Limiting:** Standard

---

### 4. Security Module (`/security`)

Security monitoring, metrics, and alert management for system administrators.

**Endpoints:**
- `GET /security/metrics` - Get security metrics and monitoring data
- `GET /security/health` - Security system health check
- `GET /security/alerts` - Get active security alerts
- `POST /security/alerts/{id}/resolve` - Resolve a security alert

**Authentication:** Required (restricted to non-demo users)  
**Rate Limiting:** 10-20 requests/minute

---

### 5. Wallets Module (`/wallets`) - Core Analysis

The primary module for wallet analysis and data retrieval.

#### Wallet Search
- `GET /wallets/search` - Search wallets by address fragment
  - **Query Parameters:**
    - `query` (string): Address fragment to search
  - **Response:** Array of matching wallet addresses
  - **Use Case:** Auto-completion, wallet discovery

#### Wallet Summary
- `GET /wallets/{walletAddress}/summary` - Comprehensive wallet overview
  - **Parameters:**
    - `walletAddress` (path): Solana wallet address
    - `startDate` (query, optional): Filter start date
    - `endDate` (query, optional): Filter end date
  - **Response:** Complete wallet summary including:
    - Latest PnL and USD equivalent
    - Token win rate percentage
    - Behavior classification
    - Activity timeline (days active, last transaction)
    - Current SOL balance
  - **Caching:** 1-minute cache with ETag support
  - **Use Case:** Primary dashboard view

#### Token Performance Analysis
- `GET /wallets/{walletAddress}/token-performance` - Paginated token performance data
  - **Query Parameters:**
    - `page` (number): Page number (default: 1)
    - `limit` (number): Items per page (max: 100)
    - `sortBy` (string): Sort field
    - `sortOrder` (string): 'asc' or 'desc'
  - **Response:** Paginated list of token performance metrics
  - **Use Case:** Detailed token-by-token analysis

#### PnL Overview
- `GET /wallets/{walletAddress}/pnl-overview` - Detailed profit/loss analysis
  - **Query Parameters:**
    - `startDate` (optional): Period start date
    - `endDate` (optional): Period end date
  - **Response:** Comprehensive PnL breakdown including:
    - Realized/unrealized PnL
    - SOL spent/received
    - Win rates and trade volumes
    - Advanced trading statistics
  - **Use Case:** Financial performance analysis

#### Behavior Analysis
- `GET /wallets/{walletAddress}/behavior-analysis` - Trading behavior insights
  - **Query Parameters:**
    - `startDate` (optional): Analysis period start
    - `endDate` (optional): Analysis period end
  - **Response:** Detailed behavior metrics including:
    - Trading patterns and consistency
    - Efficiency scores
    - Strategic tags and classifications
    - Temporal behavior analysis
  - **Use Case:** Understanding trading strategies

#### Wallet Classification
- `GET /wallets/{walletAddress}/classification` - Smart classification and fetch optimization
  - **Response:** 
    - Classification type (bot, whale, etc.)
    - Smart fetch recommendations
    - Performance optimization settings
  - **Use Case:** System optimization and user insights

#### Notes Management
- `POST /wallets/{walletAddress}/notes` - Create wallet note
- `GET /wallets/{walletAddress}/notes` - Get all wallet notes
- `PATCH /wallets/{walletAddress}/notes/{noteId}` - Update specific note
- `DELETE /wallets/{walletAddress}/notes/{noteId}` - Delete specific note
  - **Authentication:** Required
  - **Authorization:** Users can only manage their own notes
  - **Use Case:** Personal annotations and research notes

#### Token Enrichment
- `POST /wallets/{walletAddress}/enrich-all-tokens` - Trigger background token metadata enrichment
  - **Response:** 202 Accepted (fire-and-forget operation)
  - **Use Case:** Enhance token display with metadata

---

### 6. Analyses Module (`/analyses`) - Job Management

High-level analysis operations that queue background jobs.

#### Wallet Status Check
- `POST /analyses/wallets/status` - Check database status for multiple wallets
  - **Request Body:** Array of wallet addresses
  - **Response:** Status for each wallet (FRESH, STALE, MISSING)
  - **Use Case:** Determine if wallets need re-analysis

#### Dashboard Analysis
- `POST /analyses/wallets/dashboard-analysis` - Queue comprehensive wallet analysis
  - **Rate Limiting:** 5 requests/minute
  - **Request Body:**
    - `walletAddress` (string): Target wallet
    - `forceRefresh` (boolean, optional): Force re-analysis
    - `enrichMetadata` (boolean, optional): Include token metadata
  - **Response:** Job submission details with monitoring URL
  - **Use Case:** Complete wallet preparation for dashboard

#### Similarity Analysis
- `POST /analyses/similarity/queue` - Queue multi-wallet similarity analysis
  - **Rate Limiting:** 5 requests/minute
  - **Request Body:**
    - `walletAddresses` (array): 2+ wallet addresses
    - `vectorType` (string, optional): 'capital' or 'binary'
  - **Response:** Job details with estimated processing time
  - **Use Case:** Compare trading patterns between wallets

#### Balance Enrichment
- `POST /analyses/similarity/enrich-balances` - Queue token balance enrichment
  - **Rate Limiting:** 20 requests/minute
  - **Request Body:** Wallet balances object
  - **Response:** Job submission with token count and monitoring URL
  - **Use Case:** Optimize token metadata for analysis

---

### 7. Jobs Module (`/jobs`) - Queue Monitoring

Comprehensive job management and monitoring system.

#### Job Status & Results
- `GET /jobs/{jobId}` - Get complete job status and details
- `GET /jobs/{jobId}/progress` - Get job progress only
- `GET /jobs/{jobId}/result` - Get job result only
- `DELETE /jobs/{jobId}` - Cancel pending/active job

#### Queue Management
- `GET /jobs/queue/{queueName}/stats` - Get queue statistics
  - **Supported Queues:** 
    - `wallet-operations`
    - `analysis-operations` 
    - `similarity-operations`
    - `enrichment-operations`
- `GET /jobs/queue/{queueName}/jobs` - List jobs in queue
  - **Query Parameters:**
    - `status` (optional): Filter by job state
    - `limit` (number): Max jobs to return (default: 10, max: 100)
    - `offset` (number): Pagination offset

#### System Overview
- `GET /jobs` - Get statistics for all queues
- `GET /jobs/failed/stats` - Dead letter queue statistics
- `GET /jobs/failed/recent` - Recent failed jobs for debugging

#### Direct Job Submission (Advanced)
**Note:** These endpoints provide direct queue access for external integrations. The frontend typically uses higher-level `/analyses` endpoints.

- `POST /jobs/wallets/sync` - Submit wallet sync job
- `POST /jobs/wallets/analyze` - Submit wallet analysis job
- `POST /jobs/similarity/analyze` - Submit similarity analysis job
- `POST /jobs/wallets/dashboard-analysis` - Submit dashboard analysis job

---

### 8. Additional Modules

#### User Favorites Module (`/users/me/favorites`)
Personal wallet favorites management and organization.

**Endpoints:**
- `POST /users/me/favorites` - Add wallet to favorites
- `DELETE /users/me/favorites/{walletAddress}` - Remove wallet from favorites
- `PUT /users/me/favorites/{walletAddress}` - Update favorite wallet
- `POST /users/me/favorites/{walletAddress}/viewed` - Mark wallet as viewed
- `GET /users/me/favorites` - Get all favorite wallets
- `GET /users/me/favorites/tags` - Get favorite tags
- `GET /users/me/favorites/collections` - Get favorite collections

**Authentication:** Required  
**Rate Limiting:** Standard

#### Token Info Module (`/token-info`)
Token metadata retrieval and caching system.

**Endpoints:**
- `POST /token-info` - Request token metadata enrichment

**Authentication:** Required  
**Rate Limiting:** Standard

#### Bot Integration Module (`/bot`)
External bot integration and monitoring endpoints.

**Endpoints:**
- `GET /bot/health` - Bot health check endpoint
- `GET /bot/security-summary` - Security summary for bot reporting
- `GET /bot/critical-alerts` - Get critical security alerts
- `POST /bot/acknowledge` - Acknowledge alerts from external bot

**Authentication:** Required  
**Rate Limiting:** 10-60 requests/minute (varies by endpoint)

#### Test Controller (`/test-auth`)
Development and testing endpoints for authentication validation.

**Endpoints:**
- Various test endpoints for development

**Authentication:** Varies by endpoint  
**Rate Limiting:** Standard

#### Health Module (`/health`)
System health monitoring and status checks.

**Endpoints:**
- `GET /health` - Basic system health check

**Authentication:** Not required  
**Rate Limiting:** Standard

---

## Queue System Architecture

The API uses BullMQ for background job processing with four main queues:

1. **Wallet Operations Queue** - Transaction syncing and data fetching
2. **Analysis Operations Queue** - PnL, behavior, and dashboard analysis
3. **Similarity Operations Queue** - Multi-wallet comparison jobs  
4. **Enrichment Operations Queue** - Token metadata enhancement

### Job States
- `waiting` - Queued for processing
- `active` - Currently being processed
- `completed` - Successfully finished
- `failed` - Processing failed
- `delayed` - Scheduled for future execution
- `paused` - Queue paused

### Job Monitoring
All analysis endpoints return job IDs that can be monitored via the Jobs API. The system provides:
- Real-time progress updates
- Estimated completion times
- Failure handling and retry logic
- Dead letter queue for failed job investigation

---

## Response Formats

### Standard Success Response
```json
{
  "status": "ok",
  "data": { ... },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Job Submission Response
```json
{
  "jobId": "job_12345",
  "requestId": "req_67890", 
  "status": "queued",
  "queueName": "analysis-operations",
  "estimatedProcessingTime": "5 minutes",
  "monitoringUrl": "/jobs/job_12345"
}
```

### Error Response
```json
{
  "statusCode": 400,
  "message": "Invalid wallet address format",
  "error": "Bad Request",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Authentication Error Responses

#### Invalid Credentials
```json
{
  "statusCode": 401,
  "message": "Invalid email or password",
  "error": "Unauthorized",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### Token Expired
```json
{
  "statusCode": 401,
  "message": "Token has expired",
  "error": "Unauthorized",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### Demo User Restriction
```json
{
  "statusCode": 403,
  "message": "This wallet is not available in the Demo account.",
  "error": "Forbidden",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### Email Already Verified
```json
{
  "statusCode": 409,
  "message": "Email is already verified",
  "error": "Conflict",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

## Rate Limiting & Caching

### Rate Limits by Endpoint
- **Analysis Operations:** 5 requests/minute (resource-intensive)
- **Balance Enrichment:** 20 requests/minute (lighter operations)
- **General API:** Standard throttling (configurable)

### Caching Strategy
- **Wallet Summary:** 1-minute cache with ETag
- **Analysis Results:** Long-term persistence in database
- **Token Metadata:** Extended caching for static data

---

## Authentication & Security

### Dual Authentication System
The API supports two authentication methods with automatic fallback:

#### 1. JWT Authentication (Preferred)
- **Header:** `Authorization: Bearer {jwt_token}`
- **Cookie:** If cookie mode is enabled, an HTTP-only cookie carries the short-lived access token
- **Token Type:** JWT (JSON Web Token)
- **Expiration:** 30 minutes by default (configurable via `JWT_EXPIRES_IN`)
- **Features:** 
  - Stateless authentication
  - Built-in expiration handling
  - User context caching (15 minutes)
  - Automatic token validation
  - Optional HTTP-only cookie support

#### 2. API Key Authentication (Legacy/Backup)
- **Header:** `X-API-Key: {api_key}`
- **Features:**
  - Backward compatibility
  - API key caching (5 minutes)
  - User validation on each request

### Cookie Authentication Support

The API supports optional HTTP-only cookie authentication for enhanced security:

#### Configuration
- **Environment Variable:** `AUTH_COOKIE_MODE=true`
- **Cookie Name:** `analyzer.sid` (configurable via `AUTH_COOKIE_NAME`)
- **Security:** HTTP-only, Secure, SameSite=strict
- **Expiration:** Matches access token TTL (default 30 minutes)

#### Cookie Behavior
- **Auto-Set:** Cookies are automatically set on successful login/registration
- **Auto-Clear:** Cookies are cleared on logout
- **Fallback:** Header authentication still works when cookies are disabled
- **Security:** Prevents XSS attacks via HTTP-only flag; CSRF protection is enforced for mutating requests when cookie mode is enabled

### Authentication Flow

#### Registration
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123"
}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_123",
    "email": "user@example.com",
    "isDemo": false,
    "emailVerified": false
  }
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123"
}
```

**Response:** Same as registration

#### Profile Access
```http
GET /api/auth/me
Authorization: Bearer {jwt_token}
```

**Response:**
```json
{
  "id": "user_123",
  "email": "user@example.com",
  "isDemo": false,
  "emailVerified": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "lastLoginAt": "2024-01-01T12:00:00.000Z"
}
```

### Email Verification System

#### Request Verification
```http
POST /api/auth/request-verification
Authorization: Bearer {jwt_token}
```

#### Verify Email
```http
POST /api/auth/verify-email
Authorization: Bearer {jwt_token}
Content-Type: application/json

{
  "token": "verification_token_here"
}
```

### User Types & Permissions

#### Regular Users
- Full access to all wallet analysis features
- Can create, edit, and delete notes
- Can manage favorites
- Access to all wallet addresses

#### Demo Users
- **Restricted Access:** Limited to predefined demo wallets
- **Read-Only:** Cannot perform write operations (except favorites)
- **Notes:** Can only read notes, cannot create/edit/delete
- **Wallet Access:** Only demo wallets from `DEMO_WALLETS` environment variable

### Security Features

#### Password Security
- **Minimum Length:** 8 characters
- **Requirements:** Uppercase, lowercase, and number
- **Hashing:** bcrypt with 12 salt rounds
- **Pepper:** Additional secret pepper for enhanced security

#### JWT Security
- **Secret Validation:** JWT secret must meet security requirements
- **Token Structure:** Contains user ID and email
- **Expiration:** Automatic token expiration
- **Validation:** Database user validation on each request

#### Rate Limiting
- **Registration:** 5 requests/minute
- **Login:** 10 requests/minute
- **Email Verification Request:** 10 requests per 5 minutes
- **Email Verification:** 3 attempts per 5 minutes
- **Profile Access (`/users/me`):** 30 requests/minute
- **Profile Access (`/auth/me`):** No rate limiting
- **Security Metrics:** 10 requests/minute
- **Security Health:** 20 requests/minute
- **Security Alerts:** 20 requests/minute

### Security Monitoring

#### Security Metrics
```http
GET /api/security/metrics?timeRange=hour
Authorization: Bearer {jwt_token}
```

**Response:**
```json
{
  "securityEvents": {
    "totalEvents": 150,
    "eventsBySeverity": {
      "LOW": 100,
      "MEDIUM": 40,
      "HIGH": 8,
      "CRITICAL": 2
    },
    "eventsByType": {
      "AUTH_FAILURE": 50,
      "RATE_LIMIT": 30,
      "SUSPICIOUS_ACTIVITY": 20
    },
    "uniqueIpsWithIssues": 15,
    "recentSuspiciousActivity": [...],
    "topRiskIps": [...]
  },
  "throttlerStats": {
    "blockedIps": 5,
    "recentEvents": 25,
    "topViolatingIps": [...]
  },
  "timestamp": "2024-01-01T12:00:00.000Z",
  "timeRange": "hour"
}
```

#### Security Health Check
```http
GET /api/security/health
Authorization: Bearer {jwt_token}
```

#### Active Alerts
```http
GET /api/security/alerts
Authorization: Bearer {jwt_token}
```

### User Context
Authenticated requests include user context for:
- Activity logging and audit trails
- User-specific data (notes, favorites)
- Rate limiting per user
- Access control and permissions
- Demo user restrictions

---

## Integration Guidelines

### Frontend Integration
1. Use `/wallets/{address}/summary` for primary wallet views
2. Monitor long-running operations via Jobs API
3. Implement proper error handling for async operations
4. Leverage caching headers for performance

### External API Integration  
1. Use direct job submission endpoints for bulk operations
2. Implement proper retry logic for failed jobs
3. Monitor queue health via statistics endpoints
4. Use webhook-style polling for job completion

### Performance Considerations
1. Respect rate limits to avoid throttling
2. Use pagination for large datasets
3. Cache responses where appropriate
4. Monitor job queue status for system health

---

## Error Handling

### Common HTTP Status Codes
- `200` - Success
- `201` - Created (user registration)
- `202` - Accepted (async operation queued)
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (missing/invalid credentials)
- `403` - Forbidden (access denied, demo user restrictions)
- `404` - Not Found (wallet/resource not found)
- `409` - Conflict (user already exists, email already verified)
- `429` - Too Many Requests (rate limit exceeded)
- `500` - Internal Server Error
- `503` - Service Unavailable (system overload)

### Retry Strategies
- **Transient Errors (5xx):** Exponential backoff
- **Rate Limiting (429):** Respect Retry-After header
- **Job Failures:** Monitor via Jobs API, manual retry if needed

---

This documentation provides a comprehensive overview of the Sova Intel API structure and capabilities. For specific endpoint details, refer to the integrated Swagger documentation available at `/api/docs`.