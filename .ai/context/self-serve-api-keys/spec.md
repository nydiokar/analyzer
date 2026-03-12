# Self-Serve API Keys — Spec
**Created:** 2026-03-13  **Target branch:** `feat/self-serve-api-keys`  **Estimate:** ~3 hours

Goal: any developer can visit the live URL, register with email, and walk away with a working API key for the `/intel` endpoints — zero human in the loop.

---

## What is already done (do NOT redo)

- `ApiKeyService` — full CRUD: `createApiKey`, `listUserApiKeys`, `revokeApiKey` — all own-user-safe
- `CreditsService.grantSignupBonus()` — already called in `auth.service.ts:131` on every registration
- `RegistrationCodeService.areCodesRequired()` — already Redis-backed; defaults to open when key absent
- `FREE_CREDITS_ON_SIGNUP` env var — already read by `CreditsService`
- Admin UI for API key management — `dashboard/src/app/admin/page.tsx` (reference for fetch patterns)
- `useApiKeyStore` — `dashboard/src/store/api-key-store.ts` (stores the key used for API calls in the dashboard)

---

## What needs to be built

### SELF-1 — Backend: user self-serve API key endpoints  [S ~45 min]

**File:** `src/api/controllers/users.controller.ts`
Currently only has `GET /users/me`. Add three routes to the same controller:

```
POST   /users/api-keys          create key (own user only, scope: ['read'])
GET    /users/api-keys          list own keys (no raw key, same as ApiKeyService.listUserApiKeys)
DELETE /users/api-keys/:keyId   revoke own key (ApiKeyService.revokeApiKey validates ownership)
```

**Implementation notes:**
- All three require `CompositeAuthGuard` (already the global guard — no extra decorator needed unless the controller has `@Public()`)
- `POST` body: `{ description: string }` — scope is hardcoded to `['read']`, no expiry by default. Do NOT let users set their own scopes.
- `POST` response: return the raw `apiKey` string + `keyInfo`. Add a clear warning in the Swagger description: "Save this key — it is shown only once."
- `DELETE` — call `this.apiKeyService.revokeApiKey(userId, keyId)` (already enforces ownership, throws `UnauthorizedException` on mismatch)
- Add throttle: `@Throttle({ default: { limit: 5, ttl: 3600000 } })` on `POST` (5 keys per hour per user)
- Inject `ApiKeyService` into `UsersController` — it is exported from `AuthModule` (already global)

**File:** `src/api/modules/users.module.ts`
Add `ApiKeyService` and `ApiKeyDatabaseService` to providers/imports if not already there. Check first — `AuthModule` is `@Global()` so they may already be available.

---

### SELF-2 — Dashboard: developer settings page  [M ~90 min]

**New file:** `dashboard/src/app/dashboard/developer/page.tsx`

Single page, no layout changes needed. Three sections:

#### Section 1 — Credit balance
- Fetch `GET /credits/balance` with the JWT from `useAuthStore` (or wherever the session token lives — check `dashboard/src/store/auth-store.ts`)
- Show current balance as a number. No purchase flow needed here.

#### Section 2 — Generate API key
- Single text input: "Key description" (e.g. "my-script", "pft-bot")
- "Generate API Key" button → `POST /users/api-keys` with JWT Bearer header
- On success: show the raw key in a `<code>` block with a copy button. Display a one-time warning: "This key will not be shown again. Copy it now."
- After user copies / dismisses, clear the raw key from state (never persists to localStorage)
- On error: show inline error (e.g. rate limit, auth failure)

#### Section 3 — Existing keys table
- Fetch `GET /users/api-keys` on mount
- Columns: prefix (`ak_xxxxxx`), description, created date, last used, status (active/revoked)
- "Revoke" button per row → `DELETE /users/api-keys/:keyId` → refetch list
- Empty state: "No API keys yet. Generate one above."

#### Navigation
- Add a link to this page from the existing dashboard nav or account area. Check `dashboard/src/components/layout/` for the nav component. A simple "Developer" or "API Keys" entry is enough.

**Auth pattern to follow:** look at `dashboard/src/app/admin/page.tsx` lines ~220–300 for the fetch-with-JWT pattern used across the dashboard.

---

### SELF-3 — Open registration default + docs callout  [S ~15 min]

**Verify registration is open:**
In Redis (prod): check that `registration:codes-required` key is absent or set to `"false"`. If you want to guarantee open registration without relying on Redis state, add a `REGISTRATION_OPEN=true` env var path in `RegistrationCodeService.areCodesRequired()` that short-circuits to `false` before the Redis check. This is a 3-line change.

**File:** `src/api/shared/services/registration-code.service.ts`
In `areCodesRequired()`, add at the top:
```ts
if (this.configService.get<string>('REGISTRATION_OPEN') === 'true') return false;
```
Then set `REGISTRATION_OPEN=true` in `.env`.

**Docs callout (optional, 5 min):**
Update `packages/sdk/README.md` or the Docusaurus `authentication.md` to add a "Get an API key" section pointing to the live dashboard URL developer page. One paragraph, no code needed.

---

## File change summary

| File | Change |
|:-----|:-------|
| `src/api/controllers/users.controller.ts` | Add 3 routes: POST/GET/DELETE `/users/api-keys` |
| `src/api/modules/users.module.ts` | Inject `ApiKeyService` if not already available |
| `src/api/shared/services/registration-code.service.ts` | Add `REGISTRATION_OPEN` env var short-circuit (3 lines) |
| `dashboard/src/app/dashboard/developer/page.tsx` | New page — credit balance + key gen + key list |
| `dashboard/src/components/layout/` (nav component) | Add "API Keys" / "Developer" nav link |
| `.env` | Add `REGISTRATION_OPEN=true` |

---

## Key facts found during research

- `ApiKeyService` is exported from `AuthModule` which is `@Global()` — injectable everywhere without adding to module imports
- `ApiKeyService.revokeApiKey(userId, keyId)` already validates ownership and throws on mismatch — safe to expose directly
- `ApiKeyService.createApiKey()` takes `{ userId, description, scopes, expiresInDays? }` — returns `{ apiKey: string, keyInfo: ... }`
- `ApiKeyService.listUserApiKeys(userId)` returns array with `keyHash: '[REDACTED]'` — safe to return directly to client
- `CreditsService.grantSignupBonus()` is already called on registration at `auth.service.ts:131` — do NOT add it again
- `FREE_CREDITS_ON_SIGNUP` env var controls the grant amount (default 100 if unset)
- API key format: `ak_<12hex>_<base64url-32bytes>` — prefix is `ak_<12hex>` for lookup
- Scopes: `'read' | 'report' | 'analysis' | 'admin' | 'full'` — self-serve keys get `['read']` only
- Dashboard fetch pattern: `fetch(\`\${API_BASE_URL}/admin/api-keys\`, { headers: { Authorization: \`Bearer \${token}\` } })` — see `admin/page.tsx:224`
- Registration kill-switch Redis key: `registration:kill-switch`; codes-required key: `registration:codes-required`
