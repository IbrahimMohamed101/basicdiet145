# Screen Contract: 05_ADDONS

## 1. Screen Purpose
Provides CRUD operations for Add-on items and Add-on subscription plans. Operators can configure available add-ons, set pricing, assign categories (e.g. salads, proteins), and toggle active/disabled states.

## 2. Dashboard Route
`/addons`

## 3. Visible UI Requirements
* List of Add-on items showing: Thumbnail, Arabic & English Name, Price, Category, and Status.
* List of Add-on subscription plans showing: Billing type, maximum allocation per day, and associated items.
* Modals to Create/Edit Add-on items and plans.

## 4. Backend Endpoints
* `GET /api/dashboard/addons` (lists all addons)
* `POST /api/dashboard/addons` (creates an addon item or plan)
* `GET /api/dashboard/addons/:id` (fetches a single addon)
* `PUT /api/dashboard/addons/:id` (updates addon)
* `PATCH /api/dashboard/addons/:id/toggle` (toggles isActive)
* `DELETE /api/dashboard/addons/:id` (deletes an addon)
* `GET /api/dashboard/addon-plans` (lists addon plans)
* `GET /api/dashboard/addon-items` (lists addon items)

## 5. Request Parameters
* Body (Create/Update Addon):
  * `kind` (required, string, values: `item`, `plan`)
  * `name` (required, object): `{ ar: string, en: string }`
  * `category` (required, string, values: `salads`, `proteins`, `sandwiches`, `addons`, etc.)
  * `price` (required, number, in major units)
  * `billingMode` (optional, string, values: `per_day`, `per_meal`)
  * `maxPerDay` (optional, number, default 1)

## 6. Response Fields Required
* `status` (boolean): `true` if request succeeded.
* `data` (addon object or array of addon objects):
  * `id` (string)
  * `kind` (string)
  * `name` (object): `{ ar, en }`
  * `category` (string)
  * `price` (number)
  * `billingMode` (string)
  * `maxPerDay` (number)
  * `isActive` (boolean)

## 7. Field Dictionary
* `kind`: Determines whether the addon is a one-time purchase `item` or a subscription `plan`.
* `billingMode`: Determines billing frequency. `per_day` counts once per selected day, while `per_meal` scales with total meals selected.

## 8. Classification
`CRUD`

## 9. Frontend Restrictions
* **No Pricing Calculation**: The frontend must send raw values input by the user. Taxes and vat breakdown are computed by the backend upon checkout.
* **No Category Creation**: Category values are constrained by backend enums.

## 10. Backend Acceptance Criteria
* Validate billing modes for plan addons (only `per_day` and `per_meal` are allowed).
* Enforce unique names if required.

## 11. Contract Tests Required
* List endpoint returns valid array.
* Toggle active endpoint changes the flag correctly.

## 12. Known Risks
* Deleting addons that are currently active in customer subscription entitlements could break balance audits. The backend soft-deletes or warns if the item is in use.

## 13. Status
`READY`
