# Screen Contract: 11A_MENU_CATEGORIES

## 1. Screen Purpose
Allows administrators to view, create, edit, reorder, and delete categories in the menu catalog. Allows bulk assigning products to a category, and managing category visibility and availability.

## 2. Dashboard Route
`/menu` (Categories tab)

## 3. Visible UI Requirements
* Paginated list of categories displaying names, keys, visibility, and availability status.
* Create and Edit Category forms/dialogs.
* Reorder handler (drag and drop).
* Visibility & Availability toggles.
* Product assignment grid.

## 4. Backend Endpoints
* `GET /api/dashboard/menu/categories` (lists categories)
* `POST /api/dashboard/menu/categories` (creates a category)
* `GET /api/dashboard/menu/categories/:id` (gets category details)
* `PATCH /api/dashboard/menu/categories/:id` (updates category fields)
* `PATCH /api/dashboard/menu/categories/reorder` (reorders category sortOrder)
* `PATCH /api/dashboard/menu/categories/:id/visibility` (toggles isVisible)
* `PATCH /api/dashboard/menu/categories/:id/availability` (toggles isAvailable)
* `POST /api/dashboard/menu/categories/:id/products` (bulk assigns products to a category)
* `DELETE /api/dashboard/menu/categories/:id` (soft-deletes category)

## 5. Request Parameters
* **Create Category (`POST /api/dashboard/menu/categories`):**
  * `name` (required, object): `{ ar: string, en: string }`
  * `description` (optional, object): `{ ar: string, en: string }`
  * `key` (optional, string): Unique identifier. If empty, automatically generated.
  * `imageUrl` (optional, string)
  * `isVisible` (optional, boolean)
  * `isAvailable` (optional, boolean)
* **Update Category (`PATCH /api/dashboard/menu/categories/:id`):** Same parameters as create.
* **Reorder Categories (`PATCH /api/dashboard/menu/categories/reorder`):**
  * `items` (required, array of strings/ObjectIds): Ordered list of Category IDs.
* **Bulk Assign Products (`POST /api/dashboard/menu/categories/:id/products`):**
  * `productIds` (required, array of strings/ObjectIds)

## 6. Response Fields Required
* `status` (boolean): `true` if request succeeded.
* `data` (category object or array):
  * `_id` (string, ObjectId)
  * `key` (string)
  * `name` (object): `{ ar, en }`
  * `description` (object): `{ ar, en }`
  * `imageUrl` (string)
  * `isVisible` (boolean)
  * `isAvailable` (boolean)
  * `sortOrder` (number)
  * `isActive` (boolean)

## 7. Status
`READY_WITH_LIMITATIONS` (Tested using basic read/write integration tests, but lacks comprehensive assertions on all fields).
