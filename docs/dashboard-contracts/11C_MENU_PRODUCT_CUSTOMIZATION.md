# Screen Contract: 11C_MENU_PRODUCT_CUSTOMIZATION

## 1. Screen Purpose
Provides options and option group mapping controls at the specific product level. Admins can attach option groups to a product, define selection rules (minimum/maximum selections), replace group option lists, and override option prices for that specific product.

## 2. Dashboard Route
`/menu/products/:productId/customization`

## 3. Visible UI Requirements
* Product Customization Composer (collapsible option groups with options list).
* Add Option Group selector (drawn from the Customization Library).
* Group rules editor (min/max selection, required status).
* Option list replacement panel.
* Product-level price override modal.

## 4. Backend Endpoints
* `GET /api/dashboard/menu/products/:productId/composer?contractVersion=v4` (fetches hydrated composer data)
* `PATCH /api/dashboard/menu/products/:productId/customization` (enables/disables customization on the product)
* `GET /api/dashboard/menu/products/:productId/option-groups` (lists product option groups)
* `POST /api/dashboard/menu/products/:productId/option-groups` (associates an option group to a product)
* `PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId` (updates group rules)
* `PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/selection-rules` (updates group min/max rules)
* `PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/visibility` (toggles group visibility on the product)
* `PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/availability` (toggles group availability on the product)
* `DELETE /api/dashboard/menu/products/:productId/option-groups/:groupId` (detaches group from the product)
* `GET /api/dashboard/menu/products/:productId/option-groups/:groupId/option-pool` (returns list of options available to link)
* `GET /api/dashboard/menu/products/:productId/option-groups/:groupId/options` (lists assigned group options)
* `POST /api/dashboard/menu/products/:productId/option-groups/:groupId/options` (assigns single option to group)
* `PUT /api/dashboard/menu/products/:productId/option-groups/:groupId/options` (replaces group options list in bulk)
* `PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId` (updates option overrides like price)
* `PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId/visibility` (toggles option visibility on this product)
* `PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId/availability` (toggles option availability on this product)
* `DELETE /api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId` (detaches option from group on this product)
* `GET /api/dashboard/menu/customization-library` (lists all global option groups and options)

## 5. Request Parameters
* **Associate Group (`POST /api/dashboard/menu/products/:productId/option-groups`):**
  * `groupId` (required, string, ObjectId)
  * `minSelections` (required, integer)
  * `maxSelections` (optional, integer)
  * `isRequired` (optional, boolean)
* **Replace Group Options (`PUT /api/dashboard/menu/products/:productId/option-groups/:groupId/options`):**
  * `options` (required, array of objects): Each object contains `optionId`, `extraPriceHalala`, `extraWeightUnitGrams`, `extraWeightPriceHalala`.
* **Update Option Overrides (`PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId`):**
  * `extraPriceHalala` (optional, integer)
  * `extraWeightUnitGrams` (optional, integer)
  * `extraWeightPriceHalala` (optional, integer)

## 6. Response Fields Required
* `status` (boolean): `true` if succeeded.
* `data` (composer object returned by `GET /products/:productId/composer?contractVersion=v4`):
  * `productId` (string)
  * `isCustomizable` (boolean)
  * `optionGroups` (array of option group objects):
    * `groupId` (string)
    * `key` (string)
    * `name` (object): `{ ar, en }`
    * `minSelections` (number)
    * `maxSelections` (number)
    * `isRequired` (boolean)
    * `options` (array of option objects):
      * `optionId` (string)
      * `key` (string)
      * `name` (object): `{ ar, en }`
      * `extraPriceHalala` (number)
      * `extraWeightUnitGrams` (number)
      * `extraWeightPriceHalala` (number)

## 7. Status
`READY_WITH_LIMITATIONS` (Tested using basic read/write integration tests, but lacks comprehensive assertions on all fields).
