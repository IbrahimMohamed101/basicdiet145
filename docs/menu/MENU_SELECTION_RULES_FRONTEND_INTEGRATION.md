# Menu Selection Rules Frontend Integration Guide

This backend-owned guide defines how Dashboard, Flutter one-time orders, and Flutter subscriptions/meal planner must use menu products, option groups, option rules, product-specific option overrides, and published menu changes.

Source verified from backend code in `src/models/*`, `src/routes/*`, `src/controllers/*`, `src/services/orders/*`, `src/services/catalog/*`, `src/services/subscription/*`, and `src/config/mealPlannerContract.js`.

## 1. Dashboard Source of Truth

Dashboard is the source of truth for the shared menu catalog.

Dashboard creates and edits:

| Entity | Backend model | Purpose |
| :--- | :--- | :--- |
| Categories | `MenuCategory` | Customer-facing product sections. |
| Products | `MenuProduct` | Sellable menu products. |
| Option groups | `MenuOptionGroup` | Reusable groups such as proteins, vegetables, sauces, carbs. |
| Options | `MenuOption` | Reusable selectable choices inside a group. |
| Product group links | `ProductOptionGroup` | Links one product to one option group and stores that product's selection rules. |
| Product option links | `ProductGroupOption` | Links one product/group to allowed options and stores product-specific price/weight overrides. |

Dashboard controls the verified fields below:

| Capability | Verified location |
| :--- | :--- |
| `minSelections`, `maxSelections`, `isRequired` | `ProductOptionGroup`, not `MenuOptionGroup`. |
| Product-specific option price | `ProductGroupOption.extraPriceHalala`; falls back to `MenuOption.extraPriceHalala`. |
| Product-specific option extra weight | `ProductGroupOption.extraWeightUnitGrams`, `extraWeightPriceHalala`; falls back to `MenuOption` fields. |
| Product/channel visibility | `availableFor`, `isActive`, `isVisible`, `isAvailable`, `publishedAt`. |
| Subscription option metadata | `MenuOption.availableForSubscription`, `extraFeeHalala`, `premiumKey`, `proteinFamilyKey`, `displayCategoryKey`, `ruleTags`, `selectionType`. |
| Sorting | `sortOrder` on catalog entities and relations. |

Dashboard must publish menu changes before customer apps rely on them. Verified: `POST /api/dashboard/menu/publish` sets `publishedAt` on active categories, products, option groups, and options, archives prior `MenuVersion` rows, creates a new published `MenuVersion`, and stores a snapshot.

## 2. Backend Endpoints

Verified routes are mounted under `/api`.

### Dashboard Menu Endpoints

All `/api/dashboard/menu/*` endpoints require dashboard auth and `admin` or `superadmin` role.

| Method | Path | Purpose | Relevant fields |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/dashboard/menu/categories` | List categories. | filters: `includeInactive`, `isActive`, `isVisible`, `isAvailable`, `q`, `published`, `page`, `limit` |
| `POST` | `/api/dashboard/menu/categories` | Create category. | `key`, `name`, `description`, `imageUrl`, `isActive`, `isVisible`, `isAvailable`, `sortOrder`, `branchIds` |
| `PATCH` | `/api/dashboard/menu/categories/:id` | Update category. | Same category fields. |
| `PATCH` | `/api/dashboard/menu/categories/:id/visibility` | Toggle category visibility. | `isVisible` |
| `PATCH` | `/api/dashboard/menu/categories/:id/availability` | Toggle category availability. | `isAvailable` |
| `PATCH` | `/api/dashboard/menu/categories/reorder` | Reorder categories. | `items[].id`, `items[].sortOrder` |
| `GET` | `/api/dashboard/menu/products` | List products. | same list filters |
| `POST` | `/api/dashboard/menu/products` | Create product. | `categoryId`, `key`, `name`, `itemType`, `pricingModel`, `priceHalala`, weight fields, `availableFor`, visibility flags |
| `PATCH` | `/api/dashboard/menu/products/:id` | Update product. | Same product fields. |
| `PATCH` | `/api/dashboard/menu/products/:id/visibility` | Toggle product visibility. | `isVisible` |
| `PATCH` | `/api/dashboard/menu/products/:productId/availability` | Toggle availability or branch availability. | `isAvailable` or `branchAvailability`/`branchIds` |
| `POST` | `/api/dashboard/menu/products/:id/duplicate` | Duplicate product and relations. | New product is inactive. |
| `GET` | `/api/dashboard/menu/option-groups` | List option groups. | same list filters |
| `POST` | `/api/dashboard/menu/option-groups` | Create option group. | `key`, `name`, `description`, flags, `sortOrder` |
| `PATCH` | `/api/dashboard/menu/option-groups/:id` | Update option group. | Same group fields. |
| `GET` | `/api/dashboard/menu/options` | List options. | `groupId` plus list filters |
| `POST` | `/api/dashboard/menu/options` | Create option. | `groupId`, `key`, `name`, prices, subscription metadata, flags |
| `PATCH` | `/api/dashboard/menu/options/:id` | Update option. | Same option fields. |
| `GET` | `/api/dashboard/menu/products/:productId/option-groups` | List product group relations. | returns `ProductOptionGroup` rows |
| `POST` | `/api/dashboard/menu/products/:productId/option-groups` | Link group to product. | `groupId`, `minSelections`, `maxSelections`, `isRequired`, flags |
| `PATCH` | `/api/dashboard/menu/products/:productId/option-groups/:groupId/selection-rules` | Update selection rules. | `minSelections`, `maxSelections`, `isRequired` |
| `GET` | `/api/dashboard/menu/products/:productId/option-groups/:groupId/options` | List allowed option relations. | returns `ProductGroupOption` rows |
| `POST` | `/api/dashboard/menu/products/:productId/option-groups/:groupId/options` | Allow option for product/group. | `optionId`, product-specific price/weight fields, flags |
| `PATCH` | `/api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId` | Update product-specific option relation. | `extraPriceHalala`, `extraWeightPriceHalala`, `extraWeightUnitGrams`, `sortOrder`, flags |
| `PUT` | `/api/dashboard/menu/products/:productId/groups` | Replace all product group links. | `groups[]` |
| `PUT` | `/api/dashboard/menu/products/:productId/groups/:groupId/options` | Replace allowed options for one group. | `options[]` |
| `POST` | `/api/dashboard/menu/publish` | Publish menu to customer apps. | optional `notes` |
| `POST` | `/api/dashboard/menu/validate` | Validate catalog integrity. | returns `ok`, `errors`, `warnings`, `summary` |
| `GET` | `/api/dashboard/menu/versions` | List menu versions. | `MenuVersion` rows |
| `POST` | `/api/dashboard/menu/rollback/:versionId` | Roll back to a version. | body must include `confirm: true` |

### Customer / Mobile Endpoints

| Method | Path | Auth | Used by | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/orders/menu` | No | Flutter one-time orders | Fetch published one-time menu catalog and restaurant hours. |
| `POST` | `/api/orders/quote` | Yes | Flutter one-time orders | Price and validate one-time order selections. |
| `POST` | `/api/orders` | Yes | Flutter one-time orders | Create order and initialize payment. |
| `POST` | `/api/orders/:orderId/payments/:paymentId/verify` | Yes | Flutter one-time orders | Verify provider payment. |
| `GET` | `/api/orders/:id` | Yes | Flutter one-time orders | Fetch order details. |
| `GET` | `/api/subscriptions/menu` | No | Flutter subscriptions | Fetch subscription plans, legacy meal catalog, builder catalog-derived premium rows, addons, delivery options. |
| `GET` | `/api/subscriptions/meal-planner-menu` | No | Meal planner | Fetch canonical planner `builderCatalog` and `addonCatalog`. |
| `POST` | `/api/subscriptions/quote` | Yes | Flutter subscriptions | Price and validate subscription checkout selections. |
| `POST` | `/api/subscriptions/checkout` | Yes | Flutter subscriptions | Create checkout draft and initialize payment. Requires idempotency key. |
| `GET` | `/api/subscriptions/:id/days/:date` | Yes | Meal planner | Fetch day details with planner view. |
| `PUT` | `/api/subscriptions/:id/days/:date/selection` | Yes | Meal planner | Save canonical `mealSlots`. |
| `POST` | `/api/subscriptions/:id/days/:date/selection/validate` | Yes | Meal planner | Validate canonical `mealSlots` without saving. |
| `POST` | `/api/subscriptions/:id/days/:date/confirm` | Yes | Meal planner | Confirm day planning. |
| `PUT` | `/api/subscriptions/:id/days/selections/bulk` | Yes | Meal planner | Bulk save canonical day selections. |
| `POST` | `/api/subscriptions/:id/days/:date/payments` | Yes | Meal planner | Create unified day payment for pending premium/addon state. |
| `POST` | `/api/subscriptions/:id/days/:date/payments/:paymentId/verify` | Yes | Meal planner | Verify unified day payment. |

## 3. Data Model Overview

### MenuProduct

| Field | Meaning |
| :--- | :--- |
| `id` / `_id` | Mongo ObjectId. Customer menu serializes as `id`. |
| `key` | Unique snake_case product key. |
| `name`, `description` | Localized `{ ar, en }`. |
| `itemType` | One of verified enum values such as `basic_salad`, `basic_meal`, `cold_sandwich`, `sourdough`, `product`. |
| `pricingModel` | `fixed` or `per_100g`. |
| `priceHalala` | Base product price in Halala. |
| `baseUnitGrams`, `defaultWeightGrams`, `minWeightGrams`, `maxWeightGrams`, `weightStepGrams` | Weight rules for `per_100g` products. |
| `availableFor` | `one_time`, `subscription`, or both. |
| `isActive`, `isVisible`, `isAvailable` | Availability gates. |
| `branchAvailability` | Optional branch allow-list. |
| `publishedAt`, `versionId` | Publish/version state. |

### MenuOptionGroup

| Field | Meaning |
| :--- | :--- |
| `id` / `_id` | Mongo ObjectId. |
| `key` | Unique snake_case group key. |
| `name`, `description` | Localized `{ ar, en }`. |
| `minSelections`, `maxSelections`, `required`, `selectionType` | Not verified on `MenuOptionGroup`; selection limits live on `ProductOptionGroup`. |
| `isActive`, `isVisible`, `isAvailable` | Group availability gates. |
| `sortOrder` | Default sorting. |
| `publishedAt` | Required for customer-facing catalog. |

### MenuOption

| Field | Meaning |
| :--- | :--- |
| `id` / `_id` | Mongo ObjectId. |
| `groupId` | Parent `MenuOptionGroup` ObjectId. |
| `key` | Unique within group. |
| `name`, `description` | Localized `{ ar, en }`. |
| `extraPriceHalala` | One-time/default extra price. |
| `extraFeeHalala` | Subscription extra fee; getter falls back to `extraPriceHalala` when zero/missing. |
| `extraWeightUnitGrams`, `extraWeightPriceHalala` | Optional weighted extra pricing. |
| `availableFor` | Channel gate: `one_time`, `subscription`, or both. |
| `availableForSubscription` | Additional subscription option gate. |
| `premiumKey`, `proteinFamilyKey`, `displayCategoryKey`, `ruleTags`, `selectionType` | Subscription/meal planner metadata. |
| `isActive`, `isVisible`, `isAvailable` | Availability gates. |
| `sortOrder`, `publishedAt` | Sorting and publish state. |

### ProductOptionGroup

| Field | Meaning |
| :--- | :--- |
| `productId` | Linked `MenuProduct`. |
| `groupId` | Linked `MenuOptionGroup`. |
| `minSelections` | Minimum selected quantity count for this product/group. |
| `maxSelections` | Maximum selected quantity count for this product/group; `null` means no maximum. |
| `isRequired` | Required flag. Backend also enforces `minSelections`. |
| `isActive`, `isVisible`, `isAvailable` | Relation availability gates. |
| `sortOrder` | Product-specific group order. |

### ProductGroupOption

| Field | Meaning |
| :--- | :--- |
| `productId` | Linked `MenuProduct`. |
| `groupId` | Linked `MenuOptionGroup`. |
| `optionId` | Linked `MenuOption`. |
| `extraPriceHalala` | Product-specific override; `null` falls back to `MenuOption.extraPriceHalala`. |
| `extraWeightUnitGrams`, `extraWeightPriceHalala` | Product-specific weighted extra overrides; `null` falls back to `MenuOption`. |
| `isActive`, `isVisible`, `isAvailable` | Relation availability gates. |
| `sortOrder` | Product-specific option order. |

## 4. Selection Rules

Verified one-time rule representation:

```json
{
  "id": "groupObjectId",
  "groupId": "groupObjectId",
  "key": "vegetables_legumes",
  "name": "Vegetables",
  "minSelections": 0,
  "maxSelections": 4,
  "isRequired": false,
  "sortOrder": 20,
  "options": [
    {
      "id": "optionObjectId",
      "optionId": "optionObjectId",
      "groupId": "groupObjectId",
      "key": "cucumber",
      "name": "Cucumber",
      "extraPriceHalala": 0,
      "extraWeightUnitGrams": 0,
      "extraWeightPriceHalala": 0,
      "sortOrder": 1
    }
  ]
}
```

`minSelections` and `maxSelections` are copied from `ProductOptionGroup`. `options[]` is filtered through `ProductGroupOption`, `MenuOption`, publish state, availability flags, and `availableFor`.

### Example: Choose Exactly 1 Protein

Conceptual example using verified one-time response field names:

```json
{
  "key": "proteins",
  "minSelections": 1,
  "maxSelections": 1,
  "isRequired": true,
  "options": [{ "id": "proteinOptionId", "optionId": "proteinOptionId" }]
}
```

Flutter should show the group as required, allow exactly one option, and block local progress until one protein is selected. Backend rejects missing selections with `MIN_SELECTIONS_NOT_MET`, too many selections with `MAX_SELECTIONS_EXCEEDED`, invalid group/option combinations with `OPTION_NOT_ALLOWED`, and unavailable choices with `OPTION_NOT_AVAILABLE` or `OPTION_GROUP_NOT_AVAILABLE`.

### Example: Choose Up To 4 Vegetables

Conceptual example using verified one-time response field names:

```json
{
  "key": "vegetables_legumes",
  "minSelections": 0,
  "maxSelections": 4,
  "isRequired": false,
  "options": [{ "id": "vegetableOptionId", "optionId": "vegetableOptionId" }]
}
```

Flutter must not hardcode `4`. It must read `maxSelections` from the selected product's `optionGroups[]` row.

### Example: Choose 1 To 2 Sauces

Conceptual example using verified one-time response field names:

```json
{
  "key": "sauces",
  "minSelections": 1,
  "maxSelections": 2,
  "isRequired": true,
  "options": [{ "id": "sauceOptionId", "optionId": "sauceOptionId" }]
}
```

Flutter should show a required group, selected count, and disable additional selections once `maxSelections` is reached.

Subscription meal planner rules are represented differently. Verified: `GET /api/subscriptions/meal-planner-menu` returns `data.builderCatalog.rules`, including:

| Rule area | Verified shape |
| :--- | :--- |
| Beef daily limit | `rules.beef.proteinFamilyKey`, `rules.beef.maxSlotsPerDay` |
| Standard carbs | `rules.standardCarbs.maxTypes`, `maxTotalGrams`, `unit` |
| Premium carbs | `rules.premiumCarbs.maxTypes`, `maxTotalGrams`, `unit` |
| Premium large salad | `rules.premiumLargeSalad.groups[].key`, `minSelect`, `maxSelect` |

## 5. Flutter One-Time Order Integration

Flutter must call `GET /api/orders/menu` and render products, option groups, options, prices, and selection rules from the backend response.

Verified customer response path:

```text
data.categories[].products[].optionGroups[].options[]
```

Flutter rules:

| Requirement | Backend contract |
| :--- | :--- |
| Product identity | Send `productId` from `products[].id`. |
| Group identity | Send `groupId` from `optionGroups[].id` or `optionGroups[].groupId`. |
| Option identity | Send `optionId` from `options[].id` or `options[].optionId`. |
| Selection limits | Read `minSelections` and `maxSelections` per product group. |
| Product-specific prices | Display `options[].extraPriceHalala` and weighted extra fields from the response. |
| Weight | Send `weightGrams` for `pricingModel: "per_100g"`. |

Verified selected options request shape:

```json
{
  "items": [
    {
      "productId": "menuProductObjectId",
      "qty": 1,
      "weightGrams": 350,
      "selectedOptions": [
        {
          "groupId": "groupObjectId",
          "optionId": "optionObjectId",
          "qty": 1,
          "extraWeightGrams": 0
        }
      ]
    }
  ]
}
```

`qty` inside `selectedOptions[]` defaults to `1` when omitted. `extraWeightGrams` defaults to `0`; send it only when the returned option supports weighted extra pricing.

Flutter may enforce rules locally for UX, but `POST /api/orders/quote` and `POST /api/orders` are the final authority.

## 6. Flutter Subscription / Meal Planner Integration

Flutter subscriptions must call:

| Endpoint | Use |
| :--- | :--- |
| `GET /api/subscriptions/menu` | Subscription purchase flow: plans, delivery, addons, and derived meal catalog. |
| `GET /api/subscriptions/meal-planner-menu` | Canonical meal planner source: `builderCatalog` and `addonCatalog`. |

Verified `builderCatalog` fields:

| Field | Meaning |
| :--- | :--- |
| `categories[]` | Planner categories with `rules`. |
| `proteins[]` | Standard protein options from published `MenuOption` group `proteins`. |
| `premiumProteins[]` | Premium protein options where extra fee is greater than zero. |
| `carbs[]` | Carb options from published `MenuOption` group `carbs`, excluding large salad display category. |
| `sandwiches[]` | Published subscription products with `itemType` `cold_sandwich` or `sourdough`. |
| `premiumLargeSalad` | Premium salad builder metadata, groups, ingredients, fee, price source. |
| `rules` | Canonical planner rules. |

Flutter must not hardcode:

- 4 vegetables.
- 1 protein.
- Sauce limits.
- Beef daily limits.
- Carb split limits.
- Premium prices.

Use backend values:

| Metadata | Verified usage |
| :--- | :--- |
| `selectionType` | Determines slot type: `standard_meal`, `premium_meal`, `premium_large_salad`, `sandwich`. |
| `premiumKey` | Premium wallet/payment identity. `premium_large_salad` is canonical for premium large salad. |
| `proteinFamilyKey` | Used by backend for rules such as beef daily limit. |
| `displayCategoryKey` | Used for grouping proteins/carbs in UI. |
| `extraFeeHalala` | Subscription premium fee. Do not replace it with one-time price fields. |

Verified premium large salad behavior:

- Canonical selection type is `premium_large_salad`.
- Price comes from published `MenuProduct` key `premium_large_salad`; fallback is published `basic_salad`; final legacy fallback is `2900` Halala.
- Salad group rules come from `SALAD_SELECTION_GROUPS` and are exposed in `builderCatalog.premiumLargeSalad.groups` and `builderCatalog.rules.premiumLargeSalad.groups`.
- Current verified backend constants require exactly one `protein` and exactly one `sauce`; other salad groups currently have `maxSelect: 99`.

Legacy note: `/api/builder/premium-meals` still exposes a backward-compatible `custom_premium_salad` entry. The canonical meal planner uses `premium_large_salad`.

## 7. Backend Validation and Error Handling

Backend validation remains final authority.

One-time selected option validation verifies:

| Case | Verified error code |
| :--- | :--- |
| Missing required group selections | `MIN_SELECTIONS_NOT_MET` |
| Too many selections in group | `MAX_SELECTIONS_EXCEEDED` |
| Unknown product | `ITEM_NOT_FOUND` |
| Product/category inactive, hidden, unavailable, unpublished, wrong channel | `PRODUCT_NOT_AVAILABLE` |
| Invalid selected option ID format | `INVALID_SELECTION` |
| Group not linked to product | `OPTION_NOT_ALLOWED` |
| Option not linked to product/group | `OPTION_NOT_ALLOWED` |
| Option belongs to wrong group | `OPTION_NOT_ALLOWED` |
| Group relation exists but is unavailable | `OPTION_GROUP_NOT_AVAILABLE` |
| Option/relation inactive, hidden, unavailable, unpublished, wrong channel | `OPTION_NOT_AVAILABLE` |
| Invalid product weight or option extra weight | `INVALID_WEIGHT` |
| Empty one-time order | `EMPTY_ORDER` |
| Restaurant closed | `RESTAURANT_CLOSED` |
| Invalid pickup/delivery window | `INVALID_DELIVERY_WINDOW` |

Subscription checkout validation verified codes include `VALIDATION_ERROR`, `INVALID`, `NOT_FOUND`, `INVALID_PREMIUM_ITEM`, `INVALID_DELIVERY_SLOT`, `DELIVERY_WINDOW_MISSING`, and `IDEMPOTENCY_CONFLICT`.

Meal planner slot validation verified codes include `PROTEIN_REQUIRED`, `INVALID_PROTEIN_TYPE`, `CARBS_REQUIRED`, `TOO_MANY_CARBS`, `INVALID_CARB_ID`, `DUPLICATE_CARB`, `INVALID_GRAMS`, `CARB_LIMIT_EXCEEDED`, `SALAD_PROTEIN_REQUIRED`, `SALAD_SAUCE_REQUIRED`, `SALAD_GROUP_MIN_SELECT`, `SALAD_GROUP_MAX_SELECT_EXCEEDED`, `DUPLICATE_SALAD_INGREDIENT`, `INVALID_SALAD_INGREDIENT`, `SALAD_INGREDIENT_GROUP_MISMATCH`, `SALAD_PROTEIN_MISMATCH`, `BEEF_LIMIT_EXCEEDED`, `MEAL_SLOT_COUNT_EXCEEDED`, and `LOCKED`.

`menu version mismatch` error code: Not verified.

Standard error shape from `errorResponse`:

```json
{
  "ok": false,
  "error": {
    "code": "MAX_SELECTIONS_EXCEEDED",
    "message": "Option group selections exceed maxSelections",
    "details": {}
  }
}
```

Some controllers return success as `{ "status": true, "data": ... }`.

## 8. How Dashboard Changes Reach Flutter

Verified publish flow:

1. Admin updates product, group, option, product-group relation, or product-option relation in Dashboard.
2. Admin calls `POST /api/dashboard/menu/publish`.
3. Backend sets `publishedAt` on active publishable catalog rows.
4. Backend creates a published `MenuVersion` with a public snapshot and dashboard catalog snapshot.
5. Flutter refetches menu/catalog.
6. Flutter invalidates cached product/group/option selections if returned rules or allowed options changed.
7. Flutter re-quotes before checkout.
8. Backend rejects stale cart or stale meal planner payloads when product/rule/option availability changed.

Flutter should refresh menus:

- App startup.
- App resume.
- Pull to refresh.
- Before quote/checkout.
- After any quote/validation error involving product, option, planner, or availability.
- After a dashboard publish notification if the app has one.

Cache TTL recommendation: Not verified in backend source. Use a short client TTL only if product requirements define one.

Menu version/hash in customer menu response: Not verified as a top-level field. One-time priced items include `menuVersionId` after quote.

## 9. Frontend UX Rules

Frontend should:

- Show required groups using `isRequired` and/or `minSelections > 0`.
- Show min/max selection counts from backend.
- Disable additional selections after `maxSelections` is reached.
- Show selected count per group.
- Validate before quote for UX, then still call backend quote.
- Render backend validation errors as business errors, not crashes.
- Clear invalid selections when product changes.
- Display product-specific option prices from customer menu `options[].extraPriceHalala`.
- Display subscription extra fees from `extraFeeHalala`.
- Hide unavailable options when absent from customer catalog; if Dashboard responses are used internally, disable or hide rows based on `isActive`, `isVisible`, `isAvailable`.

## 10. End-to-End Examples

### 1. One-Time Salad With Vegetables Group Max 4

Conceptual example using verified fields:

1. Dashboard links `vegetables_legumes` to `basic_salad` with `maxSelections: 4`.
2. Dashboard links allowed vegetable options through `ProductGroupOption`.
3. Dashboard publishes.
4. Flutter reads `products[].optionGroups[]` from `GET /api/orders/menu`.
5. Flutter enforces `maxSelections: 4`.
6. Backend quote rejects five selected vegetables with `MAX_SELECTIONS_EXCEEDED`.

### 2. Premium Salad With Exactly One Protein

Verified meal planner behavior:

1. Flutter reads `builderCatalog.premiumLargeSalad.groups`.
2. The `protein` group has `minSelect: 1`, `maxSelect: 1`.
3. Flutter sends one protein id in `mealSlots[].salad.groups.protein`.
4. Backend rejects missing or multiple protein selections with `SALAD_PROTEIN_REQUIRED`.

### 3. Product-Specific Option Price Override

Verified one-time behavior:

1. Dashboard sets `ProductGroupOption.extraPriceHalala` for one product/group/option.
2. Customer menu serializes the effective `options[].extraPriceHalala`.
3. Flutter displays that value.
4. Quote uses the relation override; if override is `null`, quote falls back to `MenuOption.extraPriceHalala`.

### 4. Subscription Meal Planner Premium Selection

Verified behavior:

1. Flutter reads `builderCatalog.premiumProteins[]`.
2. Flutter uses `selectionType: "premium_meal"`, `premiumKey`, and `extraFeeHalala`.
3. Backend validates the selected protein is premium.
4. Backend consumes premium balance when available; otherwise marks the slot as `pending_payment` with `premiumExtraFeeHalala`.

### 5. Dashboard Change Published And Flutter Refreshes

Verified flow:

1. Admin changes a group max from `4` to `3`.
2. Admin publishes menu.
3. Flutter refetches menu before quote.
4. Existing carts with four choices are revalidated.
5. Backend rejects stale payloads exceeding the new max with `MAX_SELECTIONS_EXCEEDED`.

## 11. QA Checklist

Dashboard:

- [ ] Create an option group.
- [ ] Link group to product with `maxSelections: 4`.
- [ ] Link options to group/product.
- [ ] Publish menu.
- [ ] Verify `GET /api/orders/menu` contains the product group and allowed options.

Flutter one-time:

- [ ] Product loads groups/options from backend.
- [ ] UI cannot select more than returned `maxSelections`.
- [ ] Valid quote succeeds.
- [ ] Backend rejects invalid quote.
- [ ] Stale cart after dashboard change is handled.

Flutter subscription:

- [ ] Meal planner loads `builderCatalog`.
- [ ] Premium large salad group rules work.
- [ ] `extraFeeHalala` displays correctly.
- [ ] Backend rejects invalid premium selection.

Change propagation:

- [ ] Dashboard publish causes Flutter refresh.
- [ ] Stale cached menu invalidates.
- [ ] Quote after changed rules behaves correctly.

## 12. Common Mistakes to Avoid

- Hardcoding selection limits in Flutter.
- Sending option name instead of `optionId`.
- Sending group key instead of `groupId` for one-time selected options.
- Ignoring product-specific option overrides.
- Ignoring `availableFor`.
- Ignoring `isActive`, `isVisible`, `isAvailable`.
- Not re-quoting before checkout.
- Keeping stale cart after Dashboard publish.
- Treating backend validation as a crash.
- Using one-time `extraPriceHalala` where subscription flow should display `extraFeeHalala`.
- Assuming `MenuOptionGroup` contains min/max rules; verified rules are product-specific on `ProductOptionGroup`.
