# 🔑 API Key Management Guide

## Overview

This guide covers API key management in Sova Intel, including creation, usage, scoping, and administration through both CLI and web interfaces.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [API Key vs JWT Authentication](#api-key-vs-jwt-authentication)
3. [API Key Scopes](#api-key-scopes)
4. [CLI Management](#cli-management)
5. [Admin Panel Management](#admin-panel-management)
6. [Security Best Practices](#security-best-practices)
7. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

### Service Layer

```
┌──────────────────┐
│  ApiKeyService   │  ← Business Logic (hashing, validation, authorization)
│  (Business)      │
└────────┬─────────┘
         │
┌────────▼──────────────┐
│ ApiKeyDatabaseService │  ← Pure Data Access (CRUD operations)
│ (Data Layer)          │
└───────────────────────┘
```

**ApiKeyService** (`src/api/shared/services/api-key.service.ts`):
- API key generation and hashing
- Scope validation and checking
- User ownership validation
- Admin operation authorization

**ApiKeyDatabaseService** (`src/api/shared/services/api-key-database.service.ts`):
- Pure database CRUD operations
- JSON serialization for scopes
- No business logic

---

## API Key vs JWT Authentication

### When to Use API Keys

✅ **Use API Keys for**:
- Service-to-service authentication (Prometheus, CI/CD)
- Long-running integrations
- Automated scripts and cron jobs
- External system integrations
- Machine-to-machine communication

### When to Use JWT

✅ **Use JWT for**:
- Human user authentication (dashboard, browser)
- Short-lived sessions (30-minute access tokens)
- Identity-based authentication
- Admin panel access

### Key Differences

| Feature | API Keys | JWT Tokens |
|---------|----------|------------|
| **Purpose** | Services & Integrations | Human Users |
| **Lifespan** | Long-lived (or unlimited) | Short-lived (30 min access) |
| **Scopes** | Explicit (`read`, `admin`, etc.) | None (identity only) |
| **Storage** | Environment variables, secrets | Browser memory/storage |
| **Revocation** | Instant (database flag) | Instant (token refresh) |
| **Use Case** | Prometheus scraping | Dashboard login |

---

## API Key Scopes

API keys use **permission-based scoping** for fine-grained access control.

### Available Scopes

#### `read`
- **Access**: Read-only operations
- **Can**: View wallet data, analyses, token info
- **Cannot**: Trigger analyses, modify data, access admin endpoints
- **Use Case**: External dashboards, read-only integrations

#### `report`
- **Access**: Read operations + report generation
- **Can**: Everything in `read` + generate reports
- **Cannot**: Trigger analyses, modify data, access admin endpoints
- **Use Case**: Reporting systems, data exports

#### `analysis`
- **Access**: Read + trigger wallet analyses
- **Can**: Everything in `read` + queue analysis jobs
- **Cannot**: Modify system data, access admin endpoints
- **Use Case**: Automated wallet analysis pipelines

#### `admin`
- **Access**: All operations including admin endpoints
- **Can**: Everything + access health metrics, queue stats, admin panel
- **Cannot**: Nothing (full access except user management)
- **Use Case**: Prometheus monitoring, system administration

#### `full`
- **Access**: Complete system access
- **Can**: Everything in all scopes
- **Cannot**: Nothing (complete access)
- **Use Case**: Root service accounts, emergency access

### Scope Hierarchy

```
full (all access)
  └─> admin (admin endpoints)
      └─> analysis (trigger jobs)
          └─> report (generate reports)
              └─> read (read-only)
```

**Note**: `full` and `admin` scopes grant access to **all** operations, not just their specific level.

---

## CLI Management

### Installation

The CLI tool is included in the project scripts:

```bash
npm run apikey:manage
```

### Commands

#### Create API Key

```bash
npm run apikey:manage create <userId> \
  --description "Prometheus Scraper" \
  --scopes admin \
  --expires 365
```

**Parameters**:
- `<userId>` (required): User ID to associate the key with
- `--description`, `-d`: Description of the key's purpose
- `--scopes`, `-s`: Comma-separated scopes (e.g., `read,report` or `admin`)
- `--expires`, `-e`: Expiration in days (omit for no expiration)

**Example Output**:
```
✅ API Key Created Successfully!
API Key: ak_test_Ab3d5fGhJ9kLmN0pQrS2tUvW4xYz
Prefix:  ak_test
User ID: user_123
Scopes:  admin
Expires: 2026-12-04

⚠️  SAVE THIS KEY NOW - IT WILL NOT BE SHOWN AGAIN!
```

#### List API Keys

```bash
# List all API keys
npm run apikey:manage list

# List keys for specific user
npm run apikey:manage list --user <userId>
```

#### Revoke API Key

```bash
npm run apikey:manage revoke <keyId>
```

**Note**: Revoked keys remain in the database but `isActive=false`. They can be permanently deleted later.

#### Update API Key

```bash
npm run apikey:manage update <keyId> \
  --description "Updated description" \
  --scopes read,report
```

#### Delete API Key

```bash
npm run apikey:manage delete <keyId>
```

**Warning**: This permanently deletes the key. Use `revoke` for temporary deactivation.

---

## Admin Panel Management

### Accessing the Admin Panel

**URL**: `https://your-domain.com/admin/api-keys`

**Requirements**:
- Must be logged in with JWT
- User ID or email must be in `ADMIN_USER_IDS` or `ADMIN_EMAILS` environment variables

**Security**:
- ✅ Completely invisible to non-admin users (no link, no 403 page)
- ✅ Silent redirect to home if accessed by non-admin
- ✅ No flash of content before redirect

### Features

#### 1. Create API Key

1. Click **"Create API Key"** button
2. Fill in the form:
   - **User ID**: Target user for the key
   - **Description**: Purpose of the key
   - **Scopes**: Select one or more scopes (click badges to toggle)
   - **Expires In Days**: Optional expiration (leave empty for no expiration)
3. Click **"Create"**
4. **CRITICAL**: Copy the API key immediately - it will NEVER be shown again

#### 2. List API Keys

The admin panel shows all API keys with:
- **Prefix**: First part of the key (e.g., `ak_live`)
- **Status**: Active (green) or Revoked (gray)
- **Description**: Purpose of the key
- **User**: Email or user ID
- **Scopes**: Permission badges
- **Created**: Creation date
- **Expires**: Expiration date (if set)
- **Last Used**: Last authentication timestamp

#### 3. Revoke API Key

1. Find the key in the list
2. Click **"Revoke"** button
3. Confirm the action
4. Key is immediately deactivated

**Effect**: Authentication attempts with this key will fail immediately.

#### 4. Delete API Key (Permanent)

Currently available only via CLI (`npm run apikey:manage delete <keyId>`).

---

## Security Best Practices

### Key Generation

✅ **DO**:
- Use descriptive names: `"Prometheus Production Scraper"`
- Set appropriate scopes (least privilege principle)
- Set expiration dates for temporary integrations
- Document key purpose and location of use

❌ **DON'T**:
- Create `full` scope keys unless absolutely necessary
- Share API keys across multiple services
- Store keys in version control (use `.env` files)
- Hardcode keys in application code

### Key Storage

✅ **Recommended**:
```bash
# Environment variables
export SOVA_API_KEY="ak_live_..."

# .env files (not committed to git)
SOVA_API_KEY=ak_live_...

# Secret managers (production)
aws secretsmanager get-secret-value --secret-id sova-api-key
```

❌ **Avoid**:
- Hardcoding in source code
- Storing in configuration files committed to git
- Passing in URLs or query parameters
- Storing in client-side code

### Key Rotation

**Recommended Schedule**:
- **Production keys**: Rotate every 90 days
- **Development keys**: Rotate every 180 days
- **Admin keys**: Rotate every 30 days
- **Compromised keys**: Revoke immediately

**Rotation Process**:
1. Create new API key with same scopes
2. Update all services to use new key
3. Verify services work with new key
4. Revoke old key
5. Monitor for authentication errors
6. Delete old key after 7 days

### Monitoring

**Monitor for**:
- Failed authentication attempts (check logs)
- Keys not used in 90+ days (audit for removal)
- Multiple keys for same purpose (consolidate)
- Keys without expiration dates (set expiration)

---

## Integration Examples

### Prometheus Scraper

**Create Key**:
```bash
npm run apikey:manage create <userId> \
  --description "Prometheus Production Metrics" \
  --scopes admin
```

**Configure Prometheus** (`prometheus.yml`):
```yaml
scrape_configs:
  - job_name: 'sova-intel'
    static_configs:
      - targets: ['api.sova.intel']
    scheme: https
    metrics_path: '/health/metrics'
    authorization:
      type: Bearer
      credentials: 'ak_live_YOUR_KEY_HERE'
```

**Why `admin` scope?** The `/health/metrics` endpoint requires admin privileges to prevent infrastructure enumeration attacks.

### CI/CD Pipeline

**Create Key**:
```bash
npm run apikey:manage create <userId> \
  --description "GitHub Actions CI Pipeline" \
  --scopes read,analysis \
  --expires 365
```

**GitHub Actions** (`.github/workflows/analyze.yml`):
```yaml
env:
  SOVA_API_KEY: ${{ secrets.SOVA_API_KEY }}

steps:
  - name: Analyze Wallet
    run: |
      curl -X POST https://api.sova.intel/analyses/wallets/dashboard-analysis \
        -H "X-API-Key: $SOVA_API_KEY" \
        -H "Content-Type: application/json" \
        -d '{"walletAddress": "${{ inputs.wallet }}"}'
```

### External Dashboard (Read-Only)

**Create Key**:
```bash
npm run apikey:manage create <userId> \
  --description "Public Dashboard Read Access" \
  --scopes read
```

**Usage**:
```javascript
const response = await fetch('https://api.sova.intel/wallets/ABC123/summary', {
  headers: {
    'X-API-Key': process.env.SOVA_API_KEY
  }
});
```

---

## Troubleshooting

### "Invalid API Key" Error

**Symptoms**: 401 Unauthorized response

**Possible Causes**:
1. ❌ Key was revoked → Check admin panel or CLI
2. ❌ Key expired → Check expiration date
3. ❌ Wrong key format → Must be `ak_live_...` or `ak_test_...`
4. ❌ Typo in key → Verify exact key value
5. ❌ User account disabled → Check user status

**Solutions**:
```bash
# Check key status
npm run apikey:manage list --user <userId>

# Create new key if revoked/expired
npm run apikey:manage create <userId> --scopes <scopes>
```

### "Insufficient Permissions" Error

**Symptoms**: 403 Forbidden response

**Possible Causes**:
1. ❌ Key lacks required scope → Check scopes in admin panel
2. ❌ Endpoint requires admin privileges → Use `admin` or `full` scope
3. ❌ User account is demo account → Demo accounts have restrictions

**Solutions**:
```bash
# Update key scopes
npm run apikey:manage update <keyId> --scopes admin

# Or create new key with correct scopes
npm run apikey:manage create <userId> --scopes admin,read
```

### Key Not Working After Creation

**Symptoms**: 401 immediately after creating key

**Checklist**:
1. ✅ Copied the complete key (including prefix)
2. ✅ No extra whitespace in environment variable
3. ✅ Using correct header: `X-API-Key: ak_live_...`
4. ✅ User account is active (`isActive=true`)

**Test**:
```bash
# Test key directly
curl -H "X-API-Key: YOUR_KEY" https://api.sova.intel/health
```

### Admin Panel Not Visible

**Symptoms**: No "Admin Panel" link in sidebar

**Requirements**:
- ✅ Logged in with JWT (not API key)
- ✅ User ID in `ADMIN_USER_IDS` environment variable
- ✅ OR email in `ADMIN_EMAILS` environment variable

**Check Configuration**:
```bash
# On server
echo $ADMIN_USER_IDS
echo $ADMIN_EMAILS

# Verify user ID
curl -H "Authorization: Bearer YOUR_JWT" https://api.sova.intel/auth/me
# Should return: { ..., "isAdmin": true }
```

### API Key Database Service Error

**Symptoms**: "Cannot find ApiKeyDatabaseService" error

**Cause**: Service not registered in module

**Fix**: Verify `ApiKeyDatabaseService` is in module providers:
```typescript
// AuthModule or AdminModule
providers: [
  ApiKeyDatabaseService,  // Must be present
  ApiKeyService,          // Depends on ApiKeyDatabaseService
  // ...
]
```

---

## Reference

### Environment Variables

```bash
# Admin Configuration
ADMIN_USER_IDS=user_123,user_456         # Comma-separated user IDs
ADMIN_EMAILS=admin@example.com           # Comma-separated emails

# JWT Configuration
JWT_SECRET=<64-char-base64-secret>       # Required for JWT auth
JWT_EXPIRES_IN=30m                        # Access token TTL

# Database
DATABASE_URL=file:./prisma/dev.db        # SQLite database path
```

### API Endpoints

#### API Key Operations (Admin Only)
- `GET /admin/api-keys` - List all API keys
- `POST /admin/api-keys` - Create API key
- `PATCH /admin/api-keys/:keyId/revoke` - Revoke API key
- `PATCH /admin/api-keys/:keyId` - Update API key
- `DELETE /admin/api-keys/:keyId` - Delete API key

#### Authentication
- `POST /auth/register` - Register new user (returns JWT + refresh token)
- `POST /auth/login` - Login (returns JWT + refresh token)
- `POST /auth/refresh` - Refresh access token
- `GET /auth/me` - Get current user (includes `isAdmin` flag)

### CLI Commands Summary

```bash
# Create key
npm run apikey:manage create <userId> -d "Description" -s admin -e 365

# List keys
npm run apikey:manage list [--user <userId>]

# Revoke key
npm run apikey:manage revoke <keyId>

# Update key
npm run apikey:manage update <keyId> -d "New desc" -s read,report

# Delete key (permanent)
npm run apikey:manage delete <keyId>
```

---

**Last Updated**: December 4, 2025
**Maintainer**: Sova Intel Team
**Related Docs**:
- [Architecture Decisions](../01.%20ARCHITECTURE_DECISIONS.md)
- [Prometheus Setup](../monitoring/PROMETHEUS_SETUP.md)
- [API Documentation](../../src/api/API_DOCUMENTATION.md)
