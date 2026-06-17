# Screen Contract: 06_PACKAGES

## 1. Screen Purpose
Provides CRUD operations for subscription packages (plans). Confgures plan pricing tiers based on days count, daily meal counts, protein and carbohydrate gram choices.

## 2. Dashboard Route
`/packages`

## 3. Visible UI Requirements
* List of packages showing: Name (Ar/En), Category, Gram Choices, Pricing Options, Active Status.
* Add/Edit package form: Name (Ar/En), description, image, category (e.g. keto, weight gain).
* Nested lists to configure specific Gram tiers (e.g. 100g Carb, 150g Protein) and Meal counts per day (e.g. 2 meals, 3 meals per day) with their associated pricing.

## 4. Backend Endpoints
* `GET /api/dashboard/plans` (list plans)
* `GET /api/dashboard/plans/:id` (fetch single plan)
* `POST /api/dashboard/plans` (create plan)
* `PUT /api/dashboard/plans/:id` (update plan details)
* `DELETE /api/dashboard/plans/:id` (soft/hard deletes plan)
* `PATCH /api/dashboard/plans/:id/toggle` (toggles isActive)
* `POST /api/dashboard/plans/:id/grams` (adds carb/protein gram combination)
* `POST /api/dashboard/plans/:id/grams/:grams/meals` (adds meals option under grams combindation)

## 5. Request Parameters
* Body (Create/Update Plan):
  * `name` (required, object): `{ ar: string, en: string }`
  * `description` (optional, object): `{ ar: string, en: string }`
  * `category` (required, string)
  * `sortOrder` (optional, number)

## 6. Response Fields Required
* `status` (boolean): success status.
* `data` (plan object or array of plan objects):
  * `id` (string)
  * `name` (object): `{ ar, en }`
  * `category` (string)
  * `isActive` (boolean)
  * `grams` (array of objects): lists options (e.g. `grams: "100_150"`) and their associated meal options and pricing configurations.

## 7. Field Dictionary
* `grams`: Represents protein and carbohydrate counts serialized as a string (e.g., `100_150` for 100g protein and 150g carb).
* `mealsPerDay`: Number of meals the client receives each day under this plan tier.

## 8. Classification
`CRUD`

## 9. Frontend Restrictions
* **No Pricing calculations**: The pricing rules, currency formatting, and tax additions are determined by the backend database configuration.

## 10. Backend Acceptance Criteria
* Validate nested gram combination formats.
* Prevent conflicts or duplicate options.

## 11. Contract Tests Required
* List endpoint returns valid array of packages.
* Toggle active endpoint changes flag successfully.

## 12. Known Risks
* Altering pricing tiers can affect existing subscriptions if not guarded. The backend saves historical snapshots of the plan configuration in the `Subscription` document upon purchase.

## 13. Status
`READY`
