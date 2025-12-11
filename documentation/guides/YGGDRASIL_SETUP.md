# Network Configuration Guide

This guide explains how to configure your application for different network scenarios: localhost, WiFi hotspot LAN, or Yggdrasil IPv6 network.

## Overview

The application consists of:
- **Backend**: NestJS API server (port 3001)
- **Frontend**: Next.js dashboard (port 3000)

Both can be configured to work with:
- **Localhost** - Local development only
- **WiFi Hotspot LAN** - Access from phone via WiFi hotspot (RECOMMENDED - secure & private)
- **Yggdrasil IPv6** - Access via Yggdrasil mesh network (PUBLIC - requires authentication)

---

## Backend Configuration

### File: `src/main.ts` ✅ ALREADY UPDATED

The backend now supports configurable host binding via the `BACKEND_HOST` environment variable.

### Environment Variables (add to `.env`):

```bash
# --- Backend Network Configuration ---
# Backend host to bind to. Options:
#   '::' (default) - Listen on all IPv6/IPv4 interfaces
#   'localhost' - Listen only on localhost
#   'your:yggdrasil:ipv6:address' - Bind to specific Yggdrasil IPv6
# Example: BACKEND_HOST=200:1234:5678:9abc:def0:1234:5678:9abc
BACKEND_HOST=::
PORT=3001

# --- CORS Configuration ---
# Frontend URL for CORS (must match where frontend is accessed from)
# For localhost: FRONTEND_URL=http://localhost:3000
# For Yggdrasil: FRONTEND_URL=http://[200:1234:5678:9abc:def0:1234:5678:9abc]:3000
FRONTEND_URL=http://localhost:3000
```

### How It Works:
- By default (`BACKEND_HOST=::`), the backend listens on all interfaces
- When you access it via Yggdrasil, it will respond on your Yggdrasil IPv6 address
- The logger will display the correct URL format based on the host setting

---

## Frontend Configuration

### File: `dashboard/next.config.mjs` ✅ ALREADY UPDATED

The Next.js proxy rewrite now supports configurable backend URLs.

### File: `dashboard/.env.local` (YOU NEED TO CREATE/UPDATE THIS)

Create or update `dashboard/.env.local` with the following configuration:

#### Option 1: Local Development (Default)
```bash
# API Base URL - empty means use Next.js proxy
NEXT_PUBLIC_API_BASE_URL=

# WebSocket URL
NEXT_PUBLIC_WEBSOCKET_URL=http://localhost:3001

# Backend rewrite URL (used by Next.js proxy in next.config.mjs)
BACKEND_REWRITE_URL=http://localhost:3001

# WebSocket settings
NEXT_PUBLIC_SOCKET_TRANSPORTS=polling,websocket
NEXT_PUBLIC_SOCKET_UPGRADE=true
NEXT_PUBLIC_SOCKET_FORCE_NEW=false
NEXT_PUBLIC_SOCKET_NONCE=false

# Auth settings
NEXT_PUBLIC_AUTH_COOKIE_MODE=false
NEXT_PUBLIC_AUTH_MEMORY_MODE=false
```

#### Option 2: Yggdrasil Network Access
Replace `YOUR_YGGDRASIL_IPV6` with your actual Yggdrasil IPv6 address (without brackets):

```bash
# API Base URL - direct connection to Yggdrasil backend
NEXT_PUBLIC_API_BASE_URL=http://[YOUR_YGGDRASIL_IPV6]:3001/api/v1

# WebSocket URL - direct connection to Yggdrasil backend
NEXT_PUBLIC_WEBSOCKET_URL=http://[YOUR_YGGDRASIL_IPV6]:3001

# Backend rewrite URL (for Next.js proxy, if needed)
BACKEND_REWRITE_URL=http://[YOUR_YGGDRASIL_IPV6]:3001

# WebSocket settings
NEXT_PUBLIC_SOCKET_TRANSPORTS=polling,websocket
NEXT_PUBLIC_SOCKET_UPGRADE=true
NEXT_PUBLIC_SOCKET_FORCE_NEW=false
NEXT_PUBLIC_SOCKET_NONCE=false

# Auth settings
NEXT_PUBLIC_AUTH_COOKIE_MODE=false
NEXT_PUBLIC_AUTH_MEMORY_MODE=false
```

**IMPORTANT**: IPv6 addresses in URLs must be wrapped in square brackets `[...]`

---

## Quick Start Guide

### 🔥 RECOMMENDED: WiFi Hotspot Setup (Secure & Private)

#### Step 1: Find Your Hotspot IP Address

On Windows PowerShell:
```powershell
ipconfig
```

Look for your WiFi hotspot adapter (usually "Local Area Connection* X" or similar).
Your laptop's IP will typically be something like:
- `192.168.137.1` (Windows default)
- `192.168.43.1` (Android hotspot default)

Use this IP as `YOUR_HOTSPOT_IP` below.

#### Step 2: Configure Backend

Add to `analyzer/.env`:
```bash
BACKEND_HOST=::  # Listen on all interfaces
PORT=3001
FRONTEND_URL=http://YOUR_HOTSPOT_IP:3000
```

Example:
```bash
BACKEND_HOST=::
PORT=3001
FRONTEND_URL=http://192.168.137.1:3000
```

#### Step 3: Configure Frontend

Create/update `dashboard/.env.local`:
```bash
NEXT_PUBLIC_API_BASE_URL=http://YOUR_HOTSPOT_IP:3001/api/v1
NEXT_PUBLIC_WEBSOCKET_URL=http://YOUR_HOTSPOT_IP:3001
BACKEND_REWRITE_URL=http://YOUR_HOTSPOT_IP:3001
NEXT_PUBLIC_SOCKET_TRANSPORTS=polling,websocket
NEXT_PUBLIC_SOCKET_UPGRADE=true
```

Example:
```bash
NEXT_PUBLIC_API_BASE_URL=http://192.168.137.1:3001/api/v1
NEXT_PUBLIC_WEBSOCKET_URL=http://192.168.137.1:3001
BACKEND_REWRITE_URL=http://192.168.137.1:3001
NEXT_PUBLIC_SOCKET_TRANSPORTS=polling,websocket
NEXT_PUBLIC_SOCKET_UPGRADE=true
```

### Step 4: Start Both Services

Backend:
```bash
npm run dev
```

Frontend (for Yggdrasil access):
```bash
cd dashboard
npm run dev:yggdrasil
```

**Note**: The `dev:yggdrasil` command uses `-H ::` to bind Next.js to all IPv6 interfaces, making it accessible via your Yggdrasil address. For local-only development, use `npm run dev` instead.

#### Step 4: Access from Phone

Make sure your phone is connected to your laptop's WiFi hotspot, then open browser:
```
http://YOUR_HOTSPOT_IP:3000
```

Example:
```
http://192.168.137.1:3000
```

**Security Note**: This setup keeps your app **private** - only devices on your WiFi hotspot can access it!

---

### ⚠️ ADVANCED: Yggdrasil IPv6 Setup (PUBLIC Network - Security Risk!)

**WARNING**: Yggdrasil is a **global mesh network**. Anyone on the Yggdrasil network can potentially access your application if they know your IPv6 address. Only use this if you understand the security implications!

#### Security Requirements:
- ✅ Strong authentication enabled (JWT/API keys)
- ✅ All endpoints protected with auth guards
- ✅ Rate limiting configured
- ✅ No sensitive data exposed without authentication
- ❌ Do NOT use this for development/testing
- ❌ Do NOT expose admin panels

#### Step 1: Find Your Yggdrasil IPv6 Address

On Windows PowerShell:
```powershell
ipconfig | Select-String "IPv6.*200:"
```

Look for an address starting with `200:` or `300:` - this is your Yggdrasil IPv6.

**IMPORTANT**: Both laptop AND phone must be connected to Yggdrasil peers!

#### Step 2: Configure Backend

Add to `analyzer/.env`:
```bash
BACKEND_HOST=::  # Listen on all interfaces (includes Yggdrasil)
PORT=3001
FRONTEND_URL=http://[YOUR_YGGDRASIL_IPV6]:3000
```

Example:
```bash
BACKEND_HOST=::
PORT=3001
FRONTEND_URL=http://[200:1234:5678:9abc:def0:1234:5678:9abc]:3000
```

#### Step 3: Configure Frontend

Create/update `dashboard/.env.local`:
```bash
NEXT_PUBLIC_API_BASE_URL=http://[YOUR_YGGDRASIL_IPV6]:3001/api/v1
NEXT_PUBLIC_WEBSOCKET_URL=http://[YOUR_YGGDRASIL_IPV6]:3001
BACKEND_REWRITE_URL=http://[YOUR_YGGDRASIL_IPV6]:3001
NEXT_PUBLIC_SOCKET_TRANSPORTS=polling,websocket
NEXT_PUBLIC_SOCKET_UPGRADE=true
```

Example:
```bash
NEXT_PUBLIC_API_BASE_URL=http://[200:1234:5678:9abc:def0:1234:5678:9abc]:3001/api/v1
NEXT_PUBLIC_WEBSOCKET_URL=http://[200:1234:5678:9abc:def0:1234:5678:9abc]:3001
BACKEND_REWRITE_URL=http://[200:1234:5678:9abc:def0:1234:5678:9abc]:3001
```

**Note**: IPv6 addresses in URLs must be wrapped in square brackets `[...]`

#### Step 4: Access from Phone

On your phone (with Yggdrasil connected to peers):
```
http://[YOUR_YGGDRASIL_IPV6]:3000
```

---

## Troubleshooting

### WiFi Hotspot Issues:

#### Issue: Phone can't connect to laptop

**Solution**:
1. Verify phone is connected to laptop's WiFi hotspot
2. Check laptop's hotspot IP with `ipconfig`
3. Try pinging laptop from phone (if you have a terminal app)
4. Ensure Windows Firewall allows connections on ports 3000 and 3001

#### Issue: Connection refused

**Solution**:
1. Make sure both backend and frontend are running
2. Check that you're using the correct hotspot IP
3. Try accessing `http://YOUR_HOTSPOT_IP:3001/api/v1` directly to test backend

### Yggdrasil Issues:

#### Issue: Phone can't connect to laptop via Yggdrasil

**Solution**: Verify both devices are connected to Yggdrasil peers:
- On laptop: Check Yggdrasil service is running and has peers
- On phone: Ensure Yggdrasil app shows "Connected" status
- Test: `ping6 YOUR_LAPTOP_YGGDRASIL_IPV6` from phone

### Issue: CORS errors

**Solution**: Ensure `FRONTEND_URL` in backend `.env` matches exactly how you access the frontend:
```bash
# If accessing via: http://[200:abc:...]:3000
FRONTEND_URL=http://[200:abc:...]:3000
```

### Issue: WebSocket not connecting

**Solution**: Check that `NEXT_PUBLIC_WEBSOCKET_URL` uses the same Yggdrasil address as the API.

### Issue: "Network error" in frontend

**Solution**:
1. Verify backend is running and accessible: `curl http://[YOUR_IPV6]:3001/api/v1`
2. Check that `NEXT_PUBLIC_API_BASE_URL` is set correctly
3. Verify firewall isn't blocking the connection

---

## Environment Variable Reference

### Backend (`.env`)
| Variable | Default | Description |
|----------|---------|-------------|
| `BACKEND_HOST` | `::` | Host to bind backend to |
| `PORT` | `3001` | Backend port |
| `FRONTEND_URL` | - | Frontend URL for CORS |

### Frontend (`dashboard/.env.local`)
| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_BASE_URL` | `''` | Backend API URL (empty = use proxy) |
| `NEXT_PUBLIC_WEBSOCKET_URL` | `https://sova-intel.duckdns.org` | WebSocket connection URL |
| `BACKEND_REWRITE_URL` | `http://localhost:3001` | Backend URL for Next.js proxy |
| `NEXT_PUBLIC_SOCKET_TRANSPORTS` | `polling,websocket` | Socket.IO transport methods |
| `NEXT_PUBLIC_SOCKET_UPGRADE` | `true` | Allow transport upgrade |
| `NEXT_PUBLIC_AUTH_COOKIE_MODE` | `false` | Use httpOnly cookies for auth |

---

## Testing Your Configuration

### Test Backend Accessibility
```bash
# From laptop
curl http://localhost:3001/api/v1

# From phone (via Yggdrasil)
curl http://[YOUR_LAPTOP_YGGDRASIL_IPV6]:3001/api/v1
```

### Test Frontend Accessibility
```bash
# From laptop
curl http://localhost:3000

# From phone (via Yggdrasil)
curl http://[YOUR_LAPTOP_YGGDRASIL_IPV6]:3000
```

---

## Switching Between Local and Yggdrasil

You can easily switch between configurations by changing environment variables:

### For Local Development:
```bash
# Backend .env
BACKEND_HOST=::
FRONTEND_URL=http://localhost:3000

# Frontend .env.local
NEXT_PUBLIC_API_BASE_URL=
NEXT_PUBLIC_WEBSOCKET_URL=http://localhost:3001
```

### For Yggdrasil Access:
```bash
# Backend .env
BACKEND_HOST=::
FRONTEND_URL=http://[YOUR_YGGDRASIL_IPV6]:3000

# Frontend .env.local
NEXT_PUBLIC_API_BASE_URL=http://[YOUR_YGGDRASIL_IPV6]:3001/api/v1
NEXT_PUBLIC_WEBSOCKET_URL=http://[YOUR_YGGDRASIL_IPV6]:3001
```

No code changes needed - just update the `.env` files and restart!
