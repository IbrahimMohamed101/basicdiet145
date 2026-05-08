# One-Time Order Dashboard Ops Flow

## Scope

This is the official dashboard and operations reference for pickup-only One-Time Orders after the dynamic Menu Catalog launch.

The document has two parts:

- A) Operations lifecycle for paid pickup orders.
- B) Dashboard Menu Management for the dynamic one-time menu.

One-Time Orders are separate from subscriptions. Do not use subscription endpoints, `SubscriptionDay`, `mealSlots`, `remainingMeals`, skip/freeze, courier dispatch, delivery address, delivery zone, delivery window, or notify-arrival controls for this launch.

All prices are Halala, VAT is included, and dashboard must not calculate final totals or add VAT.

## A) Operations Lifecycle

Normal pickup ops lifecycle:

```text
confirmed -> in_preparation -> ready_for_pickup -> fulfilled
```

Final states:

- `fulfilled`
- `cancelled`
- `expired`

`pending_payment` is non-operational. Do not prepare an order before `paymentStatus = "paid"`.

Supported actions:

- `prepare`
- `ready_for_pickup`
- `fulfill`
- `cancel`

Unsupported for pickup-only One-Time Orders:

- `dispatch`
- `notify_arrival`
- courier assignment
- courier fulfillment
- delivery address/zone/window edits

Always use `allowedActions` returned by the backend. The dashboard UI may hide buttons by role, but backend authorization and transition validation remain authoritative.

## Dashboard Order List

Endpoint:

```http
GET /api/dashboard/orders
```

Query params supported by `src/controllers/dashboard/orderDashboardController.js` and `src/services/orders/orderDashboardService.js`:

| Param | Purpose |
| --- | --- |
| `status` | Comma-separated normalized order statuses. |
| `paymentStatus` | Payment filter, usually `paid` for operations. |
| `fulfillmentMethod` | Use `pickup` for this launch. |
| `date` | Exact `fulfillmentDate`. |
| `from` | Created-at start datetime. |
| `to` | Created-at end datetime. |
| `zoneId` | Legacy delivery filter; not used for pickup launch. |
| `q` | Search by order/customer text or ObjectId. |
| `page` | Page number. |
| `limit` | Page size, capped by backend. |

Pickup example:

```http
GET /api/dashboard/orders?fulfillmentMethod=pickup&paymentStatus=paid&page=1&limit=20
```

Response shape:

```json
{
  "status": true,
  "data": {
    "items": [
      {
        "source": "one_time_order",
        "entityType": "order",
        "entityId": "663000000000000000001001",
        "orderId": "663000000000000000001001",
        "orderNumber": "ORD-ABC12345",
        "status": "confirmed",
        "paymentStatus": "paid",
        "fulfillmentMethod": "pickup",
        "customer": { "id": "...", "name": "Customer", "phone": "+966..." },
        "pricing": { "totalHalala": 7400, "currency": "SAR", "vatIncluded": true },
        "allowedActions": ["prepare", "cancel"]
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "pages": 1
    }
  }
}
```

UI rules:

- Treat rows with `source = "one_time_order"` and `entityType = "order"` as One-Time Orders.
- Do not assume `entityType = "subscription_day"`.
- Hide subscription-day controls and fields.
- Hide delivery/courier fields.
- Treat `pending_payment` as non-operational.

## Dashboard Order Detail

Endpoint:

```http
GET /api/dashboard/orders/:orderId
```

Detail adds:

- `items`
- `payment`
- `pickup`
- `activity`
- `updatedAt`

For pickup orders, `delivery` is `{}` and `pickup` contains branch/window/code fields when present.

## Actions

### Prepare

Endpoint:

```http
POST /api/dashboard/orders/:orderId/actions/prepare
```

Allowed from:

- `confirmed`

Result:

- `in_preparation`

Body:

```json
{
  "reason": "Kitchen started preparing the one-time pickup order",
  "notes": "Optional note"
}
```

### Ready for Pickup

Endpoint:

```http
POST /api/dashboard/orders/:orderId/actions/ready_for_pickup
```

Allowed from:

- `in_preparation`

Result:

- `ready_for_pickup`

Body:

```json
{
  "reason": "Order is ready for pickup",
  "pickupCode": "123456",
  "notes": "Optional"
}
```

If `pickupCode` is omitted, `src/services/orders/orderOpsTransitionService.js` generates a six-digit code when needed.

### Fulfill

Endpoint:

```http
POST /api/dashboard/orders/:orderId/actions/fulfill
```

Allowed from:

- `ready_for_pickup`

Result:

- `fulfilled`

Body:

```json
{
  "reason": "Customer picked up the order from branch",
  "pickupCode": "123456",
  "notes": "Optional"
}
```

### Cancel

Endpoint:

```http
POST /api/dashboard/orders/:orderId/actions/cancel
```

Allowed from paid operational states when backend `allowedActions` includes `cancel`:

- `confirmed`
- `in_preparation`
- `ready_for_pickup`

Result:

- `cancelled`

Body:

```json
{
  "reason": "Customer requested cancellation",
  "notes": "Optional"
}
```

Cancel does not mean refund. Do not trigger provider refund behavior unless a dedicated backend refund API is added later.

## Kitchen and Pickup Queues

Endpoints mounted by `src/routes/dashboardBoards.js`:

```http
GET /api/dashboard/kitchen/queue
GET /api/dashboard/pickup/queue
POST /api/dashboard/kitchen/actions/:action
POST /api/dashboard/pickup/actions/:action
```

Queue filters include `date`, `status`, `method`, `q`, `branchId`, and `zoneId`. For One-Time Orders in this launch, use pickup filtering.

One-time order rows are included when the board query finds paid orders for the selected `fulfillmentDate`. Use `source`/`entityType` and `allowedActions` to route actions correctly.

## Unified Ops Action Endpoint

Endpoint:

```http
POST /api/dashboard/ops/actions/:action
```

Body for One-Time Orders:

```json
{
  "source": "one_time_order",
  "entityType": "order",
  "entityId": "663000000000000000001001",
  "payload": {
    "reason": "Kitchen started preparing order",
    "notes": "Optional"
  }
}
```

Action examples:

```http
POST /api/dashboard/ops/actions/prepare
POST /api/dashboard/ops/actions/ready_for_pickup
POST /api/dashboard/ops/actions/fulfill
POST /api/dashboard/ops/actions/cancel
```

Do not send subscription day identifiers for One-Time Orders.

## Operations Error Handling

| Error code | Meaning | Dashboard behavior |
| --- | --- | --- |
| `INVALID_TRANSITION` | Action is not allowed from current state. | Refresh row/detail and use returned state. |
| `ORDER_NOT_FOUND` | Order does not exist or is not visible. | Remove stale row or show not found. |
| `FORBIDDEN` | Staff role cannot perform action. | Hide/disable action and show permission message. |
| `REOPEN_NOT_SUPPORTED` | Final orders cannot be reopened. | Keep final state. |
| `PAYMENT_NOT_PAID` | Operational action requires paid payment. | Keep as non-operational. |
| `FINAL_STATUS` / `ORDER_FINAL` | Order is already terminal. | Move to history/reporting. |
| `INVALID_ORDER_ID` / `INVALID_OBJECT_ID` | ID is malformed. | Treat as stale route or implementation bug. |
| `DELIVERY_NOT_SUPPORTED` | Delivery order/action blocked by launch gate. | Remove from pickup-only UI. |

## B) Dashboard Menu Management

The dashboard controls the dynamic one-time customer menu through:

```http
/api/dashboard/menu/*
```

Routes are defined in `src/routes/dashboardMenu.js` and require dashboard auth with `admin` or `superadmin`.

Managed resources:

- categories
- products
- option groups
- options
- product group relations
- product group option relations
- publish
- audit logs

The customer app reads only active, visible, available, published catalog data through `GET /api/orders/menu`.
For now unavailable entities are hidden from the customer response instead of returned disabled, because frontend disabled-state support is not part of this backend change.

State fields:

- `isActive=false`: deprecated/disabled; do not show in normal customer menus.
- `isVisible=false`: hidden from customers but still manageable in dashboard.
- `isAvailable=false`: sold out/unavailable; hidden from customers and rejected by quote/create-order.

Dashboard list endpoints default to active rows, but admins can use `includeInactive=true`, `isActive`, `isVisible`, `isAvailable`, `published`, and `q` filters to find hidden, unavailable, unpublished, or inactive catalog data.

## Menu Management Endpoints

### Categories

```http
GET /api/dashboard/menu/categories
POST /api/dashboard/menu/categories
GET /api/dashboard/menu/categories/:id
PATCH /api/dashboard/menu/categories/:id
PATCH /api/dashboard/menu/categories/:id/visibility
PATCH /api/dashboard/menu/categories/:id/availability
DELETE /api/dashboard/menu/categories/:id
PATCH /api/dashboard/menu/categories/reorder
```

### Products

```http
GET /api/dashboard/menu/products
POST /api/dashboard/menu/products
GET /api/dashboard/menu/products/:id
PATCH /api/dashboard/menu/products/:id
PATCH /api/dashboard/menu/products/:id/visibility
DELETE /api/dashboard/menu/products/:id
PATCH /api/dashboard/menu/products/reorder
PATCH /api/dashboard/menu/products/:productId/availability
```

`PATCH /api/dashboard/menu/products/:productId/availability` is the canonical product availability route. It updates sold-out state when sent `{ "isAvailable": false }`, and preserves the legacy branch-availability behavior when sent `branchAvailability` or `branchIds`.

### Option Groups

```http
GET /api/dashboard/menu/option-groups
POST /api/dashboard/menu/option-groups
PATCH /api/dashboard/menu/option-groups/reorder
GET /api/dashboard/menu/option-groups/:id
PATCH /api/dashboard/menu/option-groups/:id
PATCH /api/dashboard/menu/option-groups/:id/visibility
PATCH /api/dashboard/menu/option-groups/:id/availability
GET /api/dashboard/menu/option-groups/:groupId/options
POST /api/dashboard/menu/option-groups/:groupId/options
DELETE /api/dashboard/menu/option-groups/:id
```

### Options

```http
GET /api/dashboard/menu/options
POST /api/dashboard/menu/options
PATCH /api/dashboard/menu/options/reorder
GET /api/dashboard/menu/options/:id
PATCH /api/dashboard/menu/options/:id
PATCH /api/dashboard/menu/options/:id/visibility
PATCH /api/dashboard/menu/options/:id/availability
DELETE /api/dashboard/menu/options/:id
```

`GET /api/dashboard/menu/options` supports `groupId` filtering.

### Product Relations

Actual relation endpoints in code:

```http
GET /api/dashboard/menu/products/:productId/option-groups
POST /api/dashboard/menu/products/:productId/option-groups
PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId
PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/selection-rules
PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/visibility
PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/availability
GET /api/dashboard/menu/products/:productId/option-groups/:groupId/options
POST /api/dashboard/menu/products/:productId/option-groups/:groupId/options
PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId
PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId/visibility
PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId/availability
PUT /api/dashboard/menu/products/:productId/groups
PUT /api/dashboard/menu/products/:productId/groups/:groupId/options
```

Use the focused `PATCH` endpoints for normal dashboard edits. Keep the `PUT` endpoints for bulk replace/backward compatibility.

`ProductOptionGroup` is product-specific. This is where Builder selection rules belong, not only on the global `MenuOptionGroup`. The same global `proteins` group can be linked to `basic_salad` and `basic_meal` with different `minSelections`, `maxSelections`, `isRequired`, `sortOrder`, `isVisible`, and `isAvailable`.

`PUT /products/:productId/groups` replaces all `ProductOptionGroup` relations for a product.

Request:

```json
{
  "groups": [
    {
      "groupId": "663000000000000000000201",
      "minSelections": 0,
      "maxSelections": 1,
      "isRequired": false,
      "isActive": true,
      "isVisible": true,
      "isAvailable": true,
      "sortOrder": 10
    }
  ]
}
```

`ProductGroupOption` is product-specific. A global option can stay available everywhere while one product/group relation is sold out. Customer menu includes an option only when both the global `MenuOption` and product-specific `ProductGroupOption` are active, visible, available, and the global option is published.

`PUT /products/:productId/groups/:groupId/options` replaces allowed `ProductGroupOption` rows for that product/group.

Request:

```json
{
  "options": [
    {
      "optionId": "663000000000000000000301",
      "extraPriceHalala": 1600,
      "extraWeightPriceHalala": 1000,
      "isActive": true,
      "isVisible": true,
      "isAvailable": true,
      "sortOrder": 10
    }
  ]
}
```

Note: `extraWeightUnitGrams` belongs to `MenuOption`; product-option relation overrides only `extraPriceHalala`, `extraWeightPriceHalala`, `isActive`, `isVisible`, `isAvailable`, and `sortOrder`.

Selection rule validation:

- `minSelections` must be `>= 0`.
- `maxSelections` must be `null` or `>= minSelections`.
- If `isRequired=true`, `minSelections` must be `> 0`.
- Prefer numeric `maxSelections` for mobile compatibility.

### Publish and Audit

```http
POST /api/dashboard/menu/publish
GET /api/dashboard/menu/audit-logs
```

Publish archives existing published `MenuVersion` rows, creates a new published version with a snapshot, stamps active categories/products/groups/options with `publishedAt`, and assigns the new `versionId` to active products.

## Dashboard Menu Concepts

### MenuCategory

Model: `src/models/MenuCategory.js`

Fields:

- `key`
- `name.ar`, `name.en`
- `description.ar`, `description.en`
- `imageUrl`
- `sortOrder`
- `isActive`
- `isVisible`
- `isAvailable`
- `availability.branchIds`
- `publishedAt`

### MenuProduct

Model: `src/models/MenuProduct.js`

Fields:

- `categoryId`
- `key`
- `name.ar`, `name.en`
- `description.ar`, `description.en`
- `itemType`
- `pricingModel`: `fixed` or `per_100g`
- `priceHalala`
- `baseUnitGrams`
- `defaultWeightGrams`
- `minWeightGrams`
- `maxWeightGrams`
- `weightStepGrams`
- `imageUrl`
- `branchAvailability`
- `sortOrder`
- `isActive`
- `isVisible`
- `isAvailable`
- `versionId`
- `publishedAt`

Current `itemType` enum:

```text
basic_salad, basic_meal, fruit_salad, greek_yogurt, green_salad,
cold_sandwich, sourdough, dessert, juice, drink, ice_cream, product
```

Launch customer category keys:

```text
custom_order, light_options, cold_sandwiches, sourdough,
juices, desserts, drinks, ice_cream
```

The mobile frontend URL section `custom-order` maps to backend category key `custom_order`.
The seeded configurable products `basic_salad`, `basic_meal`, `fruit_salad`, and `greek_yogurt` live under `custom_order`.
`light_options` is available as a catalog category for future/internal use; current configurable launch products live under `custom_order`, and customer responses may omit `light_options` when it has no active visible available products.

Customer menu product responses include optional derived helpers:

- `requiresBuilder`: `true` when the product has any option groups or `pricingModel = "per_100g"`.
- `canAddDirectly`: `true` only for fixed-price products with zero option groups.

### MenuOptionGroup

Model: `src/models/MenuOptionGroup.js`

Fields:

- `key`
- `name.ar`, `name.en`
- `description.ar`, `description.en`
- `sortOrder`
- `isActive`
- `isVisible`
- `isAvailable`
- `publishedAt`

Launch Builder group keys:

```text
leafy_greens, vegetables_legumes, fruits, proteins,
cheese_nuts, sauces, carbs, nuts
```

### MenuOption

Model: `src/models/MenuOption.js`

Fields:

- `groupId`
- `key`
- `name.ar`, `name.en`
- `description.ar`, `description.en`
- `imageUrl`
- `extraPriceHalala`
- `extraWeightUnitGrams`
- `extraWeightPriceHalala`
- `currency`
- `sortOrder`
- `isActive`
- `isVisible`
- `isAvailable`
- `publishedAt`

### ProductOptionGroup

Model: `src/models/ProductOptionGroup.js`

Fields:

- `productId`
- `groupId`
- `minSelections`
- `maxSelections`
- `isRequired`
- `isActive`
- `isVisible`
- `isAvailable`
- `sortOrder`

### ProductGroupOption

Model: `src/models/ProductGroupOption.js`

Fields:

- `productId`
- `groupId`
- `optionId`
- overrides:
  - `extraPriceHalala`
  - `extraWeightPriceHalala`
  - `isActive`
  - `isVisible`
  - `isAvailable`
  - `sortOrder`

If a relation override is `null`, customer pricing falls back to the base `MenuOption` value.

## Soft Delete

Dashboard delete endpoints perform soft delete:

```text
isActive = false
```

Do not hard delete menu entities. Old orders store snapshots (`productSnapshot`, `selectedOptions`, `pricingSnapshot`, `menuVersionId`) and must remain readable even after products/options are hidden.

## Hide / Show and Sold Out Operations

Use visibility when admins want to hide something without marking it sold out:

```http
PATCH /api/dashboard/menu/products/:id/visibility
PATCH /api/dashboard/menu/options/:id/visibility
```

Body:

```json
{ "isVisible": false }
```

Use availability when an item is sold out:

```http
PATCH /api/dashboard/menu/products/:id/availability
PATCH /api/dashboard/menu/options/:id/availability
PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId/availability
```

Body:

```json
{ "isAvailable": false }
```

Global option unavailable means unavailable everywhere. Product-group-option unavailable means unavailable only for that product/group relation.

## Quote and Create-Order Protection

Do not rely only on `GET /api/orders/menu` filtering. Quote and create-order re-read the current database catalog and reject stale customer payloads.

Stable customer/catalog error codes:

| Code | Meaning |
| --- | --- |
| `PRODUCT_NOT_AVAILABLE` | Product or category is inactive, hidden, unavailable, unpublished, or branch-unavailable. |
| `OPTION_GROUP_NOT_AVAILABLE` | Selected product/group relation or global group is inactive, hidden, unavailable, or unpublished. |
| `OPTION_NOT_AVAILABLE` | Selected option relation or global option is inactive, hidden, unavailable, or unpublished. |
| `OPTION_NOT_ALLOWED` | The selected group/option is not linked to that product. |
| `MIN_SELECTIONS_NOT_MET` | Current relation-specific `minSelections` is not satisfied. |
| `MAX_SELECTIONS_EXCEEDED` | Current relation-specific `maxSelections` is exceeded. |

Client-sent prices are ignored. Pricing uses current `MenuProduct`, `MenuOption`, and `ProductGroupOption` values only.

## Publish Rules

- Customer menu reads active, visible, available, published catalog entities.
- Seed creates/publishes the launch menu.
- Dashboard edits update the same catalog rows used by runtime menu reads.
- Publish stamps active rows with `publishedAt`, assigns product `versionId`, archives the previous published `MenuVersion`, and creates a new `MenuVersion` snapshot.
- This launch does not implement full draft isolation with separate draft and published collections.

## Audit Logs

Endpoint:

```http
GET /api/dashboard/menu/audit-logs
```

Actions written by `menuCatalogService`:

- `create`
- `update`
- `visibility_changed`
- `availability_changed`
- `selection_rules_changed`
- `price_changed`
- `relation_updated`
- `soft_delete`
- `reorder`
- `replace` for relation replacement
- `publish`

Audit rows include `entityType`, `entityId`, `action`, `before`, `after`, `actorId`, `actorRole`, `meta`, and timestamps.

## Seed

Command:

```bash
npm run seed:one-time-menu
```

Use this on local or staging.

The launch seed keeps `fruit_salad` and `greek_yogurt` as `pricingModel = "fixed"` configurable products. `greek_yogurt` uses `nuts` with `minSelections = 0` and `maxSelections = 3`.

Seed modes:

```bash
MENU_SEED_MODE=initial npm run seed:one-time-menu
MENU_SEED_MODE=force npm run seed:one-time-menu
npm run seed:one-time-menu
```

- `initial`: seed only when no catalog data exists; skip if dashboard-managed catalog rows already exist.
- `force`: intentionally reseed and overwrite seed-managed launch catalog values.
- default local/dev/test: idempotent development reseed for local and test data.

Do not silently run reseed over production dashboard-managed catalog data. Use `initial` for first-time setup and `force` only with explicit operational approval.

Production guard:

```bash
NODE_ENV=production
```

refuses to seed unless explicitly overridden:

```bash
MENU_SEED_ALLOW_PRODUCTION=true
```

Only use the production override with clear operational approval.

Recommended dashboard UX:

- Put category/product/group/option `isVisible` and `isAvailable` controls near publish status.
- For sold-out actions, prefer `isAvailable=false` over `isActive=false` so admins can restore quickly.
- Edit Builder rules from the product detail page, because rules are product/group relation-specific.
- Show relation-level option overrides beside global option state so admins can tell whether an option is sold out everywhere or only for one product.
- Display the derived product behavior: Builder opens when `requiresBuilder=true`; direct add is allowed when `canAddDirectly=true`.

## Testing

Commands:

```bash
npm run test:one-time-menu
npm test
```

`npm run test:one-time-menu` uses `mongodb-memory-server` and does not require a local MongoDB instance.

## E2E Staging Checklist

1. Run `npm run seed:one-time-menu` against staging.
2. Request `GET /api/orders/menu`.
3. Quote a fixed product.
4. Quote a `per_100g` product.
5. Quote an option with fixed extra price.
6. Quote an option with `extraWeightGrams`.
7. Create an order with Moyasar test credentials or payment mock.
8. Verify payment and confirm the order moves to `confirmed`.
9. Update a product price from dashboard.
10. Verify old order `productSnapshot`, `selectedOptions`, `pricingSnapshot`, and `menuVersionId` remain unchanged.
11. Hide a product with `isVisible=false`.
12. Mark a product or option sold out with `isAvailable=false`.
13. Verify hidden/sold-out data disappears from `GET /api/orders/menu`.
14. Quote stale hidden/sold-out product/option IDs and verify stable availability errors.
15. Restore product/option and publish again if needed.

## Known Risks / Tech Debt

- Real Moyasar callback and verify behavior still needs staging credentials for end-to-end confidence.
- Long-term cleaner catalog shape would use generic `itemType` plus `productId`/`productKey`; current code persists catalog-specific item types such as `basic_salad`.
- Draft isolation is lightweight: dashboard edits affect the same rows and publish snapshots the current active state. A full draft/published separation would be cleaner later.
- Queue endpoints still share infrastructure with subscription boards, so dashboard UI must branch by `source = "one_time_order"` and `entityType = "order"`.

## Common Mistakes

- Do not use subscription day endpoints for One-Time Orders.
- Do not assume every queue row is a subscription day.
- Do not prepare `pending_payment` orders.
- Do not prepare anything without `paymentStatus = "paid"`.
- Do not ignore `allowedActions`.
- Do not use courier or delivery actions for pickup-only orders.
- Do not show delivery fields.
- Do not trigger refund on cancel unless a dedicated refund endpoint exists.
- Do not hard delete menu entities.
- Do not calculate totals in dashboard.
- Do not add VAT again.
- Do not edit selection rules on the global option group when the rule is product-specific.
- Do not run production force seed without approval.
