# Screen Contract: 02_PAYMENTS

## 1. Screen Purpose
Provides a log of all transactions and payments in the system. Allows operators to view payment status, verify transactions with payment gateways (e.g. Moyasar), and inspect transaction metadata.

## 2. Dashboard Route
`/payments`

## 3. Visible UI Requirements
* Transaction table with columns: Date, User Name, Payment Provider, Payment Type, Status, Amount, Gateway Reference.
* Verification CTA button on pending transactions.
* Detail panel displaying full payload from the payment gateway.

## 4. Backend Endpoints
* `GET /api/dashboard/payments` (lists payments with pagination)
* `GET /api/dashboard/payments/:id` (payment details)
* `POST /api/dashboard/payments/:id/verify` (verifies pending transaction)

## 5. Request Parameters
* List Query:
  * `page` (optional, default 1)
  * `limit` (optional, default 10)
* Detail:
  * `id` (path, string, ObjectId)

## 6. Response Fields Required
* `status` (boolean): success status.
* `data` (for list: array of payment objects, for detail: single payment object):
  * `id` (string): payment ID.
  * `provider` (string): e.g. "moyasar".
  * `type` (string): e.g. "subscription_activation", "one_time_addon".
  * `status` (string): e.g. "paid", "pending", "failed".
  * `amountHalala` (number): amount in minor units.
  * `amountDisplay` (string): formatted amount.
  * `user` (object): client summary (name, phone, role).
  * `metadata` (object): raw metadata (draftId, subscriptionId).
* `meta` (pagination metadata for list): `page`, `limit`, `totalCount`, `totalPages`.

## 7. Field Dictionary
* `amountHalala`: Payment amount in SAR Halalas (inclusive of 16% VAT).
* `status`: Current state of the transaction. Supported values are: `paid`, `pending`, `failed`, `initiated`.

## 8. Classification
`FINANCIAL_CRITICAL`

## 9. Frontend Restrictions
* **No Calculation**: The frontend must not compute payment totals, VAT fractions, or format currency manually. It must display `amountDisplay` directly.
* **No Mutation**: Payments cannot be deleted or updated directly; only verification requests via POST are allowed.

## 10. Backend Acceptance Criteria
* Returns 200/201 and correctly maps payment objects.
* Verify endpoint returns updated payment object with final state (`paid` or `failed`).

## 11. Contract Tests Required
* List endpoint returns valid array and summary details.
* Verification endpoint handles authorization and correct status transition.

## 12. Known Risks
* Moyasar webhook conflicts if manual verification is triggered concurrently with webhook delivery. Handled on backend via atomic transaction locks.

## 13. Status
`READY`
