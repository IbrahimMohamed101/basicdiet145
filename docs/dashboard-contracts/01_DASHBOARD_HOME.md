# Screen Contract: 01_DASHBOARD_HOME

## 1. Screen Purpose
Provides a central command view displaying active subscriptions, deliveries scheduled for the day, pending orders, app users, and lists of recent subscriptions and orders.

## 2. Dashboard Route
`/dashboard`

## 3. Visible UI Requirements
* Summary cards for 4 main stats: Active Subscriptions, Deliveries Today, Pending Orders, and App Users.
* Table of recent subscription purchases with columns: User Name, Plan, Status, Start Date, Amount, Created At.
* Table of recent one-time orders with columns: Order ID, Customer, Items Summary, Status, Delivery Date, Amount.

## 4. Backend Endpoints
* `GET /api/dashboard/overview`

## 5. Request Parameters
* Query:
  * `limit` (optional, integer, default 5): number of recent orders/subscriptions to return.

## 6. Response Fields Required
* `status` (boolean): `true` if request succeeded.
* `data.today` (string): date in KSA timezone.
* `data.stats.activeSubscriptions` (number)
* `data.stats.deliveriesToday` (number): sum of active delivery-mode subscription days + non-canceled orders scheduled for today.
* `data.stats.pendingOrders` (number)
* `data.stats.appUsers` (number)
* `data.recentSubscriptions` (array of objects):
  * `id` (string): subscription ID.
  * `userName` (string)
  * `planName` (string)
  * `status` (string)
  * `startDate` (string)
  * `amount` (number): amount in major units.
  * `amountDisplay` (string): localized currency string (e.g. "SAR 700.00").
* `data.recentOrders` (array of objects):
  * `id` (string): order ID.
  * `displayId` (string): human-readable display ID.
  * `userName` (string)
  * `itemsSummary` (string): list of items in the order.
  * `status` (string)
  * `date` (string)
  * `amountDisplay` (string)

## 7. Field Dictionary
* `deliveriesToday`: The total combined deliveries for active delivery-mode plans and one-time orders.
* `amountDisplay`: Pre-formatted string prepared by the backend to prevent decimal styling discrepancies.

## 8. Classification
`READ_ONLY`

## 9. Frontend Restrictions
* **No Local Aggregations**: The dashboard must display stats exactly as returned.
* **No Direct Mutations**: No state mutations are performed directly on the dashboard page. Any actions must hit the specific resource's controllers.

## 10. Backend Acceptance Criteria
* Returns a `200 OK` status with valid numeric fields.
* Correctly filters out canceled orders from `deliveriesToday`.

## 11. Contract Tests Required
* Endpoint returns 200 and has the required `stats` keys.

## 12. Known Risks
* High aggregation overhead on the `SubscriptionDay` table on massive databases. Index on `date` and `status` is required.

## 13. Status
`READY`
