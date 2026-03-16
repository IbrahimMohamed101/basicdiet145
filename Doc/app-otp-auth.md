# Mobile App OTP Auth (WhatsApp / Twilio)

## Flow (text diagram)

1. `POST /api/app/register` with `fullName` + `phoneE164` + optional `email`
2. Backend validates E.164, validates the profile payload, checks cooldown (30s), creates 6-digit OTP, hashes OTP, stores OTP with TTL (5m), stores the pending profile temporarily with the OTP, and sends WhatsApp OTP through Twilio.
3. `POST /api/app/verify` with `phoneE164` + `otp`
4. Backend validates expiry + attempts (max 5), compares hash, and applies IP rate-limit for verify attempts.
5. On valid OTP for registration:
   - Create or resolve both `AppUser` and core `User` (role=`client`) by phone.
   - Apply the pending `fullName` and `email`.
   - Return app JWT (`tokenType=app_access`) + user profile.
6. Existing-user sign-in remains:
   - `POST /api/app/login` with `phoneE164`
   - Then `POST /api/app/verify` with `phoneE164` + `otp`

Dashboard/admin creation is not exposed in `/api/app/*` and app registration cannot assign admin/dashboard roles.

## Endpoints

- `POST /api/app/register`
  - Input:
    - `{ "fullName": "...", "phoneE164": "+966...", "email": "..." }`
  - Output:
    - `{ "status": true, "message": "OTP sent successfully", "data": { "phoneE164": "+966...", "nextStep": "verify" } }`

- `POST /api/app/login`
  - Input: `{ "phoneE164": "+966..." }`
  - Output: `{ "status": true, "message": "OTP sent successfully", "data": { "phoneE164": "+966...", "nextStep": "verify" } }`

- `POST /api/app/verify`
  - Input: `{ "phoneE164": "+966...", "otp": "123456" }`
  - Output:
    - `{ "status": true, "token": "<app_jwt>", "user": { ... } }`

- `POST /api/auth/otp/request`
  - Input: `{ "phoneE164": "+9665XXXXXXXX" }`
  - Output: `{ "status": true }`

- `POST /api/auth/otp/verify`
  - Input: `{ "phoneE164": "+9665XXXXXXXX", "otp": "123456" }`
  - Output:
    - `{ "status": true, "token": "<app_jwt>", "user": { ... } }`

## cURL quick test

```bash
curl -X POST http://localhost:3000/api/app/register \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Jane Doe","phoneE164":"+9665XXXXXXXX","email":"jane@example.com"}'
```

```bash
curl -X POST http://localhost:3000/api/app/verify \
  -H "Content-Type: application/json" \
  -d '{"phoneE164":"+9665XXXXXXXX","otp":"123456"}'
```

```bash
curl -X POST http://localhost:3000/api/app/login \
  -H "Content-Type: application/json" \
  -d '{"phoneE164":"+9665XXXXXXXX"}'
```

```bash
curl -X POST http://localhost:3000/api/app/verify \
  -H "Content-Type: application/json" \
  -d '{"phoneE164":"+9665XXXXXXXX","otp":"123456"}'
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
- `POST /api/app/profile`, `PUT /api/app/profile`, and other protected endpoints require bearer token.
- `POST /api/app/register` no longer requires bearer token; it only starts the OTP-backed sign-up flow.
