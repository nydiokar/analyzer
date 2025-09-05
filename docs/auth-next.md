## Auth Next Tasks (Release-focused)

Prioritized, minimal-change steps to reach a safe, shippable state. Keep API keys working; focus on session safety, CSRF (if cookies), and key rotation hooks. Argon2id migration is deferred until core session and CSRF are done.

✅ **1) Introduce short-lived access tokens - COMPLETED**
- ✅ Set access token TTL to 15–30 minutes via `JWT_EXPIRES_IN` (set to 30m in auth.module.ts)
- ✅ Ensure all dashboard requests use fresh `Authorization: Bearer` from storage/cookie (cookie TTL fixed to match token)

✅ **2) Add rotating refresh tokens in Redis - COMPLETED**
- ✅ Create `refresh_sessions` Redis set/hash keyed by `sessionId` with userId, device label, createdAt, expiresAt (RefreshTokenService)
- ✅ Endpoint: `POST /auth/refresh` issues new access + new refresh, rotates old refresh (store `prevId`), and revokes chain if replay detected
- ✅ Revoke on `POST /auth/logout` (per-session), and on password reset

✅ **3) Per-session logout and revocation - COMPLETED**
- ✅ `POST /auth/logout` accepts current session (from refresh or access) and deletes that session from Redis
- ✅ Optional `DELETE /auth/sessions/:id` for user device management (implemented in RefreshTokenService.getUserSessions)

✅ **4) CSRF protection when cookie mode is enabled - COMPLETED**
- ✅ If `AUTH_COOKIE_MODE=true`: implement double-submit or signed per-mutation CSRF token (CsrfService with HMAC-SHA256)
- ✅ Backend middleware validates token for state-changing routes; frontend includes header `X-CSRF-Token` (CsrfGuard applied to all POST endpoints)

✅ **5) Key management: add kid and rotation policy - COMPLETED**
- ✅ Start signing JWTs with a `kid` header value from config (JwtKeyRotationService with enhanced JWT signing)
- ✅ Document rotation procedure; keep HS256 for now; plan RS256/EdDSA + JWKS later (rotation methods implemented)

✅ **6) Recovery flows (minimal) - COMPLETED**
- ✅ Password reset: create hashed, single-use, expiring reset tokens; endpoint to set new password; revoke all refresh sessions on success
- ✅ Email-change verification token with anti-replay (single-use, expires) - SHA256 hashed tokens, session revocation

✅ **7) JWT validation hardening - COMPLETED**
- ✅ Enforce `iss`/`aud`/`nbf` where applicable, and add ±60–120s leeway (implemented with 120s clock skew)
- ✅ Keep payload minimal: `sub`, `email`, `iat`, `exp`, `iss`, `aud` (enhanced JWT signing with nbf claim)

✅ **8) API key hygiene improvements (scoped/prefix) - COMPLETED**
- ✅ Add prefixed API key format (e.g., `ak_live_...`) and store a prefix field for UX (ApiKeyService with ak_live_/ak_test_ prefixes)
- ✅ Optional minimal scopes (read/report) checked server-side; keep hashing-at-rest (full scope system: read, report, analysis, admin, full)

9) Argon2id migration plan (deferred execution)
- Add password hash versioning (`bcrypt-v1`, `argon2id-v2`).
- On login: detect version, verify; if old, rehash with Argon2id and update.
- Execute only after tasks 1–7 are complete.

Notes
- Keep changes minimal; avoid refactors unrelated to these tasks.
- Maintain API-key compatibility throughout.

