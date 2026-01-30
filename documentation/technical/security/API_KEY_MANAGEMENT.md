# API Key Management Guide

## Quick Start

### Create API Key for Prometheus
```bash
# 1. Get your user ID first
npm run user:manage list

# 2. Create admin API key for Prometheus
npm run apikey:manage create <your-user-id> -d "Prometheus Scraper" -s "admin"

# Copy the API key immediately - it won't be shown again!
```

### Create API Key for CI/CD
```bash
npm run apikey:manage create <your-user-id> -d "CI/CD Pipeline" -s "read" -e 365
```

## Commands

### `npm run apikey:manage`

#### Create API Key
```bash
npm run apikey:manage create <userId> -d "Description" -s "scopes" [-e days]

# Examples:
npm run apikey:manage create user_123 -d "Prometheus" -s "admin"
npm run apikey:manage create user_123 -d "Read-only access" -s "read" -e 90
npm run apikey:manage create user_123 -d "Full access" -s "full"
npm run apikey:manage create user_123 -d "Analysis only" -s "analysis"
npm run apikey:manage create user_123 -d "Multiple scopes" -s "read,report,analysis"
```

**Scopes:**
- `read` - Read-only access to wallet data
- `report` - Generate reports
- `analysis` - Run analysis operations
- `admin` - Admin access (includes health/metrics endpoints)
- `full` - Full access to everything

**Options:**
- `-d, --description` - Required: Description of the key
- `-s, --scopes` - Required: Comma-separated scopes (default: `read`)
- `-e, --expires` - Optional: Expiration in days (omit for no expiration)

#### List API Keys
```bash
# List all API keys
npm run apikey:manage list

# List keys for specific user
npm run apikey:manage list <userId>
```

#### Revoke API Key
```bash
npm run apikey:manage revoke <keyId>

# This deactivates the key but keeps the record
```

#### Update API Key
```bash
# Update description
npm run apikey:manage update <keyId> -d "New description"

# Update scopes
npm run apikey:manage update <keyId> -s "admin,full"

# Update both
npm run apikey:manage update <keyId> -d "Updated" -s "read,analysis"
```

#### Delete API Key
```bash
# With confirmation
npm run apikey:manage delete <keyId>

# Skip confirmation (dangerous!)
npm run apikey:manage delete <keyId> --force
```

## User Management

### `npm run user:manage`

#### Create User
```bash
npm run user:manage create -d "Description"

# Example:
npm run user:manage create -d "Admin User"
```

#### List Users
```bash
npm run user:manage list
```

#### Set Admin Status
After creating a user, add their ID or email to `.env`:
```bash
ADMIN_USER_IDS=user_abc123,user_xyz789
ADMIN_EMAILS=admin@example.com,owner@example.com
```

Then restart the server:
```bash
npm run reset
```

## Typical Workflows

### Setup Prometheus Monitoring
```bash
# 1. Create user (if you don't have one)
npm run user:manage create -d "Monitoring Admin"
# Note the User ID from output

# 2. Add user to admin list in .env
ADMIN_USER_IDS=<user-id-from-step-1>

# 3. Restart server
npm run reset

# 4. Create API key for Prometheus
npm run apikey:manage create <user-id> -d "Prometheus Scraper" -s "admin"
# Copy the API key immediately!

# 5. Configure Prometheus (see docs/monitoring/PROMETHEUS_SETUP.md)
```

### Setup CI/CD Pipeline
```bash
# 1. Get your user ID
npm run user:manage list

# 2. Create read-only API key that expires in 1 year
npm run apikey:manage create <user-id> -d "GitHub Actions CI" -s "read" -e 365

# 3. Add key to CI/CD secrets as API_KEY
```

### Rotate API Keys
```bash
# 1. Create new key
npm run apikey:manage create <user-id> -d "New Key" -s "admin"

# 2. Update Prometheus/services with new key

# 3. Test new key works
curl -H "X-API-Key: new-key" https://your-api.com/health/metrics

# 4. Revoke old key
npm run apikey:manage revoke <old-key-id>
```

### Audit API Keys
```bash
# List all keys to see usage
npm run apikey:manage list

# Check for:
# - Keys that haven't been used recently (lastUsedAt)
# - Expired keys
# - Keys with excessive permissions
# - Keys without descriptions
```

## Security Best Practices

1. **Use Scoped Keys**: Don't use `full` scope unless absolutely necessary
2. **Set Expiration**: Use `-e` flag for non-permanent keys
3. **Descriptive Names**: Always use meaningful descriptions
4. **Regular Rotation**: Rotate admin keys every 90-180 days
5. **Revoke Unused**: Regularly audit and revoke unused keys
6. **One Key Per Service**: Don't share keys between services

## Troubleshooting

### "User not found"
```bash
# List users to verify ID
npm run user:manage list
```

### "Invalid scopes"
Valid scopes: `read`, `report`, `analysis`, `admin`, `full`
```bash
# Correct:
-s "admin"
-s "read,analysis"

# Wrong:
-s "monitoring"  # Invalid scope
```

### "API key not working"
```bash
# Check if key is active and not expired
npm run apikey:manage list

# Verify scopes are correct
npm run apikey:manage update <key-id> -s "admin"

# Test with curl
curl -H "X-API-Key: your-key" http://localhost:3000/health/metrics
```

### Prometheus getting 403
```bash
# 1. Verify key has 'admin' or 'full' scope
npm run apikey:manage list

# 2. Check user is in ADMIN_USER_IDS or ADMIN_EMAILS
grep ADMIN .env

# 3. Restart server after .env changes
npm run reset
```

## 🔐 Authentication Implementation Details

### Composite Authentication Strategy

The system implements a **dual authentication system** combining JWT tokens for human users with API keys for services:

- **Global `CompositeAuthGuard`**: Tries JWT authentication first, falls back to API key authentication
- **JWT Structure**: Contains only identity claims (`sub`, `email`) - **NO scopes** (intentional design)
- **API Key Structure**: Contains permission scopes (`read`, `report`, `analysis`, `admin`, `full`)
- **Transparent Authentication**: Single guard handles both authentication methods seamlessly
- **Backward Compatibility**: API keys created internally on user registration (hashed, not returned)

### Global Guard Pattern

```typescript
// app.module.ts
providers: [
  { provide: APP_GUARD, useClass: CompositeAuthGuard },  // Auth
  { provide: APP_GUARD, useClass: ThrottlerGuard },      // Rate limiting
  { provide: APP_GUARD, useClass: AdminGuard },          // Admin checks
]
```

**Key Benefits**:
- **Security by Default**: All routes protected unless explicitly marked `@Public()`
- **DRY Principle**: No need to repeat `@UseGuards()` on every controller
- **Fail-Safe**: New endpoints automatically protected

**Trade-offs**:
- Must explicitly mark public routes with `@Public()` decorator
- Potential for confusion if decorators are forgotten

### Admin Role Management

**Environment-Based Configuration**:
- **Admin Lists**: `ADMIN_USER_IDS` and `ADMIN_EMAILS` environment variables
- **Simple Management**: Add/remove admins via environment config + restart
- **Fast Lookups**: Uses Set data structure for O(1) performance

**Implementation**:
- `@AdminOnly()` decorator marks admin-protected routes
- Global `AdminGuard` checks user against admin lists
- Applied to sensitive endpoints (health metrics, queue monitoring, security)

### Health Endpoint Security Model (Updated 2025-12-03)

**Tiered Access Control**:
- `GET /health` - **Public**: Basic operational status ("operational" or "down")
- `GET /health/detailed` - **@AdminOnly()**: Comprehensive health check (database, cache, performance)
- `GET /health/queues` - **@AdminOnly()**: BullMQ queue health and Redis status
- `GET /health/cache-metrics` - **@AdminOnly()**: Cache statistics
- `GET /health/metrics` - **@AdminOnly()**: Prometheus text format metrics

**Security Rationale**:
- Prevents infrastructure enumeration attacks
- Stops authenticated users from scraping internal system details
- Maintains public uptime monitoring while protecting sensitive metrics

**Prometheus Integration**:
- Use API key with `'admin'` or `'full'` scope for scraping
- Configure via `Authorization` header or `X-API-Key` in `prometheus.yml`
- AdminGuard allows both JWT (human admins) and API key (Prometheus) authentication

### Email Verification System

**Token-Based Verification**:
- **Time-Limited Tokens**: Configurable expiration periods
- **Single Use**: Tokens invalidated after successful verification
- **Rate Limiting**: Prevents abuse of verification endpoints

**Security Features**:
- Prevents fake account creation
- Ensures valid contact information
- Standard security best practice for authentication systems

## 🔄 JWT Refresh Token Strategy

**Rotating Refresh Tokens with Session Management**:

### Implementation Details
- **Access Token**: 30-minute TTL (stateless JWT with `kid`, `iss`, `aud`, `nbf` claims)
- **Refresh Token**: 7-day sliding window stored hashed in Redis
- **Token Rotation**: Each `/auth/refresh` issues new access + new refresh (old token revoked)
- **Session Tracking**: Per-user session sets enable O(1) revocation
- **Absolute Max Lifetime**: 7-day hard expiration for defense-in-depth

### Security Features
- **Replay Protection**: Token reuse revokes entire session chain and triggers alerts
- **Password Reset**: Revokes all user sessions on password change
- **Selective Logout**: Can target single session or all sessions (`/auth/logout-all`)
- **Device Labels**: RefreshTokenService tracks device information for user visibility

### Authentication Architecture Summary (2025-12-03)

```
┌─────────────────────────────────────────────────────────────────┐
│                     CompositeAuthGuard                          │
│                  (Global, tries JWT first)                      │
└──────────────────┬──────────────────┬───────────────────────────┘
                   │                  │
         ┌─────────▼─────────┐  ┌────▼──────────────┐
         │  JWT Auth Path    │  │ API Key Auth Path │
         │  (Human Users)    │  │ (Services/Legacy) │
         └─────────┬─────────┘  └────┬──────────────┘
                   │                  │
         ┌─────────▼─────────┐  ┌────▼──────────────┐
         │ Identity Only     │  │ Scoped Permissions│
         │ sub, email        │  │ read, admin, etc. │
         └─────────┬─────────┘  └────┬──────────────┘
                   │                  │
         ┌─────────▼─────────┐  ┌────▼──────────────┐
         │ AdminGuard Check  │  │ AdminGuard Check  │
         │ ADMIN_USER_IDS    │  │ + Scope Check     │
         └───────────────────┘  └───────────────────┘
```

### Key Architectural Principles
1. **Security by Default**: All routes protected unless marked `@Public()`
2. **Separation of Concerns**: Identity (JWT) ≠ Permissions (API keys)
3. **No Scopes in JWT**: Intentional - enables instant admin revocation
4. **Admin via Environment**: Simple config-based admin management (no RBAC tables)
5. **Health Endpoints Secured**: Prevents infrastructure enumeration attacks

### Critical Security Milestone (2025-12-03)
- Merged JWT auth branch to `main` with proper health endpoint protection
- Discovered and fixed vulnerability where authenticated users could scrape metrics
- Final implementation: `@AdminOnly()` decorator on all sensitive monitoring endpoints
- Attack vector eliminated: Regular users cannot register → get JWT → access internal metrics

## 🏗️ API Key Service Architecture Refactor (2025-12-04)

### The Problem: Single Responsibility Violation

Prior to this refactor, `JwtDatabaseService` contained **two unrelated domains**:
- ✅ JWT/user authentication operations (correct)
- ❌ API key management operations (incorrect - violates SRP)

This created:
- Confusing service dependencies
- Inconsistent data access patterns
- Scattered business logic
- Architectural debt

### The Solution: Domain-Driven Separation

**Decision**: Create dedicated `ApiKeyDatabaseService` for pure API key data access

```
Service Layer Architecture (After Refactor)
┌─────────────────────────────────────────────────────────┐
│                   Business Logic Layer                   │
│                                                          │
│  ┌──────────────────┐         ┌──────────────────┐     │
│  │  ApiKeyService   │         │   AuthService    │     │
│  │  (Business Logic)│         │  (Business Logic)│     │
│  └────────┬─────────┘         └────────┬─────────┘     │
│           │                             │               │
└───────────┼─────────────────────────────┼───────────────┘
           │                             │
┌───────────▼─────────────────────────────▼───────────────┐
│                    Data Access Layer                     │
│                                                          │
│  ┌──────────────────────┐  ┌────────────────────────┐  │
│  │ ApiKeyDatabaseService│  │ JwtDatabaseService     │  │
│  │ (API Key CRUD)       │  │ (User/JWT/Auth CRUD)   │  │
│  └──────────┬───────────┘  └────────┬───────────────┘  │
│             │                        │                   │
└─────────────┼────────────────────────┼───────────────────┘
             │                        │
             └────────────┬───────────┘
                          │
                   ┌──────▼──────┐
                   │  Database   │
                   │  (Prisma)   │
                   └─────────────┘
```

### Implementation Details

#### Created: `ApiKeyDatabaseService`
**File**: `src/api/shared/services/api-key-database.service.ts`

**Responsibilities** (Pure Data Access Only):
- `createApiKey()` - Create API key record
- `findApiKeyByPrefix()` - Lookup for authentication
- `findApiKeyById()` - Fetch by ID
- `findApiKeysByUserId()` - List user's keys
- `findAllApiKeysWithUsers()` - Admin list with user info
- `updateApiKeyLastUsed()` - Track usage timestamp
- `updateApiKeyStatus()` - Revoke/activate keys
- `updateApiKeyMetadata()` - Update description/scopes
- `deleteApiKeyById()` - Permanent deletion
- `deleteExpiredApiKeys()` - Cleanup expired keys
- `countActiveApiKeysByUserId()` - Quota management

**Design Principles**:
- NO business logic (validation, hashing, etc.)
- Consistent JSON serialization for scopes
- Clear logging for debugging
- Returns parsed objects (scopes as arrays, not strings)

#### Refactored: `ApiKeyService`
**File**: `src/api/shared/services/api-key.service.ts`

**Constructor Updated**:
```typescript
constructor(
  private readonly apiKeyDatabaseService: ApiKeyDatabaseService,  // NEW: API key data
  private readonly jwtDatabaseService: JwtDatabaseService,        // User lookups only
  private readonly configService: ConfigService,
) {}
```

**Business Logic Preserved**:
- API key generation (prefix + secret)
- Hashing/verification (bcrypt)
- Scope validation and checking
- User ownership validation
- Admin operation authorization

#### Cleaned: `JwtDatabaseService`
**File**: `src/api/shared/services/jwt-database.service.ts`

**Removed** (Moved to ApiKeyDatabaseService):
- All 10 API key CRUD methods

**Now Only Handles**:
- User authentication and management
- Email verification tokens
- Password reset tokens

### Module Registration

**AuthModule** (`src/api/modules/auth.module.ts`):
```typescript
providers: [
  JwtDatabaseService,
  ApiKeyDatabaseService,    // NEW: Required by ApiKeyService
  ApiKeyService,             // Depends on both database services
  // ... other providers
]
```

**AdminModule** (`src/api/modules/admin.module.ts`):
```typescript
providers: [
  ApiKeyService,
  ApiKeyDatabaseService,    // Pure data access
  JwtDatabaseService,       // User operations only
]
```

### Benefits Achieved

#### ✅ Clean Architecture
- **Single Responsibility**: Each service has one clear purpose
- **Domain-Driven Design**: API keys and JWT are properly separated
- **Consistent Patterns**: All data access follows same structure
- **No Business Logic in Data Layer**: Pure separation of concerns

#### ✅ Maintainability
- New developers immediately understand service boundaries
- Adding new API key features only touches ApiKeyDatabaseService
- Testing is simpler (mock one service instead of mixed responsibilities)
- Changes to one domain don't affect the other

#### ✅ Zero Breaking Changes
- All existing functionality preserved
- API contracts unchanged
- CLI scripts updated and working
- Admin endpoints functional

### Why This Matters

**Before**: "Why does the JWT database service handle API keys?"
**After**: "API keys have their own data service, clean and clear."

This refactor represents **textbook clean architecture** and sets the pattern for future service development. It prevents architectural debt accumulation and makes the codebase more maintainable for years to come.

### Trade-offs
- ✅ **Pros**: Perfect separation of concerns, easy to maintain, clear responsibilities
- ❌ **Cons**: One additional service file, slightly more complex module setup
- **Verdict**: The benefits far outweigh the minimal added complexity

## See Also

- [Prometheus Setup Guide](./monitoring/PROMETHEUS_SETUP.md)
- [Authentication Architecture](./../documentation/01.%20ARCHITECTURE_DECISIONS.md)
- [API Documentation](./../src/api/API_DOCUMENTATION.md)
