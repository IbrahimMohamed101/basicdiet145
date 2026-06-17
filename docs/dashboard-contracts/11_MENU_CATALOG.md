# Screen Contract: 11_MENU_CATALOG

## 1. Screen Purpose
Provides administration for the restaurant's menu catalog, including categorizing products (meals, premium meals, salads, side dishes), managing customization option libraries, previewing drafts, and publishing menu releases.

## 2. Dashboard Route
`/menu?tab=catalog`

## 3. Visible UI Requirements
* Sidebar/Tabs to toggle between Categories, Products, Customization Library (Option Groups and Options), and Menu Version History.
* Categories tab: drag-and-drop sorting list, visibility toggle, create/edit forms.
* Products tab: table of products with columns: Image, Name, Category, Price, Customization Enabled, Status. Modals to configure product options.
* Customization Library: library of options (e.g. Extra Chicken, No Onions) grouped under Option Groups (e.g. Proteins, Preferences).
* Publish bar: button to trigger "Publish Menu Draft" and view diffs.

## 4. Backend Endpoints
* `GET /api/dashboard/menu/preview` (fetches active draft preview)
* `GET /api/dashboard/menu/categories` (lists catalog categories)
* `POST /api/dashboard/menu/categories` (creates category)
* `GET /api/dashboard/menu/products` (lists products)
* `POST /api/dashboard/menu/products` (creates product)
* `POST /api/dashboard/menu/publish` (publishes the current draft to live customers)
* `GET /api/dashboard/menu/diff` (shows diff between draft and published version)

## 5. Request Parameters
* List Query:
  * Category or product name filters, visibility toggle filters.
* Create Product Body:
  * `name` (required, object): `{ ar: string, en: string }`
  * `price` (required, number, in major units)
  * `categoryId` (required, string, ObjectId)
  * `sku` (optional, string)

## 6. Response Fields Required
* `status` (boolean): success status.
* `data` (varies by endpoint):
  * Product list returns arrays of product objects with `id`, `name`, `price`, `sku`, `category` info, and option groups.
  * Preview returns draft hierarchy.

## 7. Field Dictionary
* `sku`: Stock keeping unit code.
* `price`: Base price for the item (inclusive of 16% VAT).

## 8. Classification
`CRUD`

## 9. Frontend Restrictions
* **No Local Sorting**: Category and product reordering must post reorder arrays to `/categories/reorder` or `/products/reorder` to update sorting priorities.

## 10. Backend Acceptance Criteria
* Validate ObjectId relationships (e.g. categoryId must belong to an existing category).
* Publish creates a historical copy of the menu, making it immutable to ensure customer orders reference correct pricing.

## 11. Contract Tests Required
* List endpoint returns categories and products.
* Verify product creation validates parameters correctly.

## 12. Known Risks
* Modification of active products can alter customer selections if not guarded. Live menus are cached on the client app, and draft edits are isolated from active clients until "Publish" is clicked.

## 13. Status
`READY`
