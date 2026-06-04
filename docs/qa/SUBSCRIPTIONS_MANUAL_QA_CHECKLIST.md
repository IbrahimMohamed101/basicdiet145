# Subscriptions Manual QA Checklist

This runbook verifies the subscription system manually before Flutter and Dashboard handoff.

Production API:

```text
https://basicdiet145.onrender.com
```

This file is intentionally written for safe, step-by-step QA. Start read-only. Run optional write tests only after explicit approval from the project owner.

## Verified Against Code

Date: 2026-06-03

Files inspected:

- `src/routes/index.js`
- `src/routes/subscriptions.js`
- `src/routes/plans.js`
- `src/routes/addons.js`
- `src/routes/admin.js`
- `src/routes/dashboardMenu.js`
- `src/routes/dashboardSubscriptions.js`
- `src/controllers/planController.js`
- `src/controllers/subscriptionController.js`
- `src/controllers/adminController.js`
- `src/controllers/addonController.js`
- `src/models/Plan.js`
- `src/models/Addon.js`
- `src/utils/subscription/subscriptionCatalog.js`
- `src/utils/pricing.js`
- `src/services/promoCodeService.js`
- `src/services/subscription/subscriptionQuoteService.js`
- `src/services/catalog/CatalogService.js`
- `src/config/mealPlannerContract.js`
- `src/services/subscription/mealSlotPlannerService.js`
- `src/services/subscription/unifiedDayPaymentService.js`
- `scripts/seed-subscription-plans.js` read only for static plan/add-on comments.
- `tests/mealPlannerPaymentContract.test.js` read only for unified payment response contract examples.

Routes verified:

- Public: `/api/subscriptions/menu`, `/api/subscriptions/meal-planner-menu`, `/api/subscriptions/delivery-options`, `/api/addons`.
- User auth: `/api/plans`, `/api/subscriptions/quote`, `/api/subscriptions/checkout`, `/api/subscriptions/:id/timeline`, `/api/subscriptions/:id/days/:date`, `/api/subscriptions/:id/days/:date/selection/validate`, `/api/subscriptions/:id/days/:date/payments`.
- Dashboard: `/api/dashboard/plans`, `/api/dashboard/subscriptions`, `/api/dashboard/menu/*`, `/api/dashboard/promo-codes`.

Services verified:

- Public plan serialization uses `Plan.gramsOptions[].mealsOptions[]`; response also exposes `weightOptions`/`mealOptions` aliases.
- Subscription quote uses `planId`, `grams`, `mealsPerDay`, optional `premiumItems`, optional `addons`, optional `promoCode`, and delivery fields normalized through `delivery`.
- Subscription quote pricing is VAT-inclusive via `computeInclusiveVatBreakdown`.
- Promo discount is applied to the gross quote total first, then VAT is extracted again from the discounted inclusive total.
- Meal planner V2 is built from `data.builderCatalogV2.sections`.
- Unified day payment returns `premiumAmountHalala`, `addonsAmountHalala`, `totalHalala`, and `currency`.

Remaining assumptions:

- This audit verifies code paths, not live production database contents.
- `branchId` is not a direct field in `resolveCheckoutQuoteOrThrow`; pickup uses `pickupLocationId`/`locationId`. If Flutter/Dashboard still uses `branchId`, verify the client adapter or response before treating it as a backend contract.
- Add-on category code is `small_salad`; UI may label it as salad.
- Curl examples use placeholder IDs only and must be validated against actual safe QA data before optional writes.
- Dashboard menu product list route is verified; `availableFor` was not confirmed as a supported query filter in `dashboard/menuController.js`, so inspect returned product fields instead of relying on that query parameter.

## 0. Safety Rules

- Read-only first. Begin with GET endpoints and Dashboard inspection only.
- Do not run seed scripts.
- Do not run bootstrap scripts.
- Do not reset any database or catalog data.
- Do not use `ALLOW_CATALOG_RESET=true`.
- Do not delete production data.
- Do not create production writes unless the step is under "Optional write tests" and explicit approval was given.
- Any approved QA write must be QA-tagged, easy to identify, and inactive/hidden whenever possible.
- Never expose JWT tokens, dashboard tokens, secrets, or `.env` values in logs, screenshots, tickets, docs, or chat.
- Redact user phone numbers and payment/provider IDs in shared QA evidence.

### Create QA Subscription + Day Validation QA

Use this only after explicit project-owner approval for controlled QA writes.

Script:

```bash
QA_ALLOW_SUBSCRIPTION_WRITE=true \
APP_TOKEN="..." \
DASHBOARD_TOKEN="..." \
node qa-create-subscription-and-validate.js
```

What it does:

- Resolves the app user from `APP_TOKEN` without printing the token.
- Resolves the canonical `subscription_7_days` plan at `100g` and `1` meal/day.
- Runs dashboard quote/create for a clearly QA-tagged subscription.
- Does not run checkout, payment, or provider flows.
- Runs validation-only `POST /api/subscriptions/:id/days/:date/selection/validate` through `qa-subscription-day-validation.js`.
- Attempts safe dashboard cancellation after the validation run.

Optional:

- Set `QA_KEEP_SUBSCRIPTION=true` to leave the QA subscription active for manual inspection.
- Set `QA_DAYS_OFFSET=3` to choose a different start-date offset.
- Set `QA_DEBUG_CATALOG=true` to print compact catalog extraction diagnostics from the validation script.

Safety constraints:

- Requires `QA_ALLOW_SUBSCRIPTION_WRITE=true`.
- Requires both `APP_TOKEN` and `DASHBOARD_TOKEN`.
- Creates a QA subscription only for the owner represented by `APP_TOKEN`.
- Does not seed, bootstrap, reset, use `ALLOW_CATALOG_RESET`, create real checkout/payment/provider records, create orders, or hard-delete data.
- If cleanup cannot safely cancel the QA subscription, the script prints the subscription id and a warning for manual cancellation.

## 1. QA Environment

| Item | Value |
| --- | --- |
| Production API | `https://basicdiet145.onrender.com` |
| Backend repo | `/home/hema/Projects/basicdiet145` |
| Dashboard repo | `/home/hema/Projects/full app/client_dashbourd-main` |

Required tools:

- Browser DevTools.
- Postman, Insomnia, or `curl`.
- Dashboard login with the correct role.
- Flutter app/debug build pointed at production API or the approved QA API.

Data needed:

- Test user.
- Active subscription for planner/timeline checks.
- Dashboard admin token or dashboard session.
- Optional active promo code for read/quote validation.
- Optional QA subscription, created only after explicit approval.

## 2. Auth Matrix

| Area | Endpoint examples | Token required | Notes |
| --- | --- | --- | --- |
| Public subscription menu | `GET /api/subscriptions/menu`, `GET /api/subscriptions/meal-planner-menu?includeLegacy=true&lang=ar`, `GET /api/subscriptions/delivery-options` | No | Safe read-only public checks. |
| Public add-ons | `GET /api/addons` | No | Used to confirm visible add-ons. |
| User plans | `GET /api/plans`, `GET /api/plans/:id` | App user token | Verified mounted at `/api/plans`; requires app auth and lists active viable plans only. |
| User subscription quote | `POST /api/subscriptions/quote` | App user token | Write-like validation call. Use only after approval if testing production. |
| User checkout/payment | `POST /api/subscriptions/checkout`, `GET /api/subscriptions/checkout-drafts/:draftId`, `POST /api/subscriptions/checkout-drafts/:draftId/verify-payment` | App user token | Creates or verifies payment drafts. Requires approval. |
| User planner/timeline | `GET /api/subscriptions/:id`, `GET /api/subscriptions/:id/timeline`, `GET /api/subscriptions/:id/days/:date`, `POST /api/subscriptions/:id/days/:date/selection/validate` | App user token | GET is read-only. Validation is write-like but should not save. |
| User unified day payment | `POST /api/subscriptions/:id/days/:date/payments`, `POST /api/subscriptions/:id/days/:date/payments/:paymentId/verify` | App user token | Required for premium + add-on pending payment QA. Requires approval. |
| Dashboard plans | `GET /api/dashboard/plans`, `POST /api/dashboard/plans`, `PUT /api/dashboard/plans/:id` | Dashboard token, admin role | GET first. Writes require approval. |
| Dashboard subscriptions | `GET /api/dashboard/subscriptions`, `POST /api/dashboard/subscriptions/quote`, `POST /api/dashboard/subscriptions` | Dashboard token, admin/cashier as configured | Verified through `adminRoutes` mounted at `/api/dashboard`. Also `/api/dashboard/subscriptions/search`, `/:id/addon-entitlements`, and `/:id/balances` exist in `dashboardSubscriptions.js`. Writes require approval. |
| Dashboard menu | `GET /api/dashboard/menu/*`, relation edit endpoints under `/api/dashboard/menu/products/:productId/...` | Dashboard token, admin/superadmin | Confirm metadata and relation rules. Writes require approval. |
| Dashboard promo codes | `GET /api/dashboard/promo-codes`, `POST /api/dashboard/promo-codes/validate`, CRUD/toggle/delete under `/api/dashboard/promo-codes` | Dashboard token, admin role | Validation can be write-like depending on implementation. CRUD requires approval. |
| Payment redirects/API | `GET /payments/success`, `GET /payments/cancel`, `GET /api/payments/verify` | Redirect/API-specific | Do not paste provider tokens or IDs into shared notes. |

## 3. Subscription Plans QA

Goal: only these customer-facing plans are sellable:

- `subscription_7_days`
- `subscription_26_days`
- `subscription_30_days`

Checklist:

- `GET /api/plans` returns exactly 3 active viable plans for customers.
- Each plan has `gramsOptions` for `100`, `150`, and `200`. The public serializer also returns `weightOptions` as an alias.
- Each grams row has `mealsOptions` for meals/day `1`, `2`, `3`, `4`, and `5`. The public serializer also returns `mealOptions` as an alias.
- Prices match the tables below. The persisted and response price field is `priceHalala`, so `138 SAR` is `13800`.
- Legacy flat plans are not visible in Flutter/customer plan lists.
- Dashboard does not present legacy flat plans as sellable.
- Dashboard edit screens show technical `key` as read-only and do not allow changing immutable keys.

Expected prices in SAR:

### 7 days

| Grams | 1 meal | 2 meals | 3 meals | 4 meals | 5 meals |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100g | 138 | 276 | 414 | 552 | 690 |
| 150g | 174 | 348 | 522 | 696 | 870 |
| 200g | 210 | 420 | 630 | 840 | 1050 |

### 26 days

| Grams | 1 meal | 2 meals | 3 meals | 4 meals | 5 meals |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100g | 516 | 935 | 1355 | 1806 | 2257 |
| 150g | 659 | 1186 | 1732 | 2309 | 2886 |
| 200g | 750 | 1421 | 2012 | 2683 | 3354 |

### 30 days

| Grams | 1 meal | 2 meals | 3 meals | 4 meals | 5 meals |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100g | 587 | 1079 | 1511 | 2014 | 2518 |
| 150g | 720 | 1331 | 1943 | 2590 | 3238 |
| 200g | 828 | 1619 | 2279 | 3038 | 3798 |

PASS:

- Only the 3 canonical keys are customer-sellable.
- All 45 nested price points match the expected table.
- No legacy flat plan appears as available to Flutter or Dashboard sales flow.

FAIL:

- Any missing grams/meals option.
- Any price mismatch.
- Any active legacy flat plan visible as sellable.

## 4. Subscription Creation Flow

Test this from Flutter, Dashboard, and API where each client supports it.

Request fields to verify:

| Field | Expected |
| --- | --- |
| `planId` | Active canonical plan ObjectId. |
| `grams` | Required by `resolveCheckoutQuoteOrThrow`; `100`, `150`, or `200`. |
| `weightGrams` / `gramsOption` | Not used by backend subscription quote service. VERIFY FROM RESPONSE/client adapter before using. |
| `mealsPerDay` | Required by `resolveCheckoutQuoteOrThrow`; integer `1` through `5`. |
| `mealsCount` | Not used by backend subscription quote service. VERIFY FROM RESPONSE/client adapter before using. |
| `startDate` | Valid future/allowed date in project format. |
| `deliveryMode` or `delivery.type` | `pickup` or `delivery`, based on UI choice. |
| `pickupLocationId` / `locationId` | Backend quote pickup fields. If a client sends `branchId`, VERIFY FROM RESPONSE/client adapter. |
| `delivery.zoneId` / `zoneId` / `deliveryZoneId` | Required for delivery pricing. |
| `deliveryAddress` / `delivery.address` | Required for delivery unless the endpoint intentionally allows missing address. |
| `deliveryWindow` / `delivery.window` / `delivery.slot` | Required for delivery slot validation when delivery is selected. |
| `promoCode` | Optional. Submit only known QA-safe code. |
| `premiumItems` | Optional premium quantities using `proteinId` or canonical `premiumKey` plus `qty`. |
| `addons` | Optional subscription add-on plan ObjectIds. |
| `addonPlans` | Dashboard alias normalized to `addons`. |
| `idempotencyKey` | Required for checkout. Send as `Idempotency-Key`, `X-Idempotency-Key`, or body `idempotencyKey`. |

Response fields to verify:

- `status: true`.
- `data.breakdown`.
- `data.breakdown.basePlanPriceHalala`.
- `data.breakdown.premiumTotalHalala`.
- `data.breakdown.addonsTotalHalala`.
- `data.breakdown.deliveryFeeHalala`.
- `data.breakdown.grossTotalHalala`.
- `data.breakdown.subtotalHalala`.
- `data.breakdown.subtotalBeforeVatHalala`.
- `data.breakdown.vatPercentage`.
- `data.breakdown.vatHalala`.
- `data.breakdown.totalHalala`.
- `data.breakdown.currency`.
- `data.pricingSummary`.
- `data.promoCode` when a promo is applied.
- `data.totalSar`, `data.summary`, and `data.premiumItemCount` can appear in user quote responses.
- Dashboard quote wraps selected dimensions under `data.selectedOptions`.
- Checkout draft/payment fields when using checkout.

Checklist:

- Select plan.
- Select grams.
- Select meals/day.
- Select pickup location or delivery information.
- Apply promo code if approved.
- Confirm discount value.
- Confirm VAT extraction.
- Confirm final total.
- Create checkout/payment only after approval.
- Before payment, subscription should not be active unless Dashboard create intentionally activates it.
- After paid/verified payment, subscription or draft status should reflect paid/active according to the API response.
- Pending payment must remain visibly pending and must not be shown as a completed subscription.

PASS:

- Quote and checkout totals match the selected plan, add-ons, premium items, delivery fee, promo discount, VAT, and currency.
- Payment pending state is clear and recoverable.
- Flutter/Dashboard show the same totals the API returned.

FAIL:

- Client computes a different final total locally.
- Checkout can proceed without required fields or idempotency key.
- Pending payment is displayed as active/paid.
- Dashboard creates a production subscription unintentionally.

## 5. VAT / Discount / Promo QA

Project rule verified in code: customer-facing subscription prices are VAT-inclusive. The customer total is gross, and VAT is extracted from that gross amount with `computeInclusiveVatBreakdown`.

Promo behavior verified in code: `applyPromoDiscountToBreakdown()` computes `rawSubtotal = basePlanPriceHalala + premiumTotalHalala + addonsTotalHalala + deliveryFeeHalala`, caps the discount to that raw subtotal, subtracts the discount, then extracts VAT from the discounted inclusive total.

Verify actual API breakdown; do not assume formula output when promo configuration or response shape differs from the examples.

Manual formulas:

```text
grossTotal = basePlanPrice + premiumTotal + addonsTotal + deliveryFee
discount = fixedAmount OR percentageAmount capped by maxDiscount if configured
taxableAmountGross = max(grossTotal - discount, 0)
subtotalBeforeVat = round(taxableAmountGross / (1 + vatPercentage / 100))
vatAmount = taxableAmountGross - subtotalBeforeVat
total = taxableAmountGross
```

Verify:

- Price before discount.
- Fixed amount promo.
- Percentage promo.
- Maximum discount cap if configured.
- VAT is extracted after discount by `applyPromoDiscountToBreakdown()`.
- `totalHalala` is final payable amount.
- Rounding is stable to the halala.
- `subtotalBeforeVatHalala + vatHalala == totalHalala`.

Examples:

| Scenario | Manual expectation |
| --- | --- |
| 150.00 SAR VAT-inclusive, 15% VAT, no discount | Net `13043` halala, VAT `1957` halala, total `15000` halala. |
| 150.00 SAR gross, 10.00 SAR fixed discount, 15% VAT | Taxable gross `14000`, net `12174`, VAT `1826`, total `14000`. |
| 200.00 SAR gross, 10% promo, max 15.00 SAR, 15% VAT | Discount capped at `1500`, taxable gross `18500`, net `16087`, VAT `2413`, total `18500`. |

PASS:

- API `breakdown` and `pricingSummary` agree.
- Flutter and Dashboard display the API total, not a local recalculation.
- Currency is `SAR`.

FAIL:

- VAT is added on top of a VAT-inclusive plan price.
- Discount is displayed but not reflected in payable total.
- Rounding causes `subtotalBeforeVatHalala + vatHalala != totalHalala`.

### Subscription Quote + Promo + VAT QA

Use `qa-subscription-quote-promo-vat.js` only after explicit approval for limited QA writes in the target environment.

Safety requirements:

- Requires `QA_ALLOW_WRITES=true`; the script refuses to run without it.
- Requires `APP_TOKEN` for `/api/subscriptions/quote`.
- Requires `DASHBOARD_TOKEN` for `/api/dashboard/promo-codes`.
- Creates QA-tagged temporary promo codes only.
- Does not call checkout, payment, subscription creation, seed, bootstrap, reset, or destructive endpoints.
- Disables the QA promo codes after the quote checks when the dashboard toggle endpoint is available.
- Never print tokens or secrets in logs.

The script verifies:

- Canonical `subscription_7_days`, `100g`, `1` meal/day price is `13800` halala.
- Quote without promo.
- Fixed discount promo: `10 SAR` / `1000` halala.
- Percentage discount promo: `10%`, capped at `15 SAR` / `1500` halala.
- VAT is extracted from the discounted VAT-inclusive gross total.
- `subtotalBeforeVatHalala + vatHalala == totalHalala`.
- Subscription add-ons quote with promo when `juice` and `snack` subscription add-on plan IDs are available.
- Promo cleanup/disable.

Command:

```bash
QA_ALLOW_WRITES=true \
BASE_URL="https://basicdiet145.onrender.com" \
APP_TOKEN="<app user token>" \
DASHBOARD_TOKEN="<dashboard admin token>" \
node qa-subscription-quote-promo-vat.js
```

Expected report shape:

```text
PASS/FAIL Subscription quote without promo
PASS/FAIL Fixed promo discount
PASS/FAIL Percentage promo discount
PASS/FAIL VAT inclusive calculation
PASS/FAIL subtotalBeforeVat + vat == total
PASS/FAIL Add-ons quote with promo
PASS/FAIL Promo cleanup/disable
```

## 6. Subscription Add-ons QA

Subscription add-ons by business label:

- `snack`
- `juice`
- `salad`

Backend category codes:

- `snack`
- `juice`
- `small_salad`

Delivery is not a subscription add-on.

Checklist:

- Public checkout contract uses `GET /api/addons?type=subscription` and returns exactly three active subscription plan rows: `juice`, `snack`, and `small_salad`.
- Public daily-selection contract uses `GET /api/subscriptions/addon-choices` and returns `juice`, `snack`, and `small_salad` groups.
- `GET /api/subscriptions/addon-choices?category=juice` returns juice choices from one-time menu categories `juices` and `drinks`.
- `GET /api/subscriptions/addon-choices?category=snack` returns snack choices from one-time menu category `desserts`.
- `GET /api/subscriptions/addon-choices?category=small_salad` returns mapped salad choices from `light_options`; empty `choices` is acceptable if no mapped published one-time salad products exist.
- Daily add-on choices are `MenuProduct` rows from the one-time menu, not duplicate daily-choice rows in the `Addon` collection.
- `GET /api/addons?kind=plan` is equivalent to `type=subscription`; `GET /api/addons?kind=item` is legacy/backward-compatible and must not be used as the subscription daily-choice source.
- Flutter checkout must not render daily item rows such as Classic Green, Berry Blast, Dark Brownies, or Berry Cheesecake as subscription add-on plans.
- Flutter checkout must not use daily `MenuProduct` choices as subscription plans.
- Flutter day selection shows daily item choices for all eligible daily add-on categories from `GET /api/subscriptions/addon-choices`, regardless of whether the subscription has a matching entitlement.
- If the subscription has a matching entitlement, the selection is free (`source: "subscription"`, `priceHalala: 0`).
- If the subscription does not have a matching entitlement, the selection is accepted and charged (`source: "pending_payment"`, `priceHalala: current MenuProduct price`).
- Dashboard lists only subscription add-on plan categories `snack`, `juice`, and `small_salad` as subscription add-ons. UI may label `small_salad` as salad.
- Dashboard can show active/inactive state for each add-on.
- Dashboard/Kitchen must show add-on entitlement categories even when the customer has not selected a daily item yet; unselected daily items should display a `not_selected` or `pending_selection` state.
- Kitchen shows entitlement even if `selectedItem` is `null`.
- There are no duplicate daily-choice products seeded into the `Addon` collection.
- If duration-specific pricing is supported, verify price by subscription duration.
- Flutter does not render delivery as an add-on.
- Backend quote/checkout does not include delivery inside `addonsTotalHalala`.
- Delivery fees, when present, appear in `deliveryFeeHalala`.

PASS:

- Add-on totals include subscription add-ons only.
- Delivery is handled as fulfillment/delivery fee, not addon inventory.

FAIL:

- `delivery` appears as a subscription add-on.
- Add-on amount changes when only delivery method changes.

## 7. Meal Planner Menu QA

Endpoint:

```http
GET /api/subscriptions/meal-planner-menu?includeLegacy=true&lang=ar
GET /api/subscriptions/meal-planner-menu?includeLegacy=true&lang=en
```

Checklist:

- Flutter consumes `data.builderCatalogV2.sections`.
- `data.builderCatalog` may exist for compatibility but is not the primary new UI source.
- Sections include:
  - `standard_meal`
  - `premium_meal`
  - `sandwich`
  - `premium_large_salad`
- Arabic and English responses preserve the same technical keys and IDs.
- Localized labels change by `lang`; business rules do not.

PASS:

- All required sections are present in both languages.
- Flutter uses IDs and keys from the response, not translated names.

FAIL:

- Flutter reads only legacy arrays.
- Missing section or language-dependent technical behavior.

## 8. Standard Meal QA

Allowed proteins only:

- `chicken`
- `beef`
- `fish`
- `eggs`

Allowed carbs, canonical 7 only:

- `white_rice`
- `turmeric_rice`
- `alfredo_pasta`
- `red_sauce_pasta`
- `roasted_potato`
- `sweet_potato`
- `grilled_mixed_vegetables`

Must not appear:

- `brown_rice`
- `potato`
- `pasta`
- premium proteins
- `extra_protein_50g`

PASS:

- Public planner menu exposes only allowed standard proteins and canonical carbs for `standard_meal`.
- Quote/selection validation rejects disallowed options.

FAIL:

- Any forbidden legacy carb or premium option is available in standard meal.

## 9. Premium Meal QA

`premium_meal` contains only:

- `beef_steak`
- `shrimp`
- `salmon`

Each premium option:

- `extraFeeHalala = 2000`.
- Flutter displays this as `20 SAR`.
- Quote includes premium charges in `premiumTotalHalala`.

PASS:

- Only the 3 premium keys appear.
- Each fee is exactly `2000` halala.

FAIL:

- Missing fee, wrong fee, or extra premium protein appears.

## 10. Subscription Sandwich QA

Subscription sandwich section contains only:

- `beef_burger_sandwich`
- `turkey_cold_sandwich`
- `boiled_egg_sandwich`
- `tuna_sandwich`
- `mexican_chicken_sandwich`
- `grilled_chicken_sandwich`

Must not appear:

- `chicken_sandwich`
- `sourdough_turkey`

PASS:

- Only approved subscription sandwich keys are visible.

FAIL:

- Any forbidden or legacy sandwich key appears.

## 11. Premium Large Salad Subscription Restriction QA

Inside subscriptions only, `premium_large_salad` is enforced by an allowed protein list plus an excluded group list.

Allowed subscription premium large salad proteins from code:

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

Therefore these must not show or must be rejected:

- `extra_protein_50g`
- `beef_steak`
- `shrimp`
- `salmon`
- `meatballs`
- `beef_stroganoff`

Checklist:

- Only regular proteins are visible.
- `extra_protein_50g` group is excluded for subscription `premium_large_salad`.
- Validation rejects payloads that submit premium or non-allowed proteins.
- One-time `basic_salad` is a separate one-time menu flow; verify from `/api/orders/menu` if checking it, and do not infer it from subscription planner restrictions.

PASS:

- Subscription large salad rejects disallowed proteins and still allows the code-defined allowed proteins.
- One-time salad behavior remains unchanged. VERIFY FROM RESPONSE if doing one-time salad QA.

FAIL:

- Premium/disallowed protein is selectable or accepted in subscription large salad.
- One-time salad is accidentally restricted by this rule.

## 12. Protein Visual Grouping QA

Protein options should include display metadata where available:

- `proteinFamilyKey`
- `proteinFamilyNameI18n`
- `displayCategoryKey`
- `optionSections`

Flutter visual tabs:

- `دجاج`
- `لحم`
- `سمك`
- `بيض`

For option-group style builder selections, payload must still use original IDs:

```json
{
  "groupId": "original_group_id",
  "optionId": "selected_option_id",
  "qty": 1
}
```

Checklist:

- Visual grouping does not create virtual business groups.
- Flutter never sends virtual family IDs as `groupId` or `optionId`.
- Selection rules are inherited from the original protein group.
- Dashboard treats `proteinFamilyKey` as display metadata, not pricing logic.
- Canonical subscription day `mealSlots` use the meal planner contract fields such as `slotIndex`, `selectionType`, `proteinId`, `carbs`, `sandwichId`, and `salad`; do not send visual family IDs there either.

PASS:

- UI grouping works while quote/selection payloads retain original backend IDs.

FAIL:

- Quote payload contains virtual family IDs.
- Grouping changes selection limits or pricing.

## 13. Quote Validation QA

Use `POST /api/subscriptions/:id/days/:date/selection/validate` before saving day selections.

Validate:

- Standard meal valid.
- Premium meal valid.
- Sandwich valid.
- `premium_large_salad` valid.
- Invalid `weightGrams` if testing an older client-side builder adapter. TODO/VERIFY: direct subscription `mealSlots` validation primarily uses `carbs[].grams`, not a top-level `weightGrams`.
- Invalid `optionId`.
- Invalid `groupId`.
- Disallowed premium protein in `premium_large_salad`.
- `extra_protein_50g` in `premium_large_salad` should fail.
- Canonical carbs only.

Expected error codes may include:

- `SALAD_OPTION_NOT_ALLOWED`
- `SALAD_PROTEIN_NOT_ALLOWED`
- `SALAD_PROTEIN_INVALID`
- `INVALID_SALAD_OPTION`
- `CARBS_NOT_ALLOWED`
- `SANDWICH_NOT_ALLOWED`
- `INVALID_SLOT_STRUCTURE`
- Or the actual project error code returned by the API.

TODO/VERIFY: `INVALID_WEIGHT_GRAMS`, `INVALID_OPTION`, and `INVALID_SELECTION` may appear in adjacent flows, but they were not confirmed as direct meal-slot validation codes in the inspected `mealSlotPlannerService.js`.

PASS:

- Valid payloads pass.
- Invalid payloads fail before saving.
- Error responses are clear enough for Flutter to show a useful message.

FAIL:

- Invalid payload saves.
- Error code is missing or misleading.

## 14. Premium + Add-on Payment QA

Important scenario:

- Entitled daily juice MenuProduct amount = `0` halala.
- `beef_steak` premium = `2000` halala.
- The `1100` halala juice subscription add-on plan price belongs to subscription checkout, not the daily entitled selection.

Expected:

- `premiumAmountHalala = 2000`
- `addonsAmountHalala = 0`
- `totalHalala = 2000`
- `currency = SAR`

Flutter must use:

```http
POST /api/subscriptions/:id/days/:date/payments
```

Flutter must not use the add-on-only endpoint when the day contains a premium meal.

Checklist:

- Create or identify a day selection with both premium meal and entitled daily juice MenuProduct after approval.
- Validate pending payment total.
- Confirm response separates premium amount and add-on amount.
- Confirm timeline reflects pending payment until paid.
- Verify using `POST /api/subscriptions/:id/days/:date/payments/:paymentId/verify` only if approved.

PASS:

- Unified payment total is `2000` halala for premium `beef_steak` plus entitled daily juice.
- Timeline and day detail remain pending until payment is complete.

FAIL:

- Flutter creates only add-on payment.
- Premium amount is omitted.
- Day is shown as planned before payment.

## 15. Timeline QA

Test states:

- `empty`
- `draft`
- `pending_payment`
- `planned`
- `failed`

If premium/add-on payment is pending:

- `timelineStatus = pending_payment`
- `canShowAsPlanned = false`
- `isPlanned = false`

Flutter planned-day rule:

```dart
final showPlanned =
  day.timelineStatus == 'planned' || day.canShowAsPlanned == true;
```

Checklist:

- `GET /api/subscriptions/:id/timeline` returns all expected day fields.
- Empty days are not shown as planned.
- Draft selected days without confirmation/payment are not shown as planned.
- Pending payment days are not shown as planned.
- Paid and confirmed days become planned only when API says so.
- Failed payment day shows recoverable failed/pending UI.

PASS:

- Flutter uses `timelineStatus` and `canShowAsPlanned`.
- No pending payment is visually promoted to planned.

FAIL:

- Flutter uses legacy `status` alone and shows drafts/pending days as planned.

## 16. Dashboard QA

Checklist:

- Create/edit subscription plan without editing immutable `key`.
- Show `key` read-only on edit.
- Do not show legacy flat plans as sellable.
- Manage add-ons `snack`, `juice`, and `small_salad` only. UI may label `small_salad` as salad.
- Do not show delivery as an add-on.
- Manage prices in halala correctly.
- Do not convert `maxSelections=0` to `1`.
- Use `?? 1` style fallback semantics, not `|| 1`, where zero is valid.
- Relation prices come from `ProductGroupOption.extraPriceHalala`.
- UI metadata controls presentation only and must not drive business logic.
- Product/group/option relation screens preserve original `groupId` and `optionId`.
- Dashboard quote uses `/api/dashboard/subscriptions/quote` before create.

PASS:

- Dashboard can inspect and manage catalog/plans without mutating immutable technical identity.
- Read-only fields remain read-only.
- Zero and null selection limits are preserved correctly.

FAIL:

- Dashboard changes keys.
- UI metadata changes backend eligibility/pricing.
- `maxSelections=0` becomes `1`.

## 17. Flutter QA

Checklist:

- Uses `data.builderCatalogV2.sections`.
- Does not depend on Arabic or English names for business decisions.
- Does not depend on hardcoded keys for card layout.
- Uses UI metadata for display only.
- Uses quote API for final price.
- Does not calculate final payable total locally.
- Sends original `groupId` and `optionId`.
- Does not send virtual family IDs.
- Displays premium fees.
- Displays pending payment total correctly.
- Uses unified day payment endpoint:
  - `POST /api/subscriptions/:id/days/:date/payments`
- Uses planned-day rule:
  - `timelineStatus == 'planned' || canShowAsPlanned == true`

PASS:

- Flutter renders, validates, quotes, saves, and pays using backend contracts.

FAIL:

- Flutter relies on translated names, legacy arrays, local final pricing, or deprecated payment endpoints.

## 18. Final Acceptance Criteria

The subscription system is ready when:

- All public subscription menu checks PASS.
- All plan price checks PASS.
- `premium_large_salad` restriction PASS.
- Premium + add-on unified payment total PASS.
- Timeline planned/pending behavior PASS.
- Dashboard does not break relation rules.
- Dashboard does not expose legacy flat plans as sellable.
- Flutter displays, saves, quotes, and pays using the correct API contract.
- No QA run exposed tokens/secrets or performed unapproved production writes.

## 19. QA Result Template

| Area | Test | Expected | Actual | Status | Notes |
| ---- | ---- | -------- | ------ | ------ | ----- |
| Plans | 3 canonical plans only | `subscription_7_days`, `subscription_26_days`, `subscription_30_days` |  |  |  |
| Pricing | 45 price points | Match table |  |  |  |
| Menu | Planner sections | 4 required sections |  |  |  |
| Validation | Invalid premium salad protein | Rejected |  |  |  |
| Payment | Premium + entitled juice total | `2000` halala |  |  |  |
| Timeline | Pending payment day | Not planned |  |  |  |
| Dashboard | Key immutable | Read-only/not changed |  |  |  |
| Flutter | Uses canonical IDs | Original IDs only |  |  |  |

Status values:

- `PASS`
- `FAIL`
- `WARN`
- `SKIP`

## 20. Commands Section

Read-only commands only.

Set a shell variable without exposing secrets:

```bash
BASE_URL="https://basicdiet145.onrender.com"
```

Public menu checks:

```bash
curl -sS "$BASE_URL/api/subscriptions/meal-planner-menu?includeLegacy=true&lang=ar"
curl -sS "$BASE_URL/api/subscriptions/meal-planner-menu?includeLegacy=true&lang=en"
curl -sS "$BASE_URL/api/subscriptions/menu?lang=ar"
curl -sS "$BASE_URL/api/subscriptions/delivery-options"
curl -sS "$BASE_URL/api/addons"
curl -sS "$BASE_URL/api/addons?type=subscription"
curl -sS "$BASE_URL/api/subscriptions/addon-choices"
curl -sS "$BASE_URL/api/subscriptions/addon-choices?category=juice"
```

Authenticated read-only checks. Do not print the token:

```bash
APP_AUTH_HEADER="Authorization: Bearer <REDACTED_APP_USER_TOKEN>"
DASHBOARD_AUTH_HEADER="Authorization: Bearer <REDACTED_DASHBOARD_TOKEN>"
```

```bash
curl -sS -H "$APP_AUTH_HEADER" "$BASE_URL/api/plans"
curl -sS -H "$APP_AUTH_HEADER" "$BASE_URL/api/subscriptions"
curl -sS -H "$APP_AUTH_HEADER" "$BASE_URL/api/subscriptions/current/overview"
curl -sS -H "$APP_AUTH_HEADER" "$BASE_URL/api/subscriptions/<subscriptionId>/timeline"
curl -sS -H "$APP_AUTH_HEADER" "$BASE_URL/api/subscriptions/<subscriptionId>/days/<YYYY-MM-DD>"
```

Dashboard read-only checks:

```bash
curl -sS -H "$DASHBOARD_AUTH_HEADER" "$BASE_URL/api/dashboard/plans"
curl -sS -H "$DASHBOARD_AUTH_HEADER" "$BASE_URL/api/dashboard/subscriptions"
curl -sS -H "$DASHBOARD_AUTH_HEADER" "$BASE_URL/api/dashboard/menu/products"
curl -sS -H "$DASHBOARD_AUTH_HEADER" "$BASE_URL/api/dashboard/menu/option-groups"
curl -sS -H "$DASHBOARD_AUTH_HEADER" "$BASE_URL/api/dashboard/promo-codes"
```

Optional write tests - require explicit approval:

These commands are examples only. Use QA-tagged data, approved users/subscriptions, and redact all identifiers in shared output.

Quote a subscription:

```bash
curl -sS -X POST "$BASE_URL/api/subscriptions/quote" \
  -H "$APP_AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "planId": "<canonicalPlanId>",
    "grams": 100,
    "mealsPerDay": 1,
    "startDate": "<YYYY-MM-DD>",
    "deliveryMode": "pickup",
    "pickupLocationId": "<pickupLocationId>",
    "promoCode": "<OPTIONAL_QA_PROMO>"
  }'
```

Validate a planner day without saving:

```bash
curl -sS -X POST "$BASE_URL/api/subscriptions/<subscriptionId>/days/<YYYY-MM-DD>/selection/validate" \
  -H "$APP_AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "mealSlots": [
      {
        "slotIndex": 1,
        "selectionType": "standard_meal",
        "proteinId": "<proteinOptionOrBuilderProteinId>",
        "carbs": [
          { "carbId": "<carbOptionOrBuilderCarbId>", "grams": 150 }
        ]
      }
    ]
  }'
```

Create a checkout draft/payment only after approval:

```bash
curl -sS -X POST "$BASE_URL/api/subscriptions/checkout" \
  -H "$APP_AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: qa-subscription-checkout-<unique-suffix>" \
  -d '{
    "planId": "<canonicalPlanId>",
    "grams": 100,
    "mealsPerDay": 1,
    "startDate": "<YYYY-MM-DD>",
    "deliveryMode": "pickup",
    "pickupLocationId": "<pickupLocationId>",
    "idempotencyKey": "qa-subscription-checkout-<unique-suffix>"
  }'
```

Create unified day payment only after approval:

```bash
curl -sS -X POST "$BASE_URL/api/subscriptions/<subscriptionId>/days/<YYYY-MM-DD>/payments" \
  -H "$APP_AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "manual_qa",
    "note": "QA-tagged unified premium plus addon payment check"
  }'
```

Dashboard quote only after approval:

```bash
curl -sS -X POST "$BASE_URL/api/dashboard/subscriptions/quote" \
  -H "$DASHBOARD_AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "<qaUserId>",
    "planId": "<canonicalPlanId>",
    "grams": 100,
    "mealsPerDay": 1,
    "startDate": "<YYYY-MM-DD>",
    "deliveryMode": "pickup",
    "pickupLocationId": "<pickupLocationId>"
  }'
```

Forbidden commands for this QA:

```text
Do not run seed scripts.
Do not run bootstrap scripts.
Do not run reset scripts.
Do not set ALLOW_CATALOG_RESET=true.
Do not run destructive delete/update commands.
```

## Recommended Execution Order

1. Read-only public subscription menu.
2. Read-only plans/prices.
3. Read-only dashboard inspection.
4. Flutter rendering check.
5. Quote tests after explicit approval.
6. Validation tests after explicit approval.
7. Payment pending tests after explicit approval.
8. Final `PASS`/`WARN`/`FAIL` report.

## [QA_PROD_READY] Premium + Add-on Pending Payment QA

**Goal**: Verify that unified day payments correctly handle the combination of premium meal surcharges and entitled daily add-on selections.

### Test Payload
- **Meal**: `beef_steak` (Premium) -> Expected +20.00 SAR (2000 halala)
- **Add-on**: daily `juice` MenuProduct covered by subscription entitlement -> Expected +0.00 SAR (0 halala)
- **Total Pending**: 20.00 SAR (2000 halala)

### Verification Steps
1. [ ] Create Manual QA Subscription (Dashboard).
2. [ ] Identify a non-locked future date.
3. [ ] Set selection with `beef_steak` and a daily juice MenuProduct from `/api/subscriptions/addon-choices?category=juice`.
4. [ ] Trigger `POST /api/subscriptions/:id/days/:date/payments`.
5. [ ] Verify `GET /api/subscriptions/:id/timeline` shows the date as `pending_payment` with correct balance.

### Safety Status
- **Write Access**: Required (`QA_ALLOW_PAYMENT_PENDING_WRITE=true`).
- **Payment Processing**: Mock/Initiated only (No real checkout).
- **Cleanup**: Forced cancellation after test.

## [QA_PROD_READY] Non-Entitled Daily Add-on Paid Selection QA

**Goal**: Verify that a subscription without a snack entitlement can still select a snack daily add-on and is charged at the current MenuProduct price.

### Scenario B — Non-Entitled Paid Daily Add-on

- **Subscription**: Has `juice` entitlement only. Does not have `snack` entitlement.
- **Selection**: Valid snack `MenuProduct` from `GET /api/subscriptions/addon-choices?category=snack`.
- **Expected**: Selection is accepted (not rejected with `ADDON_ENTITLEMENT_REQUIRED`).
- **Expected source**: `pending_payment`
- **Expected priceHalala**: Current snack MenuProduct price (e.g. `1300` for a 13 SAR snack).
- **Expected addonPendingPaymentCount**: `1`

### Verification Steps
1. [ ] Create Manual QA Subscription with juice entitlement only (no snack).
2. [ ] Confirm `GET /api/subscriptions/addon-choices?category=snack` returns snack products.
3. [ ] Submit `PUT .../days/:date/selection` with a valid snack MenuProduct ID in `addonsOneTime`.
4. [ ] Read back day detail and assert `addonSelections[].source === "pending_payment"` and `addonSelections[].priceHalala === snack MenuProduct price`.
5. [ ] Confirm `paymentRequirement.addonPendingPaymentCount === 1`.
6. [ ] Confirm `paymentRequirement.pendingAmountHalala === snack MenuProduct price`.

### Combined Scenario — Premium + Entitled Juice + Non-Entitled Snack

- **Meal**: `beef_steak` (Premium) -> +20.00 SAR (2000 halala)
- **Add-on**: daily `juice` MenuProduct covered by entitlement -> +0.00 SAR (free)
- **Add-on**: daily `snack` MenuProduct without entitlement -> +snack MenuProduct price (e.g. 1300 halala)
- **Expected total**: `premiumAmountHalala + snackPrice` = 2000 + 1300 = 3300 halala

### Verification Steps (Combined)
1. [ ] Submit `PUT .../days/:date/selection` with `beef_steak` slot, juice MenuProduct, and snack MenuProduct.
2. [ ] Read back day detail and assert:
   - `juice` addonSelection: `source === "subscription"`, `priceHalala === 0`
   - `snack` addonSelection: `source === "pending_payment"`, `priceHalala === snack price`
3. [ ] Assert `paymentRequirement.premiumPendingPaymentCount === 1`.
4. [ ] Assert `paymentRequirement.addonSelectedCount === 2`.
5. [ ] Assert `paymentRequirement.addonPendingPaymentCount === 1`.
6. [ ] Assert `paymentRequirement.pendingAmountHalala === 3300` (or premium_fee + actual_snack_price).
7. [ ] Cleanup: Cancel QA subscription.

### Safety Status
- **Write Access**: Required (`QA_ALLOW_PAYMENT_PENDING_WRITE=true`).
- **Payment Processing**: Mock/Initiated only (No real checkout).
- **Cleanup**: Forced cancellation after test.
