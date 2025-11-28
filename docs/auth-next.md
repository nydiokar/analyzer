## Auth Next Tasks (Release-focused)

Prioritized, minimal-change steps to reach a safe, shippable state. Keep API keys working; focus on session safety, CSRF (if cookies), and key rotation hooks. Argon2id migration is deferred until core session and CSRF are done.

### Must-fix before shipping this branch
- Stop returning real password reset tokens; only email/log in dev and respond with a generic message.
- Hash refresh tokens in Redis (store hash → session) and enforce replay revocation: on reuse, revoke chain/all user sessions and alert.
- Choose a transport strategy and align middleware:
  - **Headers (chosen for this release)**: disable cookie mode; drop CSRF; rely on `Authorization: Bearer`.
  - **Cookies**: add cookie extractor in the auth guard, ensure CSRF on all POST/PUT/PATCH/DELETE routes (not just `/auth`), and avoid exposing tokens to JS storage.
- Enforce strong secrets: require non-empty 32+ char `PASSWORD_PEPPER`; keep JWT verify restricted to `HS256`.

### Guarding strategy for this release (Authorization header)
- Keep `CompositeAuthGuard` as the gate for all protected routes and require `Authorization: Bearer <access-token>`.
- Disable `AUTH_COOKIE_MODE` in env so cookies are not issued; remove CSRF guards from routes when cookie mode is off.
- Ensure frontend always attaches fresh access tokens from auth responses to the `Authorization` header; keep refresh rotation flow unchanged.
- If/when moving to cookies later: add a cookie extractor to the guard/Passport strategy, extend CSRF protection to every POST/PUT/PATCH/DELETE route, and avoid duplicating tokens into JS storage.

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

10) Refactor Entry point to the whole app
- Guard all tools for unauthorized users 
- Create a single entry point of visit freely - the web site is just one page, tools are accessed only after logged in
- Docs are visible to anybody while profile/settings only for logged in

Notes
- Keep changes minimal; avoid refactors unrelated to these tasks.
- Maintain API-key compatibility throughout.

### Next hardening (post-ship, if time permits)
- Add absolute max lifetime for refresh sessions (e.g., 30d) in addition to the 7d sliding window.
- Reduce Redis key scans (per-user session sets or secondary index) for revocation/getUserSessions.
- Add alerts/logs for replay detection and suspicious auth events.
- Add automated tests for auth flows (register/login/refresh/revoke/reset/verify-email, replay).
- Argon2id migration with hash versioning once the above are stable.
