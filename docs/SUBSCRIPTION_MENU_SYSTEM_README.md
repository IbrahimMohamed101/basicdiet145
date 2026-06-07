<<<<<<< HEAD
# Subscription Menu System README

Last audited: 2026-06-07

This document is the backend source of truth for connecting the subscription menu, subscription meal planner, premium selections, and add-ons to the dashboard and Flutter app.

The completed one-time menu backend is referenced here only where subscription flows reuse one-time catalog data.

## 1. System Overview

The backend currently has these menu systems:

| System | Purpose | Primary source | Main API |
| --- | --- | --- | --- |
| One-time menu | Public order menu and paid one-time order items | `MenuCategory`, `MenuProduct`, `MenuOptionGroup`, `MenuOption`, product/group/option relations | `GET /api/orders/menu` |
| Subscription checkout menu | Plans, subscription add-on plans, delivery options, and legacy planner summaries | `Plan`, `Addon`, delivery settings, planner catalog service | `GET /api/subscriptions/menu` |
| Subscription meal planner | Day/slot meal selection for an active subscription | `SubscriptionDay.mealSlots`; catalog from dashboard menu tables plus legacy builder tables | `GET /api/subscriptions/meal-planner-menu`, day selection endpoints |
| Premium meals | Premium proteins inside a basic meal shell | `MenuOption` rows under group key `proteins` and/or legacy `BuilderProtein` rows with premium keys | Meal planner catalog and day selection endpoints |
| Premium large salad | A premium configurable salad selection | Preferred `MenuProduct.key=premium_large_salad`; fallback `basic_salad`; final fallback legacy fixed price | Meal planner catalog and day selection endpoints |
| Add-ons / extras | Checkout add-on entitlements and per-day paid extra items | `Addon` plan/item rows plus one-time `MenuProduct` rows | `GET /api/subscriptions/addon-choices`, day selection/payment endpoints |
| Dashboard-managed catalog | Product-centered menu composer used by one-time menu and v3 planner | `Menu*` and `Product*` models | `/api/dashboard/menu/*` |
| Seeded/bootstrap catalog | Safe baseline data for plans, add-ons, and menu catalog | `scripts/bootstrap/*`, `scripts/seed-*` | CLI scripts |

Dynamic parts:

- Dashboard menu categories/products/options/relations are dynamic and publishable through `/api/dashboard/menu/*`.
- v3 planner catalog is dynamic and product-centered. It reads `basic_meal`, `cold_sandwich` products, `premium_large_salad`/`basic_salad`, option groups, and product-specific option links.
- Subscription plans are dynamic through `/api/admin/plans/*`.
- Subscription add-on plan/item rows are dynamic through `/api/admin/addons*` and legacy meal-planner admin endpoints.
- Per-day add-on choices are dynamic from published one-time `MenuProduct` rows mapped into `juice`, `snack`, and `small_salad`.

Legacy/config fallback parts:

- Legacy builder tables (`BuilderProtein`, `BuilderCarb`, `SaladIngredient`, `Meal`, `MealCategory`, `Sandwich`) are still accepted by legacy planner payloads and compatibility catalog fields.
- `premium_large_salad` pricing falls back from `MenuProduct.key=premium_large_salad` to `MenuProduct.key=basic_salad`, then to `PREMIUM_LARGE_SALAD_FIXED_PRICE_HALALA = 2900`.
- `standard_combo` maps to `standard_meal`; `custom_premium_salad` maps to `premium_large_salad`.
- Deprecated helper endpoints for premium/add-on selections still exist but return 422 and instruct clients to use canonical meal slots.

## 2. Domain Model

| Concept | Meaning | Stored in | Exposed to | Frontend screen |
| --- | --- | --- | --- | --- |
| Subscription | User's purchased plan, remaining meal balance, premium/add-on balances, delivery mode | `Subscription` | `/api/subscriptions/*`, `/api/admin/subscriptions/*`, `/api/dashboard/subscriptions/*` | Subscription overview, planner, dashboard customer detail |
| SubscriptionPlan | Duration, grams, meals/day, prices, skip/freeze policy | `Plan` | `/api/subscriptions/menu`, `/api/admin/plans/*` | Checkout package picker, dashboard plan editor |
| Meal slot | One selectable meal position for a subscription day | `SubscriptionDay.mealSlots[]` | day read, timeline, selection update/validate/confirm | Flutter weekly planner slot UI |
| Selection type | Slot mode: `standard_meal`, `premium_meal`, `premium_large_salad`, `sandwich` | `SubscriptionDay.mealSlots[].selectionType` | planner catalog and day APIs | Slot type picker / section tabs |
| Standard meal | Included basic meal with one protein and carb split | v3 `MenuProduct basic_meal` + `selectedOptions`; legacy `proteinId` + `carbs` | planner catalog, day APIs | Basic meal builder |
| Sandwich meal | Cold sandwich product as a complete slot | `MenuProduct.itemType=cold_sandwich`; legacy `Meal`/`Sandwich` fallback | planner catalog, day APIs | Sandwich list |
| Premium meal | Basic meal using premium protein, usually paid or balance-backed | Premium protein `MenuOption` or `BuilderProtein` | planner catalog, payment requirement | Premium tab in meal builder |
| Premium large salad | Premium configurable salad product | `MenuProduct.key=premium_large_salad` preferred; fallback `basic_salad`; slot `salad.groups` | planner catalog, payment requirement | Premium salad builder |
| Custom premium salad | Legacy alias for premium large salad | legacy request only | normalized on write | Do not build new UI around alias |
| Protein | Meal protein option; standard or premium | `MenuOption` group `proteins`; legacy `BuilderProtein` | planner catalog | Protein picker |
| Carb | Carb option with grams | `MenuOption` group `carbs`; legacy `BuilderCarb` | planner catalog | Carb split picker |
| Sauce | Premium salad required group | `MenuOption`/`SaladIngredient` group `sauce` | planner catalog | Salad sauce picker |
| Salad group | Premium salad grouping rules | `mealPlannerContract.SALAD_SELECTION_GROUPS`; product option groups for v3 | planner catalog | Salad grouped picker |
| Option group | Dashboard grouping of options | `MenuOptionGroup` | dashboard composer, v3 planner catalog | Dashboard composer and Flutter builders |
| Add-on | Either checkout subscription entitlement plan or daily item | `Addon`; daily choices from `MenuProduct` | checkout menu, add-on choices, day APIs | Checkout add-ons, daily extras |
| Extra protein | Dashboard option group key `extra_protein_50g` | `MenuOptionGroup`/`MenuOption` | v2/v3 catalog when linked; blocked for subscription premium large salad | Dashboard only unless enabled for valid product |
| Product | Dashboard product shell | `MenuProduct` | `/api/dashboard/menu/products*`, planner catalog | Dashboard product editor, Flutter product cards |
| Menu option | Selectable product option | `MenuOption`, linked by `ProductGroupOption` | composer and planner catalog | Dashboard options, Flutter option cards |
| Catalog key | Stable semantic key such as `basic_meal`, `proteins`, `white_rice` | `key` fields | all catalog APIs | Client mapping and analytics |
| Stable key | Same idea at contract level; use keys for behavior, IDs for writes | `key`, `premiumKey`, `slotKey` | planner payloads | UI state reconciliation |
| Identity mapping | Cross-channel catalog identity links for one-time/subscription parity | `SharedMenuIdentity`, `MenuIdentityLink` | `/api/dashboard/menu-identities*`, `/api/dashboard/menu-identity-links`, `/api/dashboard/menu-identity-suggestions*` | Dashboard catalog governance |

## 3. Subscription Menu Flow

Expected lifecycle:

```txt
User has active subscription
↓
Flutter opens subscription planner
↓
App fetches /api/subscriptions/meal-planner-menu
↓
App fetches /api/subscriptions/:id/timeline or /days/:date
↓
User selects meals for day slots
↓
App calls /selection/validate or saves via /selection
↓
Backend validates catalog state, option relations, counts, premium balance, and add-ons
↓
If premium/add-on payment is required, app calls /payments then verifies
↓
App confirms day with /confirm
↓
Fulfillment/status flow continues through pickup/delivery endpoints
```

Flutter needs:

- Subscription id, status, `selectedMealsPerDay`, balances, and timeline dates.
- Planner catalog: sections/products/option groups/options/rules.
- Day read payload: `mealSlots`, `plannerMeta`, `plannerState`, `paymentRequirement`, `addonSelections`, fulfillment flags.
- Payment requirement: `requiresPayment`, blocking reason, premium/add-on counts, amount in halala, currency.
- Catalog freshness: if validation returns stale planner errors, refresh `/api/subscriptions/meal-planner-menu`.

## 4. API Contracts

All paths below are mounted under `/api`.

### Client Catalog APIs

#### `GET /api/subscriptions/menu`

Auth: public. Role: none.

Purpose: checkout-oriented subscription menu. Use it for plan/package selection, subscription add-on plans, delivery options, and legacy compatibility menu fields.

Response shape:

```json
{
  "status": true,
  "data": {
    "currency": "SAR",
    "plans": [],
    "delivery": {},
    "regularMeals": [],
    "premiumMeals": [],
    "addons": [],
    "addonsByType": { "subscription": [], "oneTime": [] },
    "mealPlanner": {},
    "flow": { "steps": [] }
  }
}
```

Screen: subscription checkout/package builder. Do not use it as the primary day planner catalog; use `/meal-planner-menu`.

#### `GET /api/subscriptions/meal-planner-menu`

Auth: public. Role: none.

Query:

- `contractVersion=v3` or `meal_planner_menu.v3`: includes `plannerCatalog`.
- `includeLegacy=true`: additionally returns old `regularMeals`, `premiumMeals`, and `addons`.

Default response shape:

```json
{
  "status": true,
  "data": {
    "builderCatalog": {},
    "builderCatalogV2": {},
    "plannerCatalog": {
      "contractVersion": "meal_planner_menu.v3",
      "currency": "SAR",
      "catalogHash": "sha256:...",
      "sections": [],
      "rules": {}
    },
    "addonCatalog": { "items": [], "byCategory": {}, "totalCount": 0 }
  }
}
```

Important fields:

- `plannerCatalog.sections[]`: preferred Flutter source.
- `builderCatalogV2.sections[]`: compatibility source for sectioned builders.
- `builderCatalog.premiumLargeSalad`: legacy compatibility data and price fallback visibility.
- `rules`: beef limit, carb split, premium salad rules.

Screen: Flutter planner first-load.

#### `GET /api/subscriptions/addon-choices`

Auth: public. Role: none.

Query:

- `category=juice|snack|small_salad` optional.

Response:

```json
{
  "status": true,
  "data": {
    "juice": {
      "category": "juice",
      "sourceCategories": ["juices", "drinks"],
      "choices": []
    }
  }
}
```

Error: `400 INVALID` if category is not one of `juice`, `snack`, `small_salad`.

Screen: daily add-on item picker.

### Client Subscription Planning APIs

All endpoints below require app bearer auth and must belong to the subscription owner.

#### `GET /api/subscriptions/current/overview`

Purpose: current subscription summary, balances, aliases for `premiumSummary` and `addonsSummary`.

Screen: subscription home.

#### `GET /api/subscriptions/:id/timeline`

Purpose: calendar view with per-day `mealSlots`, `selectedMeals`, `requiredMeals`, `commercialState`, `paymentRequirement`, and edit/fulfillment flags.

Errors: `400` invalid id, `403` forbidden, `404` not found.

Screen: weekly/monthly planner.

#### `GET /api/subscriptions/:id/days/:date`

Purpose: one day planner read. Date is `YYYY-MM-DD`.

Response includes:

- `mealSlots`
- `plannerMeta`
- `plannerState`
- `paymentRequirement`
- `mealBalance`
- add-on and pickup/delivery fields

Screen: day detail.

#### `POST /api/subscriptions/:id/days/:date/selection/validate`

Purpose: validate without saving.

Preferred v3 request:

```json
{
  "contractVersion": "meal_planner_menu.v3",
  "mealSlots": [
    {
      "slotIndex": 1,
      "selectionType": "standard_meal",
      "productId": "MENU_PRODUCT_ID",
      "selectedOptions": [
        { "groupId": "PROTEINS_GROUP_ID", "groupKey": "proteins", "optionId": "CHICKEN_OPTION_ID", "optionKey": "grilled_chicken", "quantity": 1 },
        { "groupId": "CARBS_GROUP_ID", "groupKey": "carbs", "optionId": "RICE_OPTION_ID", "optionKey": "white_rice", "quantity": 1, "grams": 150 }
      ]
    }
  ],
  "addonsOneTime": ["MENU_PRODUCT_ID"]
}
```

Legacy-compatible request:

```json
{
  "mealSlots": [
    {
      "slotIndex": 1,
      "selectionType": "standard_meal",
      "proteinId": "PROTEIN_ID",
      "carbs": [{ "carbId": "CARB_ID", "grams": 150 }]
    }
  ]
}
```

Response:

```json
{
  "status": true,
  "data": {
    "valid": true,
    "processedSlots": [],
    "plannerMeta": {},
    "rules": {}
  }
}
```

Validation failure is normally `422` or `400` with:

```json
{
  "status": false,
  "error": {
    "code": "PLANNER_PRODUCT_UNAVAILABLE",
    "message": "Product catalog item is unavailable",
    "details": { "slotErrors": [] }
  }
}
```

Screen: optional pre-submit validation and inline slot errors.

#### `PUT /api/subscriptions/:id/days/:date/selection`

Purpose: save draft day selections. Same body as validate. Also accepts `addonsOneTime`.

Success response:

```json
{
  "status": true,
  "data": {
    "date": "2026-10-10",
    "mealSlots": [],
    "plannerMeta": {},
    "plannerState": "draft",
    "paymentRequirement": {}
  }
}
```

Notes:

- Idempotent writes may include `"idempotent": true`.
- If premium/add-ons require payment, saved data remains draft and `paymentRequirement.requiresPayment=true`.
- Existing paid selections are preserved where possible to avoid recharging.

Screen: planner save/update.

#### `PUT /api/subscriptions/:id/days/selections/bulk`

Purpose: save multiple dates.

Body variant A:

```json
{
  "dates": ["2026-10-10", "2026-10-11"],
  "mealSlots": [],
  "addonsOneTime": []
}
```

Body variant B:

```json
{
  "days": [
    { "date": "2026-10-10", "mealSlots": [], "addonsOneTime": [] }
  ]
}
```

Errors:

- `400 INVALID` if no days/dates.
- `400 INVALID` if duplicate dates.
- Per-date legacy payload failures return `LEGACY_DAY_SELECTION_UNSUPPORTED`.

Screen: weekly copy/apply planner.

#### `POST /api/subscriptions/:id/days/:date/confirm`

Purpose: confirm a draft day.

Success:

```json
{
  "status": true,
  "success": true,
  "plannerState": "confirmed",
  "data": { "plannerState": "confirmed" }
}
```

Blocks:

- incomplete slots: `PLANNING_INCOMPLETE`
- pending premium payment: `PREMIUM_PAYMENT_REQUIRED`
- pending premium overage: `PREMIUM_OVERAGE_PAYMENT_REQUIRED`
- pending one-time add-on payment: `ONE_TIME_ADDON_PAYMENT_REQUIRED`
- invalid/locked/frozen/skipped day through modification policy errors

Screen: final confirmation CTA.

#### `POST /api/subscriptions/:id/days/:date/payments`

Purpose: unified day payment for pending premium and/or one-time add-ons.

Response: creates or reuses a provider payment/invoice when payment is required.

Screen: payment sheet after planner save.

#### `POST /api/subscriptions/:id/days/:date/payments/:paymentId/verify`

Purpose: verify unified day payment and settle paid planner state.

Screen: payment return/poll.

#### Legacy payment aliases

Still present:

- `POST /api/subscriptions/:id/days/:date/premium-extra/payments`
- `POST /api/subscriptions/:id/days/:date/premium-extra/payments/:paymentId/verify`
- `POST /api/subscriptions/:id/days/:date/one-time-addons/payments`
- `POST /api/subscriptions/:id/days/:date/one-time-addons/payments/:paymentId/verify`

New Flutter should prefer unified `/payments`.

#### Deprecated helper endpoints

These are not valid for new integration:

- `POST|DELETE /api/subscriptions/:id/addon-selections`
- `POST|DELETE /api/subscriptions/:id/premium-selections`

They return 422 and require canonical `/days/:date/selection`.

### Internal Or Not Publicly Exposed

These flows exist as services or stored state but are **Not currently exposed as public API** for direct Flutter use:

- Direct premium balance consumption/release. It is handled inside day selection persistence.
- Direct add-on balance consumption/release. It is handled inside day selection/payment services.
- Direct mutation of `SubscriptionDay.mealSlots` outside `/selection` and `/confirm`.
- Direct public publishing of dashboard catalog. Publishing is dashboard-only through `/api/dashboard/menu/publish`.
- Direct public editing of planner catalog rules from `mealPlannerContract.js`.
- Direct public editing of identity mappings. Identity mapping is dashboard governance under `/api/dashboard/menu-identities*`, `/api/dashboard/menu-identity-links`, and `/api/dashboard/menu-identity-suggestions*`.

### Dashboard/Admin APIs

#### `/api/dashboard/menu/*`

Auth: dashboard bearer. Roles: `admin`, `superadmin`.

Purpose: product-centered catalog management.

Important endpoints:

- `GET /api/dashboard/menu/preview`
- `GET|POST|PATCH|DELETE /api/dashboard/menu/categories`
- `GET|POST|PATCH|DELETE /api/dashboard/menu/products`
- `GET /api/dashboard/menu/products/:productId/composer`
- `PATCH /api/dashboard/menu/products/:productId/customization`
- `GET|POST|PATCH|DELETE /api/dashboard/menu/products/:productId/option-groups`
- `GET|POST|PUT|PATCH|DELETE /api/dashboard/menu/products/:productId/option-groups/:groupId/options`
- `GET|POST|PATCH|DELETE /api/dashboard/menu/option-groups`
- `GET|POST|PATCH|DELETE /api/dashboard/menu/options`
- `POST /api/dashboard/menu/publish`
- `POST /api/dashboard/menu/validate`
- `GET /api/dashboard/menu/audit-logs`

Use these for `basic_meal`, `premium_large_salad`, `basic_salad`, cold sandwiches, proteins, carbs, sauces, salad groups, extra pricing, availability, and publishing.

#### `/api/admin/meal-planner-menu/*`

Auth: dashboard bearer. Role: `admin`.

Legacy/direct planner admin surface:

- categories
- proteins
- premium-proteins
- sandwiches
- carbs
- addons
- salad-ingredients

The same route module is also mounted at `/api/dashboard/meal-planner/*`.

Use only if the dashboard still has legacy planner screens. New work should prefer `/api/dashboard/menu/*` where product-specific option links are needed.

#### `/api/admin/plans/*`

Auth: dashboard bearer. Role: `admin`.

Manage subscription plans:

- `GET|POST /api/admin/plans`
- `GET|PUT|DELETE /api/admin/plans/:id`
- `PATCH /api/admin/plans/:id/toggle`
- nested grams and meals/day endpoints under `/grams` and `/meals`

#### `/api/admin/addons*`

Auth: dashboard bearer. Role: `admin`.

Manage `Addon` rows:

- `GET|POST /api/admin/addons`
- `GET|PUT|PATCH|DELETE /api/admin/addons/:id`
- `GET|POST /api/admin/addon-plans`
- `GET|POST /api/admin/addon-items`

#### Subscription operations

Admin read/write:

- `/api/admin/subscriptions/*`

Dashboard subset:

- `/api/dashboard/subscriptions/search`
- `/api/dashboard/subscriptions/:id/addon-entitlements`
- `/api/dashboard/subscriptions/:id/balances`
- `/api/dashboard/subscriptions/:subscriptionId/manual-deduction`

Balance patching under `/api/admin/subscriptions/:id/balances` is restricted to `superadmin`; read is `superadmin`/`cashier` in the admin route and `admin`/`cashier` in dashboard route.

## 5. Selection Types

Preferred v3 slots use `productId` and `selectedOptions`. Legacy slots use direct ids (`proteinId`, `carbs`, `sandwichId`, `salad`). The backend detects v3 by `contractVersion=meal_planner_menu.v3` or any slot with `productId` plus `selectedOptions`.

### `standard_meal`

Business meaning: included basic meal.

Required v3 fields:

- `slotIndex`
- `selectionType: "standard_meal"`
- `productId` for `MenuProduct.key=basic_meal`
- one selected protein option from group `proteins`
- one or two carb options from group `carbs`, with grams

Required legacy fields:

- `proteinId` for non-premium protein
- `carbs[]`

Disallowed:

- `sandwichId`
- `salad` / `customSalad`
- premium protein

Validation:

- one protein
- carb max types `2`
- carb max total `300g`
- no duplicate carbs
- only one non-premium beef-family slot per day

Valid legacy payload:

```json
{
  "slotIndex": 1,
  "selectionType": "standard_meal",
  "proteinId": "PROTEIN_ID",
  "carbs": [{ "carbId": "CARB_ID", "grams": 150 }]
}
```

Invalid:

```json
{
  "slotIndex": 1,
  "selectionType": "standard_meal",
  "proteinId": "PREMIUM_PROTEIN_ID",
  "carbs": [{ "carbId": "CARB_ID", "grams": 150 }],
  "sandwichId": "SANDWICH_ID"
}
```

Pricing: included unless option relation extra prices are present in v3 snapshots; does not create premium balance usage.

UI: show basic meal product with protein tabs and carb split controls.

### `premium_meal`

Business meaning: basic meal with premium protein.

Required v3:

- `productId` for `basic_meal`
- selected premium protein option
- carb selections

Required legacy:

- `proteinId`, `proteinKey`, or `premiumKey` resolving to premium protein
- `carbs[]`

Allowed premium keys:

- `beef_steak`
- `shrimp`
- `salmon`

Disallowed:

- `sandwichId`
- `salad`
- non-premium protein

Pricing:

- If matching `Subscription.premiumBalance[premiumKey].remainingQty > 0`, source is `balance`, extra fee is zero for the day.
- Otherwise source is `pending_payment`, and `premiumExtraFeeHalala` comes from option/protein fee.
- Existing `paid`/`paid_extra` source may be preserved on edits.

Valid legacy payload:

```json
{
  "slotIndex": 2,
  "selectionType": "premium_meal",
  "premiumKey": "shrimp",
  "carbs": [{ "carbId": "CARB_ID", "grams": 150 }]
}
```

Invalid:

```json
{
  "slotIndex": 2,
  "selectionType": "premium_meal",
  "proteinId": "STANDARD_PROTEIN_ID",
  "carbs": [{ "carbId": "CARB_ID", "grams": 150 }]
}
```

UI: show premium proteins in a separate premium section/tab and surface extra fee or balance coverage before save.

### `sandwich`

Business meaning: one cold sandwich as a meal slot.

Required v3:

- `productId` for `MenuProduct.itemType=cold_sandwich`
- `selectedOptions` normally empty

Required legacy:

- `sandwichId`

Disallowed:

- `proteinId`
- `carbs`
- `salad`

Valid legacy payload:

```json
{
  "slotIndex": 3,
  "selectionType": "sandwich",
  "sandwichId": "SANDWICH_ID"
}
```

Invalid:

```json
{
  "slotIndex": 3,
  "selectionType": "sandwich",
  "sandwichId": "SANDWICH_ID",
  "carbs": [{ "carbId": "CARB_ID", "grams": 150 }]
}
```

Pricing: normally included as a slot. Product price is exposed in catalog for display and snapshots.

UI: simple product list; no protein/carb builder.

### `premium_large_salad`

Business meaning: premium configurable large salad occupying one meal slot.

Required v3:

- `productId` for `premium_large_salad` or fallback `basic_salad`
- selected options for product-linked salad groups

Required legacy:

- `salad.presetKey`, usually `large_salad`
- `salad.groups`
- exactly one `protein`
- exactly one `sauce`

Disallowed:

- carbs
- sandwich
- premium proteins
- `extra_protein_50g` in subscription premium large salad

Valid legacy payload:

```json
{
  "slotIndex": 1,
  "selectionType": "premium_large_salad",
  "salad": {
    "presetKey": "large_salad",
    "groups": {
      "leafy_greens": [],
      "vegetables": ["INGREDIENT_ID"],
      "protein": ["STANDARD_SALAD_PROTEIN_ID"],
      "cheese_nuts": [],
      "fruits": [],
      "sauce": ["SAUCE_ID"]
    }
  }
}
```

Invalid:

```json
{
  "slotIndex": 1,
  "selectionType": "premium_large_salad",
  "carbs": [{ "carbId": "CARB_ID", "grams": 150 }],
  "salad": { "groups": { "protein": ["SALMON_ID"], "sauce": [] } }
}
```

Pricing: same premium balance/payment logic as premium meals, with `premiumKey=premium_large_salad`.

UI: grouped salad builder; do not show extra protein for subscription premium large salad.

### Legacy aliases

- `standard_combo` -> `standard_meal`
- `custom_premium_salad` -> `premium_large_salad`
- Unknown/empty types fall back to `premium_meal` if `isPremium`/`isPremiumProtein`, otherwise `standard_meal`.

Do not send aliases from new Flutter builds.

## 6. Premium Meals / Premium Large Salad

Premium meal proteins are keyed by:

- `beef_steak`
- `shrimp`
- `salmon`

Legacy code has fallback fee defaults of 2000 halala for these keys, but v3 should rely on dashboard option/relation prices where configured.

Premium large salad:

- canonical selection type: `premium_large_salad`
- premium key: `premium_large_salad`
- preset key: `large_salad`
- preferred product key: `premium_large_salad`
- fallback product key: `basic_salad`
- final legacy fallback price: `2900` halala

Allowed subscription premium large salad proteins:

- `boiled_eggs`
- `tuna`
- `chicken_fajita`
- `spicy_chicken`
- `italian_spiced_chicken`
- `chicken_tikka`
- `asian_chicken`
- `chicken_strips`
- `grilled_chicken`
- `mexican_chicken`
- `fish_fillet`

Rejected proteins:

- Premium proteins such as `beef_steak`, `shrimp`, `salmon`
- Any protein not in the allowlist above
- Missing or duplicate protein entries

Salad group rules:

| Group | Min | Max | Source | Notes |
| --- | ---: | ---: | --- | --- |
| `leafy_greens` | 0 | 2 | ingredient | optional |
| `vegetables` | 0 | 19 | ingredient | optional |
| `protein` | 1 | 1 | protein | required |
| `cheese_nuts` | 0 | 2 | ingredient | optional |
| `fruits` | 0 | 4 | ingredient | optional |
| `sauce` | 1 | 1 | ingredient | required |
| `extra_protein_50g` | 0 | 1 | option | excluded for subscription premium large salad |

Duplicate ingredient ids inside a group are rejected. Ingredient group mismatch is rejected. Unknown group keys are rejected.

Premium balance/payment computation:

1. Backend normalizes and validates slots.
2. Each premium slot resolves a `premiumKey`.
3. Existing paid source (`paid` or `paid_extra`) is preserved where applicable.
4. Otherwise backend consumes an in-memory view of `Subscription.premiumBalance`.
5. If balance exists, slot becomes `premiumSource=balance`.
6. If no balance exists, slot becomes `premiumSource=pending_payment` and contributes to `plannerMeta.premiumTotalHalala`.
7. `paymentRequirement` blocks confirmation until payment is settled.

Price source relationship:

- Runtime dashboard product price: `MenuProduct.priceHalala` for `premium_large_salad` or fallback `basic_salad`.
- Legacy config fallback price: `2900` halala from `mealPlannerContract`.
- Quote/selection price: resolved at save/validate time into `premiumExtraFeeHalala` and snapshots.
- Subscription balance: count-based by `premiumKey`; balance coverage makes the pending fee zero for that day.

Dashboard must:

- Publish `premium_large_salad` as subscription-enabled if it should be shown as real product.
- Link salad option groups and options to the product.
- Keep `extra_protein_50g` unavailable for subscription premium large salad unless backend rules change.
- Manage premium protein options and relation prices.

Flutter must:

- Render `premium_large_salad` only when catalog has products/options or legacy catalog says enabled.
- Use group min/max from catalog.
- Hide excluded groups for subscription.
- Show payment state after save, not only local fee estimates.

## 7. Add-ons / Extras Subscription

There are two add-on layers.

### Subscription-level add-on plans

Stored in `Addon` with:

- `kind: "plan"`
- `billingMode: "per_day"` or `per_meal`
- `type/pricingModel: "subscription"`
- `category: juice|snack|small_salad`

Purchased at checkout and stored on:

- `Subscription.addonSubscriptions[]` as entitlement by category and `maxPerDay`.
- `Subscription.addonBalance[]` for balance-style rows where used.

Exposed through:

- `GET /api/subscriptions/menu`
- `GET /api/admin/subscriptions/:id/addon-entitlements`
- `PATCH /api/admin/subscriptions/:id/addon-entitlements`
- `GET /api/dashboard/subscriptions/:id/addon-entitlements`

### Day-level add-on choices / paid extras

Daily item choices are not `Addon` plan ids. They are active, published one-time `MenuProduct` rows mapped by category:

| Add-on category | Source menu categories | Extra filter |
| --- | --- | --- |
| `juice` | `juices`, `drinks` | none |
| `snack` | `desserts` | none |
| `small_salad` | `light_options` | product keys `green_salad`, `fruit_salad` |

Exposed through `GET /api/subscriptions/addon-choices`.

Selected by sending menu product ids in `addonsOneTime` on day selection endpoints.

Backend behavior:

- If subscription has entitlement for the category and daily max is not exceeded, selection source is `subscription`, price is `0`.
- Otherwise selection source is `pending_payment`, price is current `MenuProduct.priceHalala`.
- Existing `paid` selection can be preserved across edits.
- Invalid `Addon` plan ids in `addonsOneTime` are rejected with `INVALID_ONE_TIME_ADDON_SELECTION`.
- Pending paid extras contribute to unified day payment.

Example:

```json
{
  "mealSlots": [],
  "addonsOneTime": ["JUICE_MENU_PRODUCT_ID", "SNACK_MENU_PRODUCT_ID"]
}
```

If user has juice entitlement but no snack entitlement, juice is free and snack requires payment.

Limitations/TODOs found:

- Duration-specific subscription add-on prices are intentionally not persisted in `scripts/bootstrap/seed-subscription-plans.js`; dashboard management is expected.
- Legacy helper endpoint `/addon-selections` is unsupported for new clients.

## 8. Dashboard Integration Guide

Dashboard must support these management tasks:

- Manage subscription products:
  - `basic_meal`
  - cold sandwich products under `cold_sandwiches`
  - `premium_large_salad`
  - fallback `basic_salad`
- Manage option groups:
  - `proteins`
  - `carbs`
  - salad groups like `leafy_greens`, `vegetables`, `protein`, `cheese_nuts`, `fruits`, `sauce`
  - `extra_protein_50g` with the subscription exclusion noted above
- Manage product-specific option links:
  - group min/max/isRequired
  - option relation availability
  - option relation extra price
  - extra weight metadata
- Manage availability:
  - `isActive`
  - `isVisible`
  - `isAvailable`
  - `availableFor` including `subscription`
  - published state via `/publish`
  - linked catalog item availability
- Manage pricing:
  - base product price
  - option relation extra price
  - premium salad runtime price
  - premium protein extra fee
- Prevent stale selections:
  - run `/api/dashboard/menu/validate`
  - publish after edits
  - handle planner validation stale errors by telling clients to refresh
- Manage subscription plans and add-on entitlements through `/api/admin/plans/*`, `/api/admin/addons*`, and subscription entitlement/balance endpoints.

Recommended dashboard product keys:

- `basic_meal`
- `premium_large_salad`
- `basic_salad`
- cold sandwich keys listed in `SUBSCRIPTION_COLD_SANDWICH_KEYS`

## 9. Flutter Integration Guide

Recommended first calls:

1. `GET /api/subscriptions/current/overview`
2. `GET /api/subscriptions/meal-planner-menu?contractVersion=meal_planner_menu.v3`
3. `GET /api/subscriptions/:id/timeline`
4. `GET /api/subscriptions/:id/days/:date` when a day is opened

Build UI from `plannerCatalog` when present:

- Render `sections` as planner modes.
- Render `configurable_product` sections with product option groups.
- Render `product_list` sections as simple cards.
- Use `minSelections`, `maxSelections`, `isRequired`, and group `ui`.
- Use option sections for protein tabs.
- Use ids for writes and keys for UI behavior.

When sending selections:

- Prefer `contractVersion: "meal_planner_menu.v3"`.
- Send `productId` and `selectedOptions`.
- Include `grams` for carb options.
- Send `addonsOneTime` as menu product ids for daily extras.
- Keep one `slotIndex` per slot; do not duplicate.

Handling errors:

- `PLANNER_*_NOT_FOUND`, `*_INACTIVE`, `*_UNPUBLISHED`, `*_UNAVAILABLE`, or errors with hint `"Refresh planner catalog and retry."`: refresh catalog and re-render.
- `PLANNER_MIN_SELECTION_NOT_MET` / `PLANNER_MAX_SELECTION_EXCEEDED`: keep user in builder and highlight group.
- `BEEF_LIMIT_EXCEEDED`: disable more than one non-premium beef-family slot per day.
- `PREMIUM_PAYMENT_REQUIRED`, `ONE_TIME_ADDON_PAYMENT_REQUIRED`: show payment CTA.
- `PLANNING_INCOMPLETE`: keep confirm disabled.

Payment flow:

1. Save selection.
2. Inspect `paymentRequirement`.
3. If required, call `POST /api/subscriptions/:id/days/:date/payments`.
4. Open provider payment URL/invoice from response.
5. Verify via `POST /api/subscriptions/:id/days/:date/payments/:paymentId/verify`.
6. Refresh day.
7. Confirm.

Legacy subscriptions:

- Some read payloads may include legacy materialized fields.
- New writes should still use canonical v3 if catalog supports it.
- Do not call deprecated premium/add-on helper endpoints.

## 10. Validation Rules

| Rule | Enforced in | Error behavior | Frontend prevention |
| --- | --- | --- | --- |
| `slotIndex` positive integer | `mealSlotPlannerService`, `canonicalMealSlotPlannerService` | `INVALID_SLOT_INDEX` or slot error | Generate 1-based slot indices |
| Unique `slotIndex` and `slotKey` | `collectDuplicateSlotErrors` | `DUPLICATE_SLOT_INDEX`, `DUPLICATE_SLOT_KEY` | Use stable slot state |
| Max slots per day | `collectSlotCountErrors`, canonical validator | `MEAL_SLOT_COUNT_EXCEEDED`, `SLOT_COUNT_EXCEEDED` | Limit by `selectedMealsPerDay` |
| Complete slots must meet required count to confirm | commercial/planning services | `PLANNING_INCOMPLETE` | Disable confirm until complete |
| Standard meal requires non-premium protein | `validateStandardMeal`, canonical validator | `PROTEIN_REQUIRED`, `INVALID_PROTEIN_TYPE`, planner relation error | Separate premium tab/type |
| Premium meal requires premium protein | `validatePremiumMeal`, canonical validator | `INVALID_PROTEIN_TYPE` | Only show premium options |
| Carbs required for standard/premium meal | `validateCarbSplit` | `CARBS_REQUIRED` | Require at least one carb |
| Carb max 2 types | `STANDARD_CARB_RULES` | `TOO_MANY_CARBS`, planner max error | Limit selections |
| Carb max 300g total | `STANDARD_CARB_RULES` | `CARB_LIMIT_EXCEEDED` | Sum grams locally |
| Duplicate carb rejected | `validateCarbSplit` | `DUPLICATE_CARB` | Disable selected carb duplicates |
| One non-premium beef-family slot per day | planner meta recomputation | `BEEF_LIMIT_EXCEEDED` | Track beef family across slots |
| Sandwich cannot combine with protein/carbs/salad | `validateSandwichMeal` | `SANDWICH_EXCLUSIVITY_VIOLATION` | Use separate sandwich UI |
| Premium salad cannot include carbs/sandwich | `validatePremiumLargeSalad` | `CARBS_NOT_ALLOWED`, `SANDWICH_NOT_ALLOWED` | Separate salad UI |
| Premium salad valid group keys only | `validatePremiumLargeSalad` | `INVALID_SALAD_GROUP` | Use catalog groups only |
| Premium salad exact one protein | `SALAD_SELECTION_GROUPS` | `SALAD_PROTEIN_REQUIRED` | Radio selection |
| Premium salad exact one sauce | `SALAD_SELECTION_GROUPS` | `SALAD_SAUCE_REQUIRED` | Radio selection |
| Premium salad group min/max | `SALAD_SELECTION_GROUPS` and product relations | `SALAD_GROUP_MIN_SELECT`, `SALAD_GROUP_MAX_SELECT_EXCEEDED`, planner min/max errors | Enforce group counters |
| Premium salad duplicate ingredient | `validatePremiumLargeSalad` | `DUPLICATE_SALAD_INGREDIENT` | Toggle instead of adding duplicates |
| Premium salad ingredient group mismatch | `validatePremiumLargeSalad` | `SALAD_INGREDIENT_GROUP_MISMATCH` | Do not mix groups |
| Premium salad extra protein excluded | config exclusion set | `SALAD_OPTION_NOT_ALLOWED`, `PLANNER_GROUP_RELATION_INACTIVE` | Hide group |
| Hidden/inactive/unpublished catalog rows rejected | canonical validator and availability service | `PLANNER_*_INACTIVE`, `PLANNER_*_UNPUBLISHED`, `PLANNER_*_UNAVAILABLE` | Refresh catalog after dashboard publish |
| Product-option relation required | canonical validator | `PLANNER_GROUP_RELATION_NOT_FOUND`, `PLANNER_OPTION_RELATION_NOT_FOUND` | Build from product option groups only |
| Add-on choices must be mapped one-time products | `reconcileAddonInclusions` | `INVALID_ONE_TIME_ADDON_SELECTION` | Use `/addon-choices` ids only |
| Pending premium/add-on payment blocks confirm | commercial state services | payment required codes | Pay before confirm |

## 11. Pricing and Payment Logic

All prices are integer halala and currency is currently `SAR`.

Subscription checkout pricing:

- `Plan.gramsOptions[].mealsOptions[].priceHalala`
- `Addon` plan billing:
  - `per_day`: price * days
  - `per_meal`: price * days * mealsPerDay
  - `flat_once`: one-time item
- VAT is included in subscription pricing summaries where checkout services apply it.

Day planner pricing:

- Standard meal: usually included. v3 snapshots may include base product and selected option pricing.
- Premium meal: uses premium balance first, otherwise pending payment.
- Premium large salad: uses `resolvePremiumLargeSaladPricing`.
- Daily add-on choices: free when entitlement covers the category; otherwise current menu product price.

Payment states:

- `premiumSource=none`: not premium.
- `premiumSource=balance`: covered by purchased premium balance.
- `premiumSource=pending_payment`: requires day payment.
- `premiumSource=paid_extra` or `paid`: already settled.
- add-on `source=subscription`: entitlement-covered.
- add-on `source=pending_payment`: requires day payment.
- add-on `source=paid`: already settled.

`paymentRequirement` is the Flutter source of truth for CTA state. Do not infer final payment status only from catalog prices.

## 12. Bootstrap, Seed Data, and Diagnostics

Relevant scripts:

```bash
npm run bootstrap:data
npm run bootstrap:data:sync
npm run seed:subscription-plans
npm run seed:subscription-addons
npm run seed:one-time-menu
npm run diagnose:subscription-menu
npm run catalog:check
npm run validate:backend
npm run validate:data
```

Important seed files:

- `scripts/bootstrap/seed-subscription-plans.js`
- `scripts/seed-subscription-plans.js`
- `scripts/seed-subscription-addons.js`
- `scripts/seed-one-time-menu.js`
- `scripts/seedBuilderCatalogData.js`
- `scripts/bootstrap/seed-catalog.js`

Plan seed expectations:

- 3 duration plans: 7, 26, 30 days.
- 3 grams options per plan: 100g, 150g, 200g.
- 5 meals/day price points per grams option.
- 45 nested price points total.

Diagnostics:

- `npm run diagnose:subscription-menu` explains why `GET /api/subscriptions/menu` returns or omits plans/add-ons.
- `npm run catalog:check` audits subscription integrity and catalog health.

## 13. Tests and Validation Commands

Fast/default:

```bash
npm test
```

Subscription-specific:

```bash
npm run test:subscriptions
NODE_ENV=test node tests/mealPlannerCanonicalContract.test.js
NODE_ENV=test node tests/mealPlannerCanonicalV3Write.test.js
NODE_ENV=test node tests/mealPlannerPaymentContract.test.js
NODE_ENV=test node tests/subscription_addon_selection_contract.test.js
NODE_ENV=test node tests/subscription_addon_selection_readback.integration.test.js
```

Catalog/dashboard/menu:

```bash
npm run test:builder-catalog-v2-contract
npm run test:weekly-menu-dashboard
npm run test:one-time-menu
NODE_ENV=test node tests/dashboardMenuProductCenteredContract.test.js
NODE_ENV=test node tests/mobileApiContracts.test.js
```

Seeds/bootstrap:

```bash
npm run test:subscription-plan-seed
NODE_ENV=test node tests/bootstrapOrchestrator.test.js
NODE_ENV=test node tests/seedCatalogCanonicalV3Contract.test.js
```

Full validation:

```bash
npm run validate:backend
npm run test:all
```

## 14. Implementation File Map

Core client routes:

- `src/routes/subscriptions.js`
- `src/controllers/subscriptionController.js`
- `src/controllers/menuController.js`

Planner services:

- `src/services/subscription/subscriptionSelectionService.js`
- `src/services/subscription/subscriptionSelectionClientService.js`
- `src/services/subscription/mealSlotPlannerService.js`
- `src/services/subscription/canonicalMealSlotPlannerService.js`
- `src/services/subscription/subscriptionDayPlanningService.js`
- `src/services/subscription/subscriptionDayCommercialStateService.js`
- `src/services/subscription/mealPlannerCatalogService.js`

Catalog services:

- `src/services/catalog/CatalogService.js`
- `src/services/catalog/premiumLargeSaladPricingService.js`
- `src/services/catalog/catalogAvailabilityService.js`
- `src/services/orders/menuCatalogService.js`

Models:

- `src/models/Subscription.js`
- `src/models/SubscriptionDay.js`
- `src/models/Plan.js`
- `src/models/Addon.js`
- `src/models/MenuProduct.js`
- `src/models/MenuOption.js`
- `src/models/MenuOptionGroup.js`
- `src/models/ProductOptionGroup.js`
- `src/models/ProductGroupOption.js`
- legacy: `BuilderProtein`, `BuilderCarb`, `SaladIngredient`, `Meal`, `MealCategory`, `Sandwich`

Dashboard/admin routes:

- `src/routes/dashboardMenu.js`
- `src/routes/dashboardSubscriptions.js`
- `src/routes/admin.js`
- `src/routes/adminMealPlannerMenu.routes.js`

Config:

- `src/config/mealPlannerContract.js`
- `src/utils/subscription/mealTypeMapper.js`

## 15. Known Integration Stance

- New Flutter planner work should target `plannerCatalog` + v3 `mealSlots`.
- Keep `builderCatalog` and `builderCatalogV2` support only for compatibility screens.
- Do not invent new endpoints for premium/add-ons; use day selection plus unified day payment.
- Dashboard catalog changes must be published before Flutter can use them.
- When in doubt, trust day read `paymentRequirement` and `plannerMeta` over local client estimates.
=======
# Subscription Menu / Meal Planner Backend README

Status: READY FOR DASHBOARD/FLUTTER CONTRACT REVIEW

This document is the backend reference for the subscription menu and meal planner contract. It is not a production-launch certificate; production readiness still depends on deployment environment, secrets rotation, and real payment-provider staging verification.

## Scope

- Subscription planner catalog read: `GET /api/subscriptions/meal-planner-menu`
- Daily add-on choices read: `GET /api/subscriptions/addon-choices`
- Day read/save/validate/confirm under `GET|PUT|POST /api/subscriptions/:id/days/:date/...`
- Unified day payment:
  - `POST /api/subscriptions/:id/days/:date/payments`
  - `POST /api/subscriptions/:id/days/:date/payments/:paymentId/verify`
- Dashboard readiness check: `GET /api/dashboard/health/meal-planner`

## Route Alias Policy

Keep current public routes and aliases. Do not remove legacy subscription day routes or dashboard menu aliases while Flutter/Dashboard contracts are being reviewed.

Canonical Dashboard readiness route:

```http
GET /api/dashboard/health/meal-planner
```

Canonical Flutter planner catalog routes:

```http
GET /api/subscriptions/meal-planner-menu
GET /api/subscriptions/addon-choices
```

## Addon vs Daily Extras

- `addon-choices` are daily add-ons backed by active, visible, available, published `MenuProduct` rows in mapped menu categories.
- Planner day payment uses `ADDON_PAYMENT_REQUIRED` for unpaid daily add-ons.
- Do not use `ONE_TIME_ADDON_PAYMENT_REQUIRED` for the day planner payment CTA. That legacy wording can still exist in older one-time add-on paths, but it is not the v3 planner CTA contract.

## Premium Large Salad v3

The backend enforces the subscription premium large salad protein allowlist even when Dashboard relations expose extra options.

Required behavior:

- Allowed subscription salad proteins are accepted.
- Disallowed regular proteins are rejected even if a `ProductGroupOption` relation exists.
- Premium proteins outside the salad allowlist are rejected.
- `extra_protein_50g` is rejected for subscription premium large salad.
- Legacy premium large salad validation is not weakened.

Stable rejection codes:

- `SALAD_PROTEIN_NOT_ALLOWED`
- `PLANNER_OPTION_GROUP_UNAVAILABLE` for `extra_protein_50g`

## Unified Day Payment Response

Create and verify responses consistently expose safe contract fields:

```json
{
  "paymentId": "payment object id",
  "payment_id": "payment object id",
  "status": "initiated|paid|...",
  "requiresPayment": true,
  "premiumAmountHalala": 3000,
  "addonsAmountHalala": 1000,
  "totalHalala": 4000,
  "plannerRevisionHash": "sha256",
  "paymentUrl": "https://provider-checkout",
  "payment_url": "https://provider-checkout"
}
```

Additional day/payment state fields already returned by the backend remain available, including `paymentRequirement`, `commercialState`, `premiumSummary`, `premiumExtraPayment`, `addonSelections`, `providerInvoice`, and `payment`.

Important variants covered by tests:

- premium-only amount
- add-on-only amount
- combined premium plus add-on amount
- no-payment-required state
- reusable initiated payment
- revision hash mismatch with `DAY_PAYMENT_REVISION_MISMATCH`
- provider/config failure without secret values in response fields

## Dashboard Readiness Endpoint

`GET /api/dashboard/health/meal-planner` returns:

```json
{
  "status": "ok|warning|error",
  "ready": true,
  "errors": [],
  "warnings": [],
  "checks": [],
  "summary": {}
}
```

It validates required planner products, keys, option groups, product-group relations, product-option relations, active/visible/available/published state, linked `CatalogItem` availability, premium large salad allowlist safety, `extra_protein_50g` exclusion, daily add-on mapped products, and standard/premium protein exposure warnings.

## Stale Catalog Refresh Matrix

Flutter should refresh the planner catalog and retry when it receives stale catalog errors with the refresh hint.

Stable backend codes include:

- `PLANNER_PRODUCT_NOT_FOUND`
- `PLANNER_PRODUCT_INACTIVE`
- `PLANNER_PRODUCT_UNPUBLISHED`
- `PLANNER_PRODUCT_UNAVAILABLE`
- `PLANNER_OPTION_GROUP_NOT_FOUND`
- `PLANNER_OPTION_GROUP_UNAVAILABLE`
- `PLANNER_OPTION_GROUP_RELATION_NOT_FOUND`
- `PLANNER_OPTION_GROUP_RELATION_UNAVAILABLE`
- `PLANNER_OPTION_NOT_FOUND`
- `PLANNER_OPTION_UNAVAILABLE`
- `PLANNER_PRODUCT_OPTION_RELATION_NOT_FOUND`
- `PLANNER_PRODUCT_OPTION_RELATION_UNAVAILABLE`
- `PLANNER_MIXED_LEGACY_CANONICAL_SLOT`
- `LEGACY_DAY_SELECTION_UNSUPPORTED`
- `DAY_PAYMENT_REVISION_MISMATCH`

## E2E Validation

The backend now has a focused dashboard-to-Flutter integration test covering Dashboard readiness, Flutter menu reads, daily add-on reads, pure v3 save, unified payment create, payment verify, confirmation, and final day read.

Needs backend contract hardening: none currently blocking Dashboard/Flutter contract review. Production checks remain separate.
>>>>>>> f664f6cc (docs: addnig new md ref for SUBSCRIPTION_MENU_SYSTEM_SOURCE_OF_TRUTH)
