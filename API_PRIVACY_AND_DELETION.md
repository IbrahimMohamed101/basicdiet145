# Privacy and Account Deletion API

## GET /account-deletion

Returns a backend-served static HTML form for external account deletion requests. This URL must be publicly reachable outside the app for Google Play.

Production URL:

`https://basicdiet145.onrender.com/account-deletion`

## GET /privacy-policy

Returns a browser-readable HTML rendering of `PRIVACY_POLICY.md`. The markdown file remains the source of truth.

Production URL:

`https://basicdiet145.onrender.com/privacy-policy`

## POST /api/account-deletion/request

Public endpoint that also accepts an optional app bearer token.

Request:

```json
{
  "email": "user@example.com",
  "reason": "Optional reason",
  "confirmation": true
}
```

Public success response:

```json
{
  "ok": true,
  "status": "pending",
  "requestId": "665000000000000000000000",
  "message": "Account deletion request received for manual verification."
}
```

Authenticated success response:

```json
{
  "ok": true,
  "status": "completed",
  "requestId": "665000000000000000000000",
  "message": "Account deletion request completed. Active sessions have been revoked."
}
```

Validation errors:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_EMAIL",
    "message": "email must be a valid email address"
  }
}
```

```json
{
  "ok": false,
  "error": {
    "code": "CONFIRMATION_REQUIRED",
    "message": "Deletion confirmation is required"
  }
}
```

Security behavior:

- Rate limited by `RATE_LIMIT_ACCOUNT_DELETION_WINDOW_MS` and `RATE_LIMIT_ACCOUNT_DELETION_MAX`.
- Invalid bearer tokens are rejected with `TOKEN_INVALID`.
- Public requests are stored as `pending` and require manual verification.
- Duplicate public pending requests for the same email within 24 hours return the existing pending request instead of creating unlimited rows.

## POST /api/app/account-deletion/request

Authenticated app endpoint. Requires `Authorization: Bearer <accessToken>`.

Request:

```json
{
  "email": "user@example.com",
  "reason": "Optional reason",
  "confirmation": true
}
```

Behavior:

- Creates an `AccountDeletionRequest` with `status: completed`.
- Soft-deletes the authenticated user by setting `isActive: false`.
- Clears `passwordHash` and `fcmTokens`.
- Revokes active refresh sessions.
- Leaves order, subscription, payment, audit, and operational records intact where required for accounting, tax, fraud prevention, refunds, dispute handling, legal obligations, and operational retention.
- Existing auth middleware blocks the deleted user from protected routes and login.

Documented retention notes:

- Account deletion requests are retained for up to 90 days after completion.
- Server logs are retained for up to 30 days unless needed for security investigation or legal compliance.
- Backups may retain deleted data for up to 30 days before being overwritten.
- Support records are retained for up to 180 days after the last interaction.
- Orders and payment records are retained as required for accounting, tax, fraud prevention, refunds, dispute handling, and legal obligations.

## Manual Admin Processing

For public `pending` requests:

1. Verify the requester's identity outside the public form.
2. Locate the matching `User`/`AppUser` by email or related account records.
3. If verified, soft-delete the user using the same behavior as the authenticated flow.
4. Set the `AccountDeletionRequest.status` to `completed` and `processedAt` to the processing time.
5. If rejected, set `status` to `rejected`, `processedAt`, and document the reason in `metadata`.

TODO: Add an internal admin endpoint or back-office workflow if manual processing should happen inside the dashboard.
