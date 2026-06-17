# Screen Contract: 11E_MENU_OPTIONS

## 1. Screen Purpose
Provides CRUD operations, toggling, reordering, and visibility/availability controls for global options (e.g. specific ingredients/sides).

## 2. Dashboard Route
`/menu/options`

## 3. Visible UI Requirements
* List of options with filter by group, displaying name, key, extra price, visibility, availability, and active status.
* Create/Edit Option forms.
* Active status toggle button.

## 4. Backend Endpoints
* `GET /api/dashboard/menu/options` (lists options, optional query filters like `groupId` or `search`/`q`)
* `POST /api/dashboard/menu/options` (creates a global option)
* `PATCH /api/dashboard/menu/options/reorder` (reorders options sortOrder)
* `GET /api/dashboard/menu/options/:id` (gets option detail)
* `PATCH /api/dashboard/menu/options/:id` (updates option fields)
* `PATCH /api/dashboard/menu/options/:id/visibility` (toggles isVisible)
* `PATCH /api/dashboard/menu/options/:id/availability` (toggles isAvailable)
* `DELETE /api/dashboard/menu/options/:id` (soft-deletes option)
* `PATCH /api/dashboard/menu/options/:id/toggle` (toggles isActive)

## 5. Request Parameters
* **Create Option (`POST /api/dashboard/menu/options`):**
  * `groupId` (required, string, ObjectId): Parent group ID.
  * `name` (required, object): `{ ar: string, en: string }`
  * `key` (optional, string): If empty, auto-generated.
  * `extraPriceHalala` (optional, integer, default 0)
  * `extraWeightUnitGrams` (optional, integer, default 0)
  * `extraWeightPriceHalala` (optional, integer, default 0)
  * `imageUrl` (optional, string)
  * `isVisible` (optional, boolean)
  * `isAvailable` (optional, boolean)
* **Update Option (`PATCH /api/dashboard/menu/options/:id`):** Same parameters as create.
* **Reorder Options (`PATCH /api/dashboard/menu/options/reorder`):**
  * `items` (required, array of strings/ObjectIds): Ordered list of Option IDs.

## 6. Response Fields Required
* `status` (boolean): `true` if request succeeded.
* `data` (option object or array):
  * `_id` (string, ObjectId)
  * `groupId` (string, ObjectId)
  * `key` (string)
  * `name` (object): `{ ar, en }`
  * `extraPriceHalala` (number)
  * `extraWeightUnitGrams` (number)
  * `extraWeightPriceHalala` (number)
  * `imageUrl` (string)
  * `isVisible` (boolean)
  * `isAvailable` (boolean)
  * `isActive` (boolean)
  * `sortOrder` (number)

## 7. Status
`READY_WITH_LIMITATIONS` (Tested using basic read/write integration tests, but lacks comprehensive assertions on all fields).
