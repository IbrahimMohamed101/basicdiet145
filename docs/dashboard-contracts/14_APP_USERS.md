# Screen Contract: 14_APP_USERS

## 1. Screen Purpose
Provides user search, details, subscription histories, and activation control for client accounts (app users).

## 2. Dashboard Route
`/users`

## 3. Visible UI Requirements
* Search input to match client name or phone.
* Table of clients showing: Name, Phone, Status (Active/Inactive), Total Subscriptions, Active Subscriptions, Registration Date.
* Customer profile detail page:
  * Customer profile card (name, phone, registration date, email, device info).
  * Status toggle (Is Active / Suspended).
  * List of past and current subscriptions for the client.

## 4. Backend Endpoints
* `GET /api/dashboard/users` (lists client users with pagination)
* `GET /api/dashboard/users/:id` (client user details)
* `PUT /api/dashboard/users/:id` (updates client account, e.g. toggling `isActive`)
* `GET /api/dashboard/users/:id/subscriptions` (lists customer's subscription history)

## 5. Request Parameters
* List Query:
  * `page` (optional, default 1)
  * `limit` (optional, default 10)
  * `q` (optional, string)
* Detail/Update:
  * `id` (path, string, ObjectId)
* Update Body:
  * `isActive` (required, boolean)

## 6. Response Fields Required
* `status` (boolean): success status.
* `data` (varies by endpoint):
  * Core user fields (`id`, `name`, `phone`, `email`, `role`, `isActive`, `createdAt`).
  * Counts summary: `subscriptionsCount`, `activeSubscriptionsCount`.
  * Subscription history array (returned by `/users/:id/subscriptions`).

## 7. Field Dictionary
* `isActive`: Boolean indicating if the client is allowed to log in and order via the mobile app.
* `subscriptionsCount`: Cumulative subscription purchases made by the user.

## 8. Classification
`SECURITY_CRITICAL`

## 9. Frontend Restrictions
* **No Calculation**: The counts of active/total subscriptions must be consumed directly from the serializer fields rather than computed on the frontend client-side.

## 10. Backend Acceptance Criteria
* Restrict list/detail/update actions to administrative roles.
* Correctly count active and total subscriptions using database aggregates.

## 11. Contract Tests Required
* List endpoint returns customer profiles.
* Toggle active updates customer status correctly.

## 12. Known Risks
* Disabling a user does not automatically cancel their active delivery days. An operator must cancel or freeze the active subscription if needed.

## 13. Status
`READY_WITH_LIMITATIONS` (Verified via integration smoke tests, but lacks comprehensive assertions on response body fields inside `dashboardContracts.test.js`).
