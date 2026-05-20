# Backend Security Notes

Review date: 2026-05-20

## Fixed in this pass

- Added backend account deletion support with rate limiting.
- Added `AccountDeletionRequest` database model.
- Added public deletion request flow with validation and duplicate-pending-request throttling.
- Added authenticated in-app deletion flow that soft-deletes the user, clears password hash and push tokens, revokes refresh sessions, and blocks protected routes through the existing inactive-user guard.
- Added backend-served `GET /account-deletion` page and `POST /api/account-deletion/request` API.
- Added backend-served `GET /privacy-policy` page that renders `PRIVACY_POLICY.md`.
- Added `POST /api/app/account-deletion/request` authenticated app alias.
- Added tests for valid/invalid deletion requests, confirmation validation, rate limiting, authenticated deletion, session revocation, and protected route denial for deleted users.
- Updated `.env.example` with placeholder-only rate-limit and refresh-token settings.
- Added Google Play privacy/deletion/data-safety documentation.

## Existing protections observed

- Passwords are hashed with `bcryptjs`.
- App access tokens include token type and role checks.
- Refresh tokens are stored as HMAC hashes, not raw tokens.
- Active refresh sessions can be revoked per token or per user.
- OTP, login, dashboard login, checkout, and account deletion endpoints have rate limiters.
- CORS is allowlist-based.
- Helmet security headers are enabled.
- Error responses use generic structured payloads.
- Log sanitization utilities redact common secrets and PII keys.
- `.env` and `.env.*` are ignored except `.env.example`.

## Manual decisions still needed

- Replace all placeholder values in production environment variables with strong secrets.
- Public production Privacy Policy URL: `https://basicdiet145.onrender.com/privacy-policy`.
- Public production Account Deletion URL: `https://basicdiet145.onrender.com/account-deletion`.
- Confirm production backup provider/settings and ensure backup overwrite behavior matches the documented 30-day retention statement.
- Decide whether public account deletion requests should trigger an email verification workflow. No email sending provider was found in the backend.
- Confirm final mobile build has no analytics, crash reporting, ads, advertising ID, location, contacts, media, camera, or microphone permissions.
- Confirm production database encryption-at-rest, backups, access controls, and log retention.
- Confirm exact production Twilio and Moyasar configuration.
- Configure `CORS_ORIGINS`, `FRONTEND_URL`, and `DASHBOARD_URL` to production-only origins before launch.
- Configure `PAYMENT_REDIRECT_ALLOWED_ORIGINS` for production payment redirects.
