# 🧪 Testing Authentication System - Complete Guide

## Overview

This guide walks you through testing the complete authentication system including JWT, email verification, admin access, and API key management.

---

## 🚀 Quick Start: Become an Admin

### Method 1: Add Your Email to Admin List (RECOMMENDED)

1. **Register an account** (we'll do this in a moment)
2. **Get your user ID** from the registration response
3. **Edit `.env` file** on your server:

```bash
# Open .env
nano .env

# Add your user ID or email to admin lists
ADMIN_USER_IDS=your-user-id-here
ADMIN_EMAILS=your-email@example.com

# Or both (comma-separated for multiple admins)
ADMIN_USER_IDS=user_abc123,user_def456
ADMIN_EMAILS=admin@example.com,you@example.com
```

4. **Restart the backend**:
```bash
# If using PM2
pm2 restart all

# Or if running directly
npm run start
```

5. **Verify admin access** - the Shield icon "Admin Panel" link should appear in sidebar

### Method 2: Add After First Login

1. **Register and login first** (get your credentials working)
2. **Check your user ID**:
```bash
curl -X GET https://your-api.com/auth/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

Response will include your `id`:
```json
{
  "id": "cm4pqr7s8000001l8a1b2c3d4",  // <-- THIS IS YOUR USER ID
  "email": "you@example.com",
  "isDemo": false,
  "emailVerified": false,
  "isAdmin": false,  // <-- Will be true after adding to env
  "createdAt": "2025-12-04T...",
  "lastLoginAt": "2025-12-04T..."
}
```

3. **Add to `.env` and restart** (see Method 1 step 3-4)

---

## 📋 Complete Testing Checklist

### ✅ Phase 1: User Registration & JWT Auth

#### Test 1: Register New Account

**Frontend (Dashboard)**:
1. Go to `http://localhost:3000` (or your dashboard URL)
2. Click **"Sign Up"** or navigate to registration
3. Fill in:
   - Email: `testuser@example.com`
   - Password: `TestPass123!` (must meet requirements)
4. Click **"Create Account"**
5. **Expected**:
   - ✅ Success toast message
   - ✅ Automatically logged in
   - ✅ Redirected to dashboard

**API (curl)**:
```bash
curl -X POST http://localhost:8080/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "testuser@example.com",
    "password": "TestPass123!"
  }'
```

**Expected Response**:
```json
{
  "access_token": "eyJhbGc...",
  "refresh_token": "eyJhbGc...",
  "user": {
    "id": "cm4pqr7s8000001l8a1b2c3d4",
    "email": "testuser@example.com",
    "isDemo": false,
    "emailVerified": false,
    "isAdmin": false
  }
}
```

**Save**: Copy `user.id` - you'll need this to become admin!

#### Test 2: Login with Existing Account

**Frontend**:
1. Logout if logged in
2. Click **"Login"**
3. Enter credentials
4. Click **"Sign In"**
5. **Expected**: Successfully logged in, JWT stored

**API**:
```bash
curl -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "testuser@example.com",
    "password": "TestPass123!"
  }'
```

#### Test 3: Verify JWT Authentication

**Check Current User**:
```bash
curl -X GET http://localhost:8080/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Expected**: Returns user profile with `isAdmin: false` (before adding to env)

---

### ✅ Phase 2: Email Verification

#### Test 4: Request Verification Email

**Frontend**:
1. After registration, look for email verification banner
2. Click **"Resend Verification Email"**
3. **Expected**: Toast message "Verification email sent"

**API**:
```bash
curl -X POST http://localhost:8080/auth/request-verification \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

#### Test 5: Check Email / Get Token

**Option A: Check Email** (if email service configured):
- Open your email inbox
- Look for verification email from Sova Intel
- Click the verification link or copy the token

**Option B: Get Token from Database** (development):
```bash
# Using SQLite CLI
sqlite3 prisma/dev.db "SELECT token, expiresAt FROM EmailVerificationToken WHERE userId = 'YOUR_USER_ID' ORDER BY createdAt DESC LIMIT 1;"
```

**Option C: Check Logs** (if email fails):
```bash
# PM2 logs
pm2 logs --lines 50 | grep -i "verification"

# Or direct logs
tail -f logs/app.log | grep -i verification
```

#### Test 6: Verify Email

**API**:
```bash
curl -X POST http://localhost:8080/auth/verify-email \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "TOKEN_FROM_EMAIL_OR_DB"
  }'
```

**Expected Response**:
```json
{
  "message": "Email verified successfully!"
}
```

**Verify It Worked**:
```bash
curl -X GET http://localhost:8080/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Response should show: `"emailVerified": true`

---

### ✅ Phase 3: Admin Access

#### Test 7: Make Yourself Admin

**Step 1: Add to .env**:
```bash
# On server, edit .env
ADMIN_USER_IDS=cm4pqr7s8000001l8a1b2c3d4
# OR
ADMIN_EMAILS=testuser@example.com
# OR BOTH
```

**Step 2: Restart Backend**:
```bash
pm2 restart all
```

**Step 3: Verify Admin Status**:
```bash
curl -X GET http://localhost:8080/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Expected**: `"isAdmin": true` 🎉

#### Test 8: Access Admin Panel

**Frontend**:
1. Refresh the dashboard page
2. Look in the sidebar (bottom section)
3. **Expected**:
   - ✅ **Shield icon** "Admin Panel" link visible
   - ✅ Clicking it takes you to `/admin/api-keys`

**If Link Not Visible**:
- ❌ Check: Did you restart the backend?
- ❌ Check: Is user ID/email correct in `.env`?
- ❌ Check: Did you refresh the page after restart?
- ❌ Check: Are you logged in with JWT (not API key)?

#### Test 9: Admin Panel Invisibility (Non-Admin)

**Important Security Test**:

1. **As Admin**: Note the admin panel URL: `/admin/api-keys`
2. **Logout**
3. **Login as different user** (without admin privileges)
4. **Try to access** `/admin/api-keys` directly
5. **Expected**:
   - ✅ **Silent redirect** to home `/`
   - ✅ **NO 403 error page**
   - ✅ **NO toast notification**
   - ✅ **NO admin link** in sidebar

This confirms the "invisible" admin panel design!

---

### ✅ Phase 4: Admin - API Key Management

#### Test 10: Create API Key via Admin Panel

**Frontend**:
1. Go to Admin Panel (`/admin/api-keys`)
2. Click **"Create API Key"**
3. Fill in form:
   - **User ID**: Your user ID (or another user's)
   - **Description**: `"Test Prometheus Scraper"`
   - **Scopes**: Click `admin` badge
   - **Expires In Days**: Leave empty (no expiration)
4. Click **"Create"**
5. **Expected**:
   - ✅ Green alert box with full API key
   - ✅ Copy button to copy key
   - ✅ Key appears in list below

**CRITICAL**: Copy the key NOW - you won't see it again!

Example key: `ak_test_xyz123abc456def789...`

#### Test 11: List API Keys

**Frontend**: Scroll down on admin panel page

**Expected Display**:
- Prefix: `ak_test` (or `ak_live` in production)
- Status: Green "Active" badge
- Description: What you entered
- User: Email or user ID
- Scopes: Badge for each scope
- Dates: Created, expires (if set), last used

**API**:
```bash
curl -X GET http://localhost:8080/admin/api-keys \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Test 12: Test API Key Authentication

**Test the key you just created**:
```bash
curl -X GET http://localhost:8080/health/metrics \
  -H "X-API-Key: ak_test_xyz123abc456def789..."
```

**Expected**: Returns Prometheus metrics (because you used `admin` scope)

**Test with Wrong Scope** (create key with only `read` scope):
```bash
curl -X GET http://localhost:8080/health/metrics \
  -H "X-API-Key: ak_test_onlyread..."
```

**Expected**: 403 Forbidden (insufficient permissions)

#### Test 13: Revoke API Key

**Frontend**:
1. Find the key in the list
2. Click **"Revoke"** button
3. Confirm the action
4. **Expected**: Status changes to gray "Revoked" badge

**Verify Revocation**:
```bash
curl -X GET http://localhost:8080/health/metrics \
  -H "X-API-Key: YOUR_REVOKED_KEY"
```

**Expected**: 401 Unauthorized

---

### ✅ Phase 5: Token Refresh Flow

#### Test 14: Access Token Expiration

**Setup**: Wait 30 minutes (or change `JWT_EXPIRES_IN` to `1m` for testing)

**Frontend**: After token expires, make an API request

**Expected**:
- ✅ Request fails with 401
- ✅ Frontend detects expired token
- ✅ Automatically calls `/auth/refresh`
- ✅ Gets new access token
- ✅ Retries original request

**Manual Test**:
```bash
# Use old/expired access token
curl -X GET http://localhost:8080/auth/me \
  -H "Authorization: Bearer EXPIRED_TOKEN"

# Expected: 401 Unauthorized

# Refresh the token
curl -X POST http://localhost:8080/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "YOUR_REFRESH_TOKEN"
  }'

# Expected: New access_token + new refresh_token (rotation)
```

#### Test 15: Refresh Token Rotation

**API**:
```bash
# First refresh
curl -X POST http://localhost:8080/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "REFRESH_TOKEN_1"}'

# Returns: NEW_ACCESS_TOKEN_1 + NEW_REFRESH_TOKEN_2

# Try to reuse old refresh token (SHOULD FAIL)
curl -X POST http://localhost:8080/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "REFRESH_TOKEN_1"}'

# Expected: 401 Unauthorized (replay attack detected)
```

---

### ✅ Phase 6: Composite Auth Guard

#### Test 16: JWT vs API Key Authentication

**Test 1: JWT Auth** (human user):
```bash
curl -X GET http://localhost:8080/wallets/YOUR_WALLET/summary \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected**: ✅ Success (identity-based auth)

**Test 2: API Key Auth** (service):
```bash
curl -X GET http://localhost:8080/wallets/YOUR_WALLET/summary \
  -H "X-API-Key: YOUR_API_KEY"
```

**Expected**: ✅ Success (permission-based auth with `read` scope)

**Test 3: Both Provided** (JWT takes precedence):
```bash
curl -X GET http://localhost:8080/auth/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "X-API-Key: YOUR_API_KEY"
```

**Expected**: ✅ Returns JWT user (API key ignored)

**Test 4: Neither Provided**:
```bash
curl -X GET http://localhost:8080/wallets/YOUR_WALLET/summary
```

**Expected**: ❌ 401 Unauthorized

---

## 🐛 Troubleshooting Common Issues

### Issue: "Admin Panel Link Not Showing"

**Checklist**:
1. ✅ Logged in with JWT (not API key)?
2. ✅ User ID/email in `.env` correct?
3. ✅ Backend restarted after `.env` change?
4. ✅ Page refreshed after backend restart?
5. ✅ Check `/auth/me` shows `isAdmin: true`?

**Debug**:
```bash
# Check .env
cat .env | grep ADMIN

# Restart backend
pm2 restart all

# Verify admin status
curl -X GET http://localhost:8080/auth/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" | grep isAdmin
```

### Issue: "Email Verification Not Working"

**Possible Causes**:
1. ❌ Email service not configured
2. ❌ Token expired (15 min TTL)
3. ❌ Wrong token

**Solutions**:
```bash
# Check if email service is configured
cat .env | grep EMAIL

# Get token directly from database
sqlite3 prisma/dev.db "SELECT token FROM EmailVerificationToken WHERE userId = 'YOUR_ID' ORDER BY createdAt DESC LIMIT 1;"

# Manually verify in database (dev only)
sqlite3 prisma/dev.db "UPDATE User SET emailVerified = 1 WHERE id = 'YOUR_ID';"
```

### Issue: "API Key Not Working"

**Checklist**:
1. ✅ Copied full key (including prefix)?
2. ✅ Key is active (not revoked)?
3. ✅ Key not expired?
4. ✅ Using correct header: `X-API-Key`?
5. ✅ Key has required scope for endpoint?

**Debug**:
```bash
# Test with admin panel or CLI
npm run apikey:manage list

# Check key details
sqlite3 prisma/dev.db "SELECT id, prefix, isActive, expiresAt, scopes FROM ApiKey WHERE prefix = 'ak_test';"
```

### Issue: "401 Unauthorized" After Login

**Possible Causes**:
1. ❌ Token not stored correctly
2. ❌ Wrong header format
3. ❌ Token expired

**Debug**:
```bash
# Check token format (should be JWT)
echo "YOUR_TOKEN" | cut -d'.' -f1 | base64 -d

# Verify with /auth/me
curl -X GET http://localhost:8080/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN" -v

# Check response headers for clues
```

---

## 📊 Complete Test Matrix

| Test | Method | Expected Result | Status |
|------|--------|-----------------|--------|
| Register Account | Frontend | Success + Auto-login | ⬜ |
| Login | Frontend | JWT + Refresh Token | ⬜ |
| Access Protected Route | JWT | 200 OK | ⬜ |
| Request Email Verification | Frontend | Email sent | ⬜ |
| Verify Email | API | emailVerified: true | ⬜ |
| Add User to Admin List | .env | isAdmin: true | ⬜ |
| Admin Panel Visible | Frontend | Shield icon shows | ⬜ |
| Admin Panel Invisible (Non-Admin) | Frontend | Silent redirect | ⬜ |
| Create API Key | Admin Panel | Key created | ⬜ |
| Test API Key Auth | curl | 200 OK | ⬜ |
| Revoke API Key | Admin Panel | 401 after revoke | ⬜ |
| JWT Refresh | API | New tokens | ⬜ |
| Refresh Token Rotation | API | Old token fails | ⬜ |
| Logout | Frontend | Tokens cleared | ⬜ |

---

## 🎯 Quick Commands Reference

```bash
# Register user
curl -X POST http://localhost:8080/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass123!"}'

# Login
curl -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass123!"}'

# Check current user (get user ID)
curl -X GET http://localhost:8080/auth/me \
  -H "Authorization: Bearer TOKEN"

# Request email verification
curl -X POST http://localhost:8080/auth/request-verification \
  -H "Authorization: Bearer TOKEN"

# Verify email
curl -X POST http://localhost:8080/auth/verify-email \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"token":"VERIFICATION_TOKEN"}'

# Add admin (on server)
echo "ADMIN_USER_IDS=your-user-id" >> .env
pm2 restart all

# List API keys (CLI)
npm run apikey:manage list

# Test API key
curl -X GET http://localhost:8080/health/metrics \
  -H "X-API-Key: YOUR_KEY"
```

---

**Last Updated**: December 4, 2025
**Maintainer**: Sova Intel Team
**Related Docs**:
- [API Key Management](./API_KEY_MANAGEMENT.md)
- [Architecture Decisions](../01.%20ARCHITECTURE_DECISIONS.md)
