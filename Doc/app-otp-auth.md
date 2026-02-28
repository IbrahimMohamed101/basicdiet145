# Mobile App OTP Auth (WhatsApp / Twilio)

## Flow (text diagram)

1. `POST /api/app/login` (or `POST /api/auth/otp/request`) with `phoneE164`
2. Backend validates E.164, checks cooldown (30s), creates 6-digit OTP, hashes OTP, stores OTP with TTL (5m), sends WhatsApp OTP through Twilio.
3. `POST /api/auth/otp/verify` with `phoneE164` + `otp`
4. Backend validates expiry + attempts (max 5), compares hash, and applies IP rate-limit for verify attempts.
5. On valid OTP:
   - Return app JWT (`tokenType=app_access`) + user profile.
   - Auto-link/create both `AppUser` and core `User` (role=`client`) by phone.
6. Optional: `POST /api/app/register` with profile fields (`fullName`, optional `email`) and bearer token from step 5.

Dashboard/admin creation is not exposed in `/api/app/*` and app registration cannot assign admin/dashboard roles.

## Endpoints

- `POST /api/auth/otp/request`
  - Input: `{ "phoneE164": "+9665XXXXXXXX" }`
  - Output: `{ "ok": true }`

- `POST /api/auth/otp/verify`
  - Input: `{ "phoneE164": "+9665XXXXXXXX", "otp": "123456" }`
  - Output:
    - `{ "ok": true, "token": "<app_jwt>", "user": { ... } }`

- `POST /api/app/register`
  - Input:
    - `{ "fullName": "...", "phoneE164": "+966...", "email": "..." }`
  - Output:
    - `{ "ok": true, "token": "<app_jwt>", "user": { ... } }`

- `POST /api/app/login`
  - Input: `{ "phoneE164": "+966..." }`
  - Output: `{ "ok": true }`

## cURL quick test

```bash
curl -X POST http://localhost:3000/api/auth/otp/request \
  -H "Content-Type: application/json" \
  -d '{"phoneE164":"+9665XXXXXXXX"}'
```

```bash
curl -X POST http://localhost:3000/api/auth/otp/verify \
  -H "Content-Type: application/json" \
  -d '{"phoneE164":"+9665XXXXXXXX","otp":"123456"}'
```

```bash
curl -X POST http://localhost:3000/api/app/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <app_jwt>" \
  -d '{"fullName":"Jane Doe","phoneE164":"+9665XXXXXXXX","email":"jane@example.com"}'
```

```bash
curl -X POST http://localhost:3000/api/app/login \
  -H "Content-Type: application/json" \
  -d '{"phoneE164":"+9665XXXXXXXX"}'
```

## Environment variables

Required OTP/Twilio vars:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM` (sandbox sender is `whatsapp:+14155238886`)
- `MONGODB_URI` (or `MONGO_URI`)
- `OTP_TTL_MINUTES` (default 5)
- `OTP_COOLDOWN_SECONDS` (default 30)
- `OTP_MAX_ATTEMPTS` (default 5)
- `OTP_HASH_SECRET` (recommended)
- `RATE_LIMIT_OTP_WINDOW_MS` (default 60000)
- `RATE_LIMIT_OTP_MAX` (default 5)
- `RATE_LIMIT_OTP_VERIFY_WINDOW_MS` (default 60000)
- `RATE_LIMIT_OTP_VERIFY_MAX` (default 10)
- `APP_ACCESS_TOKEN_TTL` (default 31d)
- `DEV_AUTH_BYPASS` (default false; dev-only)

## Sandbox to Production migration

No endpoint contract changes are required.

Only switch operational config:

1. Replace `TWILIO_WHATSAPP_FROM` from sandbox number to approved production WhatsApp sender.
2. Update outgoing message content to approved WhatsApp template content if required by Twilio/Meta policy.
3. Keep request/verify/register/login API payloads unchanged so mobile app does not need auth API contract changes.

## Security notes

- OTP is 6 digits and never stored in plaintext (SHA-256 hash + secret).
- OTP expires after configured TTL (default 5 minutes).
- Cooldown blocks rapid re-request (default 30 seconds).
- Wrong OTP attempts are limited (default 5), then OTP is invalidated.
- OTP record is deleted after successful verification.
- `POST /api/app/register` and other protected endpoints require bearer token.
