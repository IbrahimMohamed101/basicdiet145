# Screen Contract: 11D_MENU_OPTION_GROUPS

## 1. Screen Purpose
Provides CRUD operations, reordering, and visibility/availability controls for global option groups (the reusable library items).

## 2. Dashboard Route
`/menu/option-groups`

## 3. Visible UI Requirements
* List of option groups displaying names, keys, visibility, and availability status.
* Create/Edit Option Group forms.
* Option assignment panel (links global options to this group).
* Reorder handler.

## 4. Backend Endpoints
* `GET /api/dashboard/menu/option-groups` (lists option groups)
* `POST /api/dashboard/menu/option-groups` (creates a global option group)
* `PATCH /api/dashboard/menu/option-groups/reorder` (reorders option groups sortOrder)
* `GET /api/dashboard/menu/option-groups/:groupId/options` (lists all options belonging to the group)
* `POST /api/dashboard/menu/option-groups/:groupId/options` (creates/assigns option for group)
* `GET /api/dashboard/menu/option-groups/:id` (gets option group detail)
* `PATCH /api/dashboard/menu/option-groups/:id` (updates option group fields)
* `PATCH /api/dashboard/menu/option-groups/:id/visibility` (toggles isVisible)
* `PATCH /api/dashboard/menu/option-groups/:id/availability` (toggles isAvailable)
* `DELETE /api/dashboard/menu/option-groups/:id` (soft-deletes option group)

## 5. Request Parameters
* **Create Option Group (`POST /api/dashboard/menu/option-groups`):**
  * `name` (required, object): `{ ar: string, en: string }`
  * `key` (optional, string): If empty, auto-generated.
  * `description` (optional, object): `{ ar: string, en: string }`
  * `isVisible` (optional, boolean)
  * `isAvailable` (optional, boolean)
* **Update Option Group (`PATCH /api/dashboard/menu/option-groups/:id`):** Same parameters as create.
* **Reorder Option Groups (`PATCH /api/dashboard/menu/option-groups/reorder`):**
  * `items` (required, array of strings/ObjectIds): Ordered list of Option Group IDs.

## 6. Response Fields Required
* `status` (boolean): `true` if request succeeded.
* `data` (option group object or array):
  * `_id` (string, ObjectId)
  * `key` (string)
  * `name` (object): `{ ar, en }`
  * `description` (object): `{ ar, en }`
  * `isVisible` (boolean)
  * `isAvailable` (boolean)
  * `sortOrder` (number)
  * `isActive` (boolean)

## 7. Status
`READY_WITH_LIMITATIONS` (Tested using basic read/write integration tests, but lacks comprehensive assertions on all fields).
