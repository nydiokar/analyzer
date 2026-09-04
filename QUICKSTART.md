# 🚀 Quick Start Guide (local development)

This document is for local development and testing. It is not the production
deployment runbook. Production uses a prebuilt GHCR image; see
[`deployment/README.md`](deployment/README.md) for initial setup, automatic
pull deployment, manual SHA deployment, and rollback.

This guide will get your analyzer running with onchain metadata enrichment in under 5 minutes.

## Prerequisites

- **Docker Desktop** (for Redis) - [Download here](https://www.docker.com/products/docker-desktop/)
- **WSL2** enabled 
- **Helius API key** - [Get one free](https://www.helius.dev/)

## One-Command Local Setup

```bash
./setup.sh
```

This automated script will:
1. ✅ Upgrade Node.js to v22 (if needed)
2. ✅ Verify Docker is running
3. ✅ Install npm dependencies
4. ✅ Start Redis in Docker
5. ✅ Create `.env` file (if missing)
6. ✅ Run database migrations
7. ✅ Generate Prisma client

## Manual Steps

### 1. Edit `.env` file

After first run, the script will create `.env`. Edit it and add your API keys:

```bash
# Required
HELIUS_API_KEY=your_main_helius_key_here

# Optional but recommended (separate free account for metadata)
HELIUS_METADATA_API_KEY=your_metadata_key_here

# Optional (will be auto-generated if missing)
API_KEY=your_test_api_key_or_leave_this_line_out
```

### 2. Run setup again

```bash
./setup.sh
```

This time it will complete the full setup.

## Start the Backend

```bash
npm run dev
```

You should see:
```
[OnchainMetadataServiceFactory] Using separate Helius API key for metadata enrichment
[TokenInfoService] TokenInfoService initialized with price caching and onchain metadata enrichment
[NestApplication] Nest application successfully started +2ms
```

## Test It Works! 🧪

Open a new terminal and test token enrichment:

```bash
# Test with Bonk token (known token with metadata)
curl -X POST http://localhost:3000/api/token-info \
  -H "Content-Type: application/json" \
  -H "x-api-key: demo-key-123" \
  -d '{
    "tokenAddresses": ["DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"]
  }'
```

**Expected logs:**
```
[TokenInfoService] Enriching 1 tokens with 3-stage enrichment (onchain-first)
[OnchainMetadataService] Fetching basic metadata for 1 tokens via DAS API
[TokenInfoService] ✅ Stage 1: Saved basic metadata for 1 tokens
[TokenInfoService] Token enrichment triggered in 543ms (DAS completed, DexScreener and socials in background)
[TokenInfoService] ✅ Stage 2: DexScreener enrichment completed
[TokenInfoService] ✅ Stage 3: Social links fetched for 1 tokens
```

## View the Data

```bash
npx prisma studio
```

Navigate to `TokenInfo` table and check:
- **onchainName**: Should be "Bonk"
- **onchainSymbol**: Should be "Bonk"
- **onchainImageUrl**: Should have image URL
- **metadataSource**: Should be "hybrid" (both sources)

## Common Issues

### Docker not running
```bash
# Start Docker Desktop on Windows
# Then verify:
docker info
```

### Port 3000 already in use
```bash
# Find what's using it:
lsof -i :3000
# or on Windows:
netstat -ano | findstr :3000

# Kill it or change port in src/main.ts
```

### Redis connection failed
```bash
# Check Redis is running:
APP_IMAGE=sova-backend:local docker-compose ps

# Restart Redis (local development):
APP_IMAGE=sova-backend:local docker-compose restart redis

# Check logs:
APP_IMAGE=sova-backend:local docker-compose logs redis
```

### Migration fails
```bash
# Reset database and try again:
npx prisma migrate reset
./setup.sh
```

## Useful Commands

```bash
# Development (hot reload)
npm run dev

# Production build
npm run build
npm run start

# Database management
npx prisma studio          # Visual DB browser
npx prisma migrate reset   # Reset DB (dangerous!)

# Docker management
APP_IMAGE=sova-backend:local docker-compose up -d redis  # Start local Redis
APP_IMAGE=sova-backend:local docker-compose down         # Stop local stack
APP_IMAGE=sova-backend:local docker-compose logs -f      # View logs
APP_IMAGE=sova-backend:local docker-compose ps           # List services

# Testing
npm run test:unit          # Run unit tests
npm run verify             # TypeScript check
```

## What's Running?

After setup:
- **Redis**: `localhost:6379` (in Docker)
- **Backend API**: `http://localhost:3000`
- **Database**: `./dev.db` (SQLite file)

## Next Steps

1. ✅ **Test with your own tokens** - Replace the mint address in the curl command
2. ✅ **Check the frontend** - If you have the dashboard running, it should show proper metadata now
3. ✅ **Monitor Helius credits** - Check your Helius dashboard to see credit usage
4. ✅ **Create separate metadata account** - For better rate limit isolation

## Need Help?

Check the logs:
```bash
# Backend logs (in terminal where npm run dev is running)
# Watch for errors or warnings

# Redis logs
APP_IMAGE=sova-backend:local docker-compose logs redis

# Database inspection
npx prisma studio
```

---

**You're all set! 🎉**

The onchain metadata enrichment is now active. Tokens will show proper names/symbols/images immediately instead of "Unknown Token".
