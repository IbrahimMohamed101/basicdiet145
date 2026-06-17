# Screen Contract: 08_ONE_TIME_ORDERS

## 1. Screen Purpose
Provides monitoring, lifecycle state changes, timeline history, and actions for one-time orders (non-subscription checkout items).

## 2. Dashboard Route
`/one-time-orders`

## 3. Visible UI Requirements
* Filters: Status (Pending, Preparing, Ready for Pickup, Fulfilled, Canceled, No Show), Payment Status (Paid, Pending, Failed), Fulfillment Method (Pickup, Delivery).
* Date range selector.
* Table showing order display ID, Customer name & phone, Order items list, Payment status, Fulfillment method, Total price, Status, and date.
* Order detail side-panel:
  * Customer profile, billing details, and shipping address.
  * Timeline of order status transitions (status changed from X to Y by actor Z at datetime).
  * Action controls: Prepare, Ready for Pickup, Fulfill, Cancel, No Show.

## 4. Backend Endpoints
* `GET /api/dashboard/orders` (lists orders)
* `GET /api/dashboard/orders/:orderId` (gets order detail)
* `GET /api/dashboard/orders/:orderId/timeline` (gets order timeline logs)
* `POST /api/dashboard/orders/:orderId/actions/:action` (triggers transitions: `prepare`, `ready_for_pickup`, `fulfill`, `no_show`, `cancel`)

## 5. Request Parameters
* List Query:
  * `status`, `paymentStatus`, `fulfillmentMethod`, `from`, `to`, `date`, `q`, `page`, `limit`
* Action:
  * `orderId` (path, string, ObjectId)
  * `action` (path, string, e.g. `prepare`, `fulfill`)
  * `body` (optional, JSON, e.g. reason for cancellation)

## 6. Response Fields Required
* `status` (boolean): success status.
* `data` (varies by endpoint):
  * `id` (string)
  * `displayId` (string)
  * `status` (string)
  * `paymentStatus` (string)
  * `deliveryMode` (string)
  * `pricing` (object): subtotal, total, VAT breakdown.
  * `items` (array of objects): products, quantity, unit price.

## 7. Field Dictionary
* `displayId`: A friendly alphanumeric identifier formatted as `ORD-XXXXXX`.
* `paymentStatus`: Indicates if the cash, cod, or online payment succeeded (`paid`), failed (`failed`), or is pending (`pending`).

## 8. Classification
`FINANCIAL_CRITICAL`

## 9. Frontend Restrictions
* **No Local State Transitions**: The frontend must send actions to `POST /api/dashboard/orders/:orderId/actions/:action` and refresh order status based on the backend response. Do not perform state changes or status displays locally.

## 10. Backend Acceptance Criteria
* Restrict transition actions to permitted states (e.g. cannot fulfill a canceled order).
* Log transition events with the actor ID and role to populate the order timeline correctly.

## 11. Contract Tests Required
* List endpoint returns valid array of orders.
* Reject invalid transitions on test orders.

## 12. Known Risks
* Customer might request cancellation after preparation has started. The backend logs the operator who approved the cancellation.

## 13. Status
`READY_WITH_LIMITATIONS` (Verified via the `oneTimeOrders.test.js` integration suite, but lacks dedicated detailed validations inside `dashboardContracts.test.js`).
