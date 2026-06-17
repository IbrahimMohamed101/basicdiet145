# Screen Contract: 10_MANUAL_DEDUCTION

## 1. Screen Purpose
Allows cashiers or admin operators to manually look up a client's subscription details by phone number and manually deduct regular or premium meals/addons directly from their wallet balance (e.g. for walk-in cashiers or customer support overrides).

## 2. Dashboard Route
`/manual-deduction`

## 3. Visible UI Requirements
* Phone number input search field.
* Selected Customer card displaying: Name, Active subscription plans, Remaining balance details (regular meals, premium meals, addons).
* Form to specify deduction amounts (meals count, premium count, addon count), fulfillment method (pickup/delivery), business date, and operational reasons/notes.
* Table of recent manual deductions for the subscription.

## 4. Backend Endpoints
> ⚠️ **Important**: The cashier service is mounted under `/api/dashboard/ops/cashier/`, not under `/subscriptions/`.

* `GET /api/dashboard/ops/cashier/customer-lookup?phone=<phone>` — Looks up client by phone number and returns active subscriptions.
* `POST /api/dashboard/ops/cashier/customer-consumption` — Records a manual meal deduction against a subscription balance.
* `GET /api/dashboard/subscriptions/:subscriptionId/manual-deductions` — Lists past manual deductions for a subscription (if supported by the activity log).

## 5. Request Parameters
* Cashier Lookup Query:
  * `phone` (required, string, URL-encoded phone number e.g. `%2B966500000001`)
* Deduction Body (`POST /cashier/customer-consumption`):
  * `phone` (required, string, customer phone)
  * `subscriptionId` (optional, string, ObjectId — required if customer has multiple active subscriptions)
  * `mealCount` (required, positive integer, number of meals to deduct)
  * `note` (optional, string, reason or notes)
  * `actor` (optional, object, injected by middleware from the authenticated dashboard user)

## 6. Response Fields Required
* `status` (boolean): success status.
* Cashier lookup response (`GET .../customer-lookup`):
  * `data.customer.id` (string): User ID.
  * `data.customer.name` (string)
  * `data.customer.phone` (string)
  * `data.activeSubscriptions` (array): Each entry includes `id`, `status`, `remainingMeals`, `totalMeals`, `canConsumeNow`, `maxConsumableMealsNow`.
* Consumption response (`POST .../customer-consumption`):
  * `data.customer` (object): `id`, `name`, `phone`.
  * `data.subscription.id` (string)
  * `data.subscription.remainingMealsBefore` (number)
  * `data.subscription.remainingMealsAfter` (number)
  * `data.consumption.mealCount` (number)
  * `data.consumption.source` (string): `"cashier_dashboard"`
  * `data.consumption.consumedAt` (string ISO-8601)

## 7. Field Dictionary
* `deductedRegularMeals`: Count of base regular meals to subtract from the subscription balance.
* `deductedPremiumMeals`: Count of base premium meals to subtract from the subscription balance.

## 8. Classification
`OPERATIONAL`

## Subscription-Critical Invariant Rules (Cashier Context)
> These rules are enforced by the backend. The dashboard must never compute or override them.

* **Add-ons are independent entitlements** — They are never counted as base meal slots. Deducting meals via `mealCount` does not affect addon balances.
* **No wallet refunds on partial pickup** — Manually deducting from the balance via this endpoint is a wallet consumption, not a pickup request. It does not affect `addonBalance.remainingQty` for unselected planned add-ons.
* **`selectedMealSlotIds` must never contain add-ons** — Slot selection and add-on selection are strictly separate fields.
* **Flutter remains untouched** — This cashier endpoint is only available to the dashboard. No Flutter/mobile client changes are required.

## 9. Frontend Restrictions
* **No Balance Verification**: The frontend must not check if the deduction quantity exceeds the remaining balance. It must post the transaction to the backend, and handle any validation errors (e.g., `INSUFFICIENT_BALANCE`) returned.

## 10. Backend Acceptance Criteria
* Enforce role restrictions (only cashier, admin, or superadmin can perform deductions).
* Deductions are logged in `ActivityLog` (with action type `manual_subscription_meal_deduction`) to feed the daily accountant reconciliation report.

## 11. Contract Tests Required
* Cashier lookup returns active client info.
* Valid deduction subtracts count and updates database.
* Reject deduction if quantity exceeds remaining wallet balance (returns 422/400).

## 12. Known Risks
* double-submission on slow cashier networks. Use idempotent request handling or debounce client-side.

## 13. Status
`READY`
