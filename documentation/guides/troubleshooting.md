# 🚨 Troubleshooting Guide

## 🎯 Common Issues & Solutions

This guide covers the most common problems you might encounter when using the Wallet Analysis System and how to resolve them.

## 🔧 Setup & Installation Issues

### **Issue: "Cannot find module" errors**
**Symptoms**: Node.js can't find required modules after installation

**Solutions**:
```bash
# 1. Clean install
rm -rf node_modules package-lock.json
npm install

# 2. Check Node.js version
node --version  # Should be 18+
npm --version   # Should be 9+

# 3. Clear npm cache
npm cache clean --force
npm install
```

**Prevention**: Always use the exact Node.js version specified in the project

### **Issue: Prisma client not generated**
**Symptoms**: Database operations fail with "PrismaClient not found"

**Solutions**:
```bash
# 1. Generate Prisma client
npx prisma generate

# 2. If that fails, reset and regenerate
npx prisma migrate reset
npx prisma generate

# 3. Check schema file exists
ls -la prisma/schema.prisma
```

**Prevention**: Run `npx prisma generate` after any schema changes

### **Issue: Database connection failed**
**Symptoms**: "Database connection failed" or "SQLite database locked"

**Solutions**:
```bash
# 1. Check database file exists
ls -la prisma/dev.db

# 2. Check file permissions
chmod 644 prisma/dev.db

# 3. Reset database if corrupted
npx prisma migrate reset
npx prisma migrate dev --name init
```

**Prevention**: Don't manually edit the database file, use Prisma migrations

## 🌐 API & Backend Issues

### **Issue: "Cannot connect to Redis"**
**Symptoms**: Backend fails to start with Redis connection errors

**Solutions**:
```bash
# 1. Check Redis is running
redis-cli ping  # Should return "PONG"

# 2. Start Redis if stopped
# macOS
brew services start redis

# Ubuntu/Debian
sudo systemctl start redis

# Windows (WSL)
sudo service redis-server start

# 3. Check Redis URL in .env
REDIS_URL="redis://localhost:6379"
```

**Prevention**: Always start Redis before starting the backend

### **Issue: "API key validation failed"**
**Symptoms**: API requests return 401 Unauthorized

**Solutions**:
```bash
# 1. Check API key format
# Should be a long string like: abc123def456...

# 2. Verify key in database
npx prisma studio
# Check Users table for your API key

# 3. Regenerate API key if needed
# Use the user management endpoint or CLI tool
```

**Prevention**: Store API keys securely and don't share them

### **Issue: "Rate limit exceeded"**
**Symptoms**: API returns 429 Too Many Requests

**Solutions**:
```bash
# 1. Wait for rate limit to reset (usually 1 minute)
# 2. Reduce request frequency
# 3. Check your current usage
curl -H "X-API-Key: your_key" \
  http://localhost:3001/api/v1/health
```

**Prevention**: Implement exponential backoff in your API client

## 📊 Analysis & Data Issues

### **Issue: "No transactions found"**
**Symptoms**: Analysis returns empty results

**Solutions**:
```bash
# 1. Check wallet has activity
# Verify the wallet address is correct
# Check if wallet has recent transactions

# 2. Verify Helius API key
# Test with a known active wallet first

# 3. Check time range
# Try expanding the analysis period
npx ts-node src/scripts/helius-analyzer.ts \
  --address YOUR_WALLET \
  --startDate 2024-01-01 \
  --endDate 2024-12-31
```

**Prevention**: Always verify wallet addresses and check for recent activity

### **Issue: "Helius API rate limit exceeded"**
**Symptoms**: Analysis fails with Helius rate limit errors

**Solutions**:
```bash
# 1. Wait 5-10 minutes for rate limit to reset
# 2. Use smaller batch sizes
npx ts-node src/scripts/helius-analyzer.ts \
  --address YOUR_WALLET \
  --limit 50

# 3. Check your Helius plan limits
# Free tier: 100 requests/minute
# Paid tiers: Higher limits
```

**Prevention**: Use smart fetching and avoid analyzing multiple wallets simultaneously

### **Issue: "Analysis job failed"**
**Symptoms**: Background analysis jobs fail with errors

**Solutions**:
```bash
# 1. Check job logs
# View the job status endpoint
GET /analyses/jobs/{jobId}/status

# 2. Check Redis and database health
redis-cli ping
npx prisma studio

# 3. Restart the job queue system
npm run start:dev
```

**Prevention**: Monitor system resources and ensure Redis is stable

## 🖥️ Frontend & Dashboard Issues

### **Issue: Dashboard shows "Loading..." indefinitely**
**Symptoms**: Dashboard never loads data

**Solutions**:
```bash
# 1. Check backend is running
curl http://localhost:3001/api/v1/health

# 2. Check browser console for errors
# Open Developer Tools (F12) and check Console tab

# 3. Verify API key is set
# Check localStorage for NEXT_PUBLIC_API_KEY

# 4. Check CORS configuration
# Backend should allow requests from frontend domain
```

**Prevention**: Always start backend before frontend

### **Issue: Charts not displaying**
**Symptoms**: Dashboard loads but charts are empty or broken

**Solutions**:
```bash
# 1. Check browser console for JavaScript errors
# 2. Verify data is being returned from API
# 3. Check chart library versions are compatible
# 4. Try refreshing the page
```

**Prevention**: Test with known good data first

### **Issue: "Failed to fetch" errors**
**Symptoms**: Network errors when calling API endpoints

**Solutions**:
```bash
# 1. Check backend is accessible
curl http://localhost:3001/api/v1/health

# 2. Verify CORS configuration
# Backend should allow frontend origin

# 3. Check network connectivity
# Try accessing backend directly in browser

# 4. Verify API key is valid
```

**Prevention**: Test API endpoints independently before using frontend

## 🗄️ Database Issues

### **Issue: "Database schema out of sync"**
**Symptoms**: Prisma operations fail with schema mismatch errors

**Solutions**:
```bash
# 1. Check migration status
npx prisma migrate status

# 2. Apply pending migrations
npx prisma migrate deploy

# 3. Reset database if needed (WARNING: loses data)
npx prisma migrate reset
npx prisma migrate dev --name init
```

**Prevention**: Always run migrations after pulling code changes

### **Issue: "Database file corrupted"**
**Symptoms**: SQLite errors or unexpected behavior

**Solutions**:
```bash
# 1. Backup current database
cp prisma/dev.db prisma/dev.db.backup

# 2. Reset database
npx prisma migrate reset

# 3. Re-run analysis on wallets
npx ts-node src/scripts/helius-analyzer.ts \
  --address YOUR_WALLET
```

**Prevention**: Regular backups and don't manually edit database files

### **Issue: "Migration failed"**
**Symptoms**: Database migrations fail to apply

**Solutions**:
```bash
# 1. Check migration files
ls -la prisma/migrations/

# 2. Reset migration state
npx prisma migrate reset

# 3. Check for conflicting changes
# Review migration files for errors

# 4. Manual migration if needed
npx prisma db push
```

**Prevention**: Test migrations on development database first

## 🔍 Debugging Techniques

### **Enable Debug Logging**
```bash
# Backend debug mode
LOG_LEVEL=debug npm run start:dev

# Script debug mode
npx ts-node src/scripts/helius-analyzer.ts \
  --address YOUR_WALLET \
  --verbose
```

### **Check System Resources**
```bash
# Check Redis memory usage
redis-cli info memory

# Check database size
ls -lh prisma/dev.db

# Check Node.js memory usage
node --max-old-space-size=4096 src/main.ts
```

### **Monitor Network Requests**
```bash
# Check API responses
curl -v -H "X-API-Key: your_key" \
  http://localhost:3001/api/v1/wallets/YOUR_WALLET/summary

# Check Helius API
curl -H "Authorization: Bearer YOUR_HELIUS_KEY" \
  "https://api.helius.xyz/v0/addresses/YOUR_WALLET/transactions?api-key=YOUR_KEY"
```

## 📞 Getting Additional Help

### **When to Create an Issue**
- **Bug Reports**: Include error messages, steps to reproduce, and system info
- **Feature Requests**: Describe the use case and expected behavior
- **Documentation Issues**: Note what's unclear or missing

### **Information to Include**
```bash
# System Information
node --version
npm --version
uname -a  # or systeminfo on Windows

# Error Messages
# Copy the full error message and stack trace

# Steps to Reproduce
# Detailed steps that lead to the issue

# Expected vs Actual Behavior
# What you expected to happen vs what actually happened
```

### **Community Resources**
- **GitHub Issues**: For bugs and feature requests
- **GitHub Discussions**: For questions and help
- **Documentation**: Check this guide and other docs first
- **Code Examples**: Look at existing scripts and tests

## 🚀 Prevention Best Practices

### **Development Environment**
- Use exact Node.js version specified in project
- Always run `npm install` after pulling changes
- Keep dependencies updated regularly
- Use virtual environments when possible

### **Data Management**
- Regular database backups
- Test with small datasets first
- Monitor API rate limits
- Validate wallet addresses before analysis

### **System Monitoring**
- Check system resources regularly
- Monitor Redis memory usage
- Watch for failed jobs
- Set up health check monitoring

---

**Last Updated**: August 2025  
**Maintainer**: Support Team  
**Related Docs**: 
- [Quick Start Guide](../02.%20QUICK_START.md)
- [API Reference](../03.%20API_REFERENCE.md)
- [Development Guide](./development.md)

**💡 Tip**: Most issues can be resolved by checking the logs and following the troubleshooting steps above. If you're still stuck, create a detailed issue with all the information requested.
