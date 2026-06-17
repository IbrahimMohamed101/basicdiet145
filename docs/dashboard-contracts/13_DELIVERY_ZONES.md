# Screen Contract: 13_DELIVERY_ZONES

## 1. Screen Purpose
Provides CRUD operations for delivery zones. Allows operators to set zone-specific delivery fees, toggle active status, sort zones, and filter lists by query.

## 2. Dashboard Route
`/zones`

## 3. Visible UI Requirements
* List of delivery zones with columns: Name (Ar/En), Delivery Fee (SAR), Status, and Sort Order.
* Create/Edit modal forms: Zone Name (Ar/En), Delivery Fee (in Halalas or Major units), Active status, Sort order.
* Status toggles.

## 4. Backend Endpoints
* `GET /api/dashboard/zones` (lists all zones)
* `GET /api/dashboard/zones/:id` (fetches a single zone)
* `POST /api/dashboard/zones` (creates zone)
* `PUT /api/dashboard/zones/:id` (updates zone details)
* `PATCH /api/dashboard/zones/:id/toggle` (toggles isActive flag)
* `DELETE /api/dashboard/zones/:id` (soft-deletes zone by setting isActive = false)

## 5. Request Parameters
* Query (List):
  * `q` (optional, string)
  * `isActive` (optional, boolean)
* Body (Create/Update):
  * `name` (required, object or string): `{ ar: string, en: string }`
  * `deliveryFeeHalala` (required, integer, >= 0)
  * `isActive` (optional, boolean, default true)
  * `sortOrder` (optional, integer, default 0)

## 6. Response Fields Required
* `status` (boolean): success status.
* `data` (zone object or array of zone objects):
  * `_id` (string)
  * `name` (object): `{ ar, en }`
  * `deliveryFeeHalala` (number)
  * `isActive` (boolean)
  * `sortOrder` (number)

## 7. Field Dictionary
* `deliveryFeeHalala`: Fee added to delivery subscriptions or one-time orders in this zone (e.g. `1500` for 15.00 SAR).

## 8. Classification
`CRUD`

## 9. Frontend Restrictions
* **No Tax Calculations**: Delivery fee values are sent as raw integers in minor units or major units (with backend conversion).

## 10. Backend Acceptance Criteria
* Reject negative delivery fees or non-integer halala values.
* Log all zone creation, update, and toggle events in the activity log with user metadata.

## 11. Contract Tests Required
* List endpoint returns valid array of zones.
* Validates inputs for negative delivery fees (returns 400).

## 12. Known Risks
* Active subscriptions rely on delivery zone IDs. Deleting zones can cause lookup errors unless soft-deleted (which preserves the record in the DB but hides it from new plan signups).

## 13. Status
`READY`
