<<<<<<< HEAD
# Subscription Menu System Source of Truth

Reference date: 2026-06-07  
Source documents: `docs/SUBSCRIPTION_MENU_SYSTEM_README.md`, `docs/SUBSCRIPTION_MENU_SYSTEM_REVIEW.md`  
Scope: backend reference, integration readiness, problem inventory, and fix planning. Runtime backend behavior was not changed.

This document is intentionally strict. It preserves the current system truth: the subscription menu backend is useful and partly integrated, but it is not yet a final Dashboard/Flutter contract.

## 1. Executive Status

| Area | Status | Decision |
| --- | --- | --- |
| Subscription menu backend | PARTIALLY READY | `GET /api/subscriptions/menu` exists and returns active subscription plans, checkout add-on plans, item add-ons, delivery, and planner catalog data, but checkout, quote, draft, and plan viability behavior need stronger documentation. Active plans are not filtered through `Plan.isViable()`. |
| Weekly meal planner | PARTIALLY READY | Day read, validate, save, bulk save, confirm, payment, pickup, and fulfillment APIs exist, but v3 canonical and legacy compatibility paths coexist and the response/error contract is not fully hardened. |
| Premium large salad / premium selections | PARTIALLY READY | Legacy premium large salad validation and runtime pricing fallback exist. v3 canonical validation relies on dashboard product-option relations and extra-protein exclusion, but does not independently enforce every legacy protein allowlist rule. |
| Add-ons / extras | PARTIALLY READY | Checkout add-on entitlements and day-level daily add-ons exist. The confusing part is ownership: daily add-on choices are `MenuProduct` rows, not generic `Addon` rows. Wallet and paid sources need clearer contracts. |
| Dashboard integration | PARTIALLY READY | Product-centered dashboard menu CRUD, composer, publish, validate, plans, add-ons, entitlements, balances, and health endpoints exist. Risks remain around route aliases, publish readiness, CatalogItem availability, and premium salad governance. |
| Flutter integration | PARTIALLY READY | Flutter can target `plannerCatalog` and pure v3 `mealSlots[]`, but stale catalog handling, payment lifecycle fields, legacy fallback behavior, and error matrices need hardening before final integration. |
| Bootstrap/seed | PARTIALLY READY | Subscription plan, add-on, one-time menu, bootstrap, catalog, and dashboard-user seed scripts exist. Readiness still depends on published products, product-group relations, product-option relations, and globally available linked `CatalogItem` rows. |
| Tests | PARTIALLY READY | Strong targeted tests exist for planner types, v3 writes, payments, add-ons, dashboard menu, mobile contracts, checkout, seeds, and bootstrap. Missing coverage includes full dashboard-to-Flutter E2E, v3 premium salad allowlist enforcement, stale catalog refresh, and doc examples as fixtures. |

Current final decision: No, fix blockers first before using this as the Dashboard/Flutter implementation contract.

## 2. System Map

| Area | What it is | Main backend files | Main APIs | Main tests | Current readiness | Known problems |
| --- | --- | --- | --- | --- | --- | --- |
| One-time menu | Product-centered menu for normal orders and daily extras. | `src/services/orders/menuCatalogService.js`, `src/routes/orders.js`, `src/models/MenuProduct.js`, `src/models/MenuOption.js`, `src/models/MenuOptionGroup.js` | `GET /api/orders/menu`, dashboard product APIs under `/api/dashboard/menu/*` | `tests/oneTimeMenuCatalog.test.js`, `tests/oneTimeOrderFullFlow.test.js`, `tests/dashboardMenuProductCenteredContract.test.js` | PARTIALLY READY | Daily subscription add-ons depend on one-time `MenuProduct` categories and publication state. |
| Subscription menu | Public catalog for subscription checkout. | `src/controllers/menuController.js`, `src/routes/subscriptions.js`, `src/models/Plan.js`, `src/models/Addon.js` | `GET /api/subscriptions/menu`, `POST /api/subscriptions/quote`, `POST /api/subscriptions/checkout` | `tests/mobileApiContracts.test.js`, `tests/checkout.integration.test.js`, `tests/seedSubscriptionPlans.test.js` | PARTIALLY READY | Active plans are returned without `Plan.isViable()` filtering; quote/checkout/draft contracts are under-documented. |
| Weekly meal planner | Customer planning flow for subscription days. | `src/controllers/subscriptionController.js`, `src/services/subscription/subscriptionPlanningClientService.js`, `src/services/subscription/subscriptionSelectionService.js`, `src/models/SubscriptionDay.js` | `GET /api/subscriptions/:id/days/:date`, `PUT /selection`, `POST /selection/validate`, `POST /confirm` | `tests/mealPlannerCanonicalContract.test.js`, `tests/mealPlannerCanonicalV3Write.test.js`, `tests/mealPlannerPaymentContract.test.js` | PARTIALLY READY | v3 and legacy paths coexist; examples and error responses need hardening. |
| v3 canonical planner | Product-centered planner contract using `MenuProduct`, `MenuOptionGroup`, `MenuOption`, and relation IDs. | `src/services/subscription/canonicalMealSlotPlannerService.js`, `src/services/orders/menuCatalogService.js` | `GET /api/subscriptions/meal-planner-menu`, v3 `mealSlots[]` writes | `tests/mealPlannerCanonicalV3Write.test.js`, `tests/seedCatalogCanonicalV3Contract.test.js` | PARTIALLY READY | Product/group/option relations and linked `CatalogItem` availability can cause stale frontend selections. |
| Legacy planner compatibility | Older builder catalog and legacy slot support inside `mealSlots[]`. | `src/services/subscription/mealSlotPlannerService.js`, `src/utils/subscription/mealTypeMapper.js`, `src/models/BuilderProtein.js`, `src/models/BuilderCarb.js` | Same day planner endpoints when request is not v3 canonical | `tests/meal_planner_types.test.js`, `tests/builderCatalogV2Contract.test.js` | PARTIALLY READY | Root-level old `selections` and `premiumSelections` write payloads are not supported for day selection. |
| Premium large salad | Premium subscription salad selection. | `src/services/subscription/canonicalMealSlotPlannerService.js`, `src/services/subscription/mealSlotPlannerService.js`, `src/services/catalog/premiumLargeSaladPricingService.js` | v3 `mealSlots[]` with `selectionType: "premium_large_salad"` | `tests/meal_planner_types.test.js`, `tests/mealPlannerPaymentContract.test.js` | PARTIALLY READY | v3 allowlist ownership is unclear; fallback product pricing can hide catalog setup gaps. |
| Premium selections | Premium meal or salad selections that consume balance or require payment. | `src/services/subscription/subscriptionDayCommercialStateService.js`, `src/services/subscription/unifiedDayPaymentService.js`, `src/models/Subscription.js`, `src/models/SubscriptionDay.js` | Day planner save/confirm/payment APIs | `tests/mealPlannerPaymentContract.test.js`, `tests/subscriptionBalancePolicy.test.js` | PARTIALLY READY | Premium state is represented in subscription balance, day slots, and compatibility fields. Flutter should trust returned day state. |
| Add-ons / extras | Checkout entitlements plus day-level daily extras. | `src/models/Addon.js`, `src/services/subscription/subscriptionAddonChoicesService.js`, `src/services/subscription/subscriptionSelectionService.js` | `GET /api/subscriptions/addon-choices`, `addonsOneTime` on planner save | `tests/subscription_addon_selection_contract.test.js`, `tests/subscription_addon_selection_readback.integration.test.js` | PARTIALLY READY | `Addon` is overloaded; daily add-on IDs must come from `MenuProduct` choices. |
| Dashboard catalog | Backoffice product-centered catalog and composer. | `src/routes/dashboardMenu.js`, `src/controllers/dashboard/menuController.js`, `src/services/orders/menuCatalogService.js` | `/api/dashboard/menu/*` | `tests/dashboardMenuProductCenteredContract.test.js`, `tests/weeklyMenuDashboard.test.js` | PARTIALLY READY | Dashboard validation does not yet serve as a full subscription planner readiness gate. |
| Seeded/bootstrap catalog | Scripts that create plans, catalog, dashboard users, and compatibility rows. | `scripts/bootstrap/index.js`, `scripts/bootstrap/seed-catalog.js`, `scripts/seed-subscription-plans.js`, `scripts/seed-one-time-menu.js` | CLI scripts | `tests/bootstrapOrchestrator.test.js`, `tests/seedCatalogCanonicalV3Contract.test.js`, `tests/seedSubscriptionPlans.test.js` | PARTIALLY READY | Running seeds is not enough; publish/global availability checks are required. |
| Payment-required flow | Commercial state for premium and daily add-on overages. | `src/services/subscription/subscriptionDayCommercialStateService.js`, `src/services/subscription/unifiedDayPaymentService.js`, `src/services/subscription/subscriptionPaymentPayloadService.js` | `POST /api/subscriptions/:id/days/:date/payments`, `POST /payments/:paymentId/verify` | `tests/mealPlannerPaymentContract.test.js` | PARTIALLY READY | `plannerRevisionHash`, payment reuse, no-payment case, and revision mismatch need stable public examples. |
| Fulfillment/pickup flow | Day execution readiness, pickup prepare/status, fulfillment polling. | `src/services/subscription/subscriptionPickupPreparationService.js`, `src/services/subscription/subscriptionDayExecutionValidationService.js`, `src/routes/subscriptions.js` | `/pickup/prepare`, `/pickup/status`, `/fulfillment/status` | `tests/fulfillmentContract.test.js`, `tests/subscriptionPickupRequestRoutes.test.js` | PARTIALLY READY | Planner payment/blocking errors can also block pickup/fulfillment preparation. |

## 3. Route Surfaces and Aliases

| Route family | Consumer | Canonical or legacy | Should new Dashboard use it? | Should Flutter use it? | Notes |
| --- | --- | --- | --- | --- | --- |
| `/api/subscriptions/*` | Flutter/mobile customer client | Canonical customer surface with some legacy endpoints | No | Yes | Public catalog routes exist before auth; subscription, planner, payment, skip, pickup, delivery, and legacy helpers are after auth. |
| `/api/dashboard/menu/*` | Dashboard | Canonical product-centered menu surface | Yes | No | Use for categories, products, options, option relations, preview, validate, publish, versions, rollback, diff, and audit logs. |
| `/api/dashboard/meal-planner/*` | Dashboard/admin | Legacy planner admin alias | Only for legacy screens | No | Mounted to the same router as `/api/admin/meal-planner-menu/*`. Do not use for new v3 product-centered catalog work. |
| `/api/admin/meal-planner-menu/*` | Admin/internal | Legacy planner admin surface | Only for legacy/admin maintenance | No | Manages legacy builder categories, proteins, premium proteins, sandwiches, carbs, add-ons, and salad ingredients. |
| `/api/dashboard/*` | Dashboard | Mixed canonical dashboard and admin alias | Yes, selectively | No | Includes dashboard boards, menu identities, subscriptions, catalog items, ops, accounting, and the full `adminRoutes` alias. |
| `/api/admin/*` | Admin/internal | Admin alias | Prefer `/api/dashboard/*` for dashboard UI | No | Same `adminRoutes` are mounted under `/api/dashboard` and `/api/admin`. This creates duplicate paths for many plan/add-on/subscription endpoints. |
| `/api/dashboard/menu-identities*` | Dashboard/admin | Canonical identity governance | Yes, for identity governance | No | Also mounted as `/api/dashboard/menu-identities-audit/*` because the same router is mounted there. |
| `/api/dashboard/catalog-items/*` | Dashboard/admin | Canonical catalog item management | Yes | No | Linked `CatalogItem` global availability affects Flutter planner visibility/rejection. |
| `/api/dashboard/health/*` and `/api/admin/health/*` | Dashboard/admin | Health/readiness | Yes | No | `adminRoutes` exposes `/health/catalog`, `/health/subscription-menu`, `/health/meal-planner`, and `/health/indexes` under both dashboard and admin aliases. |

New dashboard work should prefer the product-centered `/api/dashboard/menu/*` APIs where applicable.
Legacy planner admin surfaces should be treated as compatibility/admin-only unless a specific screen requires them.

## 4. Complete API Contract Table

| Method | Endpoint | Consumer | Status | Auth/Role | Purpose | Request Notes | Response Notes | Important Errors | Source Files |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/subscriptions/menu` | Flutter | Stable/Partial | Public | Public subscription checkout menu. | Query behavior is minimal; currently active plan query. | Returns plans, checkout add-on plans/items, delivery config, and planner sections. Active plans are not filtered by `Plan.isViable()`. | Needs backend contract hardening for plan viability semantics. | `src/routes/subscriptions.js`, `src/controllers/menuController.js` |
| GET | `/api/subscriptions/meal-planner-menu` | Flutter | Stable/Partial | Public | Planner catalog. | `includeLegacy=true` returns legacy fields; `version`/`contractVersion` affect v3 inclusion. | `plannerCatalog` is canonical for new Flutter when v3 included; compatibility catalogs may also appear. | Stale catalog prevention depends on dashboard publish and global availability. | `src/routes/subscriptions.js`, `src/controllers/menuController.js` |
| GET | `/api/subscriptions/delivery-options` | Flutter | Stable | Public | Delivery zones/options for subscription checkout/planning. | No body. | Delivery option payload from menu controller. | Needs examples if Flutter depends on exact fields. | `src/routes/subscriptions.js`, `src/controllers/menuController.js` |
| GET | `/api/subscriptions/addon-choices` | Flutter | Stable/Partial | Public | Daily add-on choices for planner. | No body. | Returns one-time `MenuProduct` choices grouped by mapped add-on categories. | `INVALID_ONE_TIME_ADDON_SELECTION` when planner receives IDs not in choices. | `src/routes/subscriptions.js`, `src/services/subscription/subscriptionAddonChoicesService.js` |
| GET | `/api/subscriptions` | Flutter | Stable | Bearer user | List current user's subscriptions. | No body. | Current-user subscription list. | Auth/ownership errors. | `src/routes/subscriptions.js` |
| GET | `/api/subscriptions/payment-methods` | Flutter | Stable | Bearer user | List subscription payment methods. | No body. | Payment method metadata. | Needs backend contract hardening if Flutter will model it strictly. | `src/routes/subscriptions.js` |
| GET | `/api/subscriptions/current/overview` | Flutter | Stable | Bearer user | Current subscription overview. | No body. | Summary view for current user. | Auth/ownership errors. | `src/routes/subscriptions.js` |
| POST | `/api/subscriptions/quote` | Flutter | Stable/Partial | Bearer user | Quote subscription checkout. | Plan, premium items, add-ons, delivery details. | Pricing/quote breakdown. | Needs examples for Flutter. | `src/routes/subscriptions.js`, `src/services/subscription/subscriptionQuoteService.js` |
| POST | `/api/subscriptions/checkout` | Flutter | Stable/Partial | Bearer user, checkout limiter | Create subscription checkout/draft/payment. | `planId`, `premiumItems`, `addons`, `deliveryMode`, `deliveryAddress`. | May create draft/payment and return payment fields. | Payment provider, invalid plan, invalid add-on, delivery errors. | `src/routes/subscriptions.js`, `src/services/subscription/subscriptionCheckoutService.js` |
| GET | `/api/subscriptions/checkout-drafts/:draftId` | Flutter | Stable/Partial | Bearer user | Read checkout draft status. | `draftId` path. | Draft/payment status. | Draft not found/forbidden. | `src/routes/subscriptions.js`, `src/services/subscription/subscriptionCheckoutHelpers.js` |
| POST | `/api/subscriptions/checkout-drafts/:draftId/verify-payment` | Flutter | Stable/Partial | Bearer user | Verify checkout draft payment. | `draftId` path; provider verification data may be in body. | Payment verification and activation status. | Payment failed, draft invalid, provider errors. | `src/routes/subscriptions.js`, `src/services/subscription/subscriptionCheckoutHelpers.js` |
| POST | `/api/subscriptions/:id/activate` | Dev/internal | Dev-only | Bearer user, env gated | Activate subscription in dev. | Only registered when `ENABLE_DEV_SUBSCRIPTION_ACTIVATION=true`. | Activation result. | Not available unless env flag enabled. | `src/routes/subscriptions.js` |
| GET | `/api/subscriptions/:id/renewal-seed` | Flutter | Stable/Partial | Bearer user | Get renewal defaults. | Subscription id. | Renewal seed data. | Auth/ownership, invalid status. | `src/routes/subscriptions.js` |
| POST | `/api/subscriptions/:id/renew` | Flutter | Stable/Partial | Bearer user | Renew subscription. | Renewal body. | Renewal result/payment state. | Needs backend contract hardening for Flutter. | `src/routes/subscriptions.js` |
| POST | `/api/subscriptions/:id/pickup-requests` | Flutter | Stable | Bearer user | Create subscription pickup request. | Subscription id and request body. | Pickup request state. | Insufficient balance, inactive subscription. | `src/routes/subscriptions.js` |
| GET | `/api/subscriptions/:id/pickup-requests` | Flutter | Stable | Bearer user | List pickup requests. | Subscription id. | Pickup requests. | Auth/ownership errors. | `src/routes/subscriptions.js` |
| GET | `/api/subscriptions/:id/pickup-requests/:requestId/status` | Flutter | Stable | Bearer user | Pickup request status. | Subscription id and request id. | Status view. | Not found/forbidden. | `src/routes/subscriptions.js` |
| GET | `/api/subscriptions/:id` | Flutter | Stable | Bearer user | Subscription detail. | Subscription id. | Subscription detail. | Auth/ownership, not found. | `src/routes/subscriptions.js` |
| GET | `/api/subscriptions/:id/operations-meta` | Flutter | Stable/Partial | Bearer user | Operations metadata. | Subscription id. | Operations-related state. | Needs backend contract hardening. | `src/routes/subscriptions.js` |
| GET | `/api/subscriptions/:id/freeze-preview` | Flutter | Stable/Partial | Bearer user | Preview freeze impact. | Subscription id. | Freeze preview. | Invalid status. | `src/routes/subscriptions.js` |
| POST | `/api/subscriptions/:id/cancel` | Flutter | Stable | Bearer user | Cancel subscription. | Cancellation body. | Cancel result. | Invalid status, forbidden. | `src/routes/subscriptions.js` |
| GET | `/api/subscriptions/:id/timeline` | Flutter | Stable/Partial | Bearer user | Calendar/timeline view. | Subscription id. | Includes days, statuses, planner/payment/fulfillment derived fields. | Auth/ownership, invalid id. | `src/routes/subscriptions.js`, `src/services/subscription/subscriptionTimelineService.js` |
| POST | `/api/subscriptions/:id/freeze` | Flutter | Stable | Bearer user | Freeze subscription. | Freeze body. | Freeze result. | Invalid status/date. | `src/routes/subscriptions.js` |
| POST | `/api/subscriptions/:id/unfreeze` | Flutter | Stable | Bearer user | Unfreeze subscription. | Unfreeze body. | Unfreeze result. | Invalid status/date. | `src/routes/subscriptions.js` |
| GET | `/api/subscriptions/:id/days` | Flutter | Stable | Bearer user | List subscription days. | Subscription id; possible query filters. | Day list. | Auth/ownership. | `src/routes/subscriptions.js` |
| GET | `/api/subscriptions/:id/today` | Flutter | Stable | Bearer user | Today's subscription day. | Subscription id. | Today day view. | Auth/ownership, no day. | `src/routes/subscriptions.js` |
| GET | `/api/subscriptions/:id/days/:date` | Flutter | Stable/Partial | Bearer user | Day detail with planner read model. | Date path in ISO format. | Shaped day with `mealSlots`, `plannerRevisionHash`, `paymentRequirement`, planner meta, add-ons, and derived fields. | Auth/ownership, invalid date. | `src/routes/subscriptions.js`, `src/services/subscription/subscriptionPlanningClientService.js` |
| POST | `/api/subscriptions/:id/days/:date/selection/validate` | Flutter | Stable/Partial | Bearer user | Validate day selections without saving. | Send `contractVersion` and `mealSlots`; may include `addonsOneTime`. | Shaped validation response. | Planner validation errors; exact error matrix needs hardening. | `src/routes/subscriptions.js`, `src/services/subscription/subscriptionSelectionService.js` |
| PUT | `/api/subscriptions/:id/days/:date/selection` | Flutter | Stable/Partial | Bearer user | Save day selections. | New Flutter should send pure v3 `mealSlots[]`; `addonsOneTime` for daily add-ons. | Shaped day read fields and commercial state. | `LEGACY_DAY_SELECTION_UNSUPPORTED`, `PLANNER_MIXED_LEGACY_CANONICAL_SLOT`, payment required. | `src/routes/subscriptions.js`, `src/services/subscription/subscriptionSelectionService.js` |
| PUT | `/api/subscriptions/:id/days/selections/bulk` | Flutter | Stable/Partial | Bearer user | Bulk save multiple dates. | Either `{ dates, mealSlots, addonsOneTime }` or `{ days: [...] }`. | Summary with per-date success/failure. | Legacy payloads without `mealSlots` fail per date. | `src/routes/subscriptions.js` |
| POST | `/api/subscriptions/:id/days/:date/confirm` | Flutter | Stable/Partial | Bearer user | Confirm day planning. | No major body required. | Confirmed day if no blockers. | `PREMIUM_PAYMENT_REQUIRED`, `ADDON_PAYMENT_REQUIRED`, `PAYMENT_REQUIRED`, incomplete planner. | `src/routes/subscriptions.js`, `src/services/subscription/subscriptionSelectionService.js` |
| POST | `/api/subscriptions/:id/days/:date/payments` | Flutter | Stable/Partial | Bearer user | Create unified premium/add-on day payment. | Should send latest `plannerRevisionHash` when available. | Returns `paymentId`, `payment_id`, `premiumAmountHalala`, `addonsAmountHalala`, `totalHalala`, `plannerRevisionHash`, payment URL/provider fields when needed. | `DAY_PAYMENT_REVISION_MISMATCH`; no-payment behavior needs public examples. | `src/routes/subscriptions.js`, `src/services/subscription/unifiedDayPaymentService.js` |
| POST | `/api/subscriptions/:id/days/:date/payments/:paymentId/verify` | Flutter | Stable/Partial | Bearer user | Verify unified day payment and settle day. | `paymentId` path. | Updated day/payment state; add-on selections may be stamped with payment id. | Payment not found/failed, revision mismatch side effects. | `src/routes/subscriptions.js`, `src/services/subscription/unifiedDayPaymentService.js` |
| POST | `/api/subscriptions/:id/days/:date/premium-extra/payments` | Flutter legacy | Legacy / Do not use for new work | Bearer user | Legacy premium-only payment create. | Prefer unified day payment. | Legacy premium payment payload. | Revision mismatch and payment errors. | `src/routes/subscriptions.js`, `src/services/subscription/premiumExtraDayPaymentService.js` |
| POST | `/api/subscriptions/:id/days/:date/premium-extra/payments/:paymentId/verify` | Flutter legacy | Legacy / Do not use for new work | Bearer user | Legacy premium-only payment verify. | Prefer unified day payment. | Legacy verification payload. | Payment errors. | `src/routes/subscriptions.js`, `src/services/subscription/premiumExtraDayPaymentService.js` |
| POST | `/api/subscriptions/:id/days/:date/one-time-addons/payments` | Flutter legacy | Legacy / Do not use for new work | Bearer user | Legacy add-on-only payment create. | Prefer unified day payment. | Legacy add-on payment payload. | Payment errors. | `src/routes/subscriptions.js` |
| POST | `/api/subscriptions/:id/days/:date/one-time-addons/payments/verify` | Flutter legacy | Legacy / Do not use for new work | Bearer user | Legacy add-on payment verify by body. | Prefer unified day payment. | Legacy verification payload. | Payment errors. | `src/routes/subscriptions.js` |
| POST | `/api/subscriptions/:id/days/:date/one-time-addons/payments/:paymentId/verify` | Flutter legacy | Legacy / Do not use for new work | Bearer user | Legacy add-on payment verify by path. | Prefer unified day payment. | Legacy verification payload. | Payment errors. | `src/routes/subscriptions.js` |
| POST | `/api/subscriptions/:id/days/skip` | Flutter | Stable | Bearer user | Skip day using date in body. | Body includes `date`. | Skip result. | Invalid date/status. | `src/routes/subscriptions.js` |
| POST | `/api/subscriptions/:id/days/:date/skip` | Flutter | Stable | Bearer user | Skip specific day. | Date path. | Skip result. | Invalid date/status. | `src/routes/subscriptions.js` |
| POST | `/api/subscriptions/:id/days/:date/unskip` | Flutter | Stable | Bearer user | Unskip specific day. | Date path. | Unskip result. | Invalid date/status. | `src/routes/subscriptions.js` |
| POST | `/api/subscriptions/:id/skip-range` | Flutter | Stable | Bearer user | Skip range of days. | `startDate`, `days`. | Range skip summary. | Invalid range/status. | `src/routes/subscriptions.js` |
| POST | `/api/subscriptions/:id/days/:date/custom-salad` | Flutter legacy/separate | Legacy / Separate flow | Bearer user | Add custom salad to day. | Custom salad ingredients. | Custom salad order/day result. | Not part of canonical planner. | `src/routes/subscriptions.js`, `src/controllers/customSaladController.js` |
| POST | `/api/subscriptions/:id/days/:date/custom-meal` | Flutter legacy/separate | Legacy / Separate flow | Bearer user | Add custom meal to day. | Custom meal ingredients/options. | Custom meal order/day result. | Not part of canonical planner. | `src/routes/subscriptions.js`, `src/controllers/customMealController.js` |
| PUT | `/api/subscriptions/:id/days/:date/delivery` | Flutter | Stable/Partial | Bearer user | Update delivery details for one day. | Delivery details. | Updated day delivery state. | Invalid delivery mode/address. | `src/routes/subscriptions.js` |
| POST | `/api/subscriptions/:id/days/:date/pickup/prepare` | Flutter | Stable | Bearer user | Prepare pickup for a day. | Date path. | Pickup preparation status. | `PLANNING_INCOMPLETE`, `PREMIUM_PAYMENT_REQUIRED`, legacy prep payment errors, locked/skipped/frozen. | `src/routes/subscriptions.js`, pickup services |
| GET | `/api/subscriptions/:id/days/:date/pickup/status` | Flutter | Stable | Bearer user | Poll pickup status. | Date path. | Pickup status, code, readiness flags. | Not found/forbidden. | `src/routes/subscriptions.js` |
| GET | `/api/subscriptions/:id/days/:date/fulfillment/status` | Flutter | Stable | Bearer user | Poll fulfillment status. | Date path. | Delivery/pickup fulfillment status and polling hint. | Not found/forbidden. | `src/routes/subscriptions.js` |
| POST | `/api/subscriptions/:id/addon-selections` | Flutter legacy | Legacy / Do not use for new work | Bearer user | Deprecated helper for add-ons. | Clients must use day selection with `mealSlots`. | Returns 422 for new canonical use. | `LEGACY_DAY_SELECTION_UNSUPPORTED` style behavior. | `src/routes/subscriptions.js`, `src/services/subscription/subscriptionSelectionClientService.js` |
| DELETE | `/api/subscriptions/:id/addon-selections` | Flutter legacy | Legacy / Do not use for new work | Bearer user | Deprecated helper for add-on removal. | Use day selection instead. | Returns 422 for new canonical use. | Legacy unsupported. | `src/routes/subscriptions.js` |
| POST | `/api/subscriptions/:id/premium-selections` | Flutter legacy | Legacy / Do not use for new work | Bearer user | Deprecated helper for premium selections. | Use `mealSlots`. | Returns 422 for new canonical use. | Legacy unsupported. | `src/routes/subscriptions.js` |
| DELETE | `/api/subscriptions/:id/premium-selections` | Flutter legacy | Legacy / Do not use for new work | Bearer user | Deprecated helper for premium removal. | Use `mealSlots`. | Returns 422 for new canonical use. | Legacy unsupported. | `src/routes/subscriptions.js` |
| POST | `/api/subscriptions/:id/addons/one-time` | Flutter legacy/unclear | Needs backend contract hardening | Bearer user | Add one-time add-on outside canonical planner. | Existing support unclear for new clients. | Needs contract hardening. | Invalid add-on/payment behavior unclear. | `src/routes/subscriptions.js` |
| PUT | `/api/subscriptions/:id/delivery` | Flutter | Stable/Partial | Bearer user | Update subscription delivery details. | Delivery details. | Updated subscription. | Invalid delivery details. | `src/routes/subscriptions.js` |
| GET | `/api/dashboard/menu/preview` | Dashboard | Stable | Dashboard admin/superadmin | Preview product-centered menu. | Optional query. | Preview payload. | Auth/role. | `src/routes/dashboardMenu.js` |
| GET/POST/PATCH/DELETE | `/api/dashboard/menu/categories*` | Dashboard | Stable | Dashboard admin/superadmin | Category CRUD, reorder, product assignment, visibility, availability. | Product-centered category payloads. | Category records and mutation results. | Validation/auth errors. | `src/routes/dashboardMenu.js` |
| GET/POST/PATCH/DELETE | `/api/dashboard/menu/products*` | Dashboard | Stable | Dashboard admin/superadmin | Product CRUD, duplicate, bulk, reorder, visibility, availability, composer/customization. | `MenuProduct` fields and relation payloads. | Product/composer payloads. | Validation/auth errors. | `src/routes/dashboardMenu.js`, `src/services/orders/menuCatalogService.js` |
| GET/POST/PATCH/PUT/DELETE | `/api/dashboard/menu/products/:productId/option-groups*` | Dashboard | Stable | Dashboard admin/superadmin | Product-to-group and product-to-option relation management. | Relation payloads include selection rules, visibility, availability, relation prices. | Product group/option relation payloads. | Product-option relation errors; invalid `extraPriceHalala`. | `src/routes/dashboardMenu.js`, `src/services/orders/menuCatalogService.js` |
| GET/POST/PATCH/DELETE | `/api/dashboard/menu/option-groups*` | Dashboard | Stable | Dashboard admin/superadmin | Global option group CRUD. | Option group payload. | Option group records. | Validation/auth errors. | `src/routes/dashboardMenu.js` |
| GET/POST/PATCH/DELETE | `/api/dashboard/menu/options*` | Dashboard | Stable | Dashboard admin/superadmin | Global option CRUD, reorder, toggle, visibility, availability. | Option payload. | Option records. | Validation/auth errors. | `src/routes/dashboardMenu.js` |
| POST | `/api/dashboard/menu/publish` | Dashboard | Stable/Partial | Dashboard admin/superadmin | Publish product-centered menu. | Publish payload. | Publish result/version. | Needs subscription planner readiness checks before relying on it for Flutter. | `src/routes/dashboardMenu.js` |
| GET | `/api/dashboard/menu/versions` | Dashboard | Stable | Dashboard admin/superadmin | List published versions. | Query optional. | Version list. | Auth/role. | `src/routes/dashboardMenu.js` |
| POST | `/api/dashboard/menu/rollback/:versionId` | Dashboard | Stable | Dashboard admin/superadmin | Roll back menu version. | Version id. | Rollback result. | Stale Flutter catalog after rollback. | `src/routes/dashboardMenu.js` |
| GET | `/api/dashboard/menu/diff` | Dashboard | Stable | Dashboard admin/superadmin | Diff draft/published menu. | Query optional. | Diff payload. | Auth/role. | `src/routes/dashboardMenu.js` |
| POST | `/api/dashboard/menu/validate` | Dashboard | Stable/Partial | Dashboard admin/superadmin | Validate dashboard menu. | Validation payload. | Validation result. | Does not fully replace subscription planner readiness validation. | `src/routes/dashboardMenu.js` |
| GET | `/api/dashboard/menu/audit-logs` | Dashboard | Stable | Dashboard admin/superadmin | Menu audit logs. | Query optional. | Audit log list. | Auth/role. | `src/routes/dashboardMenu.js` |
| GET/POST/PATCH | `/api/dashboard/catalog-items*` | Dashboard | Stable | Dashboard admin/superadmin | Manage linked global catalog items. | Catalog item payloads. | Catalog item records. | Global availability can hide/reject planner items. | `src/routes/dashboardCatalogItems.js` |
| GET/POST | `/api/dashboard/menu-identities*` and `/api/dashboard/menu-identities-audit/*` | Dashboard | Stable/Partial | Dashboard admin | Menu identity mapping and suggestion workflow. | Read identities, links, suggestions; approve/reject suggestions. | Identity governance payloads. | Not required for Flutter planner writes. | `src/routes/dashboardMenuIdentity.js`, `src/routes/index.js` |
| GET/POST/PATCH/PUT/DELETE | `/api/dashboard/meal-planner/*` | Dashboard legacy | Legacy / Do not use for new v3 work | Dashboard admin | Legacy builder categories, proteins, premium proteins, sandwiches, carbs, add-ons, salad ingredients. | Legacy builder payloads. | Legacy catalog records. | Can duplicate/confuse product-centered dashboard. | `src/routes/adminMealPlannerMenu.routes.js`, `src/routes/index.js` |
| GET/POST/PATCH/PUT/DELETE | `/api/admin/meal-planner-menu/*` | Admin legacy | Legacy / Do not use for new v3 work | Dashboard admin | Same as dashboard meal-planner alias. | Legacy builder payloads. | Legacy catalog records. | Compatibility/admin-only. | `src/routes/adminMealPlannerMenu.routes.js`, `src/routes/index.js` |
| GET/POST/PUT/PATCH/DELETE | `/api/dashboard/plans*` and `/api/admin/plans*` | Dashboard/admin | Stable | Dashboard admin | Subscription plan CRUD plus grams/meals rows. | Plan and nested pricing payloads. | Plan records. | Plan viability semantics need contract decision. | `src/routes/admin.js` |
| GET/POST/PUT/PATCH/DELETE | `/api/dashboard/addons*`, `/api/admin/addons*`, `/api/dashboard/addon-plans*`, `/api/dashboard/addon-items*` | Dashboard/admin | Stable/Partial | Dashboard admin | Checkout add-ons and legacy item add-ons. | `Addon` payloads. | Add-on records. | Do not confuse with daily `MenuProduct` add-on choices. | `src/routes/admin.js`, `src/models/Addon.js` |
| GET/POST/PATCH/PUT/DELETE | `/api/dashboard/builder-premium-meals*`, `/api/admin/builder-premium-meals*` | Dashboard/admin | Legacy/compat | Dashboard admin | Legacy builder premium meals. | Legacy payloads. | Legacy records. | Not the v3 product-centered planner source. | `src/routes/admin.js` |
| GET | `/api/dashboard/subscriptions/search` | Dashboard | Stable | Dashboard admin/cashier | Search subscriptions by phone. | Query. | Search results. | Auth/role. | `src/routes/dashboardSubscriptions.js` |
| GET | `/api/dashboard/subscriptions/:id/addon-entitlements` | Dashboard | Stable | Dashboard admin/cashier | Read subscription add-on entitlements. | Subscription id. | Entitlements. | Auth/role. | `src/routes/dashboardSubscriptions.js`, `src/routes/admin.js` |
| GET | `/api/dashboard/subscriptions/:id/balances` | Dashboard | Stable | Dashboard admin/cashier | Read premium/add-on balances. | Subscription id. | Balance payload. | Auth/role. | `src/routes/dashboardSubscriptions.js`, `src/routes/admin.js` |
| POST | `/api/dashboard/subscriptions/:subscriptionId/manual-deduction` | Dashboard | Stable/Partial | Dashboard admin | Manual balance deduction. | Deduction body. | Deduction result. | Needs careful audit/role handling. | `src/routes/dashboardSubscriptions.js` |
| GET/POST/PUT/PATCH | `/api/dashboard/subscriptions*` and `/api/admin/subscriptions*` | Dashboard/admin | Stable/Partial | Dashboard admin/cashier for reads; admin/superadmin for some writes | Admin subscription list/detail/quote/create/delivery/entitlements/balances/cancel/extend/freeze/unfreeze/skip. | Admin payloads. | Admin subscription records. | Duplicate aliases and role differences can confuse dashboard integration. | `src/routes/admin.js` |
| GET | `/api/dashboard/health/catalog`, `/api/admin/health/catalog` | Dashboard/admin | Stable | Dashboard admin | Catalog health. | No body. | Health payload. | Needs mapping to release gate. | `src/routes/admin.js`, `src/controllers/dashboardHealthController.js` |
| GET | `/api/dashboard/health/subscription-menu`, `/api/admin/health/subscription-menu` | Dashboard/admin | Stable/Partial | Dashboard admin | Subscription menu health. | No body. | Health payload. | Should become part of publish readiness checklist. | `src/routes/admin.js`, `src/controllers/dashboardHealthController.js` |
| GET | `/api/dashboard/health/meal-planner`, `/api/admin/health/meal-planner` | Dashboard/admin | Stable/Partial | Dashboard admin | Meal planner health. | No body. | Health payload. | Needs full v3 relation/readiness coverage. | `src/routes/admin.js`, `src/controllers/dashboardHealthController.js` |
| GET | `/api/dashboard/health/indexes`, `/api/admin/health/indexes` | Dashboard/admin | Stable | Dashboard admin | Index health. | No body. | Health payload. | Operational. | `src/routes/admin.js` |

## 5. Domain Model and Data Ownership

| Concept | Business meaning | Backend source of truth | Dashboard ownership | Flutter usage | Fields Flutter can read | Fields Flutter must not write/rely on | Legacy fields | Current problems |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Subscription` | Customer subscription contract, balances, entitlements, lifecycle. | `src/models/Subscription.js` | Dashboard can manage admin state, entitlements, balances, delivery, freeze/cancel/extend. | Read current status, balances through shaped APIs, and subscription id for planner. | Public subscription detail/overview/timeline fields. | Do not directly infer future premium/add-on availability from raw `premiumSelections` or `addonSelections`. | `premiumSelections`, `addonSelections` compatibility fields. | Premium/add-on ownership is duplicated across subscription and day. |
| `SubscriptionDay` | One service day in a subscription. | `src/models/SubscriptionDay.js` | Dashboard/kitchen/courier/admin update fulfillment and exceptional states. | Main planner read/write target. | `mealSlots`, `plannerRevisionHash`, `paymentRequirement`, day status, add-on selections, fulfillment state. | `pricingSnapshot` as future price source, `materializedMeals`, `baseMealSlots`, root `selections`, `premiumUpgradeSelections` as write source. | Legacy fields inside `mealSlots[]`: `proteinId`, `carbs`, `sandwichId`, `salad`, `premiumSource`. | `mealSlots[]` mixes v3 and legacy fields. |
| `Plan` / Subscription plan | Checkout plan and meals/grams pricing. | `src/models/Plan.js`, admin plan routes. | Dashboard/admin manages plan rows and active/sort state. | Read from subscription menu/checkout. | Plan id, display/pricing fields returned by APIs. | Do not assume active equals viable unless backend decides to enforce `Plan.isViable()`. | Older plan shapes may exist. | Active plan listing does not apply `Plan.isViable()`. |
| `Addon` | Checkout entitlement plan/item model. | `src/models/Addon.js` | Dashboard/admin manages checkout add-on plans/items. | Use only for checkout when returned by subscription menu. | Checkout add-on plan/item display fields. | Do not send `Addon` ids as daily add-on selections. | Legacy type/pricingModel/billingUnit compatibility. | `Addon` is overloaded between checkout entitlements and item-like rows. |
| `MenuProduct` | Product-centered catalog item for one-time menu and subscription planner products. | `src/models/MenuProduct.js` | Dashboard product composer owns product key, availability, visibility, publish state, category, subscription availability. | Use v3 `productId` from `plannerCatalog`; daily add-ons use `MenuProduct` ids from `/addon-choices`. | Product id/key/name/image/selection type/options from catalog. | Cached product ids after dashboard publish/rollback; products not present in current catalog. | Can mirror legacy sandwiches/salads. | A dashboard-active product can still be hidden by unpublished/global availability state. |
| `MenuOption` | Product-centered option such as protein/carb/sauce. | `src/models/MenuOption.js` | Dashboard owns key, fee, selection type, active/visible/available state. | Use option ids from product-linked groups only. | Option id/key/display fields and option fee fields. | Raw global options not linked to the selected product. | Can mirror builder proteins/carbs. | v3 `proteinId` compatibility may actually contain a `MenuOption` id. |
| `MenuOptionGroup` | Product option group such as proteins, carbs, sauces. | `src/models/MenuOptionGroup.js` | Dashboard owns group key/rules and relation to products. | Render grouped choices from `plannerCatalog`. | Group id/key/min/max/rules from product relation catalog. | Assumptions from group name alone. | Can mirror legacy categories. | Product relation rules are required for v3 validation. |
| `CatalogItem` | Global availability link for product/option visibility. | `src/models/CatalogItem.js` | Dashboard/admin owns global availability. | Should not write; must refresh catalog when backend rejects unavailable items. | Availability hints if exposed by catalog/health. | Assuming active/published product is enough. | None. | Linked global unavailability can make otherwise active rows disappear or reject. |
| `BuilderProtein` | Legacy protein source. | `src/models/BuilderProtein.js` | Legacy dashboard meal-planner/admin surfaces. | Legacy compatibility only. | Legacy read compatibility fields. | Do not use as v3 catalog id source. | Primary legacy protein. | v3 compatibility stores can blur `proteinId` meaning. |
| `BuilderCarb` | Legacy carb source. | `src/models/BuilderCarb.js` | Legacy dashboard meal-planner/admin surfaces. | Legacy compatibility only. | Legacy read compatibility fields. | Do not use as v3 catalog id source. | Primary legacy carb. | v3 should use selected options/grams. |
| `Meal` | Legacy meal/sandwich/catalog item. | `src/models/Meal.js` | Legacy/admin surfaces and order flows. | Legacy compatibility only. | Read-only legacy fallback if exposed. | Do not send `sandwichId` with v3 `productId`. | Sandwich fallback. | New planner should use cold sandwich `MenuProduct`. |
| `MealCategory` | Legacy meal categorization. | `src/models/MealCategory.js` | Legacy/admin surfaces. | Not needed for new Flutter planner. | Legacy display if exposed. | Do not rely for v3 grouping. | Legacy categories. | Coexists with product-centered categories. |
| `SaladIngredient` | Legacy/custom salad ingredient source. | `src/models/SaladIngredient.js` | Legacy/admin surfaces and custom salad flow. | Separate custom salad flow only. | Custom salad ingredient catalog if needed. | Do not mix with v3 premium large salad groups. | Legacy salad ingredients. | Legacy fallback still matters. |
| Menu identity models | Mapping/governance for menu identity. | Dashboard identity controllers/models. | Dashboard owns read/approve/reject workflow. | No direct planner write dependency. | None for planner writes. | Do not require for v3 planner payload. | None. | Docs should avoid implying Flutter needs identity mapping. |

Important ownership facts:

- Daily add-on choices are `MenuProduct` rows, not `Addon` rows.
- `Addon` is overloaded between checkout entitlements and item-like rows.
- v3 `proteinId` can behave like a `MenuOption` id, not just a `BuilderProtein` id.
- `SubscriptionDay.mealSlots[]` mixes v3 and legacy fields.
- `pricingSnapshot` is not a future price source.
- Legacy fallback config still matters.

## 6. v3 vs Legacy Planner Contract

| Topic | v3 Canonical Planner | Legacy Compatibility | Risk |
| --- | --- | --- | --- |
| Request payload shape | `contractVersion: "meal_planner_menu.v3"` or `"v3"` with `mealSlots[]` containing `productId` and `selectedOptions`. | `mealSlots[]` can contain legacy `proteinId`, `carbs`, `sandwichId`, `salad` fields if not mixed with v3 fields. | Mixed payloads fail; old root payloads fail. |
| `mealSlots[]` | Required for day selection save/validate. | Also required for supported legacy slot compatibility. | Missing `mealSlots` triggers unsupported legacy behavior. |
| `selectionType` | Use canonical values: `standard_meal`, `premium_meal`, `sandwich`, `premium_large_salad`. | Legacy aliases like `standard_combo` and `custom_premium_salad` can be normalized in compatibility code. | New Flutter should never emit aliases. |
| `standard_meal` | Product must match standard meal rules and linked options. Premium proteins are rejected. | Uses legacy protein/carb maps. | Dashboard relation mistakes can expose invalid options. |
| `sandwich` | Use cold sandwich `MenuProduct` as `productId`. | May use legacy `sandwichId`/`Meal` fallback. | Do not mix `sandwichId` with v3 `productId`. |
| `premium_large_salad` | Uses salad product, linked groups/options, extra protein group exclusion, and product/fallback premium price. | Enforces allowed salad protein keys and salad group rules from legacy config. | v3 does not fully match legacy allowlist unless dashboard relations enforce it. |
| `standard_combo` | Do not send. | Maps to `standard_meal`. | Alias increases migration ambiguity. |
| `custom_premium_salad` | Do not send. | Maps to `premium_large_salad`. | Alias can hide v3/legacy mixing. |
| Protein handling | Select protein option via `selectedOptions` from product-linked group. Compatibility fields may be materialized. | `proteinId` references `BuilderProtein`. | v3 `proteinId` readback may not be a `BuilderProtein` id. |
| Carb handling | Select carb option with grams where needed; backend can default grams in places but Flutter should send explicit grams. | `carbs[]`, `carbId`, and legacy grams. | Local UI estimates can disagree if grams omitted. |
| Selected options | Source of truth is product-linked `selectedOptions[]`. | Not the primary source. | Raw global options are not valid unless linked to product. |
| Salad groups | Product relation groups define min/max and availability; extra protein is explicitly excluded. | Legacy config has group max/min and allowlists. | Missing dashboard validation can expose invalid combinations. |
| Pricing | Premium meal option fee uses relation `extraPriceHalala` first, then option fee. Premium salad uses product price fallback chain. | Legacy fee maps and fallback price can apply. | Dashboard can edit wrong field. |
| Validation | `canonicalMealSlotPlannerService` validates product, group, option, relation, publish, availability, and selection type rules. | `mealSlotPlannerService` validates legacy protein/carb/salad/sandwich rules. | Validation matrix must identify enforcement layer. |
| Payment balance | Save computes draft commercial state and payment requirement from v3/legacy shaped slots. | Same commercial layer after normalization. | Flutter should trust returned `paymentRequirement`. |
| Read response | Shaped through planning client/timeline/localization services; includes derived compatibility fields. | Legacy fields may appear in readback. | Response examples need contract hardening. |
| Unsupported root legacy payloads | Not supported. | Old root-level `selections`/`premiumSelections` are rejected for day selection. | Legacy client migration required. |

Legacy slot shape inside `mealSlots[]` may be accepted.
Old root-level `selections` / `premiumSelections` write payloads are not supported for day selection.
New Flutter should send pure v3 canonical payloads only.

## 7. Validation Rules and Backend Rejection Matrix

| Flow | Rule | Enforced Where | Error Code/Behavior | Dashboard Prevention | Flutter Prevention |
| --- | --- | --- | --- | --- | --- |
| Standard meal | Product must be valid for `standard_meal`. | `canonicalMealSlotPlannerService.js` | Planner validation error for invalid product/selection type. | Product key/type validation before publish. | Use product from current `plannerCatalog`. |
| Standard meal | Premium protein cannot be used in standard meal. | `canonicalMealSlotPlannerService.js` | Rejected when premium protein selected for standard meal. | Do not link premium proteins to standard product. | Render only linked standard choices. |
| Premium meal | Protein must be premium-capable. | `canonicalMealSlotPlannerService.js` | Rejected if standard protein selected for premium meal. | Link only premium proteins to premium products. | Use current premium product options. |
| Sandwich | v3 sandwich must use product-centered sandwich product. | `canonicalMealSlotPlannerService.js` | Invalid product/selection type or mixed legacy error. | Mark cold sandwich products correctly. | Do not send legacy `sandwichId` in v3 slot. |
| Premium large salad | Extra protein group `extra_protein_50g` is excluded. | `canonicalMealSlotPlannerService.js`, `mealSlotPlannerService.js` | Rejected for subscription premium salad. | Publish validation must block excluded group. | Do not render excluded group. |
| Premium large salad | Legacy allowed protein keys are enforced only in legacy path. | `mealSlotPlannerService.js` | Legacy validation rejects disallowed proteins. | Either enforce relation allowlist or add backend v3 allowlist. | Use current catalog; cannot independently know all backend intent. |
| Premium large salad | v3 relation min/max and option availability must pass. | `canonicalMealSlotPlannerService.js` | Planner validation errors. | Validate product-group and product-option relations. | Use linked options only. |
| Proteins | Product-option relation must exist and be available. | `canonicalMealSlotPlannerService.js` | Product/group/option not found, inactive, unpublished, unavailable style errors. | Relation completeness check before publish. | Refresh catalog on stale product/option errors. |
| Carbs | Carb option and grams rules must pass. | `canonicalMealSlotPlannerService.js`, legacy planner service | Validation errors; grams may default in some paths. | Link carbs and set rules clearly. | Send explicit grams. |
| Sauces | Sauce group rules must pass for salad products. | Product relation rules and legacy salad rules. | Validation errors. | Configure min/max and availability before publish. | Respect min/max from catalog. |
| Salad groups | Duplicate/max rules must pass. | Canonical relation rules and legacy salad logic. | Validation errors. | Validate duplicate and max rules before publish. | Prevent duplicate or over-max selections locally. |
| Add-ons | Daily add-ons must be valid choices from `/addon-choices`. | `subscriptionAddonChoicesService.js`, `subscriptionSelectionService.js` | `INVALID_ONE_TIME_ADDON_SELECTION` or payment requirement. | Ensure one-time products are active, published, mapped, and globally available. | Use only IDs from `/addon-choices`. |
| Duplicate selections | Duplicate option/slot rules are normalized or rejected depending flow. | Planner services. | Validation errors or normalized slots. | Dashboard should avoid ambiguous duplicate option setup. | Prevent duplicate user selections. |
| Max slot count | Day slots must match subscription/day requirements. | Selection service and planner validation. | Incomplete/too many/too few planner behavior. | Plan/day rules must be clear. | Respect `requiredMealCount`/planner rules from day read. |
| Required slot count | Confirm requires planning completeness. | `subscriptionSelectionService.js`, execution validation. | `PLANNING_INCOMPLETE` or confirm rejection. | Show day requirement in dashboard support views. | Disable confirm until day read says ready. |
| Inactive items | Inactive products/options rejected or filtered. | Canonical planner and addon choices service. | Planner unavailable/inactive errors. | Do not publish inactive linked rows. | Refresh catalog on rejection. |
| Unpublished items | Unpublished products/options rejected or filtered. | Canonical planner and catalog services. | Planner unpublished/unavailable errors. | Publish all required products/options. | Refresh catalog on rejection. |
| Hidden items | Hidden/invisible rows may be filtered from catalogs. | Catalog services. | Missing from catalog or rejected. | Validate visibility. | Do not cache hidden choices. |
| Globally unavailable `CatalogItem` | Linked global item can hide/reject otherwise active rows. | `loadCatalogItemsByIdForDocs`, `filterGloballyAvailable`, canonical validation. | Missing/unavailable catalog item behavior. | Include CatalogItem health in publish checklist. | Refresh catalog and discard stale IDs. |
| Stale cached IDs | Product/group/option ids can become invalid after publish/rollback. | Canonical planner validation. | `PLANNER_*_NOT_FOUND/INACTIVE/UNPUBLISHED/UNAVAILABLE` style behavior. | Stable publish/rollback process. | On any planner stale error, refetch `/meal-planner-menu`. |
| Mixed v3/legacy slot fields | v3 slot cannot include legacy fields. | `canonicalMealSlotPlannerService.js` | `PLANNER_MIXED_LEGACY_CANONICAL_SLOT`. | Not a dashboard issue. | Send pure v3 slots only. |
| Unsupported root legacy payloads | Root `selections`/`premiumSelections` are not supported for day selection. | `subscriptionSelectionService.js`, client service. | `LEGACY_DAY_SELECTION_UNSUPPORTED`. | Not a dashboard issue. | Always send `mealSlots[]`. |

v3 premium large salad validation does not fully match legacy allowlist validation unless dashboard relations enforce the same rule.

## 8. Pricing and Payment Source of Truth

| Pricing/payment item | Source of truth | Notes |
| --- | --- | --- |
| Product base price | `MenuProduct.priceHalala` / product pricing fields | Used by catalog/order flows and premium salad fallback path where applicable. |
| Product-option relation fee | `ProductGroupOption.extraPriceHalala` | For v3 premium meal option fees, relation `extraPriceHalala` takes precedence. |
| Option fee fallback | `MenuOption.extraPriceHalala` / compatibility `extraFeeHalala` | Used when relation fee is null/undefined. |
| Premium large salad price | `premium_large_salad` product, fallback `basic_salad`, fallback legacy price | Current fallback can keep flow alive while hiding catalog setup problems. |
| Legacy fallback config price | Legacy pricing maps/constants | Still matters for legacy planner compatibility. |
| Subscription premium balance | `Subscription.premiumBalance`, day commercial derivation | Backend decides whether a premium selection consumes balance or requires payment. |
| Add-on balance | `Subscription.addonBalance`, day add-on selections | Day source can be `subscription`, `wallet`, `pending_payment`, or `paid`. |
| Wallet source | `SubscriptionDay.addonSelections.source: "wallet"` | Must be documented for Flutter read handling. |
| Daily add-on payment | Unified day payment for `addonsOneTime` overages | Planner add-on payment requirement uses `ADDON_PAYMENT_REQUIRED`. |
| Payment requirement | Day commercial state from `subscriptionDayCommercialStateService.js` | Flutter should use returned `paymentRequirement` as truth. |
| Payment create | `POST /api/subscriptions/:id/days/:date/payments` | Sends latest `plannerRevisionHash` where possible. |
| Payment verify | `POST /api/subscriptions/:id/days/:date/payments/:paymentId/verify` | Settles premium/add-on payment when provider status allows. |
| Payment reuse | Unified service can return existing reusable initiated payment. | Response examples should show this before Flutter relies on field-level details. |
| No-payment case | Unified service returns no-payment result when total is <= 0. | Needs backend contract hardening for final Flutter typed model. |
| Revision mismatch | `plannerRevisionHash` mismatch returns `DAY_PAYMENT_REVISION_MISMATCH` for unified create. | Flutter must refresh day/catalog and restart payment flow. |
| `plannerRevisionHash` | Derived from current day planner state. | Save response, day read, payment create, and verify can include it. |

Planner add-on payment requirement uses `ADDON_PAYMENT_REQUIRED`.
Do not use `ONE_TIME_ADDON_PAYMENT_REQUIRED` for the day planner payment CTA.

Flutter should trust backend-returned `paymentRequirement`, not local price estimates.

Unified payment response fields known from tests include `paymentId`, `payment_id`, `premiumAmountHalala`, `addonsAmountHalala`, `totalHalala`, and `plannerRevisionHash`. Exact final response variants for no-payment, payment reuse, and all provider failures are still Needs backend contract hardening.

## 9. Add-ons and Extras

Add-ons are currently the most overloaded concept in this system.

| Concept | Meaning | Backend owner | Flutter rule | Dashboard rule |
| --- | --- | --- | --- | --- |
| Checkout add-on plans | Subscription purchase entitlements, usually per-day plan add-ons. | `Addon` model, admin add-on plan routes, checkout services. | Use only in subscription quote/checkout if returned by subscription menu. | Manage under plan/add-on admin surfaces. |
| Add-on entitlements | Subscription-level included quantities/balances. | `Subscription.addonSubscriptions`, `Subscription.addonBalance`, admin entitlement APIs. | Read through shaped APIs; do not infer daily choice IDs. | Manage via `/api/dashboard/subscriptions/:id/addon-entitlements` or admin alias. |
| Subscription-level add-ons | Legacy/compat subscription add-on state. | `Subscription.addonSelections` and related services. | Do not write directly for new planner. | Admin support only. |
| Day-level daily add-ons | One-time extras chosen for a subscription day. | `SubscriptionDay.addonSelections`; choices loaded from one-time `MenuProduct`. | Send `addonsOneTime` with `MenuProduct` ids from `/addon-choices`. | Configure eligible one-time products and category mappings. |
| `Addon` model | Checkout add-on model and legacy item rows. | `src/models/Addon.js`. | Not a daily planner choice source. | Use for checkout/admin add-on management. |
| `MenuProduct` daily add-on choices | Daily extras from one-time menu. | `subscriptionAddonChoicesService.js`. | This is the daily add-on source. | Product must be active, published, available, mapped, and globally available. |
| `addonSelections` | Day-level readback of selected extras. | `SubscriptionDay.addonSelections`. | Read payment/source state; do not construct write payload from raw fields. | Support/admin visibility. |
| Source `subscription` | Covered by entitlement. | Commercial state service. | Display included. | Ensure entitlements are correct. |
| Source `wallet` | Covered by wallet/add-on balance. | Day model enum. | Display as covered, not pending payment. | Document balance operations. |
| Source `pending_payment` | Payment required or in progress. | Commercial state and payment services. | Show payment CTA for `ADDON_PAYMENT_REQUIRED`. | Support payment reconciliation. |
| Source `paid` | Settled by payment. | Unified payment verification. | Read as paid. | Support refunds/audit separately if needed. |

Daily add-on choices use `MenuProduct` IDs from `/api/subscriptions/addon-choices`.
Flutter must not send generic `Addon` model IDs for daily add-on selections.

## 10. Premium Large Salad and Premium Selections

Premium large salad is a premium planner selection, not a generic custom salad.

| Topic | Current behavior |
| --- | --- |
| Business meaning | A premium subscription meal option, typically consuming premium balance or requiring payment. |
| v3 representation | `mealSlots[]` item with `selectionType: "premium_large_salad"`, `productId`, and `selectedOptions` for linked salad groups. |
| Legacy representation | Legacy slot shape can include `salad.groups`, `proteinId`, `customSalad`, and compatibility aliases. |
| Product key expectations | Runtime pricing searches for `premium_large_salad`, then `basic_salad`, then legacy fallback. |
| Group/option relation expectations | Dashboard must link required salad groups/options to the product and keep them visible/available/published. |
| Allowed proteins | Legacy path enforces `SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS`. |
| Rejected proteins | Legacy path rejects proteins outside the allowlist; v3 rejects based on product relation validity and explicit extra protein exclusion. |
| Extra protein exclusion | Group key `extra_protein_50g` is not allowed for subscription premium large salad. |
| Sauce min/max | Enforced by legacy rules and/or v3 product group relation selection rules. |
| Salad group max rules | Enforced by legacy salad logic and v3 relation rules. |
| Duplicate rules | Enforced in planner validation/normalization. |
| Pricing source | Product/fallback price for premium salad; v3 premium meal uses relation/option fee precedence. |
| Fallback behavior | `premium_large_salad` product missing can fall back to `basic_salad`; then legacy fixed fallback. |
| Payment balance impact | Backend decides balance vs pending payment and returns `paymentRequirement`. |
| Dashboard ownership | Product key, linked groups/options, availability, publish state, excluded groups, and price setup. |
| Flutter payload rule | Send pure v3 selected options from `plannerCatalog`; do not send legacy custom salad payload for v3. |
| Known mismatch | v3 does not independently enforce the same protein allowlist as legacy unless dashboard relations do it. |

Example v3 premium large salad payload:

```json
{
  "contractVersion": "meal_planner_menu.v3",
  "mealSlots": [
    {
      "slotIndex": 1,
      "slotKey": "slot_1",
      "selectionType": "premium_large_salad",
      "productId": "MENU_PRODUCT_ID_FROM_PLANNER_CATALOG",
      "selectedOptions": [
        {
          "groupId": "PROTEIN_GROUP_RELATION_ID_FROM_PRODUCT",
          "optionId": "PROTEIN_OPTION_ID_FROM_PRODUCT",
          "quantity": 1
        },
        {
          "groupId": "SAUCE_GROUP_RELATION_ID_FROM_PRODUCT",
          "optionId": "SAUCE_OPTION_ID_FROM_PRODUCT",
          "quantity": 1
        }
      ]
    }
  ]
}
```

Backend decision needed:
Either enforce the same premium large salad allowlist in v3 canonical validation, or make dashboard relation validation the official source of truth and document it as such.

## 11. Dashboard Integration Readiness

Canonical dashboard APIs to use:

- `/api/dashboard/menu/*` for product-centered category/product/group/option/composer/publish flows.
- `/api/dashboard/catalog-items/*` for global availability dependencies.
- `/api/dashboard/subscriptions/*` for subscription search, entitlements, balances, and manual deduction.
- `/api/dashboard/health/subscription-menu` and `/api/dashboard/health/meal-planner` for readiness checks.
- `/api/dashboard/plans*`, `/api/dashboard/addons*`, `/api/dashboard/addon-plans*`, `/api/dashboard/addon-items*` through the admin route alias when building backoffice screens.

APIs to avoid for new product-centered work:

- `/api/dashboard/meal-planner/*`
- `/api/admin/meal-planner-menu/*`
- Legacy builder premium meal/protein/carb surfaces unless maintaining compatibility screens.

Needed dashboard screens and capabilities:

- Product composer for subscription planner products.
- Product/group/option relation management with min/max, visibility, availability, and relation `extraPriceHalala`.
- Price management that labels relation price vs option fallback vs product/fallback price.
- Availability management for product, option, relation, category, publish state, and linked `CatalogItem`.
- Publish, preview, diff, rollback, and audit log workflow.
- Subscription planner readiness/health page.
- Add-on management split between checkout add-ons and daily `MenuProduct` extras.
- Premium large salad controls, including excluded group and allowed protein governance.
- Subscription plan/add-on/entitlement/balance admin support.

### Dashboard Must Validate Before Publish

- Required product keys exist for subscription planner.
- Required group keys exist and are linked to the correct products.
- Required product-group relations exist.
- Required product-option relations exist.
- Products/options/groups/relations are active, visible, available, and published as required.
- Linked `CatalogItem` rows are globally available.
- Premium large salad does not expose `extra_protein_50g`.
- Premium large salad proteins match the chosen governance rule.
- Standard products do not expose premium-only proteins.
- Premium products do not expose standard-only proteins unless intentionally allowed.
- Daily add-on one-time products are active, published, category-mapped, subscription eligible, and globally available.
- Relation `extraPriceHalala` is valid where premium pricing depends on it.
- Product fallback price does not mask missing `premium_large_salad`.
- `/api/dashboard/health/subscription-menu` and `/api/dashboard/health/meal-planner` are green enough for release.

## 12. Flutter Integration Readiness

Canonical Flutter APIs to use:

- `GET /api/subscriptions/menu`
- `GET /api/subscriptions/delivery-options`
- `GET /api/subscriptions/meal-planner-menu`
- `GET /api/subscriptions/addon-choices`
- `POST /api/subscriptions/quote`
- `POST /api/subscriptions/checkout`
- `GET /api/subscriptions/current/overview`
- `GET /api/subscriptions/:id/timeline`
- `GET /api/subscriptions/:id/days`
- `GET /api/subscriptions/:id/today`
- `GET /api/subscriptions/:id/days/:date`
- `POST /api/subscriptions/:id/days/:date/selection/validate`
- `PUT /api/subscriptions/:id/days/:date/selection`
- `POST /api/subscriptions/:id/days/:date/payments`
- `POST /api/subscriptions/:id/days/:date/payments/:paymentId/verify`
- `POST /api/subscriptions/:id/days/:date/confirm`
- Pickup, fulfillment, delivery, skip, and unskip endpoints as needed.

APIs to avoid:

- `/api/subscriptions/:id/addon-selections`
- `/api/subscriptions/:id/premium-selections`
- Legacy `/premium-extra/payments` and `/one-time-addons/payments` unless maintaining an old client.
- Dashboard/admin APIs.

Recommended request sequence:

1. Fetch `GET /api/subscriptions/meal-planner-menu` and use `plannerCatalog` for new planner UI.
2. Fetch `GET /api/subscriptions/addon-choices` for daily extras.
3. Fetch `GET /api/subscriptions/:id/days/:date` before editing.
4. Render v3 slots from current catalog IDs and day rules.
5. Validate with `POST /selection/validate`.
6. Save with `PUT /selection`.
7. Inspect returned `paymentRequirement` and `plannerRevisionHash`.
8. If payment is required, create unified payment with `POST /payments`.
9. Verify with `POST /payments/:paymentId/verify`.
10. Refresh day read.
11. Confirm with `POST /confirm`.

Stale catalog handling:

- On any planner not found, inactive, unpublished, unavailable, relation, or mixed-contract error, discard local cached IDs and refetch `/meal-planner-menu`.
- After dashboard publish or rollback, Flutter should treat planner catalog as stale.
- Flutter should use local price estimates only for preview. Backend `paymentRequirement` is final.

Fields Flutter must not rely on as write sources:

- `materializedMeals`
- `baseMealSlots`
- `selections`
- `premiumUpgradeSelections`
- `premiumSelections`
- `pricingSnapshot` as future price authority
- legacy `carbId` / `carbSelections`
- `proteinId` as a stable v3 catalog id

Example standard meal v3 payload:

```json
{
  "contractVersion": "meal_planner_menu.v3",
  "mealSlots": [
    {
      "slotIndex": 1,
      "slotKey": "slot_1",
      "selectionType": "standard_meal",
      "productId": "STANDARD_MEAL_PRODUCT_ID",
      "selectedOptions": [
        {
          "groupId": "PROTEIN_GROUP_ID",
          "optionId": "STANDARD_PROTEIN_OPTION_ID",
          "quantity": 1
        },
        {
          "groupId": "CARB_GROUP_ID",
          "optionId": "CARB_OPTION_ID",
          "quantity": 1,
          "grams": 150
        }
      ]
    }
  ]
}
```

Example sandwich v3 payload:

```json
{
  "contractVersion": "meal_planner_menu.v3",
  "mealSlots": [
    {
      "slotIndex": 1,
      "slotKey": "slot_1",
      "selectionType": "sandwich",
      "productId": "COLD_SANDWICH_PRODUCT_ID",
      "selectedOptions": []
    }
  ]
}
```

Example daily add-on selection:

```json
{
  "contractVersion": "meal_planner_menu.v3",
  "mealSlots": [
    {
      "slotIndex": 1,
      "slotKey": "slot_1",
      "selectionType": "standard_meal",
      "productId": "STANDARD_MEAL_PRODUCT_ID",
      "selectedOptions": []
    }
  ],
  "addonsOneTime": [
    "MENU_PRODUCT_ID_FROM_ADDON_CHOICES"
  ]
}
```

Example unified payment create:

```json
{
  "plannerRevisionHash": "LATEST_HASH_FROM_DAY_SAVE_OR_DAY_READ"
}
```

Expected create response fields include:

```json
{
  "paymentId": "PAYMENT_ID",
  "payment_id": "PAYMENT_ID",
  "premiumAmountHalala": 3000,
  "addonsAmountHalala": 3200,
  "totalHalala": 6200,
  "plannerRevisionHash": "CURRENT_HASH"
}
```

Exact provider URL/status fields and no-payment/reuse variants are Needs backend contract hardening.

Example unified payment verify:

```json
{}
```

Use endpoint:

```txt
POST /api/subscriptions/:id/days/:date/payments/:paymentId/verify
```

After verify success, Flutter should refresh `GET /api/subscriptions/:id/days/:date` and trust returned day state.

## 13. Known Problems and Risks

### Blockers

| Problem | Impact | Evidence | Recommended fix | Files likely involved | Suggested test |
| --- | --- | --- | --- | --- | --- |
| Wrong planner add-on payment code in old docs | Flutter may miss the correct payment CTA. | Planner save/confirm uses `ADDON_PAYMENT_REQUIRED`; old docs referenced `ONE_TIME_ADDON_PAYMENT_REQUIRED`. | Correct documentation and make Flutter handle `ADDON_PAYMENT_REQUIRED`. | `docs/SUBSCRIPTION_MENU_SYSTEM_README.md`, Flutter client docs | `tests/mealPlannerPaymentContract.test.js`, doc examples test |
| Missing complete endpoint contract | Dashboard/Flutter can choose wrong routes or miss required flows. | Real routes include quote, checkout, drafts, days, today, pickup, fulfillment, skip, custom flows, aliases. | Keep this table as backend reference and harden final public examples. | `src/routes/subscriptions.js`, `src/routes/index.js`, docs | `tests/subscriptionPlannerReadmeExamples.test.js` |
| v3 vs legacy premium salad mismatch | Dashboard could link proteins v3 accepts but legacy would reject. | Legacy allowlist is in `mealSlotPlannerService`; v3 relation validation does not call same allowlist. | Decide: enforce allowlist in v3 or make dashboard relation validation source of truth. | `canonicalMealSlotPlannerService.js`, dashboard validation, catalog seed | `tests/premiumLargeSaladV3Allowlist.test.js` |
| Payment contracts vague | Flutter typed models may break on no-payment, reuse, provider failure, or revision mismatch. | Tests assert fields, but docs lack full examples. | Stabilize create/verify response schema and document all variants. | `unifiedDayPaymentService.js`, docs | Expand `tests/mealPlannerPaymentContract.test.js` |
| Missing full dashboard-to-Flutter E2E | Integration can pass unit contracts but fail across publish/catalog/payment. | No single test creates dashboard catalog, publishes, fetches Flutter catalog, saves, pays, confirms. | Add full E2E flow. | Dashboard menu services, subscription planner/payment services | `tests/subscriptionPlannerDashboardToFlutter.e2e.test.js` |

### High Priority

| Problem | Impact | Evidence | Recommended fix | Files likely involved | Suggested test |
| --- | --- | --- | --- | --- | --- |
| Dashboard/admin alias confusion | Duplicate screens and wrong API usage. | `adminRoutes` mounted under `/api/dashboard` and `/api/admin`; legacy planner under dashboard/admin aliases. | Publish route policy and prefer canonical dashboard menu APIs. | `src/routes/index.js`, docs | Route parity smoke test |
| Daily add-ons are `MenuProduct`, not `Addon` | Flutter could send checkout add-on IDs and fail. | `/addon-choices` loads one-time products; planner rejects invalid choice ids. | Rename UI/docs to "daily extras" and expose source type. | `subscriptionAddonChoicesService.js`, docs | Add-on choices contract test |
| CatalogItem/global availability hides active items | Dashboard may think item is active while Flutter cannot use it. | Planner/add-on services filter/reject globally unavailable linked docs. | Add publish readiness checks and health warnings. | `dashboardHealthService`, `menuCatalogService.js` | `tests/dashboardSubscriptionMenuReadiness.test.js` |
| Product-option relation mismatch | Flutter can render/send options backend rejects. | v3 requires product-to-group and product-to-option relations. | Dashboard validation must verify relation completeness. | `menuCatalogService.js`, dashboard validation | Dashboard readiness test |
| Stale catalog IDs | Saves fail after publish/rollback. | Canonical validation rejects stale product/group/option ids. | Document Flutter refresh behavior and add stale tests. | Canonical planner service, Flutter client | `tests/subscriptionPlannerStaleCatalog.test.js` |
| Mixed v3/legacy slots | Saves fail with confusing user state. | `PLANNER_MIXED_LEGACY_CANONICAL_SLOT`. | Flutter sends pure v3 only. | Flutter client, docs | v3 write tests |
| Price source spread | Dashboard can edit wrong price field. | Premium meal relation fee vs option fee; premium salad product fallback. | Label price fields and add validation. | `menuCatalogService.js`, dashboard UI, docs | Pricing contract tests |

### Medium Priority

| Problem | Impact | Evidence | Recommended fix | Files likely involved | Suggested test |
| --- | --- | --- | --- | --- | --- |
| Active plans not filtered by `Plan.isViable()` | Checkout menu may show active but incomplete plans. | Menu controller active query does not apply viability. | Decide whether to filter or document active-only behavior. | `src/controllers/menuController.js`, `Plan` | Subscription menu viability test |
| Default `npm test` is not full suite | Teams may overtrust one targeted test. | `package.json` runs only `meal_planner_types.test.js`. | Document `npm run validate:backend` and targeted tests. | `package.json`, docs | None |
| `proteinId` semantic ambiguity | Flutter can treat v3 readback as builder id. | `SubscriptionDay` ref says `BuilderProtein`, v3 can materialize option ids. | Add explicit read alias or document compatibility only. | Read serialization services | Canonical read contract test |
| Dashboard `validate` scope unclear | Publish can pass while subscription planner is not ready. | `/api/dashboard/menu/validate` exists, separate planner validators also exist. | Add dedicated subscription planner readiness endpoint/checklist. | Dashboard health/validation services | Readiness test |

### Low Priority / Cleanup

| Problem | Impact | Evidence | Recommended fix | Files likely involved | Suggested test |
| --- | --- | --- | --- | --- | --- |
| Compatibility catalogs coexist in one response | Flutter may choose wrong catalog. | `/meal-planner-menu` can return legacy, v2, and v3 sections. | Later add explicit strict v3 mode if needed. | `menuController.js` | Catalog response contract test |
| Deprecated endpoints still visible | New clients may use them. | Legacy add-on/premium endpoints exist. | Keep endpoints but label deprecated in docs/OpenAPI. | Routes/OpenAPI docs | Deprecated endpoint smoke test |
| Price source labels could be richer | Support/debugging harder. | Some responses do not expose final fee source. | Add `priceSource`/`feeSource` consistently later. | Catalog/planner serializers | Catalog contract test |

## 14. Test Coverage Map

| Test File | Type | Covers | Gaps |
| --- | --- | --- | --- |
| `tests/meal_planner_types.test.js` | Unit/contract | Legacy planner normalization, selection types, premium salad rules, type helpers. | Does not prove full v3 dashboard-created catalog behavior. |
| `tests/oneTimeMenuCatalog.test.js` | Contract | One-time menu catalog behavior. | Does not prove daily subscription add-on mapping end to end. |
| `tests/mobileApiContracts.test.js` | Contract | Broad mobile API contracts. | Not enough detail for unified day payment and v3 planner examples. |
| `tests/dashboardMenuProductCenteredContract.test.js` | Contract | Product-centered dashboard menu CRUD/composer/publish behavior. | Does not complete Flutter planner/payment flow. |
| `tests/weeklyMenuDashboard.test.js` | Integration/contract | Weekly/dashboard menu behavior. | Not full subscription planner E2E. |
| `tests/fulfillmentContract.test.js` | Contract | Fulfillment status/readiness behavior. | Does not cover all planner payment blockers. |
| `tests/mealPlannerPaymentContract.test.js` | Contract/integration | Premium/add-on payment requirement, unified create/verify, revision mismatch, combined payments. | Response examples should become public doc fixtures. |
| `tests/mealPlannerCanonicalContract.test.js` | Contract | Canonical planner read/write contract. | Needs stale catalog and dashboard-created relation scenarios. |
| `tests/mealPlannerCanonicalV3Write.test.js` | Contract | v3 canonical write path. | Does not enforce legacy salad allowlist parity in v3. |
| `tests/subscription_addon_selection_contract.test.js` | Contract | Add-on selection rules. | Needs full wallet/source readback matrix. |
| `tests/subscription_addon_selection_readback.integration.test.js` | Integration | Add-on readback behavior. | Needs dashboard-to-Flutter add-on product setup. |
| `tests/builderCatalogV2Contract.test.js` | Contract | Builder catalog v2 compatibility. | Not canonical v3 source of truth. |
| `tests/seedCatalogCanonicalV3Contract.test.js` | Contract | Seeded canonical v3 catalog expectations. | Does not prove dashboard publish-created catalog. |
| `tests/checkout.integration.test.js` | Integration | Subscription checkout and add-on pricing. | Does not cover planner day payment. |
| `tests/bootstrapOrchestrator.test.js` | Unit/integration | Bootstrap script orchestration. | Does not prove production catalog readiness. |
| `tests/seedSubscriptionPlans.test.js` | Contract | Subscription plan seed behavior. | Does not prove plan viability filtering in public menu. |
| `tests/catalogAllowlistParity.test.js` | Contract | Seed allowlists match runtime contract constants. | Does not prove v3 runtime premium salad allowlist enforcement. |

Recommended new tests:

- `tests/subscriptionPlannerDashboardToFlutter.e2e.test.js`
- `tests/premiumLargeSaladV3Allowlist.test.js`
- `tests/subscriptionPlannerStaleCatalog.test.js`
- `tests/subscriptionPlannerReadmeExamples.test.js`
- `tests/dashboardSubscriptionMenuReadiness.test.js`

## 15. Bootstrap, Seeds, and Operational Checks

Relevant scripts:

- `scripts/bootstrap/index.js`
- `scripts/bootstrap/seed-catalog.js`
- `scripts/seed-subscription-plans.js`
- `scripts/seed-subscription-addons.js`
- `scripts/seed-one-time-menu.js`
- `scripts/create_default_accounts.js`
- `scripts/seed-dashboard-users.js`
- `scripts/validate-backend.js`

Useful commands:

```bash
nvm use
npm install
npm test
npm run validate:backend
```

Additional seed/bootstrap commands from `package.json`:

```bash
npm run seed:subscription-plans
npm run seed:subscription-addons
npm run seed:one-time-menu
npm run bootstrap:data
npm run bootstrap:data:sync
npm run bootstrap:accounts
npm run seed:dashboard-users
```

Safe Mongo/test DB rules:

- Test scripts should run with `NODE_ENV=test`.
- Destructive tests should use existing safety helpers before deleting data.
- Do not run production seeds without the explicit production override required by each script.
- `scripts/validate-backend.js` states default validation avoids production DB, production seeds, and live payment provider calls.

Post-seed checks:

- Required subscription plans exist, are active, and are viable if product decides viability should matter.
- Required v3 products exist: standard meal, premium meal, premium large salad, cold sandwiches, and daily add-on products.
- Required option groups exist: proteins, carbs, sauces, salad groups, and any subscription-specific groups.
- Product-group relations exist.
- Product-option relations exist.
- Products/options/groups/relations are active, visible, available, and published.
- Linked `CatalogItem` rows are globally available.
- `premium_large_salad` exists and is priced, or fallback is intentionally accepted.
- Premium large salad excludes `extra_protein_50g`.
- Daily add-on one-time products map to supported categories.
- Dashboard health endpoints return acceptable results.

Default `npm test` is not the full backend suite.
Use `npm run validate:backend` and relevant targeted tests for integration confidence.

## 16. Recommended Fix Plan

### Phase 1: Documentation Contract Fixes

Goal: make backend docs accurate enough for internal fix planning.

Tasks:

- Correct old docs that use `ONE_TIME_ADDON_PAYMENT_REQUIRED` for day planner CTA.
- Complete endpoint tables and route alias policy.
- Clarify v3 vs legacy payload rules.
- Clarify daily add-ons as `MenuProduct` choices.
- Clarify payment lifecycle and `plannerRevisionHash`.
- Mark unstable areas as `Needs backend contract hardening`.

Files likely involved:

- `docs/SUBSCRIPTION_MENU_SYSTEM_README.md`
- `docs/SUBSCRIPTION_MENU_SYSTEM_SOURCE_OF_TRUTH.md`

Tests to add/run:

- Documentation diff review.
- Later `tests/subscriptionPlannerReadmeExamples.test.js`.

Exit criteria:

- Backend team has one internal reference that does not hide blockers.

### Phase 2: Backend Contract Hardening

Goal: reduce ambiguity before frontend teams implement typed clients.

Tasks:

- Decide premium salad allowlist ownership and implement the decision.
- Add or strengthen subscription planner readiness endpoint.
- Stabilize unified payment create/verify response variants.
- Document stale catalog error matrix.
- Publish route alias policy.

Files likely involved:

- `src/services/subscription/canonicalMealSlotPlannerService.js`
- `src/services/subscription/unifiedDayPaymentService.js`
- `src/services/dashboardHealthService.js`
- `src/controllers/dashboardHealthController.js`
- `src/routes/admin.js`

Tests to add/run:

- `tests/premiumLargeSaladV3Allowlist.test.js`
- `tests/dashboardSubscriptionMenuReadiness.test.js`
- Expanded `tests/mealPlannerPaymentContract.test.js`

Exit criteria:

- Backend can state final contract variants for premium salad, stale catalog, and unified day payment.

### Phase 3: Dashboard Preparation

Goal: make dashboard publish safe for Flutter planner consumption.

Tasks:

- Add product composer validation for subscription planner requirements.
- Add publish readiness checks.
- Separate checkout add-ons from daily extras in labels/UI.
- Add premium salad controls for allowlist/excluded groups.
- Add health/readiness pages using dashboard health endpoints.

Files likely involved:

- Dashboard frontend files when available.
- `src/services/orders/menuCatalogService.js`
- `src/controllers/dashboard/menuController.js`
- Dashboard health services.

Tests to add/run:

- `tests/dashboardSubscriptionMenuReadiness.test.js`
- Dashboard product-centered contract tests.

Exit criteria:

- Dashboard can publish only planner-ready catalog or clearly blocks unsafe publish.

### Phase 4: Flutter Preparation

Goal: give Flutter a stable v3-only integration path.

Tasks:

- Define typed models for `plannerCatalog`, day read, selection save, payment requirement, payment create, and verify.
- Send pure v3 payloads only.
- Implement stale catalog refresh.
- Implement unified day payment flow with `plannerRevisionHash`.
- Source daily add-ons only from `/addon-choices`.

Files likely involved:

- Flutter client code, not this backend repo.
- Backend docs and contract tests.

Tests to add/run:

- `tests/subscriptionPlannerReadmeExamples.test.js`
- `tests/subscriptionPlannerStaleCatalog.test.js`
- Existing planner/payment contracts.

Exit criteria:

- Flutter has deterministic behavior for save, payment, confirm, stale catalog, and add-on flows.

### Phase 5: E2E Testing

Goal: prove the real Dashboard-to-Flutter flow.

Tasks:

- Dashboard creates or updates catalog.
- Dashboard publishes catalog.
- Flutter fetches planner catalog.
- Flutter saves v3 selections.
- Backend computes payment requirement.
- Flutter creates unified payment.
- Flutter verifies payment.
- Flutter confirms day.
- Flutter reads fulfillment state.

Files likely involved:

- Dashboard menu services.
- Subscription planner services.
- Unified payment services.
- Test helpers/fixtures.

Tests to add/run:

- `tests/subscriptionPlannerDashboardToFlutter.e2e.test.js`
- `npm run validate:backend`

Exit criteria:

- One E2E test proves the integration path from dashboard catalog publish to customer day confirmation.

## 17. Final Source-of-Truth Decision

Can this document be used as the single backend reference now?

Yes, as an internal backend reference for problems, contracts, and fix planning.
No, not yet as a final Dashboard/Flutter implementation contract until blockers are fixed.

Top blockers before final Dashboard/Flutter contract:

- Correct old planner add-on payment guidance to `ADDON_PAYMENT_REQUIRED`.
- Finish endpoint and response examples for Flutter.
- Decide and enforce/document v3 premium large salad allowlist ownership.
- Harden unified day payment create/verify/no-payment/reuse/revision mismatch variants.
- Add dashboard subscription planner readiness checks.
- Add full dashboard-to-Flutter E2E test coverage.
=======
# Subscription Menu / Meal Planner Source Of Truth

Internal backend reference: YES
Final Dashboard/Flutter implementation contract: READY FOR CONTRACT REVIEW
Overall readiness: READY FOR DASHBOARD/FLUTTER CONTRACT REVIEW

Decision:

The subscription menu / meal planner backend can be used as the backend source of truth and contract review baseline. Dashboard and Flutter can start implementation against the documented v3 contract.

This is not a claim of full production readiness. Production readiness still depends on environment validation, secrets rotation, deployment checks, and real payment provider staging verification.

## Contract Decisions

- v3 premium large salad validation enforces the backend subscription salad protein allowlist.
- Dashboard relations cannot allow a disallowed premium large salad protein.
- `extra_protein_50g` is rejected for subscription premium large salad.
- Unified day payment create/verify responses include stable safe fields:
  `paymentId`, `payment_id`, `status`, `requiresPayment`, `premiumAmountHalala`, `addonsAmountHalala`, `totalHalala`, `plannerRevisionHash`, `paymentUrl`, and `payment_url`.
- Planner add-on CTA uses `ADDON_PAYMENT_REQUIRED`, not `ONE_TIME_ADDON_PAYMENT_REQUIRED`.
- Dashboard readiness is exposed through `GET /api/dashboard/health/meal-planner`.
- Flutter stale catalog refresh behavior is driven by explicit planner error codes and refresh hints.

## Final Status

READY FOR DASHBOARD/FLUTTER CONTRACT REVIEW

Dashboard/Flutter can begin contract review against:

- `GET /api/subscriptions/meal-planner-menu`
- `GET /api/subscriptions/addon-choices`
- `PUT /api/subscriptions/:id/days/:date/selection`
- `POST /api/subscriptions/:id/days/:date/selection/validate`
- `POST /api/subscriptions/:id/days/:date/payments`
- `POST /api/subscriptions/:id/days/:date/payments/:paymentId/verify`
- `POST /api/subscriptions/:id/days/:date/confirm`
- `GET /api/dashboard/health/meal-planner`
>>>>>>> f664f6cc (docs: addnig new md ref for SUBSCRIPTION_MENU_SYSTEM_SOURCE_OF_TRUTH)
