# Menu Backend/Mobile/Dashboard Contract

## 1. Purpose

This document is the practical contract for the server-driven menu shared by:

- the Node.js / Express / MongoDB backend in `/home/hema/Projects/basicdiet145`
- the React dashboard in `/home/hema/Projects/full app/client_dashbourd-main`
- the Flutter mobile app

The goal is to keep catalog data, rendering metadata, pricing, and dashboard edits aligned. Flutter must render the menu returned by the backend. It must not infer card layout from Arabic or English names and must not hardcode category or product keys for visual behavior.

The production API base URL is:

```text
https://basicdiet145.onrender.com
```

This document describes code. It does not prove the current production database contents.

## 2. High-level architecture

```text
MongoDB catalog models
  MenuCategory -> MenuProduct
  MenuProduct -> ProductOptionGroup -> MenuOptionGroup
  MenuProduct + MenuOptionGroup -> ProductGroupOption -> MenuOption
        |
        v
catalog services and serializers
  src/services/orders/menuCatalogService.js
  src/services/orders/menuPricingService.js
  src/services/catalog/CatalogService.js
        |
        +--> GET /api/orders/menu
        +--> POST /api/orders/quote
        +--> GET /api/subscriptions/meal-planner-menu
        |
        v
Flutter rendering and quote submission

Dashboard CRUD, relation rules, publish, and image upload
  /api/dashboard/menu/*
  /api/dashboard/uploads/image
        |
        v
MongoDB catalog models
```

The routed one-time menu entry point is:

```text
src/routes/orders.js
  -> src/controllers/orderController.js
  -> src/services/orders/orderMenuService.js
  -> src/services/orders/menuCatalogService.js
```

Do not confuse it with `src/controllers/menuController.js#getOrderMenu`, which is a separate legacy `Meal`-based serializer and is not mounted at `GET /api/orders/menu`.

## 3. Source of truth

### Canonical menu collections

| Concern | Canonical model | Source file |
| --- | --- | --- |
| Categories | `MenuCategory` | `src/models/MenuCategory.js` |
| Products | `MenuProduct` | `src/models/MenuProduct.js` |
| Reusable option groups | `MenuOptionGroup` | `src/models/MenuOptionGroup.js` |
| Reusable options | `MenuOption` | `src/models/MenuOption.js` |
| Product-to-group selection rules | `ProductOptionGroup` | `src/models/ProductOptionGroup.js` |
| Allowed options and relation-specific prices | `ProductGroupOption` | `src/models/ProductGroupOption.js` |
| Published snapshots | `MenuVersion` | `src/models/MenuVersion.js` |

`Menu*` models and their relation collections are the primary canonical menu source. Avoid duplicating business data unless a compatibility path requires it.

### Compatibility mirrors

| Model | Purpose | Source file |
| --- | --- | --- |
| `BuilderCategory` | Legacy subscription protein/carb category metadata | `src/models/BuilderCategory.js` |
| `BuilderProtein` | Compatibility mirror for menu protein options | `src/models/BuilderProtein.js` |
| `BuilderCarb` | Compatibility mirror for menu carb options | `src/models/BuilderCarb.js` |
| `SaladIngredient` | Compatibility mirror for salad ingredient options | `src/models/SaladIngredient.js` |
| `Sandwich` | Compatibility mirror for subscription sandwich products | `src/models/Sandwich.js` |

The subscription planner reads canonical `MenuOption`, `MenuOptionGroup`, `MenuProduct`, and relation data through `src/services/catalog/CatalogService.js`. The bootstrap script also maintains compatibility mirrors for older paths.

`Meal`, `MealCategory`, and `Addon` remain in legacy subscription and older one-time compatibility flows. They are not replacements for the canonical `Menu*` catalog.

## 4. Main entities and relationships

### MenuCategory

Defined in `src/models/MenuCategory.js`.

| Field | Meaning |
| --- | --- |
| `key` | Unique technical identity. Lowercase and immutable after create. |
| `name.ar`, `name.en` | Localized display name. |
| `description.ar`, `description.en` | Localized description. |
| `imageUrl` | Customer-facing category image URL. |
| `sortOrder` | Category ordering. |
| `isActive`, `isVisible`, `isAvailable` | Public catalog gates. |
| `availability.branchIds` | Optional branch restriction. Empty means unrestricted. |
| `publishedAt` | Must be non-null for public menu output. |
| `ui.cardVariant` | Category layout hint for Flutter. |

### MenuProduct

Defined in `src/models/MenuProduct.js`.

| Field | Meaning |
| --- | --- |
| `key` | Unique immutable technical identity. |
| `categoryId` | Reference to `MenuCategory`. |
| `name`, `description`, `imageUrl` | Localized content and image. |
| `priceHalala` | Base price in halala. `1900` means 19 SAR. |
| `pricingModel` | `fixed` or `per_100g`. |
| `itemType` | Product behavior label such as `basic_meal`, `dessert`, or `drink`. |
| `availableFor` | Channels: `one_time`, `subscription`, or both. |
| `baseUnitGrams` | Pricing unit for `per_100g`. Defaults to `100`. |
| `defaultWeightGrams`, `minWeightGrams`, `maxWeightGrams`, `weightStepGrams` | Weight metadata and validation controls. |
| `branchAvailability` | Optional list of branch IDs. Empty means unrestricted. |
| `isActive`, `isVisible`, `isAvailable`, `publishedAt` | Public catalog gates. |
| `ui.cardVariant`, `ui.badge`, `ui.ctaLabel`, `ui.imageRatio` | Display metadata. |

The one-time public serializer computes two convenience fields:

| Field | Meaning |
| --- | --- |
| `requiresBuilder` | `true` when the product has option groups or uses `per_100g`. |
| `canAddDirectly` | `true` only for fixed-price products with no option groups. |

### MenuOptionGroup

Defined in `src/models/MenuOptionGroup.js`.

| Field | Meaning |
| --- | --- |
| `key` | Unique immutable technical identity. |
| `name`, `description` | Localized content. |
| `sortOrder` | Default group ordering. A relation may override it. |
| `isActive`, `isVisible`, `isAvailable`, `publishedAt` | Public catalog gates. |
| `ui.displayStyle` | Widget hint for Flutter. |

### MenuOption

Defined in `src/models/MenuOption.js`.

| Field | Meaning |
| --- | --- |
| `groupId` | Parent `MenuOptionGroup`. |
| `key` | Immutable technical identity, unique inside a group. |
| `name`, `description`, `imageUrl` | Localized content and image. |
| `extraPriceHalala` | Global default option surcharge. |
| `extraFeeHalala` | Shared compatibility fee field. Its getter falls back to `extraPriceHalala`. |
| `extraWeightUnitGrams`, `extraWeightPriceHalala` | Optional extra-weight pricing. |
| `availableFor`, `availableForSubscription` | Channel gates. |
| `proteinFamilyKey`, `displayCategoryKey`, `premiumKey`, `ruleTags`, `selectionType` | Advanced planner metadata. |
| `sortOrder`, active/visible/available flags, `publishedAt` | Ordering and public gates. |

### ProductOptionGroup

Defined in `src/models/ProductOptionGroup.js`.

This relation connects a product to a reusable option group.

| Field | Meaning |
| --- | --- |
| `productId`, `groupId` | Relation identity. |
| `minSelections` | Minimum selected quantity in this group. |
| `maxSelections` | Maximum selected quantity. `null` means unlimited. `0` is a real value and must be preserved. |
| `isRequired` | Dashboard-facing required marker. Backend validation still uses `minSelections`. |
| `sortOrder` | Group order inside this product. |
| active/visible/available flags | Relation-level gates. |

### ProductGroupOption

Defined in `src/models/ProductGroupOption.js`.

This relation controls which options appear for a specific product and group.

| Field | Meaning |
| --- | --- |
| `productId`, `groupId`, `optionId` | Relation identity. |
| `extraPriceHalala` | Product-specific surcharge override. `null` falls back to `MenuOption.extraPriceHalala`. |
| `extraWeightUnitGrams`, `extraWeightPriceHalala` | Product-specific extra-weight override. |
| `sortOrder` | Option order inside this product/group. |
| active/visible/available flags | Relation-level gates. |

Use `ProductGroupOption.extraPriceHalala` for relation-specific prices. Do not mutate a global option price when only one product needs a different amount.

## 5. Keys and immutability

Backend CRUD behavior is implemented in `src/services/orders/menuCatalogService.js` and helpers in `src/services/catalog/catalogKeyUiHelpers.js`.

- Create endpoints accept an omitted key and generate one from the display name when possible.
- A generated fallback key is used when the name cannot produce ASCII `snake_case`.
- Update attempts that change a key return HTTP `400` with code `IMMUTABLE_KEY`.
- Dashboard create forms hide the key input.
- Dashboard edit forms show the key disabled/read-only.
- Dashboard update mappers omit `key`.

Dashboard form examples:

```text
/home/hema/Projects/full app/client_dashbourd-main/src/components/pages/menu/categories/MenuCategoryFormFields.tsx
/home/hema/Projects/full app/client_dashbourd-main/src/components/pages/menu/products/MenuProductFormFields.tsx
/home/hema/Projects/full app/client_dashbourd-main/src/utils/menuPayloadMappers.ts
```

Flutter may submit identifiers required by a write API, but it must not use keys to select card shapes or infer localized presentation.

## 6. UI metadata contract

The allowed values are enforced in the Mongoose schemas and normalized by `src/services/catalog/catalogKeyUiHelpers.js`.

### Category `ui.cardVariant`

| Value | Suggested Flutter layout |
| --- | --- |
| `meal_builder` | Builder entry card or builder-oriented collection |
| `light_collection` | Light product collection |
| `sandwich_collection` | Sandwich collection |
| `addon_collection` | Add-on style collection |

Unknown category values normalize to `addon_collection`.

### Product `ui.cardVariant`

| Value | Suggested Flutter layout |
| --- | --- |
| `standard` | Standard product card |
| `premium` | Premium-emphasis card |
| `large_salad` | Large configurable salad card |
| `addon` | Compact add-on card |

Unknown product values normalize to `standard`.

Additional product display fields:

```text
ui.badge
ui.ctaLabel
ui.imageRatio
```

### Option group `ui.displayStyle`

| Value | Suggested Flutter widget |
| --- | --- |
| `chips` | Chips |
| `radio_cards` | Single-select cards |
| `checkbox_grid` | Multi-select grid |
| `dropdown` | Dropdown |
| `stepper` | Quantity stepper |

Unknown values normalize to `chips`.

These fields are display metadata only. Pricing, eligibility, selection limits, and premium behavior remain backend-owned business rules.

## 7. Public one-time menu API

### Endpoint

```http
GET /api/orders/menu?lang=ar
GET /api/orders/menu?lang=en
```

The route is public. It is defined in `src/routes/orders.js` and serialized by `src/services/orders/menuCatalogService.js` through `src/services/orders/orderMenuService.js`.

When at least one published one-time `MenuProduct` exists, the response shape is:

```text
data
  source
  fulfillmentMethod
  currency
  vatIncluded
  vatPercentage
  itemTypes[]
  restaurantHours
  categories[]
    products[]
      optionGroups[]
        options[]
```

Sanitized example:

```json
{
  "status": true,
  "data": {
    "source": "one_time_order",
    "fulfillmentMethod": "pickup",
    "currency": "SAR",
    "vatIncluded": true,
    "categories": [
      {
        "id": "CATEGORY_OBJECT_ID",
        "key": "meals",
        "name": "الوجبات",
        "nameI18n": { "ar": "الوجبات", "en": "Meals" },
        "imageUrl": "",
        "ui": { "cardVariant": "light_collection" },
        "products": [
          {
            "id": "PRODUCT_OBJECT_ID",
            "key": "basic_meal",
            "categoryId": "CATEGORY_OBJECT_ID",
            "name": "وجبة بيسك",
            "imageUrl": "",
            "itemType": "basic_meal",
            "pricingModel": "per_100g",
            "priceHalala": 1900,
            "baseUnitGrams": 100,
            "requiresBuilder": true,
            "canAddDirectly": false,
            "ui": {
              "cardVariant": "standard",
              "badge": "",
              "ctaLabel": "",
              "imageRatio": "square"
            },
            "optionGroups": [
              {
                "groupId": "GROUP_OBJECT_ID",
                "key": "proteins",
                "minSelections": 1,
                "maxSelections": 1,
                "isRequired": true,
                "ui": { "displayStyle": "radio_cards" },
                "options": [
                  {
                    "optionId": "OPTION_OBJECT_ID",
                    "groupId": "GROUP_OBJECT_ID",
                    "key": "chicken",
                    "name": "دجاج",
                    "imageUrl": "",
                    "extraPriceHalala": 0,
                    "extraWeightUnitGrams": 0,
                    "extraWeightPriceHalala": 0
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}
```

The current public one-time serializer returns option `extraPriceHalala` after applying any `ProductGroupOption` override. It does **not** currently return option `extraFeeHalala`, `displayCategoryKey`, `proteinFamilyKey`, `premiumKey`, `ruleTags`, or option descriptions in this endpoint.

### Current seeded public sections

The bootstrap definitions in `scripts/seed-catalog.js` seed these categories:

```text
custom_order
meals
carbs
light_options
cold_sandwiches
sourdough
desserts
juices
drinks
ice_cream
```

The public API returns only categories that contain at least one published, active, visible, available `one_time` product.

| Section | Current seeded customer-visible intent |
| --- | --- |
| `custom_order` | `basic_salad` |
| `meals` | `basic_meal` plus 19 fixed meal products |
| `carbs` | 7 fixed carb products |
| `light_options` | `green_salad`, `fruit_salad`, `greek_yogurt` |
| `cold_sandwiches` | 6 canonical cold sandwiches |
| `desserts` | 8 fixed desserts |
| `juices` | 6 fixed juices |
| `ice_cream` | 3 fixed ice-cream products |
| `drinks` | 4 fixed drinks |

`sourdough_turkey` is currently subscription-only, so the seeded `sourdough` category does not appear in a normal one-time menu unless a published one-time product is added.

`small_salad` is retained internally as subscription-only and is also explicitly hidden from the public menu serializer. Legacy carbs are filtered from customer-visible one-time and subscription planner arrays.

`basic_meal` is seeded under `meals`. The serializer also contains a defensive display override that maps `basic_meal` to `meals` if a stale database row still points elsewhere.

### Legacy fallback

If there is no published one-time `MenuProduct`, `src/services/orders/orderMenuService.js` returns an older compatibility shape built from `BuilderProtein`, `BuilderCarb`, `Sandwich`, `SaladIngredient`, and `Addon`.

Flutter should treat the nested `categories[].products[]` shape as the target canonical contract. Keep a controlled fallback only if supporting an uninitialized environment is required.

## 8. Product types and pricing models

Pricing is implemented in `src/services/orders/menuPricingService.js`.

| Behavior | Representation |
| --- | --- |
| Fixed product | `pricingModel: "fixed"` |
| Price per 100g or configured base unit | `pricingModel: "per_100g"` and required `weightGrams` |
| Configurable builder | Any product with `optionGroups[]` |
| Optional add-on | A group with `minSelections: 0`, often `maxSelections: 1` |
| Product-specific option price | `ProductGroupOption.extraPriceHalala` |

All prices use halala:

```text
19 SAR = 1900 halala
29 SAR = 2900 halala
```

For `per_100g`, the backend calculates:

```text
ceil(weightGrams / baseUnitGrams) * priceHalala
```

The quote service reads a relation override first and falls back to the global option price.

Examples:

- A dessert is a fixed product with no groups and can be added directly.
- `basic_meal` is `per_100g`; a quote requires `weightGrams`.
- Eligible fixed meal products have an optional `extra_protein_50g` group.
- `basic_salad` has relation-specific protein and extra-protein pricing overrides.

## 9. Option selection rules

The backend enforces rules in `src/services/orders/menuPricingService.js`.

- `minSelections` is the minimum summed selected quantity.
- `maxSelections` is the maximum summed selected quantity.
- `null` `maxSelections` means unlimited.
- `0` is a valid numeric value and must not be converted to `1`.
- Options must belong to the selected group and must have an active `ProductGroupOption` relation for the selected product.

Correct JavaScript fallback:

```js
const maxSelections = value ?? 1;
```

Incorrect fallback:

```js
const maxSelections = value || 1;
```

Current seeded examples:

| Product | Rules |
| --- | --- |
| `basic_meal` | `carbs` min 1/max 2; `proteins` min 1/max 1; public proteins restricted to `chicken`, `beef`, `fish`, `eggs` |
| `basic_salad` | Shared custom-salad groups; protein and sauce required; optional `extra_protein_50g` |
| `fruit_salad` | Fruits max 9 and sauce max 1; allowed sauce restricted to `honey` by seeded relations |
| `greek_yogurt` | Fruits max 5, sauce max 1, cheese/nuts max 3; seeded relations restrict sauce to honey and nuts to selected values |
| Eligible fixed meal | Optional `extra_protein_50g`, min 0/max 1 |

## 10. Current canonical business sections

The current canonical bootstrap is `scripts/seed-catalog.js`.

### Custom Order

- `basic_salad`
- `premium_large_salad` exists for subscription planner compatibility.
- `basic_meal` belongs under `meals`, not `custom_order`.

### Meals

- `basic_meal`
- 19 fixed meal products in `mealProductRows`
- optional extra protein for eligible meal rows configured by `extraProteinByMeal`

### Carbs

- one shared `carbRows` definition
- 7 customer-visible carbs:

```text
white_rice
turmeric_rice
alfredo_pasta
red_sauce_pasta
roasted_potato
sweet_potato
grilled_mixed_vegetables
```

The same canonical keys feed one-time carb products and subscription carb options.

### Custom Salad

- `basic_salad`
- `premium_large_salad` reuses the custom salad relation data for planner output.
- relation-specific protein and extra-protein prices are stored on `ProductGroupOption`.

### Light Options

```text
green_salad
fruit_salad
greek_yogurt
```

### Cold Sandwiches

The 6 subscription-visible canonical keys are defined in `src/config/mealPlannerContract.js`:

```text
beef_burger_sandwich
turkey_cold_sandwich
boiled_egg_sandwich
tuna_sandwich
mexican_chicken_sandwich
grilled_chicken_sandwich
```

They appear in the one-time menu and the subscription planner sandwich section.

### Desserts, Juices, Ice Cream, Drinks

These are fixed one-time products in `externalProductRows`.

## 11. Subscription meal planner API

### Endpoint

```http
GET /api/subscriptions/meal-planner-menu?includeLegacy=true&lang=ar
```

The endpoint is public and defined in `src/routes/subscriptions.js`. It calls:

```text
src/controllers/menuController.js
  -> src/services/subscription/mealPlannerCatalogService.js
  -> src/services/catalog/CatalogService.js
```

Default response fields:

```text
data.builderCatalog
data.addonCatalog
data.builderCatalogV2
```

When `includeLegacy=true`, the endpoint additionally includes:

```text
data.currency
data.regularMeals
data.premiumMeals
data.addons
```

`builderCatalog` is the V1 compatibility planner object. New Flutter work should prefer `builderCatalogV2`.

### builderCatalogV2

```json
{
  "catalogVersion": "meal_planner_menu.v2",
  "currency": "SAR",
  "sections": [],
  "rules": {}
}
```

Current sections:

| Section key | Type | Notes |
| --- | --- | --- |
| `standard_meal` | `meal_builder` | Virtual product with standard protein and carb groups |
| `premium_meal` | `meal_builder` | Virtual product with premium protein and carb groups |
| `sandwich` | `product_list` | Real canonical `MenuProduct` sandwich rows |
| `premium_large_salad` | `configurable_product` | Real product when available; virtual fallback otherwise |

Current standard proteins:

```text
chicken
beef
fish
eggs
```

Current premium proteins:

```text
beef_steak
shrimp
salmon
```

Planner carbs use the canonical 7 shared carbs. Legacy carbs are filtered out. Sandwiches use the 6 canonical cold sandwich keys. Subscription `premium_large_salad` uses custom salad option relations but excludes premium proteins and `extra_protein_50g`; allowed proteins come only from `SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS`.

Flutter migration guidance:

- Prefer `data.builderCatalogV2.sections`.
- Keep V1 parsing only while backward compatibility is necessary.
- Do not submit virtual IDs such as `virtual:standard_meal` as real menu product IDs.
- Keep existing subscription write payloads until the backend write contract is deliberately migrated.

## 12. Quote/order contract

### Endpoints

```http
POST /api/orders/quote
POST /api/orders
GET /api/orders/:id
```

Authentication is required for all three. Routes are defined in `src/routes/orders.js`.

For canonical menu products, send `productId` or `menuProductId`. If any cart item contains one of those fields, `src/services/orders/orderPricingService.js` routes the cart to canonical `MenuProduct` pricing.

One-time canonical orders are pickup-only. The default pickup branch is `main`.

### Fixed product quote

```json
{
  "fulfillmentMethod": "pickup",
  "pickup": { "branchId": "main" },
  "fulfillmentDate": "2026-06-03",
  "items": [
    {
      "productId": "DESSERT_PRODUCT_OBJECT_ID",
      "qty": 1
    }
  ]
}
```

### basic_meal with weight

```json
{
  "fulfillmentMethod": "pickup",
  "pickup": { "branchId": "main" },
  "fulfillmentDate": "2026-06-03",
  "items": [
    {
      "productId": "BASIC_MEAL_PRODUCT_OBJECT_ID",
      "qty": 1,
      "weightGrams": 200,
      "selectedOptions": [
        { "groupId": "CARBS_GROUP_OBJECT_ID", "optionId": "WHITE_RICE_OPTION_OBJECT_ID", "qty": 1 },
        { "groupId": "PROTEINS_GROUP_OBJECT_ID", "optionId": "CHICKEN_OPTION_OBJECT_ID", "qty": 1 }
      ]
    }
  ]
}
```

### Fixed meal with optional extra protein

```json
{
  "fulfillmentMethod": "pickup",
  "pickup": { "branchId": "main" },
  "fulfillmentDate": "2026-06-03",
  "items": [
    {
      "productId": "FIXED_MEAL_PRODUCT_OBJECT_ID",
      "qty": 1,
      "selectedOptions": [
        { "groupId": "EXTRA_PROTEIN_GROUP_OBJECT_ID", "optionId": "EXTRA_CHICKEN_OPTION_OBJECT_ID", "qty": 1 }
      ]
    }
  ]
}
```

### basic_salad with relation-specific protein price

```json
{
  "fulfillmentMethod": "pickup",
  "pickup": { "branchId": "main" },
  "fulfillmentDate": "2026-06-03",
  "items": [
    {
      "productId": "BASIC_SALAD_PRODUCT_OBJECT_ID",
      "qty": 1,
      "weightGrams": 100,
      "selectedOptions": [
        { "groupId": "PROTEINS_GROUP_OBJECT_ID", "optionId": "PROTEIN_OPTION_OBJECT_ID", "qty": 1 },
        { "groupId": "SAUCES_GROUP_OBJECT_ID", "optionId": "SAUCE_OPTION_OBJECT_ID", "qty": 1 }
      ]
    }
  ]
}
```

Sanitized quote response shape:

```json
{
  "status": true,
  "data": {
    "currency": "SAR",
    "fulfillmentDate": "2026-06-03",
    "requestedFulfillmentDate": "2026-06-03",
    "items": [
      {
        "productId": "PRODUCT_OBJECT_ID",
        "qty": 1,
        "unitPriceHalala": 1900,
        "lineTotalHalala": 1900,
        "pricingSnapshot": {
          "basePriceHalala": 1900,
          "optionsTotalHalala": 0,
          "unitPriceHalala": 1900,
          "lineTotalHalala": 1900
        }
      }
    ],
    "pricing": {
      "subtotalHalala": 1900,
      "deliveryFeeHalala": 0,
      "totalHalala": 1900,
      "currency": "SAR"
    }
  }
}
```

Use the quote API as the final price authority. Flutter may display catalog prices optimistically but must show backend validation errors such as `INVALID_WEIGHT_GRAMS`, `MIN_SELECTIONS_NOT_MET`, `MAX_SELECTIONS_EXCEEDED`, and `OPTION_NOT_ALLOWED`.

## 13. Dashboard contract

Dashboard CRUD routes are mounted at `/api/dashboard/menu` by `src/routes/index.js` and implemented by:

```text
src/routes/dashboardMenu.js
src/controllers/dashboard/menuController.js
src/services/orders/menuCatalogService.js
```

### Dashboard should manage

- category names, descriptions, images, sort, visibility, availability, and `ui.cardVariant`
- product category, names, descriptions, images, prices, weight fields, availability, and product UI fields
- option-group names, descriptions, sort, and `ui.displayStyle`
- option names, descriptions, images, sort, channels, and prices
- product/group selection rules
- allowed product/group options
- `ProductGroupOption.extraPriceHalala` and extra-weight overrides
- publish after changes that must become publicly visible

### Dashboard must not

- ask admins to type technical keys
- send changed keys on update
- expose Cloudinary secrets
- wipe `imageUrl` unless the admin intentionally clears it
- use `|| 1` when preserving `maxSelections`
- create duplicate canonical rows instead of editing existing rows
- treat UI metadata as business logic

### Dashboard relation APIs

```http
PUT   /api/dashboard/menu/products/:productId/groups
PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/selection-rules
PUT   /api/dashboard/menu/products/:productId/groups/:groupId/options
PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId
```

The two `PUT` routes replace the complete relation list. The dashboard must send all relations it intends to preserve.

### Known dashboard gaps

| Gap | Evidence | Required follow-up |
| --- | --- | --- |
| `maxSelections = 0` is converted to `1` in relation writes | `/home/hema/Projects/full app/client_dashbourd-main/src/components/pages/menu/relations/MenuProductRelationsTab.tsx` uses `Number(state.maxSelections) || 1` | Replace with nullish/explicit parsing and preserve `0` and `null` deliberately. |
| Advanced option metadata is only partially editable | Option form exposes `displayCategoryKey` and `proteinFamilyKey`, but not `premiumKey`, `ruleTags`, `selectionType`, or `extraFeeHalala` directly | Add an advanced admin section if these values must be dashboard-managed. |
| Planner V2 preview/diagnostics is not present in the inspected menu UI | Menu UI manages CRUD, publish, validation, versions, and audit tabs | Add a read-only `builderCatalogV2` preview if operators need planner verification. |
| Manual URL entry is still enabled | `ImageUploadField.tsx` supports upload and free-text URL input | Decide whether dashboard-managed images must be upload-only. |

Settings, restaurant hours, accounting, users, and dashboard-user pages exist in the dashboard. They are adjacent administration features, not catalog entity editors.

## 14. Image upload contract

### Endpoint

```http
POST /api/dashboard/uploads/image
Content-Type: multipart/form-data
Field: image
```

The endpoint is protected by dashboard authentication and admin role checks in `src/routes/admin.js`. `/api/admin/uploads/image` is retained as a legacy alias.

Accepted types and size limit are defined in `src/middleware/imageUpload.js`:

```text
image/jpeg
image/png
image/webp
maximum 5 MiB by default
```

Response:

```json
{
  "success": true,
  "status": true,
  "data": {
    "url": "https://...",
    "imageUrl": "https://.../f_auto,q_auto/...",
    "secureUrl": "https://...",
    "publicId": "basicdiet145/menu/...",
    "resourceType": "image",
    "width": 1200,
    "height": 900,
    "format": "webp",
    "bytes": 123456
  }
}
```

Cloudinary upload logic lives in:

```text
src/services/cloudinaryUploadService.js
src/services/adminImageService.js
src/controllers/uploadController.js
```

Dashboard should store `data.imageUrl`. Flutter should render entity `imageUrl`. Cloudinary credentials remain backend-only.

The shared dashboard uploader is:

```text
/home/hema/Projects/full app/client_dashbourd-main/src/components/shared/ImageUploadField.tsx
```

It currently permits both backend upload and manual URL entry.

## 15. Bootstrap/seed behavior

Relevant package commands:

```bash
npm run bootstrap:data
npm run bootstrap:data:sync
```

Defined in `package.json`:

```text
bootstrap:data      -> node scripts/seed-catalog.js && account bootstrap
bootstrap:data:sync -> BOOTSTRAP_SYNC=true node scripts/seed-catalog.js && account bootstrap
```

Behavior in `scripts/seed-catalog.js`:

| Mode | Behavior |
| --- | --- |
| Default `npm run bootstrap:data` | Create missing rows only. Existing rows are skipped. Menu publication is skipped. |
| Explicit `npm run bootstrap:data:sync` | Updates canonical rows, repairs missing rows, and publishes the menu. |
| Explicit reset | Enabled only by `--reset` or `ALLOW_CATALOG_RESET=true`; deletes catalog-owned collections before rebuilding. |

Operational rules:

- Normal missing-row maintenance: use `npm run bootstrap:data`.
- Intentional canonical synchronization: use `npm run bootstrap:data:sync` only after reviewing overwrite impact.
- Reset: never use unless the owner explicitly requests it.

Default create-missing-only mode preserves existing dashboard-managed image URLs because existing rows are skipped.

**Important limitation:** explicit sync can overwrite dashboard-managed fields when seed payloads include them. Some seeded products and options include `imageUrl: ""`, so explicit sync is not guaranteed to preserve uploaded images. Review and fix this before treating sync mode as dashboard-image-safe.

## 16. Flutter implementation guide

### One-time menu

Flutter should:

1. Fetch `GET /api/orders/menu?lang=ar|en`.
2. Render returned categories and products in returned order.
3. Choose category layout from `category.ui.cardVariant`.
4. Choose product card layout from `product.ui.cardVariant`.
5. Choose option-group widgets from `optionGroup.ui.displayStyle`.
6. Enforce `minSelections`, `maxSelections`, and `isRequired` for immediate UX feedback.
7. Submit selected `groupId` and `optionId` values exactly as returned.
8. Include `weightGrams` for `per_100g` products.
9. Display `priceHalala` as SAR for presentation, but use `POST /api/orders/quote` as final price authority.
10. Show server validation errors.

Recommended Dart models:

```text
MenuResponse
MenuCategoryDto
MenuProductDto
MenuOptionGroupDto
MenuOptionDto
ProductUiDto
CategoryUiDto
OptionGroupUiDto
OrderQuoteRequest
OrderQuoteResponse
```

### Subscription planner

Flutter should:

1. Fetch `GET /api/subscriptions/meal-planner-menu?includeLegacy=true&lang=ar|en`.
2. Prefer `data.builderCatalogV2.sections`.
3. Render real and virtual planner products according to section `type`.
4. Keep current legacy write payloads during migration.
5. Use timeline `timelineStatus` and `canShowAsPlanned` from the subscription timeline response.

Timeline behavior is implemented in `src/services/subscription/subscriptionTimelineService.js`. Do not infer a planned day only from selected meal count.

### Flutter must not

- hardcode Arabic or English names for behavior
- infer product type from text
- use keys as card-layout switches
- calculate final price without the quote endpoint
- submit virtual planner product IDs as canonical menu product IDs

## 17. Dashboard implementation guide

### Add a fixed product

1. Create or reuse a category.
2. Create a product with `pricingModel: "fixed"`, a halala price, channels, and `ui.cardVariant`.
3. Leave technical key generation to the backend.
4. Upload an image through `ImageUploadField`.
5. Publish the menu.
6. Verify `GET /api/orders/menu?lang=ar`.

### Add a configurable product

1. Create the product.
2. Reuse existing option groups where possible.
3. Link groups to the product with `ProductOptionGroup` selection rules.
4. Link only allowed options through `ProductGroupOption`.
5. Add relation-specific prices where needed.
6. Publish and verify quote validation.

### Add optional extra protein

1. Reuse the `extra_protein_50g` group.
2. Link it with `minSelections: 0`, `maxSelections: 1`, `isRequired: false`.
3. Link the intended extra-protein options only.
4. Set per-product overrides on `ProductGroupOption` when needed.

### Update an image

1. Upload through `POST /api/dashboard/uploads/image`.
2. Store returned `data.imageUrl` on the category, product, or option.
3. Publish if the entity is new or publication state needs refresh.
4. Verify the public endpoint and Flutter rendering.

### Avoid breaking Flutter

- Do not change keys.
- Do not remove required relations without validating affected products.
- Preserve `0` and `null` selection limits.
- Keep UI metadata present and valid.
- Publish and verify both one-time menu and planner output after structural edits.

## 18. End-to-end examples

### Add a fixed dessert

Create a product under `desserts`:

```json
{
  "categoryId": "DESSERTS_CATEGORY_OBJECT_ID",
  "name": { "ar": "حلوى جديدة", "en": "New Dessert" },
  "itemType": "dessert",
  "pricingModel": "fixed",
  "priceHalala": 1200,
  "availableFor": ["one_time"],
  "ui": { "cardVariant": "addon", "imageRatio": "square" }
}
```

Then publish. Flutter receives the generated key but renders the card from `ui.cardVariant`.

### Add a meal with optional extra protein

Create the fixed meal, link `extra_protein_50g`, link intended options, then publish. Flutter renders the returned optional group and sends selected IDs to quote.

### Update a product image

Upload the file, store returned optimized `imageUrl`, update the product, publish if needed, and verify the public menu response.

### Change category card style

Update:

```json
{
  "ui": { "cardVariant": "light_collection" }
}
```

Flutter changes layout without checking category names or keys.

### Flutter renders a configurable product

Flutter receives a product with `requiresBuilder: true`, iterates `optionGroups`, selects a widget from each `ui.displayStyle`, enforces limits locally, then submits IDs to quote.

### Quote flow

```text
GET /api/orders/menu
  -> user selects returned product and options
  -> POST /api/orders/quote
  -> backend validates availability, groups, options, weights, and prices
  -> Flutter displays quote totals
  -> POST /api/orders
```

## 19. Troubleshooting

| Problem | Probable cause | Where to check |
| --- | --- | --- |
| Product not showing in app | Product/category inactive, hidden, unavailable, unpublished, wrong channel, wrong branch, or empty category | `src/services/orders/menuCatalogService.js#getPublishedMenu`, dashboard publish tab |
| Image not showing | Empty `imageUrl`, failed upload, stale public row, or client cache | `src/components/shared/ImageUploadField.tsx`, `src/services/cloudinaryUploadService.js`, public menu JSON |
| Option appears in wrong product | Incorrect `ProductGroupOption` relation | Dashboard relations tab and `ProductGroupOption` collection |
| Option price not applied | Override stored globally instead of on relation, or relation override missing | `ProductGroupOption.extraPriceHalala`, `src/services/orders/menuPricingService.js` |
| Legacy carb appears | Filtering omitted in a new serializer | `CUSTOMER_VISIBLE_CARB_KEYS` in `src/config/mealPlannerContract.js` |
| `small_salad` appears publicly | New serializer bypassed hidden-key or channel filtering | `HIDDEN_PUBLIC_PRODUCT_KEYS` in `src/services/orders/menuCatalogService.js` |
| Dashboard changed a key | Client sent an invalid update or backend guard was bypassed | Expect `400 IMMUTABLE_KEY`; inspect dashboard payload mapper |
| Flutter card shape is wrong | Flutter used a name/key switch or ignored metadata fallback | `ui.cardVariant` and `ui.displayStyle` handling |
| Quote says `INVALID_WEIGHT_GRAMS` | Missing, non-positive, out-of-range, or wrong-step `weightGrams` for `per_100g` | Product weight fields and quote payload |
| Relation `maxSelections` becomes `1` | Dashboard used falsy fallback for `0` | `MenuProductRelationsTab.tsx`; replace `|| 1` |
| Newly created row is not public | New row has `publishedAt: null` until publish | `POST /api/dashboard/menu/publish` |
| Explicit sync wipes an uploaded image | Seed payload overwrote dashboard field | Review `scripts/seed-catalog.js` before sync |

## 20. Final checklist

### Backend

- [ ] Check `GET /api/orders/menu?lang=ar`.
- [ ] Check `GET /api/subscriptions/meal-planner-menu?includeLegacy=true&lang=ar`.
- [ ] Check fixed, weighted, optional add-on, and relation-override quote pricing.
- [ ] Confirm no duplicate category, product, group, or option keys.
- [ ] Validate before publishing.
- [ ] Never run reset without explicit owner approval.

### Dashboard

- [ ] Keys are hidden on create and read-only on edit.
- [ ] Image upload uses `/api/dashboard/uploads/image`.
- [ ] Stored URL is optimized `data.imageUrl`.
- [ ] Product/category/group UI metadata is editable.
- [ ] `maxSelections = 0` and `null` are preserved.
- [ ] Full replacement relation APIs preserve existing intended relations.
- [ ] Publish after customer-visible structural changes.

### Flutter

- [ ] Render categories in API order.
- [ ] Render layouts from backend UI metadata.
- [ ] Use returned product/group/option IDs.
- [ ] Use quote API as final price authority.
- [ ] Show server validation errors.
- [ ] Prefer `builderCatalogV2`.
- [ ] Use `timelineStatus` and `canShowAsPlanned`.
- [ ] No hardcoded visual UI keys or localized names.

### QA

- [ ] Verify public menu endpoint in Arabic and English.
- [ ] Verify planner endpoint and canonical 7 carbs.
- [ ] Verify 6 planner sandwiches.
- [ ] Verify `small_salad` is not public.
- [ ] Verify image upload and image rendering.
- [ ] Verify dashboard edit then publish flow.
- [ ] Verify no duplicate keys.
- [ ] Verify quote totals with relation-specific pricing.
- [ ] Verify no seed reset was used.

## TODO / Needs confirmation

1. Fix dashboard `maxSelections` parsing in `/home/hema/Projects/full app/client_dashbourd-main/src/components/pages/menu/relations/MenuProductRelationsTab.tsx`. Current writes can turn `0` into `1`, and the UI does not provide a deliberate `null` unlimited flow.
2. Decide whether dashboard menu images must be upload-only. The current shared component allows manually entered URLs.
3. Make explicit sync preserve dashboard-managed `imageUrl` values, or document a reviewed overwrite policy. Default create-missing-only mode is safe; explicit sync is not fully safe today.
4. Decide whether the one-time public option serializer should expose advanced metadata such as `extraFeeHalala`, `displayCategoryKey`, `proteinFamilyKey`, `premiumKey`, and `ruleTags`. Older docs imply a broader shape than current code returns.
5. Add canonical `MenuProduct` nutrition and preparation-time fields if Flutter must display the external-menu metadata currently left as comments in `scripts/seed-catalog.js`.
6. Confirm whether the legacy `Meal`-based `src/controllers/menuController.js#getOrderMenu` can be removed or clearly deprecated to reduce serializer ambiguity.
7. Add a dashboard read-only `builderCatalogV2` preview if operators need to verify planner output before mobile QA.

## Verified source index

Backend:

```text
src/models/MenuCategory.js
src/models/MenuProduct.js
src/models/MenuOptionGroup.js
src/models/MenuOption.js
src/models/ProductOptionGroup.js
src/models/ProductGroupOption.js
src/models/BuilderCategory.js
src/models/BuilderProtein.js
src/models/BuilderCarb.js
src/models/SaladIngredient.js
src/models/Sandwich.js
src/services/orders/menuCatalogService.js
src/services/orders/menuPricingService.js
src/services/orders/orderMenuService.js
src/services/orders/orderPricingService.js
src/services/catalog/CatalogService.js
src/services/catalog/catalogKeyUiHelpers.js
src/services/subscription/mealPlannerCatalogService.js
src/config/mealPlannerContract.js
src/controllers/orderController.js
src/controllers/menuController.js
src/controllers/dashboard/menuController.js
src/controllers/uploadController.js
src/services/cloudinaryUploadService.js
src/services/adminImageService.js
src/middleware/imageUpload.js
src/routes/orders.js
src/routes/subscriptions.js
src/routes/dashboardMenu.js
src/routes/admin.js
src/routes/index.js
scripts/seed-catalog.js
package.json
```

Dashboard:

```text
/home/hema/Projects/full app/client_dashbourd-main/src/components/shared/ImageUploadField.tsx
/home/hema/Projects/full app/client_dashbourd-main/src/components/pages/menu/categories/MenuCategoryFormFields.tsx
/home/hema/Projects/full app/client_dashbourd-main/src/components/pages/menu/products/MenuProductFormFields.tsx
/home/hema/Projects/full app/client_dashbourd-main/src/components/pages/menu/option-groups/MenuOptionGroupFormFields.tsx
/home/hema/Projects/full app/client_dashbourd-main/src/components/pages/menu/options/MenuOptionFormFields.tsx
/home/hema/Projects/full app/client_dashbourd-main/src/components/pages/menu/relations/MenuProductRelationsTab.tsx
/home/hema/Projects/full app/client_dashbourd-main/src/utils/menuPayloadMappers.ts
/home/hema/Projects/full app/client_dashbourd-main/src/utils/fetchMenuProductGroups.ts
/home/hema/Projects/full app/client_dashbourd-main/src/utils/fetchUploadImage.ts
/home/hema/Projects/full app/client_dashbourd-main/src/hooks/useUploadImageMutation.ts
```
