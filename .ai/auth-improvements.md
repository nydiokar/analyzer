Auth improvements (current JWT implementation)
- Password reset flow now returns a generic 200 response; tokens are only emailed/logged in dev and never returned in API responses.
- Refresh tokens are hashed in Redis (hash → session) with replay detection; reuse revokes the user’s sessions. Per-user session sets added for O(1) revocation and an absolute max lifetime is enforced.
- Transport for this release is `Authorization: Bearer`; cookie mode stays optional. CSRF guard is bypassed when cookie mode is off.
- Secrets: PASSWORD_PEPPER must exist and be ≥32 chars; JWT verify pinned to HS256; absolute refresh max age added for defense-in-depth.
- Exposure reduction: no plaintext refresh tokens in Redis; per-user session sets replace scans; added `npm run auth:reset-sessions` to clear legacy keys.
- Email delivery abstraction added with Resend support (via `MAIL_PROVIDER=resend`), suppression checks, and Resend webhook endpoint (`/webhooks/email/resend`, optional `MAIL_WEBHOOK_SECRET`). SMTP remains supported as a fallback.
