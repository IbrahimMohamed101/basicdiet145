# Mobile App OTP Auth (WhatsApp / Twilio)

## Flow (text diagram)

1. `POST /api/app/login` (or `POST /api/auth/otp/request`) with `phoneE164`
2. Backend validates E.164, checks cooldown (30s), creates 6-digit OTP, hashes OTP, stores OTP with TTL (5m), sends WhatsApp OTP through Twilio.
3. `POST /api/auth/otp/verify` with `phoneE164` + `otp`
4. Backend validates expiry + attempts (max 5), compares hash.
5. On valid OTP:
   - If app user exists: return app JWT + user.
   - If app user does not exist: return short-lived `registration token`.
6. `POST /api/app/register` with profile + `verificationToken` to create app-only user (`role=app_user`).

Dashboard/admin creation is not exposed in `/api/app/*` and app registration cannot assign admin/dashboard roles.

## Endpoints

- `POST /api/auth/otp/request`
  - Input: `{ "phoneE164": "+9665XXXXXXXX" }`
  - Output: `{ "ok": true }`

- `POST /api/auth/otp/verify`
  - Input: `{ "phoneE164": "+9665XXXXXXXX", "otp": "123456" }`
  - Existing app user output:
    - `{ "ok": true, "token": "<app_jwt>", "user": { ... } }`
  - New app user output:
    - `{ "ok": true, "token": "<registration_token>", "user": null, "registrationRequired": true }`

- `POST /api/app/register`
  - Input:
    - `{ "fullName": "...", "phoneE164": "+966...", "email": "...", "verificationToken": "..." }`
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
  -d '{"fullName":"Jane Doe","phoneE164":"+9665XXXXXXXX","email":"jane@example.com","verificationToken":"<registration_token>"}'
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
