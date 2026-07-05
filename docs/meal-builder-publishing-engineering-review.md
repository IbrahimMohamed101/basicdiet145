# Meal Builder Publishing — Engineering Review

## A. Scope

Full engineering review and hardening pass for the Meal Builder publishing flow, covering the `MEAL_BUILDER_PRODUCT_UNPUBLISHED` error and the broader product classification contract for subscription meal slots.

---

## B. Root Causes Identified

### B1. `publishedAt: null` on Dashboard-Created Products

**File**: `src/services/orders/menuCatalogAdminService.js`

The `truthy()` function in `mealBuilderConfigService.js` requires `publishedAt` to be set as the customer-visibility gate. Dashboard-created products and categories that were initialized with `isActive: true` but `publishedAt: null` were treated as unpublished by the system.

**Fix**: Set `publishedAt = new Date()` when `isActive: true` on creation in the admin service. This is domain-correct: if an admin creates an entity as active on the dashboard, they intend it to be immediately customer-visible.

```
Domain rule: publishedAt IS the customer-visibility gate.
isActive=true + publishedAt=null = internally active, NOT customer-visible.
isActive=true + publishedAt=<date> = active AND customer-visible.
```

### B2. Over-Broad Zero-Option-Group Inference

**File**: `src/services/subscription/mealBuilderConfigService.js` — `buildProductItem()`

The inference:

```js
const effectivelyStandalone = isStandaloneMeal || (optionGroups.length === 0 && !isPremiumSalad);
```

Would silently treat **any** product in **any** section with zero visible option groups as a "full meal" (`treatAsFullMeal=true, requiresBuilder=false`). This includes:

- A `standard_meal` product with misconfigured or missing option groups → should remain `requiresBuilder=true` (broken state, not silently fixed)
- A `standard_meal` product whose option groups are temporarily filtered out due to data issues

**Fix**: Removed the zero-option-group fallback. `effectivelyStandalone` is now driven exclusively by `selectionType`:

```js
// Standalone = only sandwich or full_meal_product selectionType
const effectivelyStandalone = isStandaloneMeal;
// where isStandaloneMeal = (selectionType === SANDWICH || selectionType === FULL_MEAL_PRODUCT)
```

**Engineering principle enforced**: "Explicit beats implicit. If a product isn't explicitly classified as full_meal_product or sandwich, it must go through the builder, regardless of how many option groups it has."

### B3. `resolveDocsForSections` Missing Option-Less Groups

**File**: `src/services/subscription/mealBuilderConfigService.js` — `resolveDocsForSections()`

The function built `groupsById` only from:
1. `section.sourceGroupId` IDs (section-explicit references)
2. Group IDs from `ProductGroupOption` rows (option-level relations)

Groups linked to a product via `ProductOptionGroup` (product-group relation) but with **zero `ProductGroupOption` entries** were absent from `groupsById`. This caused false `MEAL_BUILDER_PREMIUM_LARGE_SALAD_INVALID_GROUP` validation errors for groups that exist and are linked but have no options yet assigned.

**Fix**: Also merge group IDs from `groupRelations` (ProductOptionGroup) into the set before loading `MenuOptionGroup` documents.

```diff
+ const productGroupRelGroupIds = groupRelations.map((row) => String(row.groupId));
+ const allRelationGroupIds = [...new Set([...relationGroupIdsFromRows, ...productGroupRelGroupIds])];
  MenuOptionGroup.find({ _id: { $in: allRelationGroupIds } }).lean()
```

---

## C. Domain Model Confirmation

| Field | Meaning |
|---|---|
| `isActive` | Entity is administratively enabled |
| `publishedAt` | Customer-visibility gate (checked by `truthy()` and `activeIssue()`) |
| `isVisible` | Section/item is shown in customer-facing lists |
| `isAvailable` | Item is fulfillable |
| `availableFor` includes `"subscription"` | Item is subscription-enabled |

`isActive=true` + `publishedAt=null` = internally active, **not** customer-visible.  
`isActive=true` + `publishedAt=<timestamp>` = active AND customer-visible.

The existing `truthy()` gating is correct. The `publishedAt` auto-set on creation is domain-correct.

---

## D. Classification Contract

| Section selectionType | Product contract |
|---|---|
| `standard_meal` | `requiresBuilder=true`, `treatAsFullMeal=undefined` |
| `premium_meal` | `requiresBuilder=true`, `treatAsFullMeal=undefined` |
| `sandwich` | `requiresBuilder=false`, `treatAsFullMeal=true`, `action.type="direct_add"` |
| `full_meal_product` | `requiresBuilder=false`, `treatAsFullMeal=true`, `action.type="direct_add"` |
| `premium_large_salad` | `requiresBuilder=true`, `treatAsFullMeal=undefined` |

**Zero option groups alone does NOT make a product a full meal.**

---

## E. Changes Made

### 1. `src/services/subscription/mealBuilderConfigService.js`

- **`resolveDocsForSections()`**: Added `productGroupRelGroupIds` from `groupRelations` to ensure option-less groups appear in `groupsById`.
- **`buildProductItem()`**: Narrowed `effectivelyStandalone` to `isStandaloneMeal` only. Removed global zero-option-group fallback.

### 2. `src/services/orders/menuCatalogAdminService.js`

- Added inline domain-model comments at each `if (payload.isActive) { publishedAt = new Date(); }` block explaining the intentional design decision.

### 3. `scripts/repairMealBuilderProducts.js`

Complete rewrite:
- Dry-run by default (no DB writes without `--apply`)
- `--apply` flag to enable mutations
- `--all-active` flag to extend scope from MealBuilderConfig-referenced products to all active products (explicit opt-in)
- `--allow-ambiguous` flag to suppress exit-non-zero for ambiguous sections
- Targeted scope: only products/categories in current MealBuilderConfig configs
- Summary output: `scannedProducts`, `scannedCategories`, `publishBackfillCandidates`, `sectionConversionCandidates`, `ambiguousProducts`, `appliedChanges`, `skippedChanges`
- Never prints MongoDB URI or credentials

### 4. `tests/dashboardMealBuilderDefaultTemplate.test.js`

- Fixed seed: `premium_large_salad` now has all `allowedOptionKeys` proteins assigned as `ProductGroupOption` entries (matching production behavior)
- Fixed: `leafy_greens` and `vegetables_legumes` `ProductOptionGroup` entries are now correctly present and loaded
- Corrected two incorrect assertions that assumed `builderCatalogV2` would be absent in the response (it is always generated by the catalog service)

### 5. `tests/mealPlannerFullMealProductContract.test.js`

Expanded with Test 2:
- `standard_meal` section + zero option groups → must NOT set `treatAsFullMeal=true` (anti-regression for the over-broad inference fix)
- `full_meal_product` section + zero option groups → `treatAsFullMeal=true, requiresBuilder=false` ✓

---

## F. Validation Results

```
node tests/dashboardMealBuilderDefaultTemplate.test.js  → PASS ✅
node tests/mealPlannerFullMealProductContract.test.js   → PASS ✅ (2 tests)
npm test                                                → PASS ✅ (64 tests)
```

---

## G. Engineering Risks (Resolved)

| Risk | Status | Resolution |
|---|---|---|
| Zero-option-group inference masks broken builder products | ✅ Resolved | Removed from `buildProductItem` |
| Repair script mutates live data without dry-run | ✅ Resolved | Full rewrite with `--apply` gate |
| Option-less groups invisible to validation | ✅ Resolved | `resolveDocsForSections` fix |
| MongoDB credentials in logs | ⚠️ Ongoing | Repair script now safe; rotate DB credentials in Railway |

---

## H. Remaining Recommendations

1. **Rotate MongoDB credentials** — Previous session identified credentials in logs. This must be done in Railway environment settings before next production incident.

2. **Add `MEAL_BUILDER_PRODUCT_MISSING_OPTION_GROUPS` diagnostic** — Consider adding a validation warning (not error) for `standard_meal` products with zero option groups. Currently they fail silently as broken builder products. A warning code would make the builder dashboard readiness report more actionable.

3. **Production repair script run**:
   ```bash
   # Dry-run first
   node scripts/repairMealBuilderProducts.js
   # If no ambiguous products, apply
   node scripts/repairMealBuilderProducts.js --apply
   ```
