# Admin Access Control Implementation

**Branch:** `feat/admin-access-controls`
**Date:** 2026-02-09
**Status:** ✅ Implementation Complete - Ready for Testing

---

## Overview

Implemented two-tier access control for alpha node management:
1. **Registration Codes** - Invite-based registration system
2. **Registration Kill-Switch** - Emergency brake to halt all new registrations
3. **User Account Management** - Enable/disable user accounts

This provides **granular control over user access** while maintaining system stability (no full system kill-switch).

---

## What Was Implemented

### 1. Registration Codes System

**Database Schema** (`RegistrationCode` model):
- Unique cryptographically secure codes (16 characters, base64url)
- Status tracking: `active`, `used`, `revoked`
- Multi-use support (configurable max uses, default: 1)
- Expiration dates (optional)
- Usage tracking (who used it, when)
- Admin attribution (who created it)

**Service** (`RegistrationCodeService`):
- `createCode()` - Generate single code
- `createBulkCodes()` - Generate up to 100 codes at once
- `validateCode()` - Check if code is valid (without marking as used)
- `validateAndUseCode()` - Validate and mark as used atomically
- `revokeCode()` - Deactivate a code
- `deleteCode()` - Permanently remove code
- `listCodes()` - Filter by status, paginated
- `getStats()` - Total/active/used/revoked/expired counts

### 2. Registration Kill-Switch

**Storage:** Redis key `registration:kill-switch` (value: "1" = enabled)

**Methods:**
- `enableKillSwitch()` - Block ALL new registrations immediately
- `disableKillSwitch()` - Re-enable registrations
- `isKillSwitchActive()` - Check current state
- `getKillSwitchStatus()` - Get status with user-friendly message

**Integration:**
- Checked in `AuthController.register()` BEFORE validation
- Returns `503 Service Unavailable` when active
- Does NOT affect existing users or login

### 3. Admin Endpoints

All added to **existing** `AdminController` (not a separate controller):

**Registration Codes:**
- `POST /admin/registration-codes` - Create single code
- `POST /admin/registration-codes/bulk` - Create multiple codes
- `GET /admin/registration-codes?status=active&limit=100` - List codes
- `GET /admin/registration-codes/stats` - Get statistics
- `PATCH /admin/registration-codes/:code/revoke` - Revoke code
- `DELETE /admin/registration-codes/:code` - Delete code permanently

**Kill-Switch:**
- `GET /admin/registration/kill-switch` - Get status
- `POST /admin/registration/kill-switch/enable` - Enable (DANGER)
- `POST /admin/registration/kill-switch/disable` - Disable

**User Management:**
- `PATCH /admin/users/:userId/disable` - Disable user account (sets `isActive=false`)
- `PATCH /admin/users/:userId/enable` - Re-enable user account

### 4. Registration Flow Update

**Updated `AuthController.register()`:**
1. Check kill-switch → Return 503 if active
2. Validate registration code → Return 400 if invalid/expired/used
3. Create user account
4. Mark code as used (non-blocking - won't fail registration if this fails)
5. Send verification email
6. Return JWT tokens

**Updated DTOs:**
- `RegisterRequestDto` now requires `registrationCode: string` field

---

## Migration

**Database Migration:** `20260209093024_add_registration_codes`

Adds `RegistrationCode` table with proper indexes for performance.

---

## Architecture Decisions

### Why Reuse AdminController?
- ✅ Consolidates admin endpoints in one place
- ✅ Reuses existing `@AdminOnly()` decorator and guards
- ✅ Consistent API structure
- ✅ Avoids duplication

### Why Use Redis for Kill-Switch?
- ✅ Sub-millisecond read performance (critical for registration path)
- ✅ No database load on every registration attempt
- ✅ Instant propagation (no cache invalidation needed)
- ✅ Simple boolean flag, no complex state

### Why Direct Prisma Access in RegistrationCodeService?
- ✅ DatabaseService wrapper doesn't expose `.prisma`
- ✅ Simple CRUD operations don't need wrapper abstraction
- ✅ Follows existing pattern (wallet HUD service does this too)
- ✅ Clean, type-safe Prisma operations

### Why Validate Code Twice (validate + validateAndUse)?
- ✅ Prevents burning codes when user creation fails (email conflict, etc.)
- ✅ Atomic marking as "used" only after successful account creation
- ✅ Race condition window is acceptable (codes are cheap)

---

## Security Considerations

### Registration Code Generation
- Uses `crypto.randomBytes()` - cryptographically secure
- 16 bytes → base64url = 21+ characters of entropy
- Collision probability: negligible (~2^-128)

### Kill-Switch Protection
- Requires admin auth (JWT)
- Requires `@AdminOnly()` decorator check
- Logged with admin ID and email
- No additional password protection needed (admin JWT is sufficient)

### User Disable/Enable
- Uses existing `DatabaseService.activateUser()` / `deactivateUser()`
- Sets `isActive` field (already enforced in auth flow)
- Preserves all user data (non-destructive)

---

## Testing Checklist

### Registration Codes
- [ ] Generate single code
- [ ] Generate bulk codes (10 codes)
- [ ] List codes with status filter
- [ ] Register with valid code
- [ ] Register with used code (should fail)
- [ ] Register with revoked code (should fail)
- [ ] Register with expired code (should fail)
- [ ] Revoke an active code
- [ ] Delete a code permanently
- [ ] Check stats accuracy

### Kill-Switch
- [ ] Enable kill-switch
- [ ] Verify registration blocked (503 response)
- [ ] Verify existing users can still login
- [ ] Disable kill-switch
- [ ] Verify registration works again

### User Management
- [ ] Disable a user account
- [ ] Verify disabled user cannot login
- [ ] Re-enable user account
- [ ] Verify re-enabled user can login

### Edge Cases
- [ ] Register with code while kill-switch is active (should fail with 503, not 400)
- [ ] Create code with maxUses=5, use it 5 times (should work), try 6th (should fail)
- [ ] Create code with expiration 1 minute from now, wait, try to use (should fail)
- [ ] Non-admin tries to access `/admin/registration-codes` (should get 403)

---

## Environment Variables (Optional)

These are **not currently checked** but documented for future enhancement:

```bash
# Registration Access Control (Future: read these from config)
REGISTRATION_CODES_REQUIRED=true  # Enforce code requirement
REGISTRATION_KILL_SWITCH=false     # Emergency brake
```

Currently:
- Registration codes are **ALWAYS required** (hard-coded)
- Kill-switch is **always checked** (stored in Redis)

---

## Usage Examples

### Admin: Generate Codes

```bash
# Create single code
curl -X POST https://api.example.com/admin/registration-codes \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"description": "Alpha tester invite", "maxUses": 1}'

# Create 10 codes for beta testers
curl -X POST https://api.example.com/admin/registration-codes/bulk \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"count": 10, "description": "Beta wave 1", "maxUses": 1}'

# Create multi-use code (e.g., for a team)
curl -X POST https://api.example.com/admin/registration-codes \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"description": "Team Acme Corp", "maxUses": 5}'
```

### User: Register with Code

```bash
curl -X POST https://api.example.com/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!",
    "registrationCode": "abc123xyz789"
  }'
```

### Admin: Emergency Halt Registrations

```bash
# Enable kill-switch
curl -X POST https://api.example.com/admin/registration/kill-switch/enable \
  -H "Authorization: Bearer <admin-jwt>"

# Disable kill-switch
curl -X POST https://api.example.com/admin/registration/kill-switch/disable \
  -H "Authorization: Bearer <admin-jwt>"
```

### Admin: Disable User Account

```bash
# Disable
curl -X PATCH https://api.example.com/admin/users/clx123abc/disable \
  -H "Authorization: Bearer <admin-jwt>"

# Re-enable
curl -X PATCH https://api.example.com/admin/users/clx123abc/enable \
  -H "Authorization: Bearer <admin-jwt>"
```

---

## Files Modified/Created

### Created
- `prisma/migrations/20260209093024_add_registration_codes/migration.sql`
- `src/api/shared/services/registration-code.service.ts`
- `.ai/ADMIN_ACCESS_CONTROL_IMPLEMENTATION.md` (this file)

### Modified
- `prisma/schema.prisma` - Added `RegistrationCode` model
- `src/api/controllers/auth.controller.ts` - Added registration code validation
- `src/api/controllers/admin.controller.ts` - Added 11 new endpoints
- `src/api/modules/auth.module.ts` - Registered `RegistrationCodeService`, added `RedisModule`
- `src/api/modules/admin.module.ts` - Added `RegistrationCodeService` provider
- `src/api/shared/services/auth.service.ts` - Updated `RegisterDto` interface

---

## Next Steps

1. **Test all endpoints** (use checklist above)
2. **Update frontend** - Add registration code input field
3. **Update documentation** - API docs, user guide
4. **Production deployment:**
   - Run migration: `npx prisma migrate deploy`
   - Generate codes for initial alpha users
   - Distribute codes via secure channel (email, private Discord, etc.)
5. **Monitor logs** for registration attempts and code usage

---

## Rollback Plan

If issues arise:

1. **Disable kill-switch** (if accidentally enabled):
   ```bash
   redis-cli DEL registration:kill-switch
   ```

2. **Temporarily disable code requirement**:
   - Comment out validation in `AuthController.register()`
   - Redeploy

3. **Database rollback**:
   ```bash
   npx prisma migrate reset  # CAUTION: Dev only
   # Or manually drop RegistrationCode table
   ```

---

## Questions / Clarifications

**Q: Can we skip registration codes for specific users (e.g., legacy users)?**
A: Not currently - all registrations require codes. Could add a config flag or allowlist.

**Q: Can admins see which user used which code?**
A: Yes - `GET /admin/registration-codes` includes `usedBy` relation with user info.

**Q: What happens if Redis is down?**
A: Kill-switch check will fail-open (allow registrations) OR fail-closed (block registrations) depending on error handling. Currently: fail-closed (safer for alpha control).

**Q: Can we expire codes automatically?**
A: Yes - set `expiresAt` when creating. Validation checks expiration.

**Q: Can we un-revoke a code?**
A: Not via API - would need direct database update. Intentional (revoke should be permanent).

---

**Status: Ready for Testing & Frontend Integration** ✅
