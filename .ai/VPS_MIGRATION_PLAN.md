# SOVA Backend Migration: Pi → Hetzner VPS

**Created:** 2026-02-01
**Target:** Hetzner CX32 + 200GB volume
**Current DB Size:** ~2.5 GB

---

## Retention Policy (Final)

```
KEEP:    All wallet data, all SwapAnalysisInput,
         all HeliusTransactionCache, all TokenInfo
TRIM:    ActivityLog >90 days, AnalysisRun >90 days (optional, low priority)
MONITOR: Alert at 80% disk usage
VACUUM:  Run before dump, autovacuum handles the rest
```

**Philosophy:** Data is the product. Don't auto-evict. Monitor and scale storage as needed.

---

## Phase 1: Prepare Pi (Before Migration Day)

- [ ] **1.1** VACUUM ANALYZE on Pi
  ```bash
  sudo -u postgres psql -d analyzer -c "VACUUM ANALYZE;"
  ```

- [ ] **1.2** Note current wallet count (for verification later)
  ```bash
  sudo -u postgres psql -d analyzer -c "SELECT COUNT(*) FROM \"Wallet\";"
  ```

- [ ] **1.3** Verify you have all env vars documented:
  - DATABASE_URL
  - REDIS_URL / REDIS_PASSWORD
  - HELIUS_API_KEY
  - JWT secrets
  - Frontend URLs (CORS)
  - Registration mode vars
  - Any other API keys

- [ ] **1.4** Ensure new branch is pushed to git

---

## Phase 2: VPS Setup (On Hetzner)

- [ ] **2.1** SSH into VPS, verify specs
  ```bash
  df -h          # Confirm 200GB volume mounted
  free -h        # Confirm RAM
  nproc          # Confirm CPUs
  ```

- [ ] **2.2** Install dependencies
  ```bash
  sudo apt update && sudo apt install -y \
    postgresql postgresql-contrib \
    redis-server \
    nginx \
    git \
    build-essential
  ```

- [ ] **2.3** Install Node 24
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt install -y nodejs
  ```

- [ ] **2.4** Install PM2
  ```bash
  sudo npm install -g pm2
  ```

- [ ] **2.5** Configure PostgreSQL
  ```bash
  sudo -u postgres createuser analyzer
  sudo -u postgres createdb analyzer -O analyzer
  sudo -u postgres psql -c "ALTER USER analyzer WITH PASSWORD 'YOUR_SECURE_PASS';"
  ```

- [ ] **2.6** Configure Redis
  - Edit `/etc/redis/redis.conf` - set password
  - `sudo systemctl restart redis`

---

## Phase 3: Database Migration

- [ ] **3.1** ON PI - Create dump (during low traffic)
  ```bash
  sudo -u postgres pg_dump -Fc analyzer > /tmp/analyzer_dump.sql
  ```
  *Takes ~2-5 min for 2.5GB*

- [ ] **3.2** Transfer dump to VPS
  ```bash
  scp /tmp/analyzer_dump.sql user@VPS_IP:/tmp/
  ```

- [ ] **3.3** ON VPS - Restore dump
  ```bash
  sudo -u postgres pg_restore -d analyzer /tmp/analyzer_dump.sql
  ```

- [ ] **3.4** Verify row counts match
  ```bash
  sudo -u postgres psql -d analyzer -c "SELECT COUNT(*) FROM \"Wallet\";"
  # Should match Pi count from step 1.2
  ```

---

## Phase 4: Application Deploy (On VPS)

- [ ] **4.1** Clone repo (your new branch)
  ```bash
  git clone -b YOUR_BRANCH git@github.com:YOUR_REPO.git ~/analyzer
  cd ~/analyzer
  ```

- [ ] **4.2** Install dependencies
  ```bash
  npm install
  ```

- [ ] **4.3** Create .env file
  ```bash
  cp .env.example .env
  nano .env
  # Fill in VPS-specific values
  ```

- [ ] **4.4** Run Prisma migrations (if schema changed)
  ```bash
  npx prisma migrate deploy
  ```

- [ ] **4.5** Build
  ```bash
  npm run build
  ```

- [ ] **4.6** Start with PM2
  ```bash
  pm2 start ecosystem.config.js --env production
  pm2 save
  pm2 startup
  ```

---

## Phase 5: Nginx + SSL

- [ ] **5.1** Configure nginx
  ```bash
  sudo nano /etc/nginx/sites-available/sova-api
  ```

  ```nginx
  server {
      listen 80;
      server_name api.sova-intel.com;

      location / {
          proxy_pass http://localhost:3001;
          proxy_http_version 1.1;
          proxy_set_header Upgrade $http_upgrade;
          proxy_set_header Connection 'upgrade';
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
          proxy_cache_bypass $http_upgrade;
      }
  }
  ```

- [ ] **5.2** Enable site
  ```bash
  sudo ln -s /etc/nginx/sites-available/sova-api /etc/nginx/sites-enabled/
  sudo nginx -t && sudo systemctl reload nginx
  ```

- [ ] **5.3** SSL with Certbot
  ```bash
  sudo apt install certbot python3-certbot-nginx
  sudo certbot --nginx -d api.sova-intel.com
  ```

---

## Phase 6: DNS Cutover

- [ ] **6.1** Update DNS: `api.sova-intel.com` → VPS IP
  - Set TTL low (60-300s) before cutover

- [ ] **6.2** Wait for propagation (5-15 min)

- [ ] **6.3** Test external access
  ```bash
  curl https://api.sova-intel.com/health
  ```

- [ ] **6.4** Test frontend → backend connection
  - Login, fetch a wallet, verify data loads

---

## Phase 7: Monitoring Setup

- [ ] **7.1** Disk usage alert

  Create `/usr/local/bin/disk-alert.sh`:
  ```bash
  #!/bin/bash
  THRESHOLD=80
  USAGE=$(df /path/to/volume | tail -1 | awk '{print $5}' | tr -d '%')
  if [ "$USAGE" -gt "$THRESHOLD" ]; then
    echo "Disk at ${USAGE}%" | mail -s "SOVA DISK ALERT" you@email.com
  fi
  ```

  ```bash
  chmod +x /usr/local/bin/disk-alert.sh
  crontab -e
  # Add: 0 * * * * /usr/local/bin/disk-alert.sh
  ```

- [ ] **7.2** PM2 log rotation
  ```bash
  pm2 install pm2-logrotate
  pm2 set pm2-logrotate:max_size 50M
  pm2 set pm2-logrotate:retain 7
  ```

- [ ] **7.3** Helius usage - check dashboard daily during first week

---

## Phase 8: Pi as Failover

- [ ] **8.1** Keep Pi running 24-48h after cutover

- [ ] **8.2** If VPS fails → DNS back to Pi IP (instant rollback)

- [ ] **8.3** After 48h stable:
  - Stop PM2 on Pi: `pm2 stop sova-backend-api`
  - Keep DB intact (backup)
  - Optional: periodic DB sync for disaster recovery

---

## Phase 9: Pre-Warming Job (Post-Migration)

- [ ] **9.1** Create list of priority wallets

- [ ] **9.2** Run background job to pre-fetch 2-5k wallets

- [ ] **9.3** Monitor Helius credit usage during warm-up

---

## Migration Day Timeline

| Time | Action |
|------|--------|
| T-1h | VACUUM on Pi, note counts |
| T-0 | pg_dump on Pi |
| T+10m | scp dump to VPS |
| T+20m | pg_restore on VPS |
| T+30m | Verify counts, start app, test locally |
| T+45m | DNS cutover |
| T+1h | Verify external access |
| T+2h | Monitor for errors |
| T+48h | Decommission Pi from active duty |

**Total: 1-2 hours** (excluding VPS pre-setup)

---

## Database Stats (as of 2026-02-01)

| Table | Rows | Size |
|-------|------|------|
| HeliusTransactionCache | 3.3M | 1,013 MB |
| SwapAnalysisInput | 1.8M | 1,162 MB |
| AnalysisResult | 319K | 182 MB |
| TokenInfo | 152K | 138 MB |
| Wallet | ~3K | 1.6 MB |

**Growth rate:** ~50-100 MB/day (heavy usage)

---

## Decision Log

- **PM2 vs Docker:** PM2 - simpler, already familiar, single app doesn't need container overhead
- **Retention:** Keep all data, monitor growth, no auto-eviction
- **Indexes:** Handled separately (most kept, few dropped after analysis)
