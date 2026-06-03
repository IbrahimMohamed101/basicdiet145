# Dashboard Dynamic Menu Integration

## 1. Purpose

This guide is the dashboard implementation contract for the server-driven menu in the backend repository:

```text
/home/hema/Projects/basicdiet145
```

The dashboard edits canonical menu data. Flutter renders the published result. MongoDB identifiers and technical keys identify entities; UI metadata controls presentation; backend quote services remain the price authority.

Production API base URL:

```text
https://basicdiet145.onrender.com
```

This document describes backend code. It does not prove the current production database contents.

## 2. Canonical Data Model

Use these collections as the menu source of truth:

| Concern | Model | Important relationship |
| --- | --- | --- |
| Categories | `MenuCategory` | A category owns products. |
| Products | `MenuProduct` | A product belongs to one category. |
| Reusable option groups | `MenuOptionGroup` | A group may be linked to many products. |
| Reusable options | `MenuOption` | An option belongs to one reusable group. |
| Product-to-group rules | `ProductOptionGroup` | Controls group availability and selection limits for one product. |
| Allowed options and overrides | `ProductGroupOption` | Controls which options are allowed and their product-specific prices. |
| Published snapshots | `MenuVersion` | Stores public and dashboard snapshots for publish and rollback. |

Compatibility collections such as `BuilderProtein`, `BuilderCarb`, `SaladIngredient`, and `Sandwich` are not replacements for the canonical `Menu*` models.

## 3. Authentication And Base Paths

Dashboard menu CRUD is mounted at:

```text
/api/dashboard/menu
```

It requires dashboard authentication and an `admin` or `superadmin` role.

Image upload is mounted at:

```text
POST /api/dashboard/uploads/image
```

The upload route is also available through the legacy alias:

```text
POST /api/admin/uploads/image
```

The upload route currently passes through the `admin` role gate in `src/routes/admin.js`.

## 4. Entity Fields

### Categories

| Field | Notes |
| --- | --- |
| `key` | Immutable technical identity. Omit on create and let the backend generate it. |
| `name`, `description` | Localized objects: `{ "ar": "...", "en": "..." }`. |
| `imageUrl` | Customer-facing image URL. Preserve the current value unless the admin intentionally changes it. |
| `sortOrder` | Non-negative integer. |
| `isActive`, `isVisible`, `isAvailable` | Public catalog gates. |
| `availability.branchIds` | Empty array means unrestricted. |
| `ui.cardVariant` | `meal_builder`, `light_collection`, `sandwich_collection`, or `addon_collection`. |

### Products

| Field | Notes |
| --- | --- |
| `key` | Immutable technical identity. Omit on create. |
| `categoryId` | Active `MenuCategory` ObjectId. |
| `itemType` | One of the backend-supported product behavior values. |
| `pricingModel` | `fixed` or `per_100g`. |
| `priceHalala` | Integer price in halala. Example: `1900` means 19 SAR. |
| `baseUnitGrams` | Pricing unit for `per_100g`. |
| `defaultWeightGrams`, `minWeightGrams`, `maxWeightGrams`, `weightStepGrams` | Weight controls. A zero min/max means no configured bound. |
| `availableFor` | `one_time`, `subscription`, or both. |
| `branchAvailability` | Empty array means unrestricted. |
| `ui.cardVariant` | `standard`, `premium`, `large_salad`, or `addon`. |
| `ui.badge`, `ui.ctaLabel`, `ui.imageRatio` | Display metadata. |

### Option Groups

| Field | Notes |
| --- | --- |
| `key` | Immutable technical identity. Omit on create. |
| `name`, `description` | Localized content. |
| `sortOrder` | Default order. A product relation may override it. |
| `ui.displayStyle` | `chips`, `radio_cards`, `checkbox_grid`, `dropdown`, or `stepper`. |

### Options

| Field | Notes |
| --- | --- |
| `groupId` | Parent `MenuOptionGroup` ObjectId. |
| `key` | Immutable inside its group. Omit on create. |
| `name`, `description`, `imageUrl` | Localized content and image. |
| `extraPriceHalala` | Global fallback surcharge. |
| `extraFeeHalala` | Planner compatibility fee. The backend keeps it aligned with `extraPriceHalala` when only one is sent. |
| `extraWeightUnitGrams`, `extraWeightPriceHalala` | Optional extra-weight pricing. |
| `availableFor`, `availableForSubscription` | Channel gates. |
| `proteinFamilyKey`, `displayCategoryKey`, `premiumKey`, `ruleTags`, `selectionType` | Advanced planner metadata. |

### Protein Visual Grouping Metadata

Dashboard can continue managing proteins as normal options in the single `proteins` option group. Backend seed definitions and serializers assign `proteinFamilyKey` metadata so Flutter can visually section the group into `chicken`, `beef`, `fish`, and `eggs`.

Admins should not create separate real groups such as `chicken_proteins`, `beef_proteins`, `fish_proteins`, or `eggs_proteins`. This grouping is display metadata only; selection limits, required status, product/group relations, allowed-option relations, quote pricing, and product-specific surcharges still belong to the original `proteins` group and `ProductGroupOption.extraPriceHalala`.

If dashboard later exposes advanced option metadata, treat `proteinFamilyKey` as read-only or carefully editable because it affects presentation, not pricing logic.

## 5. Key Rules

- Hide `key` on create forms.
- Show `key` read-only on edit forms.
- Omit `key` from update payloads.
- The backend generates a readable ASCII `snake_case` key from the name where possible.
- Arabic-only names receive a generated fallback key.
- Attempts to change a key return `400 IMMUTABLE_KEY`.

Do not use keys as UI layout switches. Store and edit the explicit `ui` metadata instead.

## 6. CRUD Endpoint Map

### Categories

```text
GET    /api/dashboard/menu/categories
POST   /api/dashboard/menu/categories
GET    /api/dashboard/menu/categories/:id
PATCH  /api/dashboard/menu/categories/:id
PATCH  /api/dashboard/menu/categories/:id/visibility
PATCH  /api/dashboard/menu/categories/:id/availability
PATCH  /api/dashboard/menu/categories/reorder
DELETE /api/dashboard/menu/categories/:id
```

### Products

```text
GET    /api/dashboard/menu/products
POST   /api/dashboard/menu/products
GET    /api/dashboard/menu/products/:id
PATCH  /api/dashboard/menu/products/:id
PATCH  /api/dashboard/menu/products/:id/category
PATCH  /api/dashboard/menu/products/:id/visibility
PATCH  /api/dashboard/menu/products/:productId/availability
PATCH  /api/dashboard/menu/products/reorder
POST   /api/dashboard/menu/products/:id/duplicate
DELETE /api/dashboard/menu/products/:id
```

### Reusable Groups And Options

```text
GET    /api/dashboard/menu/option-groups
POST   /api/dashboard/menu/option-groups
GET    /api/dashboard/menu/option-groups/:id
PATCH  /api/dashboard/menu/option-groups/:id
PATCH  /api/dashboard/menu/option-groups/:id/visibility
PATCH  /api/dashboard/menu/option-groups/:id/availability
PATCH  /api/dashboard/menu/option-groups/reorder
DELETE /api/dashboard/menu/option-groups/:id

GET    /api/dashboard/menu/options
POST   /api/dashboard/menu/options
GET    /api/dashboard/menu/options/:id
PATCH  /api/dashboard/menu/options/:id
PATCH  /api/dashboard/menu/options/:id/visibility
PATCH  /api/dashboard/menu/options/:id/availability
PATCH  /api/dashboard/menu/options/:id/toggle
PATCH  /api/dashboard/menu/options/reorder
DELETE /api/dashboard/menu/options/:id
```

Use `GET /api/dashboard/menu/option-groups/:groupId/options` and `POST /api/dashboard/menu/option-groups/:groupId/options` when editing options in a selected group.

List endpoints support filters such as `includeInactive`, `isActive`, `isVisible`, `isAvailable`, `published`, `q`, `page`, and `limit`.

## 7. Relation Editing

`ProductOptionGroup` links a product to a group. `ProductGroupOption` links an allowed option to that product/group pair.

### Incremental Relation APIs

```text
GET    /api/dashboard/menu/products/:productId/option-groups
POST   /api/dashboard/menu/products/:productId/option-groups
PATCH  /api/dashboard/menu/products/:productId/option-groups/:groupId
PATCH  /api/dashboard/menu/products/:productId/option-groups/:groupId/selection-rules
PATCH  /api/dashboard/menu/products/:productId/option-groups/:groupId/visibility
PATCH  /api/dashboard/menu/products/:productId/option-groups/:groupId/availability
DELETE /api/dashboard/menu/products/:productId/option-groups/:groupId

GET    /api/dashboard/menu/products/:productId/option-groups/:groupId/options
POST   /api/dashboard/menu/products/:productId/option-groups/:groupId/options
PATCH  /api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId
PATCH  /api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId/visibility
PATCH  /api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId/availability
DELETE /api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId
```

Creating a product/group relation automatically creates allowed-option relations for the group's currently active options. Review the resulting list and remove options that the product must not expose.

Resolved: the option-relation `visibility` route is usable. The router declaration and the exported `updateProductGroupOptionVisibility` controller handler are wired together.

### Full Replacement APIs

```text
PUT /api/dashboard/menu/products/:productId/groups
PUT /api/dashboard/menu/products/:productId/groups/:groupId/options
```

These endpoints delete existing relations in scope and recreate the submitted list. Always load the current complete list, edit it locally, and send every relation that must survive.

### Selection Limit Rules

```json
{
  "groupId": "GROUP_OBJECT_ID",
  "minSelections": 0,
  "maxSelections": null,
  "isRequired": false,
  "sortOrder": 10
}
```

- `maxSelections: null` means unlimited.
- `maxSelections: 0` is a real limit and must remain `0`.
- Never use `Number(value) || 1`.
- Parse empty input deliberately as `null` if the UI means unlimited.
- When `isRequired` is `true`, `minSelections` must be greater than zero.
- When `maxSelections` is not `null`, it must be greater than or equal to `minSelections`.

Use relation-specific `ProductGroupOption.extraPriceHalala` when only one product needs a different surcharge. A `null` relation override falls back to `MenuOption.extraPriceHalala`.

## 8. Image Upload

Upload first:

```http
POST /api/dashboard/uploads/image
Content-Type: multipart/form-data
Field: image
```

Accepted image types:

```text
image/jpeg
image/png
image/webp
```

Default maximum size:

```text
5 MiB
```

Store `data.imageUrl` from the response on the category, product, or option:

```json
{
  "success": true,
  "status": true,
  "data": {
    "imageUrl": "https://.../f_auto,q_auto/...",
    "secureUrl": "https://...",
    "publicId": "...",
    "width": 1200,
    "height": 900,
    "format": "webp",
    "bytes": 123456
  }
}
```

Then send the stored URL through the relevant menu entity `PATCH`. Do not clear `imageUrl` merely because the admin did not select a new image.

The upload endpoint accepts an optional `folder`. If it is supplied, it must be one of:

```text
plans
meals
premium-meals
addons
custom-meals
custom-salads
```

Omitting `folder` uses the configured default, currently `basicdiet145/menu`.

## 9. Publish Workflow

Use this order for customer-visible edits:

1. Save entity edits and relations.
2. Call `POST /api/dashboard/menu/validate`.
3. Block publish if validation returns `ok: false`.
4. Call `POST /api/dashboard/menu/publish` with optional `notes`.
5. Verify the read-only public endpoints:

```text
GET /api/orders/menu?lang=ar
GET /api/orders/menu?lang=en
GET /api/subscriptions/meal-planner-menu?includeLegacy=true&lang=ar
```

Publishing stamps active categories, products, groups, and options with `publishedAt`, stores a `MenuVersion`, archives the previous published version, and assigns the new version ID to active products.

Operations endpoints:

```text
POST /api/dashboard/menu/validate
POST /api/dashboard/menu/publish
GET  /api/dashboard/menu/versions
GET  /api/dashboard/menu/diff
GET  /api/dashboard/menu/audit-logs
POST /api/dashboard/menu/rollback/:versionId
```

Rollback is destructive and requires:

```json
{ "confirm": true }
```

Treat rollback as an explicit operator action. It restores stored snapshots and writes new versions.

## 10. Common Workflows

### Add A Fixed Product

1. Choose an existing category.
2. Create a product with `pricingModel: "fixed"`.
3. Omit `key`.
4. Upload and store an image if needed.
5. Validate, publish, and verify the public menu.

### Add A Configurable Product

1. Create the product.
2. Reuse existing option groups when possible.
3. Link groups with selection limits.
4. Restrict each group to the intended options.
5. Store product-specific prices on `ProductGroupOption`.
6. Validate, publish, and verify both menu rendering and quote behavior.

### Add Optional Extra Protein

1. Reuse the `extra_protein_50g` group.
2. Link it with `minSelections: 0`, `maxSelections: 1`, and `isRequired: false`.
3. Keep only intended options.
4. Add product-specific overrides where required.

## Subscription Premium Large Salad Restrictions

Subscription `premium_large_salad` and one-time `basic_salad` are similar but not identical. Dashboard code must not assume every `basic_salad` option is available for subscription `premium_large_salad`.

One-time `basic_salad` may include premium proteins and `extra_protein_50g`. Subscription `premium_large_salad` should exclude premium proteins and `extra_protein_50g`.

Relation-specific one-time prices still belong to `ProductGroupOption.extraPriceHalala`, especially for `basic_salad` premium protein and extra protein choices.

## 11. Dashboard Guardrails

- Do not expose Cloudinary secrets.
- Do not mutate global option prices to solve a product-specific pricing requirement.
- Do not treat `ui` metadata as pricing or eligibility logic.
- Do not run seed, bootstrap, reset, or direct DB-write operations from dashboard integration work.
- Do not call rollback without an explicit operator confirmation.
- Do not use replacement relation endpoints with partial lists.
- Do not assume a created row is public before publish.

## 12. Known Gaps And TODOs

1. Preserve `maxSelections: 0` and provide a deliberate `null` unlimited flow in dashboard relation forms.
2. Decide whether menu image fields must be upload-only. The backend menu CRUD accepts an `imageUrl` value after upload; the product policy should decide whether manual URL entry remains available in the dashboard.
3. Add editing for advanced planner option metadata if operators must manage `premiumKey`, `ruleTags`, `selectionType`, and `extraFeeHalala`.
4. Add a read-only `builderCatalogV2` preview if operators need planner verification before mobile QA.
5. Review explicit catalog sync behavior before operational use. Seed sync can overwrite dashboard-managed `imageUrl` values when seed payloads contain empty strings.

Resolved note: the option-relation visibility endpoint is available. `src/routes/dashboardMenu.js` references `updateProductGroupOptionVisibility`, and `src/controllers/dashboard/menuController.js` exports that handler.

## 13. Backend References

```text
src/routes/dashboardMenu.js
src/routes/admin.js
src/routes/index.js
src/controllers/dashboard/menuController.js
src/controllers/uploadController.js
src/services/orders/menuCatalogService.js
src/services/adminImageService.js
src/services/cloudinaryUploadService.js
src/middleware/imageUpload.js
src/models/MenuCategory.js
src/models/MenuProduct.js
src/models/MenuOptionGroup.js
src/models/MenuOption.js
src/models/ProductOptionGroup.js
src/models/ProductGroupOption.js
src/models/MenuVersion.js
```
