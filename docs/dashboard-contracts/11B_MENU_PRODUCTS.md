# Screen Contract: 11B_MENU_PRODUCTS

## 1. Screen Purpose
Provides CRUD operations, duplication, bulk updates, reordering, and visibility/availability controls for products inside the menu catalog.

## 2. Dashboard Route
`/menu` (Products tab)

## 3. Visible UI Requirements
* List of products (filterable by Category).
* Create/Edit Product dialogs.
* Duplicate Product button.
* Reorder handler.
* Bulk update actions.

## 4. Backend Endpoints
* `GET /api/dashboard/menu/products` (lists products, optional `categoryId` filter in query)
* `POST /api/dashboard/menu/products` (creates a product)
* `GET /api/dashboard/menu/products/:id` (gets product details)
* `PATCH /api/dashboard/menu/products/:id` (updates product)
* `PATCH /api/dashboard/menu/products/bulk` (bulk updates products)
* `PATCH /api/dashboard/menu/products/reorder` (reorders products sortOrder)
* `POST /api/dashboard/menu/products/:id/duplicate` (duplicates product)
* `PATCH /api/dashboard/menu/products/:id/visibility` (toggles isVisible)
* `PATCH /api/dashboard/menu/products/:productId/availability` (toggles isAvailable)
* `DELETE /api/dashboard/menu/products/:id` (soft-deletes product)

## 5. Request Parameters
* **Create Product (`POST /api/dashboard/menu/products`):**
  * `categoryId` (required, string, ObjectId)
  * `name` (required, object): `{ ar: string, en: string }`
  * `description` (optional, object): `{ ar: string, en: string }`
  * `key` (optional, string): If empty, auto-generated.
  * `priceHalala` (required, integer)
  * `pricingModel` (required, string, values: `fixed`, `per_100g`)
  * `baseUnitGrams` (optional, integer)
  * `imageUrl` (optional, string)
  * `isVisible` (optional, boolean)
  * `isAvailable` (optional, boolean)
  * `isCustomizable` (optional, boolean)
* **Update Product (`PATCH /api/dashboard/menu/products/:id`):** Same parameters as create.
* **Duplicate Product (`POST /api/dashboard/menu/products/:id/duplicate`):** No body required.
* **Reorder Products (`PATCH /api/dashboard/menu/products/reorder`):**
  * `items` (required, array of strings/ObjectIds): Ordered list of Product IDs.

## 6. Response Fields Required
* `status` (boolean): `true` if request succeeded.
* `data` (product object or array):
  * `_id` (string, ObjectId)
  * `categoryId` (string, ObjectId)
  * `key` (string)
  * `name` (object): `{ ar, en }`
  * `priceHalala` (integer)
  * `pricingModel` (string)
  * `imageUrl` (string)
  * `isVisible` (boolean)
  * `isAvailable` (boolean)
  * `isCustomizable` (boolean)
  * `sortOrder` (number)

## 7. Status
`READY_WITH_LIMITATIONS` (Tested using basic read/write integration tests, but lacks comprehensive assertions on all fields).
