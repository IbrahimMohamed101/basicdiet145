# Subscription Meal Planner Post-Fix Verification

## Summary
- Verdict: Both targeted fixes are verified for the reported premium salad serialization / malformed save-selection 500 issue.
- Flutter payload fix: PASS - `salad.groups` now serializes as a JSON map, not a Dart instance string.
- Backend 400 vs 500 fix: PASS - malformed legacy planner payload shapes are rejected early with `400 VALIDATION_ERROR`.
- Failing tests classification: The observed failures do not show the two recent fixes are incomplete; they point to test infrastructure and older catalog/protein contract drift.
- Merge recommendation: MERGE_WITH_RISKS.

## Flutter Fix Verification
- Status: PASS.
- Evidence:
  - `../mobile_app/lib/data/request/day_selection_request.dart`: `SaladRequest` is annotated with `@JsonSerializable(explicitToJson: true)`.
  - `../mobile_app/lib/data/request/day_selection_request.g.dart`: `_$SaladRequestToJson()` emits `'groups': instance.groups.toJson()`.
  - `../mobile_app/test/day_selection_request_serialization_test.dart`: test builds a `premium_large_salad` `DaySelectionRequest`, runs `jsonEncode(request.toJson())`, asserts the encoded string does not contain `Instance of`, and asserts `salad.groups` is a `Map<String, dynamic>`.
  - Backend-facing field names remain unchanged: `mealSlots`, `slotIndex`, `slotKey`, `selectionType`, `proteinId`, `carbs`, `sandwichId`, `salad`, `presetKey`, `groups`, `addonsOneTime`.
- Remaining risks:
  - The test covers premium salad serialization directly; it does not prove every planner UI path constructs the request, but the DTO-level root cause is closed.

## Backend Fix Verification
- Status: PASS for malformed save-selection payload handling.
- Evidence:
  - `src/services/subscription/subscriptionPlanningClientService.js`: `validateMealSlotsRequestShape()` now runs before `performDaySelectionUpdate()` and `performDaySelectionValidation()`.
  - `validateMealSlotsRequestShape()` rejects non-array `mealSlots`, non-object slots, malformed legacy `carbs`, malformed `addonsOneTime`, and non-object `premium_large_salad` `salad.groups`.
  - `validateLegacyPremiumSaladShape()` requires `salad.groups` to be a plain object, group values to be arrays, exactly one protein, and exactly one sauce.
  - `updateDaySelectionForClient()` now preserves safe specific add-on codes: `VALIDATION_ERROR`, `INVALID_ONE_TIME_ADDON_SELECTION`, and `ONE_TIME_ADDON_CATEGORY_CONFLICT`.
  - `tests/subscriptionPlannerDashboardToFlutter.e2e.test.js`: asserts malformed `"Instance of 'SaladGroupsRequest'"` style `salad.groups` returns `400`, missing required salad group returns `400`, malformed `addonsOneTime` returns `400`, and the valid v3 `premium_large_salad` save still returns `200`.
  - Targeted runs reported/observed: `NODE_ENV=test node tests/subscriptionPlannerDashboardToFlutter.e2e.test.js` passed; `NODE_ENV=test node tests/subscription_addon_selection_contract.test.js` passed.
- Remaining risks:
  - Unexpected server/database/catalog exceptions still correctly return 500; the fix does not attempt to convert real infrastructure failures into validation errors.
  - Canonical v3 stale-catalog validation still uses the existing planner status behavior rather than normalizing every planner error to 400.

## Failed Test Classification

### subscription_addon_selection_readback.integration.test.js
- Status: FAILING, but not caused by the malformed payload 400 fix.
- Evidence:
  - Observed failure log shows `MongoServerError: Unable to acquire IX lock...` and later `Unable to write to collection ... due to catalog changes; please retry the operation`, both during `performDaySelectionUpdate()` persistence.
  - On rerun, the validation-only case `validate accepts canonical mealSlots plus addonsOneTime MenuProduct id` passed.
  - On rerun, invalid add-on validation assertions passed: `Addon plan id cannot be used as daily MenuProduct selection` and `invalid or disallowed MenuProduct is rejected`.
  - The remaining failing readback/kitchen assertions depend on the earlier save succeeding; they cascade after the Mongo transaction/write failure.
- Cause: Mongo memory-server transaction/catalog-change behavior or test infrastructure timing in the save path, not the new request-shape validator.
- Blocks merge? No for the current malformed-payload fix, but it should be tracked because it weakens confidence in add-on readback coverage.
- Required follow-up:
  - Stabilize the test transaction/write setup or add retry handling around the specific transient Mongo write conflict in the test environment.

### mealPlanner.integration.test.js
- Status: FAILING, but not a direct blocker for the two recent fixes.
- Evidence:
  - Observed failures include old catalog expectations such as `builderCatalog has proteins with premiumKey`, `builderCatalog has premiumLargeSalad`, and `builderCatalog sandwiches contain only real sandwich meals`.
  - The same run logged `[CatalogService] premium_large_salad not found, falling back to basic_salad`, indicating seed/catalog setup mismatch.
  - Premium salad validation failures expect premium proteins to be accepted, while current backend validation rejects disallowed subscription salad proteins; this drift was already documented in the integration review.
  - Standard meal save and sandwich save scenarios in the run passed, showing the new shape validator did not break those valid flows.
  - Some add-on scenarios returned 400 in the broad suite, while the focused `subscription_addon_selection_contract.test.js` passed and the readback test's invalid add-on assertions passed after specific code preservation.
- Cause: Existing catalog/protein expectation drift plus broader suite setup assumptions; it still indicates the planner catalog contract has unresolved mismatch, especially around premium salad protein eligibility and legacy `builderCatalog` fields.
- Blocks merge? No for the targeted 400-vs-500 and Flutter serialization fixes, but yes for claiming the whole planner catalog contract is clean.
- Required follow-up:
  - Reconcile premium_large_salad protein eligibility and the legacy `builderCatalog` expectations in this suite with the current v3 contract.

## Remaining Risks
Ranked list:
1. Planner catalog contract drift remains: some tests still expect legacy `builderCatalog.premiumLargeSalad`, `premiumProteins`, and premium salad proteins that current v3/backend rules do not expose or allow.
2. `subscription_addon_selection_readback.integration.test.js` is flaky/failing around Mongo transaction writes, reducing confidence in persisted add-on readback coverage.
3. Backend preflight validation now catches the known malformed client shapes, but deeper catalog/business-rule errors still use existing planner status behavior and should be normalized only if product/API policy requires it.

## Next Recommended Work
- Reconcile and update the premium_large_salad contract: decide whether subscription salad protein options are standard-only or can include premium proteins, then align backend validation, catalog output, Flutter UI, and tests.
- Stabilize the add-on readback integration test's Mongo transaction behavior so it can reliably cover save/readback/kitchen output.
- Update `docs/SUBSCRIPTION_MEAL_PLANNER_INTEGRATION_REVIEW.md` or supersede it with this post-fix report so the old pre-fix Flutter serializer finding is not mistaken for current state.

## Final Recommendation
- MERGE_WITH_RISKS
- Reason: The two targeted fixes close the reported root cause and malformed-payload 500 path without changing success response shape or mobile/backend field names. The remaining failing suites are not evidence that these fixes are broken, but they do expose unresolved planner catalog/test drift that should be handled before declaring the broader subscription meal planner integration fully healthy.
