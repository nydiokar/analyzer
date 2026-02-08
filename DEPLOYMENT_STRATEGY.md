# Deployment Strategy: discover-analytics-ux to Production

## Current Status
- ✅ Integration branch created: `release/merge-discover-analytics`
- ✅ Main branch merged successfully (only email service improvements)
- 🟡 Ready for testing before final merge to main

## Architecture Overview

### Current Setup
- **Server 1 (Old)**: Running `main` branch (older version)
- **Server 2 (New)**: Will run latest `main` branch with analytics features
- **Frontend**: Vercel (auto-deploys from main branch)

### Backend Configuration
Your backend already supports multiple frontend URLs via `FRONTEND_URL` environment variable:
- Supports comma-separated URLs for CORS (e.g., `https://app1.com,https://app2.com`)
- Uses first URL for email links (verification, password reset)

## Deployment Steps

### Phase 1: Testing & Preparation
1. **Test the merged code** on `release/merge-discover-analytics`:
   ```bash
   # Run tests
   npm test

   # Start locally and verify
   npm run start:dev
   ```

2. **Verify environment variables** for both servers:
   - Server 1 (old): `FRONTEND_URL=https://your-app.vercel.app`
   - Server 2 (new): `FRONTEND_URL=https://your-app.vercel.app`
   - Ensure database, Redis, API keys are configured for new server

### Phase 2: Backend Deployment (Choose One Approach)

#### Option A: Coordinated Deployment (Recommended)
1. **Pause Vercel auto-deploy**:
   - Go to Vercel Project Settings → Git
   - Temporarily disable auto-deploy for main branch

2. **Merge to main**:
   ```bash
   git checkout main
   git merge release/merge-discover-analytics
   git push origin main
   ```

3. **Deploy backend to new server**:
   ```bash
   # On Server 2
   git pull origin main
   npm install
   npm run build
   pm2 restart all  # or your process manager
   ```

4. **Update old server** (optional but recommended):
   ```bash
   # On Server 1
   git pull origin main
   npm install
   npm run build
   pm2 restart all
   ```

5. **Deploy frontend**:
   - Update environment variable in Vercel: `NEXT_PUBLIC_API_URL` to point to Server 2
   - Trigger manual deploy or re-enable auto-deploy

#### Option B: Backward-Compatible Deployment
1. **Ensure new backend works with old frontend**:
   - Keep old API endpoints functional
   - Add new endpoints for new features
   - Don't break existing response formats

2. **Deploy backend first** (both servers):
   ```bash
   git checkout main
   git merge release/merge-discover-analytics
   git push origin main
   ```

3. **Deploy frontend when ready** (Vercel will auto-deploy)

### Phase 3: Nginx Configuration

#### For Server 2 (New Analytics Backend)
If you need separate subdomains:
```nginx
# /etc/nginx/sites-available/api-analytics
server {
    listen 80;
    server_name api-analytics.yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;  # Your NestJS port
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

#### For Single Domain with Path-Based Routing
```nginx
# If you want both on same domain with different paths
server {
    listen 80;
    server_name api.yourdomain.com;

    location /v1/ {
        proxy_pass http://localhost:3001;  # Old server
    }

    location /v2/ {
        proxy_pass http://localhost:3002;  # New analytics server
    }
}
```

### Phase 4: Frontend Environment Variables

In Vercel, set based on your Nginx setup:

**Option 1 - Separate Subdomains:**
```
NEXT_PUBLIC_API_URL=https://api-analytics.yourdomain.com
```

**Option 2 - Path-Based:**
```
NEXT_PUBLIC_API_URL=https://api.yourdomain.com/v2
```

**Option 3 - Single Server:**
```
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

## Rollback Plan

If issues arise:

1. **Quick rollback** (if not merged to main yet):
   ```bash
   # Revert frontend deploy in Vercel
   # Point NEXT_PUBLIC_API_URL back to Server 1
   ```

2. **Full rollback** (if merged to main):
   ```bash
   git revert <merge-commit-hash>
   git push origin main
   # Redeploy servers
   ```

## Post-Deployment Checklist

- [ ] Both servers responding correctly
- [ ] Frontend can connect to new backend
- [ ] Email verification links work (check FRONTEND_URL)
- [ ] CORS working for all origins
- [ ] WebSocket connections functional (if using Socket.io)
- [ ] Database migrations applied (if any)
- [ ] Monitor logs for errors
- [ ] Test critical user flows

## Recommendations

1. **Use Option A** (Coordinated Deployment) for cleanest approach
2. **Keep both servers on main branch** - easier to maintain
3. **Use environment variables** to differentiate between servers if needed
4. **Test thoroughly** on staging/dev before production
5. **Have rollback plan ready** before starting deployment

## Questions to Answer

1. Do you want both servers on the same backend version (main), or different branches?
   - **Recommended**: Same version (main)

2. Should old server be updated or left as-is?
   - **Recommended**: Update it too for consistency

3. Do you need separate API URLs or can frontend use same URL?
   - Depends on your Nginx setup and load balancing needs

4. Do you have a staging environment to test this flow first?
   - **Recommended**: Test on staging before production
