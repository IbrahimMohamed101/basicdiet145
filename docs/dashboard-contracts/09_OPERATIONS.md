# Screen Contract: 09_OPERATIONS

## 1. Screen Purpose
Provides real-time queues for kitchen staff, drivers, and cashiers to transition subscription days and pickup requests through operational states (preparing, ready, fulfilled, no-show, canceled).

## 2. Dashboard Route
`/operations`

## 3. Visible UI Requirements
* Kitchen Queue showing items in preparation, sorted by date.
* Courier/Fulfillment queue showing delivery assignments and statuses.
* Self-pickup queue showing ready packages, customer names, branch locations, and pickup codes.
* Action buttons depending on role (e.g., Cashier can trigger "Fulfill" with code verification; Kitchen can trigger "Start Preparation").

## 4. Backend Endpoints
* `GET /api/dashboard/ops/list` (fetches daily queue items)
* `GET /api/dashboard/ops/search` (cashier lookup for active orders/pickup requests)
* `POST /api/dashboard/ops/actions/:action` (executes operations state transition)

## 5. Request Parameters
* List Query:
  * `date` (required, string, `YYYY-MM-DD` format)
* Action Body:
  * `entityId` (required, string, ObjectId)
  * `entityType` (required, string, values: `subscription_day`, `subscription_pickup_request`, `order`)
  * `pickupCode` (optional, string, required for self-pickup fulfillment)

## 6. Response Fields Required
* `status` (boolean): success status.
* `data` (unified enriched DTO object returned by `getEnrichedDTO`):
  * `id` (string)
  * `type` (string): e.g. `subscription_day`, `pickup_request`, `order`.
  * `status` (string): e.g. `preparing`, `ready_for_pickup`, `fulfilled`, `no_show`.
  * `pickupCode` (string, null if not ready)
  * `client` (object): name, phone.
  * `items` (array of objects): lists food items, proteins, carb quantities, and add-ons.

## 7. Field Dictionary
* `entityType`: Defines the domain model type. For self-pickup, it maps to `subscription_pickup_request`.
* `pickupCode`: Alphanumeric/numeric PIN issued to the client when their pickup request becomes `ready_for_pickup`.

## 8. Classification
`OPERATIONAL`

## 9. Frontend Restrictions
* **No Direct Day Fulfillment**: For branch pickup days, direct fulfillment is rejected with `PICKUP_REQUEST_REQUIRED`. Cashiers must look up and fulfill the `subscription_pickup_request` using `pickupCode` verification.
* **Role Enforcement**: Kitchen can prepare, couriers can transition delivery-mode days, and cashiers can fulfill branch pickup requests. Role check middleware blocks unauthorized action types.

## 10. Backend Acceptance Criteria
* Return `422 PICKUP_REQUEST_REQUIRED` when trying to prepare/ready/fulfill branch pickup subscription days directly without a pickup request.
* Fulfill action requires a correct `pickupCode` when verifying a pickup request; returns `400 INVALID_PICKUP_CODE` on mismatch.

## 11. Contract Tests Required
* List endpoint returns daily operations queue.
* Block direct preparation of branch pickup subscription days.
* Verify pickup requests with correct and incorrect codes.

## 12. Known Risks
* Staff double-tapping the fulfill button might cause concurrency issues or double-deductions. Backend transition logic uses mongoose query locking to prevent double-fulfillment.

## 13. Status
`READY`
