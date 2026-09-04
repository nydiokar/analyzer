# 🚀 Deployment Architecture Implementation

> **Production deployment notice:** This document contains historical
> architecture notes. The active production procedure is
> [`deployment/README.md`](../../../deployment/README.md). Production builds
> happen in GitHub Actions, images are published to GHCR, and the server pulls
> an immutable full-git-SHA image. Do not use the PM2/host-build commands below
> for the current Docker Compose production stack.

## 🎯 Overview

The Wallet Analysis System implements a **hybrid deployment strategy** combining self-hosted backend infrastructure with cloud-hosted frontend, optimized for cost, control, and performance.

## 🏗️ Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    HYBRID DEPLOYMENT                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────────────────────────┐  │
│  │   Backend       │  │          Frontend                   │  │
│  │   (Self-Hosted) │  │          (Vercel)                   │  │
│  │                 │  │                                     │  │
│  │ • Raspberry Pi  │  │ • Next.js 14 App Router            │  │
│  │ • Node.js API   │  │ • Global CDN                        │  │
│  │ • SQLite DB     │  │ • Automatic deployments             │  │
│  │ • Redis Cache   │  │ • Edge functions                    │  │
│  │ • PM2 Process   │  │                                     │  │
│  │   Management    │  │                                     │  │
│  └─────────────────┘  └─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 🖥️ Historical Backend Deployment Implementation

The PM2 and host-build sections below describe the former deployment model.
They remain historical architecture context only; they are not production
instructions for the current Docker Compose deployment.

### Self-Hosted Infrastructure

**Hardware**: Raspberry Pi 5 for cost-effective, always-on processing

**Key Components**:
- **Application Server**: Node.js/NestJS API server
- **Database**: SQLite with automatic backups
- **Cache Layer**: Redis for session management and job queuing
- **Process Management**: PM2 for reliability and monitoring
- **Reverse Proxy**: Nginx for SSL termination and load balancing

### PM2 Process Management Implementation

**Configuration Strategy**:
```json
// ecosystem.config.js
{
  "apps": [
    {
      "name": "wallet-analyzer-api",
      "script": "dist/main.js",
      "instances": 1,
      "exec_mode": "fork",
      "env": {
        "NODE_ENV": "production",
        "PORT": 3000
      },
      "env_production": {
        "NODE_ENV": "production",
        "PORT": 3000
      }
    }
  ]
}
```

**Process Management Features**:
- **Automatic Restarts**: Failed processes restart automatically
- **Memory Monitoring**: Process memory limits and alerts
- **Log Rotation**: Automatic log file management
- **Cluster Mode**: Multi-core utilization when needed
- **Zero Downtime**: Rolling restarts for updates

**PM2 Commands**:
```bash
# Start the application
pm2 start ecosystem.config.js --env production

# Monitor processes
pm2 monit

# View logs
pm2 logs wallet-analyzer-api

# Restart gracefully
pm2 reload wallet-analyzer-api

# Stop application
pm2 stop wallet-analyzer-api
```

## 🌐 Frontend Deployment Implementation

### Vercel Deployment Strategy

**Platform Benefits**:
- **Global CDN**: Worldwide content delivery for fast loading
- **Automatic HTTPS**: SSL certificates managed automatically
- **Preview Deployments**: Every PR gets a preview URL
- **Edge Functions**: Serverless functions at the edge
- **Analytics**: Built-in performance monitoring

**Build Configuration**:
```json
// vercel.json
{
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "framework": "nextjs",
  "regions": ["iad1", "fra1", "sin1"],
  "functions": {
    "app/api/**/*.js": {
      "runtime": "@vercel/node"
    }
  }
}
```

**Environment Variables**:
```bash
# API Configuration
NEXT_PUBLIC_API_URL=https://api.wallet-analyzer.com
NEXT_PUBLIC_WS_URL=wss://api.wallet-analyzer.com

# Feature Flags
NEXT_PUBLIC_ENABLE_SIMILARITY_LAB=true
NEXT_PUBLIC_ENABLE_ADVANCED_ANALYTICS=true
```

## 🔧 Infrastructure Setup

### Backend Server Configuration

**System Requirements**:
- **OS**: Ubuntu 22.04 LTS or Raspberry Pi OS
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 64GB SSD for database and logs
- **Network**: Stable internet connection (minimum 50Mbps)

**Software Stack**:
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# Install Nginx
sudo apt install nginx -y

# Install Redis
sudo apt install redis-server -y
```

### Database Setup

**SQLite Configuration**:
```bash
# Database directory with proper permissions
sudo mkdir -p /opt/wallet-analyzer/data
sudo chown -R wallet-analyzer:wallet-analyzer /opt/wallet-analyzer

# Backup script
#!/bin/bash
sqlite3 /opt/wallet-analyzer/data/database.db ".backup /opt/wallet-analyzer/backups/database-$(date +%Y%m%d-%H%M%S).db"
```

### SSL Configuration

**Let's Encrypt Setup**:
```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx -y

# Get SSL certificate
sudo certbot --nginx -d api.wallet-analyzer.com

# Auto-renewal (runs twice daily)
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

## 📊 Monitoring & Maintenance

### Health Checks

**Application Monitoring**:
```typescript
// Health check endpoints
GET /health         // Basic status
GET /health/detailed // Comprehensive checks
GET /health/queues  // Queue status
GET /health/metrics // Prometheus metrics
```

**System Monitoring**:
```bash
# PM2 monitoring
pm2 monit

# System resources
htop
df -h
free -h

# Redis status
redis-cli ping
redis-cli info
```

### Backup Strategy

**Automated Backups**:
```bash
#!/bin/bash
# Daily database backup
BACKUP_DIR="/opt/wallet-analyzer/backups"
DATE=$(date +%Y%m%d_%H%M%S)

# Database backup
sqlite3 /opt/wallet-analyzer/data/database.db ".backup $BACKUP_DIR/database_$DATE.db"

# Compress old backups
find $BACKUP_DIR -name "*.db" -mtime +7 -exec gzip {} \;

# Clean old compressed backups (keep 30 days)
find $BACKUP_DIR -name "*.db.gz" -mtime +30 -delete
```

**Offsite Backup**:
```bash
# Rsync to remote server
rsync -avz /opt/wallet-analyzer/backups/ user@backup-server:/backups/wallet-analyzer/
```

## 🚀 Deployment Process

### Backend Deployment

See the canonical runbook for the current Docker Compose flow. The server
either runs the systemd pull timer after one-time setup, or deliberately runs:

```bash
./deployment/scripts/deploy.sh <full-git-sha>
```

There is no production `npm ci`, host-side build, Prisma migration, or PM2
restart step in the current backend deployment path.

### Frontend Deployment

**Automatic Deployment** (Vercel):
- Push to `main` branch triggers automatic deployment
- Preview deployments for all pull requests
- Production deployment requires approval for major changes

**Manual Deployment**:
```bash
# Deploy specific commit
vercel --prod

# Rollback to previous deployment
vercel rollback
```

## 🔒 Security Considerations

### Backend Security

**Network Security**:
- **Firewall**: UFW with minimal open ports (22, 80, 443, 6379)
- **SSH Hardening**: Key-based authentication, no root login
- **Fail2Ban**: Automated IP blocking for brute force attempts

**Application Security**:
- **Rate Limiting**: NestJS throttler guard
- **CORS**: Configured origins only
- **Helmet**: Security headers middleware
- **Input Validation**: Class-validator decorators

### Frontend Security

**Content Security Policy**:
```typescript
// next.config.js
module.exports = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval';"
          }
        ]
      }
    ]
  }
}
```

## 📈 Performance Optimization

### Backend Performance

**PM2 Tuning**:
```json
{
  "apps": [
    {
      "name": "wallet-analyzer-api",
      "max_memory_restart": "1G",
      "node_args": "--max-old-space-size=1024",
      "env": {
        "UV_THREADPOOL_SIZE": 8
      }
    }
  ]
}
```

**Database Optimization**:
- **Connection Pooling**: Prisma connection limits
- **Query Optimization**: Proper indexing strategy
- **Batch Processing**: Large operations in chunks

### Frontend Performance

**Vercel Optimizations**:
- **Edge Network**: Global CDN distribution
- **Image Optimization**: Next.js automatic image optimization
- **Code Splitting**: Automatic route-based splitting
- **Caching**: Aggressive caching headers

## 🔄 Scaling Strategy

### Horizontal Scaling

**Load Balancing**:
```nginx
# nginx.conf
upstream backend {
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
}

server {
    listen 443 ssl;
    server_name api.wallet-analyzer.com;

    location / {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Vertical Scaling

**Resource Allocation**:
- **CPU**: Upgrade Raspberry Pi model for more cores
- **Memory**: Increase RAM for larger analysis operations
- **Storage**: SSD upgrades for faster database access
- **Network**: Higher bandwidth for API-heavy operations

## 📊 Cost Analysis

### Monthly Costs

**Backend (Self-Hosted)**:
- **Hardware**: Raspberry Pi 5 (~$60 one-time)
- **Electricity**: ~$5/month
- **Domain**: ~$12/year
- **SSL**: Free (Let's Encrypt)
- **Total**: ~$5/month

**Frontend (Vercel)**:
- **Hobby Plan**: $0/month (up to 100GB bandwidth)
- **Pro Plan**: $20/month (if needed for higher limits)
- **Domain**: ~$12/year

**Total Monthly Cost**: ~$5-25/month

### Cost Benefits

- **Control**: Full infrastructure control and customization
- **Scalability**: Pay only for what you use
- **Reliability**: Always-on hardware vs cloud costs
- **Performance**: Local processing for compute-intensive tasks

## 🚨 Disaster Recovery

### Backup Strategy

**Multi-Level Backups**:
- **Database**: Daily automated SQLite backups
- **Configuration**: Version-controlled configuration files
- **Code**: Git repository with full history
- **Infrastructure**: Infrastructure-as-code with Ansible

### Recovery Procedures

**Database Recovery**:
```bash
# Stop the application
pm2 stop wallet-analyzer-api

# Restore from backup
cp /opt/wallet-analyzer/backups/database_latest.db /opt/wallet-analyzer/data/database.db

# Restart application
pm2 start wallet-analyzer-api
```

**Full System Recovery**:
```bash
# Reprovision server
ansible-playbook -i inventory.ini deploy.yml

# Restore data
rsync -avz backup-server:/backups/wallet-analyzer/ /opt/wallet-analyzer/

# Deploy application
npm run deploy
```

---

## 📚 Related Documentation

- **[API Layer](./../api/README.md)** - Backend API implementation
- **[Frontend Dashboard](./../frontend/README.md)** - Frontend deployment details
- **[Security Implementation](./../security/API_KEY_MANAGEMENT.md)** - Security configurations
- **[Queue System](./../queues/README.md)** - Background job processing
