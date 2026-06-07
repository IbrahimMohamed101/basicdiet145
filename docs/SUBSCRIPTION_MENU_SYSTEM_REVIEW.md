<<<<<<< HEAD
# Subscription Menu System Review

Reviewed file: `docs/SUBSCRIPTION_MENU_SYSTEM_README.md`  
Review date: 2026-06-07  
Review scope: documentation accuracy only. No backend business logic was changed.

## 1. Executive Summary

| Area | Status | Why |
| --- | --- | --- |
| Subscription menu backend | PARTIALLY READY | `GET /api/subscriptions/menu` exists and returns active plans, checkout add-on plans, delivery, and legacy planner sections, but the README under-documents `/quote`, `/checkout`, checkout drafts, and the fact that active plans are not filtered through `Plan.isViable()`. |
| Weekly meal planner | PARTIALLY READY | Core read/write/validate/confirm APIs exist and are tested, but v3 and legacy planner paths coexist. The README is directionally right, yet it presents some examples as stable contracts without documenting all required error/response variants. |
| Premium large salad / premium selections | PARTIALLY READY | Runtime pricing fallback and legacy validation are implemented. v3 canonical validation depends heavily on dashboard product-option relations and does not independently enforce every legacy salad allowlist rule. |
| Add-ons / extras | PARTIALLY READY | Checkout entitlements and day-level menu-product add-ons exist. The README correctly separates them, but uses the wrong primary planner add-on payment code in places and under-documents wallet source behavior. |
| Dashboard integration readiness | PARTIALLY READY | Product-centered dashboard CRUD, composer, publish, validate, plans, add-ons, entitlements, and balances exist. Risk remains from overlapping `/api/admin`, `/api/dashboard`, `/api/dashboard/menu`, and legacy `/meal-planner` surfaces. |
| Flutter integration readiness | PARTIALLY READY | Flutter can integrate against `plannerCatalog` + v3 `mealSlots`, but response shapes, stale-catalog handling, payment errors, and legacy fallback behavior need tighter documentation before this README is treated as final. |
| Bootstrap/seed readiness | PARTIALLY READY | Plan, add-on, one-time menu, bootstrap, and catalog seed scripts exist. Some add-on pricing is intentionally dashboard-managed, and catalog readiness depends on published products/relations. |
| Test coverage readiness | PARTIALLY READY | Strong targeted tests exist for v2/v3 catalog, canonical writes, payment, add-ons, dashboard menu, seeds, and mobile contracts. Gaps remain around full dashboard-to-Flutter subscription planner E2E, v3 premium salad allowlist enforcement, and README contract examples. |

Overall: **PARTIALLY READY**. The README is a useful starting contract, but it should not yet be the sole source of truth for Dashboard and Flutter without corrections.

## 2. README Accuracy Review

| README Section | Status | Problem | Evidence From Code | Recommendation |
| --- | --- | --- | --- | --- |
| 1. System Overview | Partially accurate | Correct high-level split, but it understates route alias overlap and legacy-vs-v3 coexistence. | Route mounts include `/dashboard/meal-planner`, `/dashboard/menu`, `/dashboard`, and `/admin` in `src/routes/index.js:61-73`. | Add an explicit "route surfaces and aliases" subsection. |
| 2. Domain Model | Partially accurate | Good concept map, but add-ons and premium selections are represented in more places than the table makes obvious. | `Subscription` has `addonSubscriptions`, `addonBalance`, `addonSelections`, `premiumBalance`, `premiumSelections` in `src/models/Subscription.js:102-121`; `SubscriptionDay` also has day `addonSelections` and `premiumUpgradeSelections` in `src/models/SubscriptionDay.js:205-235`. | Mark fields as checkout-level, day-level, or derived/compatibility. |
| 3. Subscription Menu Flow | Accurate | Flow matches current planner path. It does not show checkout/activation/renewal flows. | Planner routes exist in `src/routes/subscriptions.js:645-779`; checkout routes exist earlier at `src/routes/subscriptions.js:88-133`. | Keep planner flow, add a separate checkout flow or link to checkout docs. |
| 4. Client catalog APIs | Partially accurate | `delivery-options` is missing, and `meal-planner-menu` default v3 behavior is more nuanced than the README says. | Public routes include `/delivery-options` at `src/routes/subscriptions.js:82-84`; `includeV3` defaults true unless version excludes it in `src/controllers/menuController.js:346-352`. | Add `/api/subscriptions/delivery-options` and document `version`/`contractVersion` behavior exactly. |
| 4. Planning APIs | Missing details | Core endpoints are listed, but several real subscription APIs are omitted: quote, checkout, checkout draft status/verify, days list, today, renewal, pickup/status, skip/unskip, custom salad/meal, delivery update. | See `src/routes/subscriptions.js:88-153`, `279-582`, `837-953`. | Add an endpoint classification table so the README is complete without making every endpoint a full recipe. |
| 4. Payment APIs | Partially accurate | Unified payment endpoint is right, but request/response examples are too vague for Flutter. | Tests assert fields such as `paymentId`, `premiumAmountHalala`, `addonsAmountHalala`, `totalHalala` in `tests/mealPlannerPaymentContract.test.js:620-756`. | Add typed examples for create/verify success, no-payment, reuse, and revision mismatch. |
| 4. Dashboard APIs | Partially accurate | The README lists `/api/admin/*` and `/api/dashboard/subscriptions/*`, but misses that most admin routes are also mounted under `/api/dashboard/*`. | `src/routes/index.js:72-73` mounts the same `adminRoutes` under both `/dashboard` and `/admin`. | Explicitly list canonical dashboard paths and legacy/admin aliases. |
| 5. Selection Types | Partially accurate | It correctly documents v3 and legacy shapes, but "legacy-compatible" can be misunderstood: old non-`mealSlots` payloads are rejected. | `performDaySelectionUpdate` rejects missing `mealSlots` with `LEGACY_DAY_SELECTION_UNSUPPORTED` in `src/services/subscription/subscriptionSelectionService.js:483-501`. | Say "legacy slot shape inside `mealSlots[]` is accepted; legacy root `selections`/`premiumSelections` is not." |
| 5. Premium large salad | Partially accurate | Legacy validation enforces allowed salad protein keys; v3 validation relies on product option relations and excludes extra protein, but does not independently enforce all legacy salad protein allowlist rules. | Legacy enforcement in `mealSlotPlannerService.js:351-406`; v3 canonical path validates relations and extra protein at `canonicalMealSlotPlannerService.js:581-595`, but does not call the legacy allowlist. | Add a backend decision: either enforce allowlist in v3 or document dashboard relation ownership as the source of truth. |
| 6. Premium pricing | Partially accurate | Runtime/fallback pricing is right, but v3 premium protein fee source is relation `extraPriceHalala` first, then option fee, not simply "dashboard option/relation prices." | `canonicalMealSlotPlannerService.js:598-705`; premium salad pricing from `premiumLargeSaladPricingService.js:63-105`. | Document price precedence per selection type. |
| 7. Add-ons / extras | Partially accurate | Correctly separates plan entitlements from daily menu-product choices, but omits `wallet` day source and uses incomplete payment reason naming. | `SubscriptionDay.addonSelections.source` includes `wallet` in `src/models/SubscriptionDay.js:210-213`; payment requirement uses `ADDON_PAYMENT_REQUIRED` in `subscriptionDayCommercialStateService.js:351` and tests at `tests/mealPlannerPaymentContract.test.js:84,586`. | Add `wallet`; replace planner add-on payment guidance with `ADDON_PAYMENT_REQUIRED`. |
| 8. Dashboard guide | Missing details | It does not say the dashboard must manage CatalogItem links/global availability, which can cause Flutter catalog rows to disappear. | Availability checks call `loadCatalogItemsByIdForDocs` and `filterGloballyAvailable` in `subscriptionAddonChoicesService.js:122-126` and canonical validation at `canonicalMealSlotPlannerService.js:413-421`. | Add a publish/global availability checklist. |
| 9. Flutter guide | Partially accurate | Good sequence, but it tells Flutter to handle `ONE_TIME_ADDON_PAYMENT_REQUIRED`; current planner payment requirement and confirm use `ADDON_PAYMENT_REQUIRED`. | `subscriptionDayCommercialStateService.js:351`; `subscriptionSelectionService.js:923`; tests at `tests/mealPlannerPaymentContract.test.js:84,586` and `tests/mealPlanner.integration.test.js:1095`. | Correct error codes and add a response/error code matrix. |
| 10. Validation matrix | Partially accurate | Matrix combines legacy and v3 rules without distinguishing enforcement layer. | v3 canonical validation at `canonicalMealSlotPlannerService.js:360-760`; legacy validation at `mealSlotPlannerService.js:300-430`. | Split validation matrix into v3 canonical and legacy compatibility columns. |
| 11. Pricing and payment | Missing details | It does not cover revision hash requirements, reusable payments, wallet source, or no-payment responses. | Revision/payment state in `subscriptionDayCommercialStateService.js:270-371`; unified payment tests in `tests/mealPlannerPaymentContract.test.js:620-756`. | Add unified day payment lifecycle details. |
| 12. Bootstrap/seed | Accurate with caveat | Commands and plan expectations are correct, but readiness depends on published menu products and relations, not just running seeds. | Plan seed contract in `tests/seedSubscriptionPlans.test.js`; catalog contract in `tests/seedCatalogCanonicalV3Contract.test.js`. | Add "post-seed checks" for required product keys and publish state. |
| 13. Tests | Partially accurate | Good command list, but default `npm test` is only `meal_planner_types.test.js`, not the whole suite. | `package.json` scripts show `"test": "node tests/meal_planner_types.test.js"` and full suite under `test:all`. | Make this explicit so frontend teams do not overtrust `npm test`. |
| 14. File map | Accurate | Correct main files. Could add payment services and dashboard health services. | Unified and legacy payment services exist under `src/services/subscription/*PaymentService.js`. | Add payment services to file map. |
| 15. Integration stance | Accurate | Correct recommendation to target v3, but too optimistic until errors/examples are fixed. | v3 contract tests exist in `tests/mealPlannerCanonicalV3Write.test.js`. | Keep stance, add "source of truth after corrections" warning. |

## 3. Backend Compatibility Review

The README mostly describes the backend as it works today, but it blends three layers that should be kept separate:

- v3 product-centered planner contracts.
- legacy `mealSlots[]` compatibility contracts.
- older root-level helper/selection contracts that now return 422 or are no longer appropriate.

Mismatches and gaps:

- **Planner add-on payment code mismatch.** README references `ONE_TIME_ADDON_PAYMENT_REQUIRED` for planner save/confirm handling, but current planner payment requirement uses `ADDON_PAYMENT_REQUIRED`. Evidence: `src/services/subscription/subscriptionDayCommercialStateService.js:351`, `src/services/subscription/subscriptionSelectionService.js:923`, `tests/mealPlannerPaymentContract.test.js:84`.
- **V3 premium large salad validation is not identical to legacy validation.** Legacy code enforces allowed protein keys; v3 canonical validation relies on linked product option groups/options and only explicitly blocks extra protein. Evidence: `src/services/subscription/mealSlotPlannerService.js:351-406` vs `src/services/subscription/canonicalMealSlotPlannerService.js:581-595`.
- **README omits public `/api/subscriptions/delivery-options`.** Evidence: `src/routes/subscriptions.js:83`.
- **README omits many real client subscription endpoints.** Quote, checkout, checkout drafts, days list, today, pickup, fulfillment, skip/unskip, custom salad/meal, and delivery updates are real routes. Evidence: `src/routes/subscriptions.js:88-153`, `279-582`, `837-953`.
- **Dashboard/admin route exposure is under-described.** `adminRoutes` are mounted at both `/api/dashboard` and `/api/admin`. Evidence: `src/routes/index.js:72-73`.
- **Some response examples are illustrative, not guaranteed contracts.** Day save/validate responses are shaped through `shapeMealPlannerReadFields`, not simple raw service objects. Evidence: `src/services/subscription/subscriptionPlanningClientService.js:94-104`, `160-164`.
- **Legacy payload wording is ambiguous.** Legacy slot shape inside `mealSlots[]` still works; old root-level selection payloads do not. Evidence: rejection at `src/services/subscription/subscriptionSelectionService.js:483-501`.
- **The README documents `paymentRequirement` as source of truth correctly, but does not document `plannerRevisionHash`, payment reuse, or revision mismatch deeply enough.** Evidence: `src/services/subscription/subscriptionDayCommercialStateService.js:270-371`.

APIs documented but not accurately exposed:

- `/api/dashboard/menu-identity/*` was already corrected in the README to real paths. Current correct paths are `/api/dashboard/menu-identities`, `/api/dashboard/menu-identity-links`, `/api/dashboard/menu-identity-suggestions`, plus audit alias. Evidence: `src/routes/dashboardMenuIdentity.js:11-20`, `src/routes/index.js:70-71`.

Response fields that are unstable or not guaranteed:

- `plannerCatalog` is included by default now, but only when `includeV3` is true; the controller can omit it for other requested versions. Evidence: `src/controllers/menuController.js:346-383`.
- `regularMeals`, `premiumMeals`, and `addons` on `/meal-planner-menu` are only returned with `includeLegacy=true`. Evidence: `src/controllers/menuController.js:385-390`.
- v3 slot `pricingSnapshot` and `displaySnapshot` are persisted implementation details, but they are not fully described as a public Flutter contract. Evidence: `src/models/SubscriptionDay.js:74-77`, `src/services/subscription/canonicalMealSlotPlannerService.js:696-746`.

## 4. Dashboard Integration Problems

| Problem | Why it matters | Current backend behavior | Recommended backend fix or dashboard workaround | Priority |
| --- | --- | --- | --- | --- |
| Route surface overlap: `/api/admin/*`, `/api/dashboard/*`, `/api/dashboard/menu/*`, `/api/dashboard/meal-planner/*` | Dashboard developers can choose the wrong surface and duplicate screens. | `adminRoutes` are mounted under both `/dashboard` and `/admin`; legacy planner routes are also mounted under `/dashboard/meal-planner`. | Pick canonical dashboard paths in README and mark aliases legacy/internal. | High |
| v3 premium salad allowlist ownership unclear | Dashboard could link disallowed proteins and v3 backend may accept them if relations allow it. | Legacy path enforces allowlist; v3 path validates relation availability and extra protein exclusion. | Backend should enforce the same allowlist in v3 or dashboard must block invalid links with validation. | High |
| CatalogItem/global availability not prominent | Dashboard may show a product active/published while Flutter planner rejects it due linked catalog item state. | Backend filters/rejects via `loadCatalogItemsByIdForDocs`, `filterGloballyAvailable`, `isLinkedDocGloballyAvailable`. | Add dashboard health/validation checks before publish; document linked CatalogItem state. | High |
| Dashboard `validate` endpoint scope is unclear | Developers may assume it validates subscription planner readiness fully. | `/api/dashboard/menu/validate` exists, but planner-specific runtime checks also live in subscription validators. | Add a dedicated subscription planner readiness validator or document limitations. | Medium |
| Premium price management is spread across product price, option relation price, option fee, and legacy fallback | Dashboard pricing UI can update the wrong field. | Premium meal v3 uses relation extra price first; premium salad uses product price fallback chain. | Add field-level pricing guide in README and dashboard UI labels. | High |
| Add-on concepts are split between `Addon` plans/items and one-time `MenuProduct` choices | Dashboard may create `Addon` item rows expecting Flutter daily choices to show them. | `/addon-choices` uses one-time `MenuProduct`, not `Addon` item rows. | Rename/dashboard-label daily choices as "menu products eligible as subscription extras." | High |
| Missing single dashboard "subscription menu health" flow in README | Integration needs a go/no-go check. | Health endpoints exist: `/api/dashboard/health/subscription-menu`, `/api/dashboard/health/meal-planner` through admin routes. | Add these endpoints to dashboard checklist. | Medium |
| Stable key vs ObjectId governance is not strict enough | Flutter writes IDs but needs stable keys for state and display; dashboard edits can break IDs. | Keys exist but backend write validation uses ObjectIds and product relations. | Dashboard should treat keys as immutable; README should state which keys are reserved. | Medium |
| Publish/preview lifecycle is mentioned but not operationally detailed | Dashboard needs safe publish workflow. | Preview, diff, versions, rollback, publish, audit logs exist in `src/routes/dashboardMenu.js`. | Add a publish checklist and rollback procedure. | Medium |
| Entitlement update exists through `/api/dashboard` alias but README lists mostly `/api/admin` | Dashboard team may miss supported dashboard path. | `adminRoutes` mounted under `/dashboard`; tests use `/api/dashboard/subscriptions/:id/addon-entitlements`. | Document dashboard alias explicitly. | Low |

## 5. Flutter Integration Problems

| Problem | Why it matters | Current backend behavior | Recommended backend fix or Flutter workaround | Priority |
| --- | --- | --- | --- | --- |
| Wrong planner add-on blocking code in README | Flutter could miss the add-on payment CTA. | Current planner uses `ADDON_PAYMENT_REQUIRED`, not `ONE_TIME_ADDON_PAYMENT_REQUIRED`, for save/confirm. | README must correct code; Flutter should handle both defensively. | High |
| Response examples are too thin | Flutter needs typed models and payment fields. | Save/validate/day responses are shaped and include many derived fields. | Add real examples from contract tests for day read, save, validate, payment create, verify. | High |
| v3 vs legacy slots are easy to mix | Mixed canonical slots with legacy fields are rejected. | `PLANNER_MIXED_LEGACY_CANONICAL_SLOT` is emitted when v3 slot includes legacy fields. | Flutter should use pure v3 when `contractVersion` is v3; README should warn loudly. | High |
| Stale catalog handling is under-specified | Dashboard changes can invalidate cached IDs. | Canonical errors include stale hints for product/group/option failures. | Flutter should refresh catalog on any `PLANNER_*_NOT_FOUND/INACTIVE/UNPUBLISHED/UNAVAILABLE` and discard old selections. | High |
| `plannerCatalog`, `builderCatalogV2`, and `builderCatalog` coexist | Flutter may build UI from the wrong catalog. | Endpoint returns multiple catalogs for compatibility. | README should state `plannerCatalog` is canonical for new Flutter; ignore V1/V2 unless fallback mode. | Medium |
| Payment lifecycle lacks revision hash details | Payment creation can fail/reuse/mismatch if planner changed. | Backend computes `plannerRevisionHash` and premium extra payment revision state. | Flutter must send/store latest hash where endpoint expects it and refresh after edits. | High |
| Add-on choices are menu product IDs, not add-on IDs | Sending checkout add-on plan id will fail. | `reconcileAddonInclusions` rejects non-choice ids with `INVALID_ONE_TIME_ADDON_SELECTION`. | Flutter must source daily extras only from `/addon-choices`. | High |
| Premium balance display before save is ambiguous | Local estimates can disagree with backend balance consumption, especially after edits. | Backend recomputes premium source from subscription balance and existing day claims. | Flutter should show estimated price before save, but trust returned `paymentRequirement`. | Medium |
| Missing UI mapping for product relation pricing and grams | v3 selected options include quantity/grams/extra prices. | Backend defaults carb grams to 150 if omitted in v3; max grams enforced later. | Flutter should require explicit grams and display relation extra prices. | Medium |
| Legacy aliases should not be sent | Aliases work only in compatibility paths and add mental load. | `mealTypeMapper` maps aliases, but v3 should use canonical types. | Flutter should never emit `standard_combo` or `custom_premium_salad`. | Low |

## 6. API Contract Gaps

| Endpoint | Consumer | Status | Notes |
| --- | --- | --- | --- |
| `GET /api/subscriptions/menu` | Flutter | Stable | Public checkout menu; active plans are returned without `Plan.isViable()` filtering. |
| `GET /api/subscriptions/meal-planner-menu` | Flutter | Stable/Partial | Public; returns compatibility catalogs plus v3 by default. Needs stronger typed examples. |
| `GET /api/subscriptions/delivery-options` | Flutter | Stable | Exists but missing from README API section. |
| `GET /api/subscriptions/addon-choices` | Flutter | Stable | Public daily add-on choice catalog from one-time menu products. |
| `GET /api/subscriptions/current/overview` | Flutter | Stable | Authenticated summary. |
| `POST /api/subscriptions/quote` | Flutter | Stable | Missing from README endpoint table. |
| `POST /api/subscriptions/checkout` | Flutter | Stable | Missing from README endpoint table. |
| `GET /api/subscriptions/checkout-drafts/:draftId` | Flutter | Stable | Missing from README endpoint table. |
| `POST /api/subscriptions/checkout-drafts/:draftId/verify-payment` | Flutter | Stable | Missing from README endpoint table. |
| `GET /api/subscriptions/:id` | Flutter | Stable | Missing from README endpoint table. |
| `GET /api/subscriptions/:id/timeline` | Flutter | Stable | Documented. |
| `GET /api/subscriptions/:id/days` | Flutter | Stable | Exists; README focuses on day detail only. |
| `GET /api/subscriptions/:id/today` | Flutter | Stable | Missing from README. |
| `GET /api/subscriptions/:id/days/:date` | Flutter | Stable | Documented. |
| `POST /api/subscriptions/:id/days/:date/selection/validate` | Flutter | Stable/Partial | Documented; examples need exact shaped response/error details. |
| `PUT /api/subscriptions/:id/days/:date/selection` | Flutter | Stable/Partial | Documented; root legacy payload unsupported. |
| `PUT /api/subscriptions/:id/days/selections/bulk` | Flutter | Partial | Documented; failures are per-date inside summary. |
| `POST /api/subscriptions/:id/days/:date/confirm` | Flutter | Stable/Partial | Documented; payment error codes need correction. |
| `POST /api/subscriptions/:id/days/:date/payments` | Flutter | Stable/Partial | Documented; request/response fields insufficient. |
| `POST /api/subscriptions/:id/days/:date/payments/:paymentId/verify` | Flutter | Stable/Partial | Documented; response fields insufficient. |
| `POST /api/subscriptions/:id/days/:date/premium-extra/payments` | Flutter | Legacy | Exists; new Flutter should prefer unified day payment. |
| `POST /api/subscriptions/:id/days/:date/one-time-addons/payments` | Flutter | Legacy | Exists; new Flutter should prefer unified day payment. |
| `POST|DELETE /api/subscriptions/:id/addon-selections` | Flutter | Legacy/Do not use | Exists but returns 422 for new use. |
| `POST|DELETE /api/subscriptions/:id/premium-selections` | Flutter | Legacy/Do not use | Exists but returns 422 for new use. |
| `POST /api/subscriptions/:id/addons/one-time` | Flutter | Legacy/Unclear | Exists but not covered; should be marked legacy or documented if still supported. |
| `POST /api/subscriptions/:id/days/:date/custom-salad` | Flutter | Legacy/Separate flow | Exists; not part of canonical planner. |
| `POST /api/subscriptions/:id/days/:date/custom-meal` | Flutter | Legacy/Separate flow | Exists; not part of canonical planner. |
| `PUT /api/subscriptions/:id/days/:date/delivery` | Flutter | Stable | Missing from README endpoint table. |
| `POST /api/subscriptions/:id/days/:date/pickup/prepare` | Flutter | Stable | Missing from planner API table. |
| `GET /api/subscriptions/:id/days/:date/pickup/status` | Flutter | Stable | Missing from planner API table. |
| `GET /api/subscriptions/:id/days/:date/fulfillment/status` | Flutter | Stable | Missing from planner API table. |
| `POST /api/subscriptions/:id/days/:date/skip` | Flutter | Stable | Missing from endpoint table. |
| `POST /api/subscriptions/:id/days/:date/unskip` | Flutter | Stable | Missing from endpoint table. |
| `POST /api/subscriptions/:id/skip-range` | Flutter | Stable | Missing from endpoint table. |
| `/api/dashboard/menu/*` | Dashboard | Stable | Product-centered catalog management. |
| `/api/dashboard/meal-planner/*` | Dashboard | Legacy | Same as `/api/admin/meal-planner-menu/*`; should not be primary for v3 product-centered catalog. |
| `/api/admin/meal-planner-menu/*` | Dashboard/Internal | Legacy | Exists; use only for legacy planner screens. |
| `/api/dashboard/plans*` and `/api/admin/plans*` | Dashboard | Stable | Exposed through `adminRoutes` under both mounts; README only emphasizes `/api/admin`. |
| `/api/dashboard/addons*` and `/api/admin/addons*` | Dashboard | Stable | Exposed through `adminRoutes` under both mounts; tests use dashboard paths. |
| `/api/dashboard/subscriptions/:id/addon-entitlements` | Dashboard | Stable | GET exists in dashboard route; PATCH exists via admin route mount. |
| `/api/dashboard/subscriptions/:id/balances` | Dashboard | Partial | GET dashboard route; PATCH via admin route with stricter roles. |
| `/api/dashboard/health/subscription-menu` | Dashboard | Stable | Missing from README improvement checklist. |
| `/api/dashboard/health/meal-planner` | Dashboard | Stable | Missing from README improvement checklist. |

Missing endpoint: a single planner catalog readiness endpoint that verifies required v3 product keys, product-option relations, publish state, CatalogItem availability, premium salad rules, and add-on choice mappings in one response.

Endpoints that exist but should not be used by new frontend work:

- `/api/subscriptions/:id/addon-selections`
- `/api/subscriptions/:id/premium-selections`
- legacy-specific `/premium-extra/payments` and `/one-time-addons/payments` unless maintaining old clients
- `/api/admin/meal-planner-menu/*` for new product-centered dashboard screens

## 7. Data Model / Domain Problems

- **Add-on is overloaded.** `Addon` is used for checkout plan entitlements and item-style rows, while daily add-on choices are actually `MenuProduct` rows. Flutter should never assume an add-on id from checkout is valid for `addonsOneTime`.
- **Premium selection ownership is duplicated.** Premium state lives in `Subscription.premiumBalance`, `Subscription.premiumSelections`, `SubscriptionDay.mealSlots`, and `SubscriptionDay.premiumUpgradeSelections`. The backend coordinates them, but frontend should rely on day read and `paymentRequirement`, not mutate or infer from global balances.
- **Meal slot schema mixes v3 and legacy.** `SubscriptionDay.mealSlots[]` has `productId`/`selectedOptions` and legacy `proteinId`/`carbs`/`sandwichId`/`salad` fields. Flutter should write pure v3 and treat legacy fields as read compatibility.
- **`proteinId` points at different conceptual sources.** Schema refs still point to `BuilderProtein`, but v3 canonical slots can store `MenuOption` ids in `proteinId`. This is operationally useful but domain-confusing. Flutter should not use `proteinId` from v3 reads as a `BuilderProtein` id.
- **Premium large salad product fallback can hide catalog issues.** If `premium_large_salad` is absent, `basic_salad` may be used. That is convenient but can make dashboard state ambiguous.
- **Stable keys are not fully governed in docs.** Keys like `basic_meal`, `proteins`, `carbs`, `premium_large_salad`, `basic_salad`, and add-on source category keys should be immutable/reserved.
- **Identity mapping is dashboard governance, not runtime planner dependency.** README should avoid implying Flutter needs identity mapping for planner writes.
- **Legacy config fallback fields still matter.** `BuilderProtein`, `BuilderCarb`, `SaladIngredient`, `Meal`, and `MealCategory` remain in compatibility paths. They should be deprecated only with a migration plan.

Fields Flutter should never rely on as write sources:

- `materializedMeals`
- `baseMealSlots`
- `selections`
- `premiumUpgradeSelections`
- `premiumSelections`
- `pricingSnapshot` as an authoritative future price
- legacy `carbId` / `carbSelections`
- `proteinId` as a stable catalog id in v3

## 8. Validation and Pricing Risks

- **Standard meal validation risk:** v3 uses product/group/option relations and checks premium-vs-standard protein; legacy uses protein/carb maps. Dashboard can create relations that expose options Flutter should not use if product relations are wrong.
- **Sandwich validation risk:** v3 accepts cold sandwich `MenuProduct`; legacy supports `Meal`/`Sandwich` fallback. Flutter must not mix `sandwichId` with v3 `productId`.
- **Premium large salad validation risk:** legacy path enforces allowed protein keys and salad group rules from config; v3 path trusts product relation min/max for most group constraints. Dashboard must not link disallowed proteins, or backend should enforce allowlist in v3.
- **Extra protein risk:** backend excludes `extra_protein_50g` for subscription premium large salad, but dashboard can still create/link the group. Publish validation should catch this before Flutter sees it.
- **Add-ons validation risk:** `/addon-choices` filters one-time products by active/published/category/channel. A product visible in one-time menu may still be rejected if category/key mapping does not match.
- **Hidden/inactive validation risk:** v3 canonical writes reject product/group/option inactive/unpublished/unavailable and linked CatalogItem unavailable. Flutter cached selections can go stale after dashboard publish.
- **Product relation validation risk:** v3 requires product-to-group and product-to-option relations. Listing raw options is not enough.
- **Premium balance risk:** validation uses a draft view and save consumes balances transactionally. A stale Flutter estimate can disagree with save result under concurrent edits.
- **Payment required risk:** README currently names add-on planner payment as `ONE_TIME_ADDON_PAYMENT_REQUIRED`, but current day planner uses `ADDON_PAYMENT_REQUIRED`.
- **Pricing risk:** premium meal option fee can come from relation `extraPriceHalala`; premium salad fee comes from product price fallback. Dashboard UI must expose the correct field for each selection type.
- **Legacy fallback pricing risk:** fallback `2900` can keep catalog alive when dashboard product is missing, but that may mask a production catalog setup error.

Where Flutter/Dashboard might show something backend later rejects:

- Product is active in dashboard but unpublished or CatalogItem unavailable.
- Option exists globally but is not linked to the selected product.
- Extra protein appears in a salad product but is rejected for subscription premium salad.
- Add-on product belongs to a category not mapped by `/addon-choices`.
- Flutter caches old option ids after a dashboard publish/rollback.
- Dashboard links premium proteins into standard section or standard proteins into premium section.

## 9. Test Coverage Gaps

Well covered:

- Planner type and premium salad business rules: `tests/meal_planner_types.test.js`.
- Canonical planner read/write: `tests/mealPlannerCanonicalContract.test.js`, `tests/mealPlannerCanonicalV3Write.test.js`.
- Payment requirement and unified day payments: `tests/mealPlannerPaymentContract.test.js`.
- Add-on entitlement and daily paid add-ons: `tests/subscription_addon_selection_contract.test.js`, `tests/subscription_addon_selection_readback.integration.test.js`.
- Builder catalog v2/v3 contracts: `tests/builderCatalogV2Contract.test.js`, `tests/seedCatalogCanonicalV3Contract.test.js`.
- Dashboard product-centered menu composer and CRUD: `tests/dashboardMenuProductCenteredContract.test.js`, `tests/weeklyMenuDashboard.test.js`.
- Checkout add-on plan pricing: `tests/checkout.integration.test.js`.
- Bootstrap orchestration and plan seed: `tests/bootstrapOrchestrator.test.js`, `tests/seedSubscriptionPlans.test.js`.
- Mobile broad contracts: `tests/mobileApiContracts.test.js`.

Weakly covered:

- Dashboard publish-to-Flutter planner full E2E with real dashboard-created premium salad/product relations.
- v3 premium large salad disallowed protein allowlist enforcement.
- README examples as executable contract fixtures.
- CatalogItem unavailable state in subscription planner writes across all product/option types.
- Route alias parity between `/api/admin` and `/api/dashboard`.

Not covered enough:

- A single test that creates catalog through dashboard endpoints, publishes, fetches `/meal-planner-menu`, saves v3 slots in Flutter shape, creates unified payment, verifies, and confirms.
- Dashboard validation rejecting subscription premium salad with `extra_protein_50g` or disallowed proteins before publish.
- Flutter stale catalog refresh behavior after option/product deactivation.
- `wallet` add-on source behavior in full API flow.

Tests to add before integration:

- `tests/subscriptionPlannerDashboardToFlutter.e2e.test.js`
- `tests/premiumLargeSaladV3Allowlist.test.js`
- `tests/subscriptionPlannerStaleCatalog.test.js`
- `tests/subscriptionPlannerReadmeExamples.test.js`
- `tests/dashboardSubscriptionMenuReadiness.test.js`

## 10. Recommended Backend Improvements

### Must Fix Before Dashboard/Flutter Integration

| Problem | Recommended change | Files likely involved | Risk level | Suggested test |
| --- | --- | --- | --- | --- |
| README has wrong planner add-on payment code | Update README to use `ADDON_PAYMENT_REQUIRED` for planner payment requirement/confirm, optionally mention legacy/prep codes separately. | `docs/SUBSCRIPTION_MENU_SYSTEM_README.md` | High | README examples test or `mealPlannerPaymentContract` doc snapshot. |
| v3 premium salad allowlist enforcement unclear | Enforce `SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS` in `canonicalMealSlotPlannerService`, or add dashboard validation that blocks invalid links. | `src/services/subscription/canonicalMealSlotPlannerService.js`, `src/services/orders/menuCatalogService.js`, dashboard validation service | High | `tests/premiumLargeSaladV3Allowlist.test.js`. |
| Missing single readiness contract for dashboard | Add or document a subscription menu health/readiness endpoint that validates required keys, publish state, relations, CatalogItem availability, prices, and add-on mappings. | `src/services/dashboardHealthService.js`, `src/controllers/dashboardHealthController.js`, `src/routes/admin.js` | High | `tests/dashboardSubscriptionMenuReadiness.test.js`. |
| Payment create/verify contract underspecified | Document and/or stabilize request/response fields for unified day payment. | `src/services/subscription/unifiedDayPaymentService.js`, README | High | Expand `tests/mealPlannerPaymentContract.test.js` assertions into doc examples. |

### Should Fix Soon

| Problem | Recommended change | Files likely involved | Risk level | Suggested test |
| --- | --- | --- | --- | --- |
| Admin/dashboard alias confusion | Choose canonical dashboard paths and mark `/api/admin` as admin alias for internal/backoffice. | README/routes docs | Medium | Route parity smoke test. |
| `proteinId` semantic ambiguity in v3 | Add explicit `optionId`/`proteinOptionId` aliases in read payload or document that v3 `proteinId` is operational compatibility only. | serialization/read services | Medium | Canonical V3 read contract test. |
| Active plans not viability-filtered | Either document it clearly or filter by `Plan.isViable()` if product wants that. | `src/controllers/menuController.js`, `Plan` | Medium | Subscription menu plan viability test. |
| Add-on daily choices tied to one-time products | Rename docs/UI labels and maybe expose `sourceType: menu_product`. | `subscriptionAddonChoicesService.js` | Medium | Add-on choices contract test. |
| README endpoint table incomplete | Add all related endpoints with consumer/status classification. | README | Low | Documentation-only. |

### Nice To Have

| Problem | Recommended change | Files likely involved | Risk level | Suggested test |
| --- | --- | --- | --- | --- |
| Too many compatibility catalogs in one response | Add `?contractVersion=meal_planner_menu.v3&compat=false` option later if needed. | `menuController`, `CatalogService` | Low | Catalog response contract test. |
| Legacy root selection paths still visible | Keep endpoints but make deprecation messaging more discoverable in API docs. | Swagger docs/routes | Low | Deprecated endpoint test. |
| Price source labeling could be clearer | Add `priceSource`/`feeSource` consistently to premium meal options too. | `CatalogService`, canonical planner service | Low | Builder catalog contract test. |

## 11. README Improvement Recommendations

Do not expand blindly. Correct and simplify:

- Correct planner add-on codes from `ONE_TIME_ADDON_PAYMENT_REQUIRED` to `ADDON_PAYMENT_REQUIRED` where referring to day planner save/confirm.
- Add an endpoint classification table using the real paths in section 6 of this review.
- Separate v3 canonical validation from legacy `mealSlots[]` compatibility validation.
- Clarify that old root-level `selections`/`premiumSelections` write payloads are not supported for day selection.
- Add real response examples for:
  - `GET /api/subscriptions/meal-planner-menu`
  - `POST /selection/validate`
  - `PUT /selection`
  - `POST /payments`
  - `POST /payments/:paymentId/verify`
  - validation stale errors
- Add a "Dashboard publish readiness checklist":
  - required product keys
  - required group keys
  - product-group relations
  - product-option relations
  - active/visible/available/published
  - CatalogItem link/global availability
  - premium salad excluded groups
  - add-on choice category mapping
- Explain route alias policy:
  - canonical dashboard menu: `/api/dashboard/menu/*`
  - legacy planner admin: `/api/dashboard/meal-planner/*` and `/api/admin/meal-planner-menu/*`
  - admin routes mounted at both `/api/dashboard/*` and `/api/admin/*`
- Add a clear "Flutter must not rely on" list for derived fields.
- Add payment lifecycle diagram with `plannerRevisionHash`, `requiresPayment`, `canCreatePayment`, create, verify, refresh, confirm.
- Add a seed verification section: after seed, check required products/relations are published, not just that scripts ran.

## 12. Final Decision

Can this README be used as the source of truth for Dashboard and Flutter now?

**No, fix blockers first.**

It is directionally useful and mostly compatible with the current backend, but it has enough contract drift and missing detail that a frontend team could make wrong implementation choices. The blockers are:

- Wrong planner add-on payment error code guidance.
- Missing endpoint classification for many real subscription flows.
- Ambiguous v3 vs legacy validation rules.
- Unclear dashboard ownership of v3 premium large salad option validity.
- Insufficient payment create/verify response examples.

After those are corrected, the README can become the source of truth with confidence.
=======
# Subscription Menu / Meal Planner Backend Review

Status: READY FOR DASHBOARD/FLUTTER CONTRACT REVIEW

## Blocker Review

1. Premium Large Salad v3 Allowlist Enforcement: fixed.
   Evidence: `src/services/subscription/canonicalMealSlotPlannerService.js`, `tests/premiumLargeSaladV3Allowlist.test.js`.

2. Unified Day Payment Contract Hardening: fixed.
   Evidence: `src/services/subscription/unifiedDayPaymentService.js`, `tests/mealPlannerPaymentContract.test.js`.

3. Dashboard Subscription Planner Readiness Check: fixed.
   Evidence: `src/services/dashboardHealthService.js`, `tests/dashboardSubscriptionMenuReadiness.test.js`.

4. Stale Catalog Error Matrix: fixed.
   Evidence: `src/services/subscription/canonicalMealSlotPlannerService.js`, `tests/subscriptionPlannerStaleCatalog.test.js`.

5. Dashboard-to-Flutter Subscription Planner E2E: fixed.
   Evidence: `tests/subscriptionPlannerDashboardToFlutter.e2e.test.js`.

## Remaining Risks

- Production payment verification still needs real Moyasar staging/live verification.
- Environment secrets and callback URLs must be validated outside unit/integration tests.
- Dashboard/Flutter can start against this contract, but final request/response examples should be frozen during contract review.

## Verification Evidence

Passing targeted commands:

```bash
NODE_ENV=test node tests/premiumLargeSaladV3Allowlist.test.js
NODE_ENV=test node tests/mealPlannerPaymentContract.test.js
NODE_ENV=test node tests/dashboardSubscriptionMenuReadiness.test.js
NODE_ENV=test node tests/subscriptionPlannerStaleCatalog.test.js
NODE_ENV=test node tests/subscriptionPlannerDashboardToFlutter.e2e.test.js
```

The broad suite and backend validator should still be run before merge/deploy:

```bash
npm test
npm run validate:backend
```
>>>>>>> f664f6cc (docs: addnig new md ref for SUBSCRIPTION_MENU_SYSTEM_SOURCE_OF_TRUTH)
