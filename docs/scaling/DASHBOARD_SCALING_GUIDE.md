# Dashboard Analysis Scaling Guide

## Executive Summary

This guide provides comprehensive instructions for scaling the dashboard wallet analysis system from initial deployment to enterprise-grade performance. The system is designed to handle everything from single-user scenarios to high-traffic production environments.

## Current System Capacity

### **Baseline Performance (Single Instance)**
```typescript
// Current Configuration (src/queues/config/queue.config.ts)
concurrency: 8,                    // 8 parallel dashboard analyses
removeOnComplete: 100,             // Job history retention
removeOnFail: 200,                 // Error analysis retention
stalledInterval: 30000,            // 30s stall detection
```

**Performance Metrics:**
- **Concurrent Analyses**: 8 wallets simultaneously
- **Average Processing Time**: 30-60 seconds per wallet
- **Throughput**: 8-16 wallets per minute
- **Response Time**: < 100ms (job submission)
- **Supported Concurrent Users**: 20-30 users

---

## Scaling Strategies

### **1. Vertical Scaling (Increase Worker Concurrency)**

**When to Use**: 
- Single server with available CPU/memory
- Quick scaling need (< 5 minutes to deploy)
- Budget constraints (no additional infrastructure)

**Capacity Increases**:
```typescript
// Conservative Scaling (+60% capacity)
concurrency: 12,  // 12 concurrent analyses
// Supports: 30-40 concurrent users

// Aggressive Scaling (+150% capacity) 
concurrency: 20,  // 20 concurrent analyses  
// Supports: 50-70 concurrent users

// Maximum Single-Instance Scaling (+250% capacity)
concurrency: 28,  // 28 concurrent analyses
// Supports: 80-100 concurrent users
```

**Implementation Steps**:

1. **Update Queue Configuration**
   ```bash
   # Edit src/queues/config/queue.config.ts
   vi src/queues/config/queue.config.ts
   ```

2. **Modify Concurrency Setting**
   ```typescript
   [QueueNames.ANALYSIS_OPERATIONS]: {
     workerOptions: {
       connection: redisConnection,
       concurrency: 16,  // Increase from 8 to 16
       maxStalledCount: 5,  // Increase proportionally  
       stalledInterval: 20000,  // More frequent monitoring
     }
   }
   ```

3. **Update Resource Allocation**
   ```typescript
   // Also increase job retention for debugging high-traffic scenarios
   defaultJobOptions: {
     removeOnComplete: 200,  // Increase from 100
     removeOnFail: 400,      // Increase from 200
   }
   ```

4. **Deploy Changes**
   ```bash
   # Build and restart application
   npm run build
   pm2 restart ecosystem.config.js
   
   # Monitor performance
   pm2 logs sova-backend-api --lines 100
   ```

5. **Performance Validation**
   ```bash
   # Check queue stats after 10 minutes
   curl http://localhost:3001/jobs/queue/analysis-operations/stats
   
   # Monitor Redis memory usage
   redis-cli info memory
   
   # Check system resources
   htop
   ```

**Resource Requirements**:
- **CPU**: +2 cores per 8 additional workers
- **Memory**: +2GB RAM per 8 additional workers  
- **Redis**: +500MB per 8 additional workers

---

### **2. Horizontal Scaling (Multiple Server Instances)**

**When to Use**:
- High availability requirements
- Traffic > 100 concurrent users
- Geographic distribution needed
- Disaster recovery requirements

**Architecture Overview**:
```
Load Balancer (nginx/AWS ALB)
├── Instance 1: 8 workers  → 8-16 wallets/min
├── Instance 2: 8 workers  → 8-16 wallets/min  
└── Instance 3: 8 workers  → 8-16 wallets/min
Total Capacity: 24-48 wallets/min (150+ concurrent users)
```

**Implementation Steps**:

1. **Prepare Environment Configuration**
   ```bash
   # Create production environment file
   cat > .env.production << EOF
   # Database (Shared)
   DATABASE_URL="postgresql://user:pass@postgres-cluster/analyzer"
   
   # Redis (Shared) 
   REDIS_URL="redis://redis-cluster:6379"
   
   # Instance-specific
   PORT=3001
   NODE_ENV=production
   INSTANCE_ID=\${HOSTNAME}
   
   # Queue Configuration
   QUEUE_CONCURRENCY=8
   EOF
   ```

2. **Configure Load Balancer**
   ```nginx
   # /etc/nginx/sites-available/dashboard-api
   upstream dashboard_backend {
       least_conn;  # Distribute based on active connections
       server 10.0.1.10:3001 max_fails=3 fail_timeout=30s;
       server 10.0.1.11:3001 max_fails=3 fail_timeout=30s;
       server 10.0.1.12:3001 max_fails=3 fail_timeout=30s;
   }
   
   server {
       listen 80;
       server_name api.youranalyzer.com;
       
       location / {
           proxy_pass http://dashboard_backend;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           
           # WebSocket support for job progress
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           
           # Timeouts for long-running requests
           proxy_connect_timeout 60s;
           proxy_send_timeout 60s;
           proxy_read_timeout 300s;  # 5 minutes for analysis jobs
       }
       
       # Health check endpoint
       location /health {
           proxy_pass http://dashboard_backend/health;
           access_log off;
       }
   }
   ```

3. **Deploy Multiple Instances**
   ```bash
   # Instance 1 (10.0.1.10)
   git clone https://github.com/yourorg/analyzer.git
   cd analyzer
   cp .env.production .env
   sed -i 's/INSTANCE_ID=.*/INSTANCE_ID=instance-1/' .env
   npm install
   npm run build
   pm2 start ecosystem.config.js --env production
   
   # Instance 2 (10.0.1.11) 
   # ... repeat with INSTANCE_ID=instance-2
   
   # Instance 3 (10.0.1.12)
   # ... repeat with INSTANCE_ID=instance-3
   ```

4. **Validate Cluster Health**
   ```bash
   # Check all instances are running
   for ip in 10.0.1.10 10.0.1.11 10.0.1.12; do
     echo "Checking $ip..."
     curl -s http://$ip:3001/health | jq '.'
   done
   
   # Test load balancer
   curl -s http://api.youranalyzer.com/health | jq '.'
   
   # Monitor queue distribution
   curl http://api.youranalyzer.com/jobs/queue/analysis-operations/stats
   ```

**High Availability Configuration**:
```typescript
// Enhanced retry configuration for cluster environments
[QueueNames.ANALYSIS_OPERATIONS]: {
  queueOptions: {
    defaultJobOptions: {
      attempts: 5,  // Increase for cluster resilience
      backoff: {
        type: 'exponential',
        delay: 2000,
        factor: 2,
        max: 30000  // Maximum 30s delay
      }
    }
  },
  workerOptions: {
    concurrency: 8,
    maxStalledCount: 2,  // Lower threshold in clusters
    stalledInterval: 15000,  // More frequent checks
  }
}
```

---

### **3. Queue-Specific Scaling (Dedicated Dashboard Queue)**

**When to Use**:
- Dashboard traffic >> other analysis types
- Need independent scaling of dashboard vs similarity analysis
- Performance isolation requirements

**Implementation Steps**:

1. **Create Dedicated Queue**
   ```typescript
   // src/queues/config/queue.config.ts
   export enum QueueNames {
     WALLET_OPERATIONS = 'wallet-operations',
     ANALYSIS_OPERATIONS = 'analysis-operations',  
     DASHBOARD_OPERATIONS = 'dashboard-operations',  // NEW
     SIMILARITY_OPERATIONS = 'similarity-operations',
     ENRICHMENT_OPERATIONS = 'enrichment-operations'
   }
   
   export const QueueConfigs = {
     // ... existing queues ...
     
     [QueueNames.DASHBOARD_OPERATIONS]: {
       queueOptions: {
         connection: redisConnection,
         defaultJobOptions: {
           removeOnComplete: 200,
           removeOnFail: 500,
           attempts: 3,
           backoff: {
             type: 'exponential',
             delay: 2000
           }
         }
       },
       workerOptions: {
         connection: redisConnection,
         concurrency: 16,  // Dedicated high concurrency
         maxStalledCount: 3,
         stalledInterval: 20000,
       }
     }
   }
   ```

2. **Create Dashboard Queue Service**
   ```typescript
   // src/queues/queues/dashboard-operations.queue.ts
   import { Injectable } from '@nestjs/common';
   import { Queue } from 'bullmq';
   import { QueueNames, QueueConfigs } from '../config/queue.config';
   import { DashboardWalletAnalysisJobData } from '../jobs/types';
   import { generateJobId } from '../utils/job-id-generator';
   
   @Injectable()
   export class DashboardOperationsQueue {
     private readonly queue: Queue;
   
     constructor() {
       const config = QueueConfigs[QueueNames.DASHBOARD_OPERATIONS];
       this.queue = new Queue(QueueNames.DASHBOARD_OPERATIONS, config.queueOptions);
     }
   
     async addDashboardWalletAnalysisJob(
       data: DashboardWalletAnalysisJobData, 
       options?: { priority?: number; delay?: number }
     ) {
       const jobId = generateJobId.dashboardWalletAnalysis(data.walletAddress, data.requestId);
       
       return this.queue.add('dashboard-wallet-analysis', data, {
         jobId,
         priority: options?.priority || 10,
         delay: options?.delay || 0,
       });
     }
   
     async getJob(jobId: string) {
       return this.queue.getJob(jobId);
     }
   }
   ```

3. **Create Dedicated Processor**
   ```typescript
   // src/queues/processors/dashboard-operations.processor.ts
   import { Injectable, Logger } from '@nestjs/common';
   import { Job, Worker } from 'bullmq';
   import { QueueNames, QueueConfigs } from '../config/queue.config';
   
   @Injectable()
   export class DashboardOperationsProcessor {
     private readonly logger = new Logger(DashboardOperationsProcessor.name);
     private readonly worker: Worker;
   
     constructor(
       // ... inject required services
     ) {
       const config = QueueConfigs[QueueNames.DASHBOARD_OPERATIONS];
       
       this.worker = new Worker(
         QueueNames.DASHBOARD_OPERATIONS,
         async (job: Job) => this.processJob(job),
         config.workerOptions
       );
     }
   
     private async processJob(job: Job) {
       // Reuse existing dashboard analysis logic
       // from analysis-operations.processor.ts
     }
   }
   ```

---

## Monitoring & Performance Tuning

### **Key Metrics to Monitor**

1. **Queue Performance**
   ```bash
   # Monitor queue depth and processing rate
   curl http://localhost:3001/jobs/queue/analysis-operations/stats | jq '.'
   
   # Expected healthy metrics:
   # - waiting: < 10 jobs
   # - active: 5-8 jobs (near concurrency limit)
   # - completed: increasing steadily
   # - failed: < 5% of completed
   ```

2. **System Resources**
   ```bash
   # CPU usage (should be 60-80% during peak)
   top -p $(pgrep -f "node.*main.js")
   
   # Memory usage (monitor for leaks)
   free -h && ps aux | grep "node.*main.js" | awk '{print $6}'
   
   # Redis memory
   redis-cli info memory | grep used_memory_human
   ```

3. **Application Performance**
   ```bash
   # Job completion times (should be 30-60s average)
   grep "Dashboard analysis completed" logs/app.log | tail -20
   
   # WebSocket connection stability
   grep "Client connected\|Client disconnected" logs/app.log | tail -10
   ```

### **Performance Tuning Parameters**

1. **Job Timeout Optimization**
   ```typescript
   // src/queues/config/queue.config.ts
   export const JobTimeouts = {
     'dashboard-wallet-analysis': {
       timeout: 12 * 60 * 1000,  // Reduce from 15min to 12min
       staleAfter: 15 * 60 * 1000,
       retryBackoff: 'exponential'
     }
   }
   ```

2. **Redis Configuration**
   ```bash
   # /etc/redis/redis.conf optimizations
   maxmemory 8gb
   maxmemory-policy allkeys-lru
   timeout 0
   tcp-keepalive 300
   
   # Persistence for job reliability
   save 900 1
   save 300 10
   save 60 10000
   ```

3. **Database Connection Pool**
   ```typescript
   // Optimize for high concurrency
   datasource: {
     connection_limit: 50,  // Increase for multiple workers
     pool_timeout: 30,
     idle_timeout: 300
   }
   ```

---

## Load Testing & Validation

### **Load Test Script**
```bash
#!/bin/bash
# load-test-dashboard.sh

ENDPOINT="http://localhost:3001/analyses/wallets/dashboard-analysis"
CONCURRENT_USERS=20
TEST_DURATION=300  # 5 minutes

# Test wallet addresses (use testnet/demo wallets)
WALLETS=(
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
  "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
  # ... add more test wallets
)

echo "Starting load test: $CONCURRENT_USERS users for ${TEST_DURATION}s"

# Function to submit analysis request
submit_analysis() {
  local wallet=${WALLETS[$RANDOM % ${#WALLETS[@]}]}
  local start_time=$(date +%s%N)
  
  response=$(curl -s -w "%{http_code}" -X POST $ENDPOINT \
    -H "Content-Type: application/json" \
    -d "{\"walletAddress\":\"$wallet\",\"forceRefresh\":false}")
  
  local end_time=$(date +%s%N)
  local response_time=$(( (end_time - start_time) / 1000000 ))  # Convert to milliseconds
  
  echo "$(date): Wallet $wallet | Response time: ${response_time}ms | Status: $response"
}

# Start concurrent users
for i in $(seq 1 $CONCURRENT_USERS); do
  (
    end_time=$(($(date +%s) + TEST_DURATION))
    while [ $(date +%s) -lt $end_time ]; do
      submit_analysis
      sleep $(( RANDOM % 10 + 5 ))  # Random delay 5-15 seconds
    done
  ) &
done

wait  # Wait for all background jobs to complete
echo "Load test completed"
```

### **Performance Validation Checklist**

```bash
# 1. Response Time Validation
echo "Checking API response times..."
for i in {1..10}; do
  time curl -X POST http://localhost:3001/analyses/wallets/dashboard-analysis \
    -H "Content-Type: application/json" \
    -d '{"walletAddress":"9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"}'
done

# 2. Queue Processing Validation  
echo "Monitoring queue processing..."
watch -n 5 'curl -s http://localhost:3001/jobs/queue/analysis-operations/stats | jq "."'

# 3. Memory Leak Detection
echo "Checking for memory leaks..."
for i in {1..60}; do
  ps aux | grep "node.*main.js" | awk '{print $6}' >> memory_usage.log
  sleep 60
done
# Analyze memory_usage.log for increasing trend

# 4. Error Rate Monitoring
echo "Checking error rates..."
grep -c "Dashboard analysis failed" logs/app.log
grep -c "Dashboard analysis completed" logs/app.log
```

---

## Troubleshooting Common Scaling Issues

### **High Memory Usage**
```bash
# Symptoms: Memory usage > 4GB per instance
# Causes: Memory leaks, large wallet processing, insufficient garbage collection

# Solutions:
# 1. Reduce worker concurrency temporarily
sed -i 's/concurrency: 16/concurrency: 8/' src/queues/config/queue.config.ts

# 2. Enable garbage collection optimization
export NODE_OPTIONS="--max-old-space-size=4096 --gc-interval=100"

# 3. Monitor and identify memory-heavy wallets
grep "tokens processed" logs/app.log | sort -k5 -nr | head -10
```

### **Queue Backlog/Stalled Jobs**
```bash
# Symptoms: waiting jobs > 50, stalled jobs appearing
# Causes: Worker overload, Redis connection issues, database timeouts

# Solutions:
# 1. Check Redis connectivity
redis-cli ping

# 2. Restart workers (graceful)
pm2 reload ecosystem.config.js

# 3. Clear stalled jobs
curl -X DELETE http://localhost:3001/jobs/queue/analysis-operations/jobs?status=stalled

# 4. Temporary concurrency reduction
# Edit queue config and deploy
```

### **Database Connection Pool Exhaustion**
```bash
# Symptoms: "Connection pool exhausted" errors
# Causes: Too many concurrent workers for database capacity

# Solutions:
# 1. Increase database connection pool
# Edit DATABASE_URL: ?connection_limit=100

# 2. Implement connection pooling optimization
# Add pgbouncer or similar connection pooler

# 3. Stagger worker startup
sleep $((RANDOM % 30)) && pm2 start ecosystem.config.js
```

### **WebSocket Connection Issues**
```bash
# Symptoms: Frontend not receiving progress updates
# Causes: Load balancer not configured for WebSocket, session affinity issues

# Solutions:
# 1. Enable WebSocket in nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";

# 2. Implement sticky sessions (if needed)
ip_hash;  # Add to upstream block

# 3. Use Redis adapter for WebSocket clustering
# Install socket.io-redis adapter
```

---

## Scaling Decision Matrix

| Scenario | Users | Method | Timeline | Complexity | Cost |
|----------|-------|--------|----------|------------|------|
| **Growth Phase** | 20-50 | Vertical (concurrency: 16) | 5 minutes | Low | $ |
| **Popular Launch** | 50-100 | Vertical (concurrency: 24) | 15 minutes | Low | $$ |
| **Enterprise Scale** | 100-300 | Horizontal (3 instances) | 2 hours | Medium | $$$ |
| **High Availability** | 200+ | Horizontal + Dedicated Queue | 1 day | High | $$$$ |

## Quick Reference Commands

```bash
# Check current capacity
curl http://localhost:3001/jobs/queue/analysis-operations/stats

# Scale vertically (double capacity)
sed -i 's/concurrency: 8/concurrency: 16/' src/queues/config/queue.config.ts
pm2 restart ecosystem.config.js

# Monitor performance
watch -n 5 'curl -s http://localhost:3001/jobs/queue/analysis-operations/stats | jq "."'

# Emergency queue clearing (if overwhelmed)
curl -X DELETE http://localhost:3001/jobs/queue/analysis-operations/jobs?status=waiting

# Health check all instances (horizontal scaling)
for ip in 10.0.1.10 10.0.1.11 10.0.1.12; do curl http://$ip:3001/health; done
```

---

## Support & Maintenance

For additional scaling support or custom enterprise configurations, refer to:
- **Application Logs**: `logs/app.log`
- **Queue Monitoring**: `http://localhost:3001/jobs`  
- **Health Endpoint**: `http://localhost:3001/health`
- **Redis Monitoring**: `redis-cli monitor`

**Emergency Contact**: Review system logs and queue statistics before implementing any scaling changes in production environments. 