# Screen Contract: 12_DELIVERY

## 1. Screen Purpose
Provides delivery drivers (couriers) and operations managers with views of delivery schedules, shipping addresses, active delivery assignments, and fulfillment triggers (e.g. mark as arriving, delivered, or canceled).

## 2. Dashboard Route
`/delivery`

## 3. Visible UI Requirements
* List of today's deliveries grouped by Delivery Window (e.g. 08:00 - 11:00) and Zone.
* Map/Navigation links or shipping addresses for each client.
* Call-to-action buttons for the courier:
  * "Arriving Soon" (sends a notification to the customer)
  * "Delivered" (completes fulfillment)
  * "Canceled/Failed Delivery" (sets failed state)

## 4. Backend Endpoints
> ⚠️ **Route Prefix**: Courier endpoints are mounted at `/api/courier/` (not `/api/dashboard/courier/`).

* `GET /api/courier/deliveries/today` — Lists subscription delivery days scheduled for today.
* `GET /api/courier/orders/today` — Lists one-time order deliveries scheduled for today.
* `PUT /api/courier/deliveries/:id/arriving-soon` — Marks subscription day as arriving.
* `PUT /api/courier/deliveries/:id/delivered` — Marks subscription day as delivered (triggers fulfillment).
* `PUT /api/courier/deliveries/:id/cancel` — Marks subscription day delivery as failed.
* `PUT /api/courier/orders/:id/delivered` — Marks one-time order as delivered.

## 5. Request Parameters
* List Query:
  * `date` (optional, default current KSA date)
* Path:
  * `id` (path, string, ObjectId)

## 6. Response Fields Required
* `status` (boolean): success status.
* `data` (array of delivery items or single delivery item):
  * `id` (string): SubscriptionDay ID or Order ID.
  * `customerName` (string)
  * `customerPhone` (string)
  * `deliveryAddress` (object)
  * `deliveryZone` (string)
  * `deliveryWindow` (string)
  * `status` (string): e.g. `preparing`, `out_for_delivery`, `delivered`, `failed`.

## 7. Field Dictionary
* `deliveryWindow`: Time range during which the delivery must occur (e.g. `08:00-11:00`).
* `status`: State of the delivery task. Supported values: `preparing`, `out_for_delivery`, `delivered`, `failed`.

## 8. Classification
`OPERATIONAL`

## 9. Frontend Restrictions
* **No Manual State Calculation**: The driver's device must poll the endpoint to obtain status updates. Do not mutate the UI states locally without backend response confirmation.

## 10. Backend Acceptance Criteria
* Restricted to users with the `courier` or `admin` roles.
* Marking as delivered deducts appropriate quantities from balances and updates the dashboard accounting stats under `grossSalesHalala`.

## 11. Contract Tests Required
* List endpoint returns deliveries ✅ (covered by `dashboardContracts.test.js` — HTTP 200 only).
* Mark delivered transitions state correctly ❌ **NOT YET VERIFIED** — No E2E test exists that seeds a subscription day in `out_for_delivery` state and calls the delivered endpoint.
* One-time order delivery flow ❌ **NOT YET VERIFIED**.

> **Verification Gap**: The current test suite only confirms that `GET /api/courier/deliveries/today` returns HTTP 200. No full end-to-end delivery fulfillment test (seed → mark arriving → mark delivered → confirm balance deduction) has been run. See [SUBSCRIPTION_BACKEND_PARTIAL_PICKUP_VERIFICATION.md](file:///home/hema/Projects/basicdiet145/docs/SUBSCRIPTION_BACKEND_PARTIAL_PICKUP_VERIFICATION.md) § 7a for the documented risk.

## 12. Known Risks
* Offline/Spotty network connections for drivers on the road. The client app should support retry logic with the same request parameters.
* Full delivery E2E flow (arriving → delivered → balance deduction) is not verified. Treat this screen as `NEEDS_TESTS` until a complete delivery flow test exists.

## 13. Status
`NEEDS_TESTS`

> **Reason**: Only the list endpoint (HTTP 200) is contract-tested. The delivery fulfillment state transitions (`arriving-soon`, `delivered`, `cancel`) and their side effects on subscription balances and accounting reports have not been covered by an automated E2E test. Do not mark as `READY` until a complete delivery flow test passes.
