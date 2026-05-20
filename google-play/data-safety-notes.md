# Google Play Data Safety Notes

Based on confirmed product behavior and the backend code reviewed, likely collected data includes:

- Personal info: phone number, optional name, optional email address.
- App activity/order data: orders, subscriptions, meal selections, pickup/delivery workflow data, promo usage.
- Financial info: payment amount/status/provider identifiers via Moyasar. Full payment card data is processed by Moyasar and is not stored on basicdite servers.
- Device or other IDs: refresh-session device ID/name if provided, user agent, IP address, Firebase push tokens.
- User-generated/support-adjacent data: optional account deletion reason, custom meal/salad selections.

Not collected or not used:

- No analytics SDK data.
- No crash logs through crash-reporting SDKs.
- No advertising ID.
- No ads.
- No precise location.
- No contacts.
- No photos/media access.
- No camera access.
- No microphone access.

Purposes:

- Account management and authentication.
- Twilio-backed login code/message sending and verification.
- Order/subscription fulfillment.
- Payment processing and reconciliation.
- App functionality and notifications.
- Fraud prevention, abuse prevention, security, compliance, accounting, and support.

Sharing:

- Twilio for authentication/login code delivery or verification.
- Moyasar for payments.
- Firebase Cloud Messaging for push notifications.
- Hosting/database/logging providers.

Sale of data and advertising:

- Data is not sold.
- Data is not shared for advertising.
- The app does not use ads or advertising IDs.

Encryption in transit:

- Yes. The production backend URLs use HTTPS on `https://basicdiet145.onrender.com`.

Can users request deletion:

- Yes. Backend supports public requests at `/account-deletion` and authenticated requests at `/api/app/account-deletion/request`.

Required or optional:

- Phone number is required for account authentication.
- Authentication data may include phone number or login identifier if Twilio login is used.
- Name/email are optional in backend flows where accepted, but email is required for public deletion requests.
- Payment/order/subscription data is required to provide paid ordering/subscription services.
- Push tokens are optional and only needed for notifications.

TODOs before submitting:

- Confirm production hosting region.
- Confirm production database encryption-at-rest.
- Confirm production backup provider and backup settings.
- Confirm exact production Twilio, Moyasar, Firebase, hosting, database, and logging provider settings.
