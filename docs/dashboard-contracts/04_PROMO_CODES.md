# Screen Contract: 04_PROMO_CODES

## 1. Screen Purpose
Enables creating, editing, activating, deactivating, deleting, validating, and auditing promo codes. Displays recent usages of specific promo codes for audit logs.

## 2. Dashboard Route
`/promo-codes`

## 3. Visible UI Requirements
* Promo codes list showing: Code, Discount Type (percentage/fixed), Value, Usage Limits, Current Usages, Expiry Date, Active Status toggle.
* Create/Edit form: Code name, discount value, type (percent or flat), maximum limit, expiry date, active status.
* Detail panel for specific promo showing list of recent usages (user name, checkout draft ID, discount amount, creation date).

## 4. Backend Endpoints
* `GET /api/dashboard/promo-codes` (list promo codes)
* `GET /api/dashboard/promo-codes/:id` (promo code details with recent usages)
* `POST /api/dashboard/promo-codes` (create promo code)
* `PUT /api/dashboard/promo-codes/:id` (update promo code)
* `PATCH /api/dashboard/promo-codes/:id/toggle` (toggle isActive)
* `DELETE /api/dashboard/promo-codes/:id` (soft-delete promo code if usage count is 0)
* `POST /api/dashboard/promo-codes/validate` (validate promo code on quote)

## 5. Request Parameters
* List Query:
  * `includeDeleted` (optional, boolean, default `false`)
* Body (Create/Update):
  * `code` (required, string, unique)
  * `discountType` (required, string, values: `percentage`, `fixed`)
  * `discountValue` (required, number)
  * `maxUsageCount` (optional, number)
  * `expiresAt` (optional, date string)
* Body (Validate):
  * `promoCode` (required, string)
  * `planId` (optional, string)
  * `subtotalHalala` (optional, number)

## 6. Response Fields Required
* `status` (boolean): success status.
* `data` (varies by endpoint):
  * `id` (string)
  * `code` (string)
  * `discountType` (string)
  * `discountValue` (number)
  * `maxUsageCount` (number)
  * `currentUsageCount` (number)
  * `expiresAt` (string)
  * `isActive` (boolean)
  * `recentUsage` (array of usage objects, returned by GET `/promo-codes/:id`)

## 7. Field Dictionary
* `maxUsageCount`: Maximum times this promo code can be redeemed globally.
* `currentUsageCount`: Number of successfully completed transactions utilizing this code.

## 8. Classification
`FINANCIAL_CRITICAL`

## 9. Frontend Restrictions
* **No Validation Calculation**: The dashboard must use `POST /promo-codes/validate` to calculate the final quote pricing and check validity rather than checking expiration or subtotal conditions locally.

## 10. Backend Acceptance Criteria
* Reject creation of duplicate codes (returns 409 Conflict).
* Block soft delete if `currentUsageCount > 0` (returns 409 `PROMO_IN_USE`).
* Flat discount value is validated in major units or minor units depending on discount type.

## 11. Contract Tests Required
* List endpoint returns valid array.
* Validation endpoint correctly applies discount and returns breakdown.

## 12. Known Risks
* Expiration timezone issues (KSA vs UTC). Expiration checks are fully computed on the backend using KSA timezone offsets.

## 13. Status
`READY`
