# Privacy Policy for basicdite

Effective date: May 20, 2026

basicdite ("we", "us", or "our") operates basicdite. This Privacy Policy explains what data the backend is designed to collect, use, store, and delete.

## Data We Collect

Based on the backend code, basicdite may collect:

- Account and authentication data: phone number, phone verification status, optional full name, optional email address, password hash for password-based app login, OTP verification metadata, refresh-session metadata, device ID/name, IP address, and user agent.
- Order and subscription data: meal selections, custom meal/salad selections, plans, subscription days, pickup/delivery status, delivery zones/addresses where used, promo code usage, and operational history.
- Payment data: payment provider identifiers, invoice/payment status, payment amounts, redirect/callback metadata, and provider webhook data from Moyasar. basicdite does not store full payment card details on its own servers.
- Push notification data: Firebase Cloud Messaging tokens when a user registers a device token.
- Logs and security data: server logs, request metadata, webhook processing data, rate-limit events, and audit/activity logs. The backend includes log redaction helpers for sensitive fields.

basicdite does not use advertising, ads, analytics SDKs, crash reporting SDKs, advertising IDs, precise location, contacts, photos/media access, camera access, or microphone access.

## Why We Collect Data

We use this data to:

- Create, authenticate, and secure user accounts.
- Verify phone numbers and support login, password reset, and session refresh.
- Process orders, subscriptions, pickup, delivery, and customer support workflows.
- Process and reconcile payments through Moyasar.
- Send or verify login codes/messages through Twilio and send push notifications through Firebase when configured.
- Maintain fraud prevention, abuse prevention, system integrity, accounting, audit, and legal records.
- Operate admin, dashboard, kitchen, courier, and reporting workflows.

## How Data Is Stored

Data is stored in MongoDB. Passwords are stored as hashes, and refresh tokens are stored as HMAC hashes rather than raw tokens. Secrets are expected to be loaded from environment variables. Production deployments should use HTTPS/TLS in transit and encrypted managed database/storage services.

TODO: Confirm production database encryption-at-rest, backup retention, and hosting region before publishing.

## Third Parties

Based on the backend integrations, data may be processed by:

- Twilio Verify/WhatsApp for OTP delivery.
- Moyasar for payment invoice/payment processing.
- Firebase Cloud Messaging for push notifications.
- Hosting, database, logging, and infrastructure providers used by basicdite.

We do not sell personal data. basicdite does not share data for advertising or analytics.

TODO: Confirm exact production hosting, database, logging, Twilio, Moyasar, and Firebase provider settings before publishing.

## Authentication and Account Data

Users authenticate with phone OTP and/or password-based login depending on the app flow. Twilio may be used to send or verify login codes/messages. The backend stores phone numbers, optional names/emails, password hashes, refresh-session records, and device/push tokens. Inactive or deleted users are blocked from login and protected API access.

## Analytics and Crash Logs

basicdite does not use analytics SDKs or crash reporting SDKs. Server logs may still collect operational and error metadata needed to run, debug, secure, and protect the service.

## Push Notifications

The backend supports Firebase Cloud Messaging tokens. These tokens are used to send app notifications if push notifications are enabled.

## Payments

Payments are processed through Moyasar. The backend stores payment identifiers, status, amounts, and webhook/reconciliation metadata. basicdite does not store full payment card details on its own servers. Payment and order records may be retained where required for accounting, tax, fraud prevention, refunds, dispute handling, and legal obligations.

## Data Retention

Account profile data is retained while the account is active. When an authenticated user requests deletion, the backend soft-deletes the account, revokes sessions, removes password hash and push tokens, and prevents login. Deleted account personal profile data is deleted or anonymized where technically and legally possible after account deletion is processed.

Retention periods:

- Account deletion requests are retained for up to 90 days after completion for security, fraud prevention, and compliance records.
- Server logs are retained for up to 30 days unless needed for security investigation or legal compliance.
- Backups may retain deleted data for up to 30 days before being overwritten.
- Support records are retained for up to 180 days after the last interaction.
- Orders and payment records are retained as required for accounting, tax, fraud prevention, refunds, dispute handling, and legal obligations.

## User Rights and Account Deletion

Users may request deletion from inside the app or through the public account deletion page at:

https://basicdiet145.onrender.com/account-deletion

The public page collects email address, optional reason, and confirmation. Public requests require manual verification before account data is changed. Authenticated in-app requests are processed by soft deletion immediately.

Users may contact us to request access, correction, deletion, or other privacy support:

basicdite@gmail.com

## Children's Privacy

basicdite is not intended for children under the age of 13. We do not knowingly collect personal data from children under 13. If we become aware that a child under 13 has provided personal data, we will take reasonable steps to delete it.

## Security Measures

The backend uses authentication middleware, password hashing, refresh-token hashing, rate limiting on sensitive endpoints, CORS allowlists, security headers, webhook validation, structured error responses, and log redaction helpers. Production deployments must configure strong secrets, HTTPS, restricted CORS origins, secure database access, and safe logging.

## Contact

For privacy questions, contact:

basicdite@gmail.com
