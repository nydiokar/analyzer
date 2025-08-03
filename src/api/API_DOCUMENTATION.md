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

### 2. Users Module (`/users`)

User profile management for authenticated users.

**Endpoints:**
- `GET /users/me` - Get authenticated user profile

**Authentication:** Required  
**Rate Limiting:** Standard

---

### 3. Wallets Module (`/wallets`) - Core Analysis

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

### 4. Analyses Module (`/analyses`) - Job Management

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

### 5. Jobs Module (`/jobs`) - Queue Monitoring

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

### 6. Additional Modules

#### Token Info (`/token-info`)
- Token metadata retrieval and caching
- Integration with external token data providers

#### User Favorites (`/user-favorites`)  
- Personal wallet favorites management
- User-specific collections and tags

#### Test Controller (`/test`)
- Development and testing endpoints
- System validation utilities

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

### API Key Authentication
All endpoints (except health) require API key authentication via:
- Header: `Authorization: Bearer {api_key}`
- Header: `X-API-Key: {api_key}`

### User Context
Authenticated requests include user context for:
- Activity logging and audit trails
- User-specific data (notes, favorites)
- Rate limiting per user
- Access control and permissions

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
- `202` - Accepted (async operation queued)
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (missing/invalid API key)
- `403` - Forbidden (access denied)
- `404` - Not Found (wallet/resource not found)
- `429` - Too Many Requests (rate limit exceeded)
- `500` - Internal Server Error
- `503` - Service Unavailable (system overload)

### Retry Strategies
- **Transient Errors (5xx):** Exponential backoff
- **Rate Limiting (429):** Respect Retry-After header
- **Job Failures:** Monitor via Jobs API, manual retry if needed

---

This documentation provides a comprehensive overview of the Sova Intel API structure and capabilities. For specific endpoint details, refer to the integrated Swagger documentation available at `/api/docs`.