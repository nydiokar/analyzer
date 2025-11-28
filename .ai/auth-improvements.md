Auth improvements (current JWT implementation)
- Password reset flow must stop returning real reset tokens; only email/log in dev and use dummy response for timing-equal failures.
- Hash refresh tokens before storing in Redis (store hash → session) and enforce replay detection: on reuse, revoke the session chain/user sessions and alert.
- Decide on cookie vs Authorization header. If cookies stay: add guard extractor for the auth cookie, ensure CSRF middleware/guard covers all state-changing routes beyond /auth, and avoid duplicating tokens in JS storage.
- Enforce strong secrets: require non-empty 32+ char PASSWORD_PEPPER and keep JWT verify restricted to HS256. Consider an absolute refresh-session max age in addition to sliding 7d.
- Reduce refresh-session exposure: avoid plaintext token logs, minimize Redis key scans; consider per-user session sets for O(1) revocation.
