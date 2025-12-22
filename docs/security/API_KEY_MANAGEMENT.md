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

## See Also

- [Prometheus Setup Guide](./monitoring/PROMETHEUS_SETUP.md)
- [Authentication Architecture](./../documentation/01.%20ARCHITECTURE_DECISIONS.md)
- [API Documentation](./../src/api/API_DOCUMENTATION.md)
