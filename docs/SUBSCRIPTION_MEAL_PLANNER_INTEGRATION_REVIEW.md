# Subscription Meal Planner Integration Review

## Review Rules
- Read-only. No source code changes.
- Only this report file was created/updated.
- Fast targeted inspection - no broad audit.

## Executive Summary
- Overall status: FAIL
- Biggest current risk: Flutter save payload can contain a non-primitive `SaladGroupsRequest` object at `salad.groups`, while backend save maps unknown exceptions to `500 INTERNAL`.
- Most likely root cause of the 500: `day_selection_request.g.dart` serializes `SaladRequest.groups` as `instance.groups`, then `subscriptionPlanningClientService.updateDaySelectionForClient()` returns `500 "Selection failed"` for unclassified exceptions, localized to Arabic as `"فشل حفظ الاختيارات"`.
- Is Flutter using the v3 contract correctly? Partially. It reads `data.builderCatalog`, validates `meal_planner_menu.v3`, and parses `sections[]`, but UI/business logic still consumes derived legacy-shaped fields such as `builderCatalog.premiumLargeSalad`, `carbs`, `categories`, and `allProteins`.
- Is the backend accepting the Flutter save-selection payload? Not safely for premium large salad until nested `salad.groups` serialization is made primitive JSON and group names are verified against the backend canonical keys.
- Recommended first fix section: 01 · Flutter Save Selection Payload

## Review Progress Board

| Section | Status | Risk | Owner | Notes |
|---|---|---|---|---|
| 01 Flutter Save Selection Payload | DONE | Critical | Flutter | `salad.groups` generated serializer is not explicit JSON. |
| 02 Premium Large Salad End-to-End | DONE | High | Flutter + Backend | v3-derived, but UI uses derived legacy field and backend allows only standard salad proteins. |
| 03 Backend Save Selection Validation | DONE | High | Backend | Validation exists before mutation, but validation failures use 422 and unknown failures become 500. |
| 04 Backend Error Handling 400 vs 500 | DONE | Critical | Backend | Exact `Selection failed` -> Arabic 500 path found. |
| 05 Flutter Menu Fetch & Parser | DONE | High | Flutter | v3 parsed, then remapped into legacy-shaped domain fields. |
| 06 Legacy Contract Usage | DONE | High | Flutter + Backend | Active Flutter domain/UI usage of banned names remains. |
| 07 Addons / addonsOneTime Flow | DONE | Medium | Flutter + Backend | Supported; stale IDs rejected, payment path covered. |
| 08 Backend Menu Contract | DONE | Medium | Backend | Returns `builderCatalog` v3; section `sortOrder` missing in default v3 builder. |
| 09 Flutter UI Rendering | DONE | High | Flutter | UI is not primarily raw `sections[]` driven. |
| 10 Carbs & Meal Business Rules | DONE | Medium | Flutter + Backend | Rules mostly aligned; salad protein expectation differs from prompt. |
| 11 Test Coverage Inventory | DONE | Medium | Flutter + Backend | Backend coverage broad; Flutter payload serialization coverage missing. |

---

## 01 · Flutter Save Selection Payload

**Status:** DONE

**Files inspected:**
- `../mobile_app/lib/data/request/day_selection_request.dart` - request DTOs.
- `../mobile_app/lib/data/request/day_selection_request.g.dart` - generated JSON.
- `../mobile_app/lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart` - `_buildRequest()`.
- `../mobile_app/lib/data/data_source/remote_data_source_impl.dart` - `saveDaySelection()`.

**Evidence:**
- `day_selection_request.dart:5` marks `DaySelectionRequest` as `@JsonSerializable(explicitToJson: true)`.
- `day_selection_request.dart:84` declares `SaladRequest` without `explicitToJson: true`.
- `day_selection_request.g.dart:78` emits `'groups': instance.groups`, not `instance.groups.toJson()`.
- `meal_planner_bloc.dart:1311` builds `mealSlots[]`; sandwich uses `selectionType`, `slotIndex`, `slotKey`, `sandwichId`.
- `meal_planner_bloc.dart:1323` builds premium salad with `selectionType: 'premium_large_salad'`, `proteinId`, and `salad.groups`.
- `meal_planner_bloc.dart:1344` builds standard/premium meal with `proteinId`, `proteinKey`, `premiumKey`, and `carbs[]`.
- `meal_planner_bloc.dart:1361` sends `addonsOneTime: current.selectedAddOnIds`.
- `remote_data_source_impl.dart:246` sends `request.toJson()` to `saveDaySelection()`.

**Findings:**
- Critical - `../mobile_app/lib/data/request/day_selection_request.g.dart`, `_$SaladRequestToJson()`: emits a Dart object for `groups`; this is the concrete payload risk behind `"Instance of 'SaladGroupsRequest'"` and can break premium salad saves.
- Medium - `../mobile_app/lib/data/request/day_selection_request.dart`, `MealSlotRequest.carbs`: Flutter models `carbs` as a list, not an object; backend accepts list-style `carbs[]`, so this is compatible despite the prompt wording.
- Low - `../mobile_app/lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart`, `_buildRequest()`: `addonsOneTime` is always a list of selected IDs; backend accepts this field.

**Required fixes later, not now:**
- Add `explicitToJson: true` to `SaladRequest` or hand-write `groups.toJson()`.
- Add a Flutter test that encodes a premium_large_salad request and asserts no `"Instance of"` appears.

---

## 02 · Premium Large Salad End-to-End

**Status:** DONE

**Files inspected:**
- `../mobile_app/lib/data/mappers/meal_planner_menu_mapper.dart` - v3 to domain mapping.
- `../mobile_app/lib/presentation/plans/timeline/meal_planner/widgets/protein_picker_sheet.dart` - premium salad entry point.
- `../mobile_app/lib/presentation/plans/timeline/meal_planner/custom_premium_meal_builder_screen.dart` - builder UI.
- `src/config/mealPlannerContract.js` - salad rules.
- `src/services/subscription/mealSlotPlannerService.js` - salad validation.

**Evidence:**
- `meal_planner_menu_mapper.dart:721` builds `PremiumLargeSaladModel` from a v3 section/product.
- `meal_planner_menu_mapper.dart:777` picks the salad product if the product key contains `salad`, not strictly `product.key == "premium_large_salad"`.
- `protein_picker_sheet.dart:331` shows the salad builder from `state.menu.builderCatalog.premiumLargeSalad`.
- `custom_premium_meal_builder_screen.dart:50` reads `widget.config.preset.groups`.
- `custom_premium_meal_builder_screen.dart:272` enforces group min/max from config.
- `mealPlannerContract.js:167` defines canonical groups: `leafy_greens`, `vegetables`, `protein`, `cheese_nuts`, `fruits`, `sauce`.
- `mealSlotPlannerService.js:343` rejects missing/non-object `salad.groups`.
- `mealSlotPlannerService.js:390` requires exactly one protein.
- `mealSlotPlannerService.js:403` rejects premium proteins for subscription premium large salad.

**Findings:**
- High - `../mobile_app/lib/data/mappers/meal_planner_menu_mapper.dart`, `_premiumLargeSaladProduct()`: finding any key containing `salad` is looser than the v3 requirement and can select the wrong salad-like product.
- High - `../mobile_app/lib/data/request/day_selection_request.g.dart`, `_$SaladRequestToJson()`: even a valid builder selection can serialize `groups` unsafely.
- Medium - `src/config/mealPlannerContract.js`, `SALAD_SELECTION_GROUPS`: backend canonical keys are `vegetables` and `sauce`; prompt expects `vegetables_legumes` and `sauces`. Runtime aliases exist in catalog code, but the save contract should be documented consistently.
- Medium - `src/services/subscription/mealSlotPlannerService.js`, `validatePremiumLargeSalad()`: subscription premium salad rejects premium proteins; prompt expectation around `proteins` group may conflict if the UI offers premium proteins.

**Required fixes later, not now:**
- Select salad by exact `product.key == "premium_large_salad"`.
- Align documented salad group keys with backend save keys.
- Fix nested JSON serialization before retesting the end-to-end flow.

---

## 03 · Backend Save Selection Validation

**Status:** DONE

**Files inspected:**
- `src/routes/subscriptions.js` - route.
- `src/controllers/subscriptionController.js` - controller.
- `src/services/subscription/subscriptionPlanningClientService.js` - client-facing save/validate wrapper.
- `src/services/subscription/subscriptionSelectionService.js` - save/validate service.
- `src/services/subscription/mealSlotPlannerService.js` - meal slot validation.

**Evidence:**
- `subscriptions.js:698` routes `PUT /:id/days/:date/selection`.
- `subscriptionController.js:2263` resolves date and validates `subscriptionId`.
- `subscriptionPlanningClientService.js:41` extracts `mealSlots`, `contractVersion`, and `addonsOneTime`.
- `subscriptionSelectionService.js:489` rejects non-`mealSlots` payloads before draft building.
- `subscriptionSelectionService.js:518` builds and validates the draft before `mongoose.startSession()` at `557`.
- `mealSlotPlannerService.js:155` validates slot index and selection type.
- `mealSlotPlannerService.js:223`, `239`, `257`, `335`, `446` validate standard, premium, carbs, salad, and sandwich exclusivity.

**Findings:**
- Medium - `src/services/subscription/subscriptionSelectionService.js`, `performDaySelectionUpdate()`: validation occurs before mutation, which is the right integration shape.
- High - `src/services/subscription/subscriptionPlanningClientService.js`, `updateDaySelectionForClient()`: draft validation errors with `err.status` return that status, commonly 422, not the requested 400.
- High - `src/services/subscription/mealSlotPlannerService.js`, `normalizeSaladPayload()`: malformed non-object `salad.groups` is handled as invalid only if it reaches validation; transport/parser exceptions before validation fall through to 500.

**Required fixes later, not now:**
- Normalize planner validation failures to 400 if that is the API contract.
- Add an early plain-object validator for `mealSlots[].salad.groups` before deeper catalog validation.

---

## 04 · Backend Error Handling — 400 vs 500

**Status:** DONE

**Files inspected:**
- `src/services/subscription/subscriptionPlanningClientService.js`
- `src/utils/errorResponse.js`
- `src/utils/errorLocalization.js`
- `src/locales/ar.js`

**Evidence:**
- `subscriptionPlanningClientService.js:115` maps `VALIDATION_ERROR`, add-on conflicts, and invalid add-ons to 400.
- `subscriptionPlanningClientService.js:119` maps errors with `err.status && err.code` to their status.
- `subscriptionPlanningClientService.js:126` maps all other save exceptions to `500 INTERNAL "Selection failed"`.
- `errorLocalization.js:34` maps `"Selection failed"` to `errors.subscription.selectionFailed`.
- `ar.js:310` translates `selectionFailed` as `"فشل حفظ الاختيارات"`.
- `errorResponse.js:3` localizes the message before returning JSON.

**Findings:**
- Critical - `src/services/subscription/subscriptionPlanningClientService.js`, `updateDaySelectionForClient()`: unknown exceptions are swallowed into generic `500 INTERNAL`, which exactly matches the production Arabic failure.
- High - `src/services/subscription/subscriptionPlanningClientService.js`, `validateDaySelectionForClient()`: validate endpoint has the same unknown-exception pattern with `"Validation failed"`.
- Medium - `src/utils/apiError.js`, `ApiError`: a structured error class exists, but this path primarily checks plain `err.status`/`err.code`.

**Required fixes later, not now:**
- Convert malformed request-shape exceptions into structured 400 errors before they enter catalog/planner services.
- Preserve validation details instead of returning generic `"Selection failed"`.

---

## 05 · Flutter Menu Fetch & Parser

**Status:** DONE

**Files inspected:**
- `../mobile_app/lib/data/response/meal_planner_menu_response.dart`
- `../mobile_app/lib/data/mappers/meal_planner_menu_mapper.dart`
- `../mobile_app/test/menu_contract_parsing_test.dart`

**Evidence:**
- `meal_planner_menu_response.dart:39` reads `data.builderCatalog`.
- `meal_planner_menu_response.dart:94` accepts `contractVersion` or `catalogVersion`.
- `meal_planner_menu_response.dart:96` reads `sections[]`.
- `meal_planner_menu_mapper.dart:264` uses `self?.data?.builderCatalog`.
- `meal_planner_menu_mapper.dart:265` throws unless catalog version is `meal_planner_menu.v3`.
- `meal_planner_menu_mapper.dart:313` maps v3 builderCatalog to `BuilderCatalogModel`.
- `menu_contract_parsing_test.dart:17` covers `builderCatalog.contractVersion = meal_planner_menu.v3`.

**Findings:**
- Medium - `../mobile_app/lib/data/mappers/meal_planner_menu_mapper.dart`, `MealPlannerMenuResponseMapper.toDomain()`: v3 contract validation is present.
- High - `../mobile_app/lib/data/mappers/meal_planner_menu_mapper.dart`, `BuilderCatalogV2ResponseMapper.toDomain()`: v3 `sections[]` are remapped into legacy-shaped `categories`, `proteins`, `premiumProteins`, `carbs`, `sandwiches`, and `premiumLargeSalad`; UI can still behave like legacy.
- Low - `../mobile_app/test/menu_contract_parsing_test.dart`: parser has v3 coverage but no negative test for unsupported contract version.

**Required fixes later, not now:**
- Move UI toward raw `builderCatalogV2.sections`/section models or clearly document the derived compatibility model.
- Add parser tests for missing/empty `imageUrl`, empty add-ons, and unsupported contract version.

---

## 06 · Legacy Contract Usage

**Status:** DONE

**Files inspected:**
- Targeted grep hits across backend and Flutter.

**Evidence and classification:**
- `../mobile_app/lib/data/mappers/meal_planner_menu_mapper.dart:156` - `premiumProteins` - `active_usage` - Risk: High. Derived from v3 or legacy response class, then used in UI.
- `../mobile_app/lib/data/mappers/meal_planner_menu_mapper.dart:228` - `premiumLargeSalad` - `active_usage` - Risk: High. Derived from v3 sections, but exposed under banned legacy name.
- `../mobile_app/lib/presentation/plans/timeline/meal_planner/widgets/protein_picker_sheet.dart:112` - `builderCatalog.categories` - `active_usage` - Risk: High. UI tabs depend on derived category list.
- `../mobile_app/lib/presentation/plans/timeline/meal_planner/meal_planner_screen.dart:631` - `builderCatalog.carbs` - `active_usage` - Risk: High. Carb UI reads derived list, not raw section.
- `../mobile_app/lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart:1270` - `builderCatalog.allProteins` - `active_usage` - Risk: Medium. Derived from v3, but legacy-shaped.
- `src/controllers/menuController.js:379` - `builderCatalogV2` behind `includeLegacy` - `safe_compat` - Risk: Low.
- `src/controllers/menuController.js:382` - `plannerCatalog` behind `includeLegacy` - `safe_compat` - Risk: Low.
- `src/services/catalog/CatalogService.js:1259` - legacy `builderCatalog` source used to compile v3 - `safe_compat` - Risk: Low.
- `tests/*`, `docs/*`, `scripts/*` hits - `safe_compat` or test/docs references - Risk: Low unless used by app runtime.

**Findings:**
- High - Flutter has no direct `data.plannerCatalog` or `data.builderCatalogV2` parser hit, but it actively consumes banned legacy-shaped domain members after v3 mapping.
- Low - Backend normal response hides `plannerCatalog` and `builderCatalogV2`; legacy fields are only included with `includeLegacy=true`.

**Required fixes later, not now:**
- Decide whether derived compatibility fields are acceptable. If not, refactor planner UI to raw `sections[]`.

---

## 07 · Addons / addonsOneTime Flow

**Status:** DONE

**Files inspected:**
- `src/controllers/menuController.js`
- `src/services/subscription/subscriptionPlanningClientService.js`
- `src/services/subscription/subscriptionSelectionService.js`
- `../mobile_app/lib/data/mappers/meal_planner_menu_mapper.dart`
- `../mobile_app/lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart`

**Evidence:**
- `menuController.js:376` returns `addonCatalog`.
- `meal_planner_menu_mapper.dart:269` maps flat-once add-on items.
- `meal_planner_bloc.dart:1361` sends `addonsOneTime: current.selectedAddOnIds`.
- `subscriptionPlanningClientService.js:56` accepts `body.addonsOneTime || body.oneTimeAddonSelections`.
- `subscriptionSelectionService.js:536` reconciles add-ons before mutation.
- `tests/mealPlannerPaymentContract.test.js:738` covers add-on-only unified payment.

**Findings:**
- Medium - `src/services/subscription/subscriptionPlanningClientService.js`, `requestedOneTimeAddonIds`: uses `||`, so an empty array is fine, but falsy non-array values may fall through to legacy field unexpectedly.
- Low - `../mobile_app/lib/data/mappers/meal_planner_menu_mapper.dart`, add-on parsing filters to `isItem && isFlatOnce`, matching backend `Addon.find({ kind: "item", billingMode: "flat_once" })`.
- Medium - stale IDs are backend-handled, but Flutter has no visible payload test for `addonsOneTime`.

**Required fixes later, not now:**
- Add Flutter serialization coverage for `addonsOneTime`.
- Prefer nullish checks over `||` in backend add-on request extraction.

---

## 08 · Backend Menu Contract

**Status:** DONE

**Files inspected:**
- `src/routes/subscriptions.js`
- `src/controllers/menuController.js`
- `src/services/subscription/mealPlannerCatalogService.js`
- `src/services/catalog/CatalogService.js`

**Evidence:**
- `subscriptions.js:81` routes `GET /meal-planner-menu`.
- `menuController.js:376` returns `data.builderCatalog: appBuilderCatalog`.
- `menuController.js:361` sets `appBuilderCatalog = plannerCatalog || {}`.
- `CatalogService.js:870` sets `contractVersion: "meal_planner_menu.v3"`.
- `CatalogService.js:872` returns `sections`.
- `CatalogService.js:811`, `826`, `858` products use `action: { type: "open_builder" }`.
- `CatalogService.js:795` sandwich products use `action: { type: "direct_add" }`.
- `CatalogService.js:750` default v3 sections include standard, premium, sandwich, and premium_large_salad.

**Findings:**
- High - `src/services/catalog/CatalogService.js`, `buildCanonicalPlannerCatalogV3()`: default v3 sections do not include section keys `chicken`, `beef`, `fish`, `eggs`, or `carbs` as top-level sections; those exist as option/category concepts.
- Medium - `src/services/catalog/CatalogService.js`, `buildCanonicalPlannerCatalogV3()`: section objects have no explicit `sortOrder`, despite prompt requiring each section to have one.
- Low - `src/controllers/menuController.js`, `getSubscriptionMealPlannerMenu()`: default response puts v3 planner under `data.builderCatalog` and hides legacy fields unless requested.

**Required fixes later, not now:**
- Add section `sortOrder` if it is contractual.
- Reconcile expected section-key list with actual default v3 design.

---

## 09 · Flutter UI Rendering

**Status:** DONE

**Files inspected:**
- `../mobile_app/lib/presentation/plans/timeline/meal_planner/widgets/protein_picker_sheet.dart`
- `../mobile_app/lib/presentation/plans/timeline/meal_planner/meal_planner_screen.dart`
- `../mobile_app/lib/presentation/plans/timeline/meal_planner/custom_premium_meal_builder_screen.dart`

**Evidence:**
- `protein_picker_sheet.dart:61` iterates `builderCatalog.allProteins`.
- `protein_picker_sheet.dart:68` iterates `builderCatalog.sandwiches`.
- `protein_picker_sheet.dart:112` renders categories from `builderCatalog.categories`.
- `protein_picker_sheet.dart:331` gets custom salad from `builderCatalog.premiumLargeSalad`.
- `meal_planner_screen.dart:631` builds carb choices from `builderCatalog.carbs`.
- `custom_premium_meal_builder_screen.dart:50` renders from `PremiumLargeSaladModel.preset.groups`.

**Findings:**
- High - Flutter planner UI is not primarily rendered from raw `data.builderCatalog.sections[]`; it uses derived domain lists.
- Medium - Sandwiches are separated by `selectionType == 'sandwich'` and do not trigger carbs in `_buildRequest()`, which matches backend exclusivity.
- Medium - Product `action.type` is parsed in response models but not observed as the primary UI driver in the inspected planner screen.

**Required fixes later, not now:**
- Drive picker tabs and actions from raw section/product/action models or explicitly approve the derived model as compatibility.

---

## 10 · Carbs & Meal Business Rules

**Status:** DONE

**Files inspected:**
- `src/config/mealPlannerContract.js`
- `src/services/subscription/mealSlotPlannerService.js`
- `../mobile_app/lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart`
- `../mobile_app/lib/presentation/plans/timeline/meal_planner/meal_planner_screen.dart`

**Evidence:**
- `mealPlannerContract.js:301` exposes `standardCarbs` and `premiumCarbs`.
- `mealSlotPlannerService.js:257` requires carbs for standard/premium meals.
- `mealSlotPlannerService.js:335` rejects carbs for premium_large_salad.
- `mealSlotPlannerService.js:449` rejects carbs/protein/salad on sandwich.
- `mealSlotPlannerService.js:734` enforces beef max one slot/day.
- `meal_planner_screen.dart:464` caps displayed carb item count to max 2.
- `meal_planner_bloc.dart:1320` sends sandwich without carbs.

**Findings:**
- Medium - Backend enforces beef max slots/day; Flutter also computes rules for UX, but backend is the authoritative guard.
- Medium - Carbs apply to standard/premium and not sandwich/salad, aligned between Flutter request building and backend validation.
- Medium - Premium proteins `beef_steak`, `shrimp`, `salmon` are backend premium keys, but premium_large_salad validation rejects premium proteins for subscription salad.

**Required fixes later, not now:**
- Clarify whether premium_large_salad should allow premium proteins. Current backend says no.

---

## 11 · Test Coverage Inventory

**Status:** DONE

**Files inspected:**
- `tests/mealPlannerCanonicalContract.test.js`
- `tests/mealPlanner.integration.test.js`
- `tests/mealPlannerPaymentContract.test.js`
- `tests/subscriptionPlannerDashboardToFlutter.e2e.test.js`
- `tests/meal_planner_types.test.js`
- `tests/premiumLargeSaladV3Allowlist.test.js`
- `../mobile_app/test/menu_contract_parsing_test.dart`

**Evidence:**
- `mealPlannerCanonicalContract.test.js:134` asserts `data.builderCatalog.contractVersion`.
- `subscriptionPlannerDashboardToFlutter.e2e.test.js:272` asserts v3 contract and hidden legacy fields.
- `subscriptionPlannerDashboardToFlutter.e2e.test.js:294` asserts premium_large_salad product has option groups.
- `mealPlanner.integration.test.js:819` covers standard meal save payload.
- `mealPlanner.integration.test.js:988` covers premium_large_salad save.
- `mealPlanner.integration.test.js:1087` and `mealPlannerPaymentContract.test.js:738` cover add-on payment paths.
- `meal_planner_types.test.js:1158` covers missing salad protein validation code.
- `../mobile_app/test/menu_contract_parsing_test.dart:11` covers v3 parser.

**Findings:**
- High - No Flutter test hit for `DaySelectionRequest`, `SaladGroupsRequest`, `jsonEncode`, or `"Instance of"`; the exact suspected payload bug is unguarded.
- Medium - Backend tests cover many save/payment paths, but the invalid premium_large_salad HTTP status appears to be 422 in service logic, not the requested 400.
- Low - Flutter parser coverage exists but does not prove UI renders from raw sections.

**Required fixes later, not now:**
- Add Flutter payload serialization tests for standard, premium, sandwich, salad, and add-ons.
- Add HTTP-level invalid salad payload test asserting the agreed status.

---

## Final Patch Plan

Do not implement. Document only:
- Confirmed bugs:
  - Flutter `SaladRequest` generated serializer leaves `groups` as a Dart object.
  - Backend save wrapper maps unknown exceptions to `500 INTERNAL "Selection failed"`, localized as `"فشل حفظ الاختيارات"`.
  - Default backend v3 sections lack explicit `sortOrder`.
- Contract mismatches:
  - Flutter validates v3 but UI consumes legacy-shaped derived fields.
  - Prompt expects top-level sections `premium`, `chicken`, `beef`, `fish`, `eggs`, `carbs`; default backend v3 returns `standard_meal`, `premium_meal`, `sandwich`, `premium_large_salad`.
  - Prompt expects salad groups `vegetables_legumes` and `sauces`; backend save canonical keys are `vegetables` and `sauce`.
- Missing validations:
  - Early backend request-shape validation for plain JSON `mealSlots[].salad.groups`.
  - Flutter encoded-payload tests for no `"Instance of"`.
- Exact files needing future changes:
  - Flutter: `mobile_app/lib/data/request/day_selection_request.dart`, regenerated `day_selection_request.g.dart`, `mobile_app/test/...` payload test.
  - Flutter later: planner UI files under `mobile_app/lib/presentation/plans/timeline/meal_planner/` if raw `sections[]` rendering is mandatory.
  - Backend: `src/services/subscription/subscriptionPlanningClientService.js`, possibly `src/services/subscription/mealSlotPlannerService.js`, `src/services/catalog/CatalogService.js`.
- Safest fix order:
  - Fix Flutter `salad.groups` JSON serialization.
  - Add Flutter encoded payload test.
  - Add backend early request-shape validator and map malformed payloads to 400.
  - Reconcile and document exact v3 section/group keys.
  - Add section `sortOrder` if required.

## Final Recommendation

**Verdict:** FAIL

**Reason:** The v3 menu parser is partially correct, but the premium large salad save path has a concrete serialization risk and the backend has a confirmed path that turns unclassified failures into the observed Arabic 500 response. Fix section 01 first, then section 04.
