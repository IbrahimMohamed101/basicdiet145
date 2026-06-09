# Subscription Meal Planner Final Verification

## Summary
- Verdict: PASS for the reported premium salad serialization / malformed save-selection 500 path.
- Original issue closed? Yes.
- Merge recommendation: MERGE_WITH_RISKS.
- Remaining risks: Flutter still selects the premium salad product with loose `contains('salad')` matching, and older broad suites still contain planner catalog/test drift.

## Fix Verification Matrix

| Area | Status | Evidence | Risk |
|---|---|---|---|
| Flutter `salad.groups` serialization | PASS | `../mobile_app/lib/data/request/day_selection_request.dart` uses `@JsonSerializable(explicitToJson: true)` on `SaladRequest`; generated `day_selection_request.g.dart` emits `instance.groups.toJson()`; `day_selection_request_serialization_test.dart` asserts encoded payload does not contain `Instance of`. | Low |
| Backend malformed payload 400 | PASS | `src/services/subscription/subscriptionPlanningClientService.js` runs `validateMealSlotsRequestShape()` before save/validate logic; malformed `salad.groups`, missing required sauce, and malformed `addonsOneTime` are asserted as `400 VALIDATION_ERROR` in `tests/subscriptionPlannerDashboardToFlutter.e2e.test.js`. | Low |
| Backend catalog filters saveable salad proteins | PASS | `src/services/catalog/CatalogService.js` filters premium salad protein options with `isSubscriptionPremiumLargeSaladProtein()`; tests assert `beef`, `beef_steak`, `shrimp`, `salmon`, and `extra_protein_50g` are not exposed. | Low |
| Backend-owned group rules exposed | PASS | `CatalogService.js` emits salad group `minSelections`, `maxSelections`, `isRequired`, `required`, and `rules` from `SALAD_SELECTION_GROUPS`; e2e asserts protein and sauce groups are required with min/max `1`. | Low |
| Valid premium salad save | PASS | `tests/subscriptionPlannerDashboardToFlutter.e2e.test.js` asserts valid v3 `premium_large_salad` save returns `200`; `tests/premiumLargeSaladV3Allowlist.test.js` validates an allowlisted protein successfully. | Low |
| Disallowed protein save validation | PASS | `tests/subscriptionPlannerDashboardToFlutter.e2e.test.js` and `tests/premiumLargeSaladV3Allowlist.test.js` assert disallowed salad proteins fail with `SALAD_PROTEIN_NOT_ALLOWED`. | Low |
| Flutter exact product key selection | FOLLOW-UP | `../mobile_app/lib/data/mappers/meal_planner_menu_mapper.dart` still returns the first product whose key `contains('salad')` before falling back to the `premium_large_salad` section. | Medium |

## Original Error Path
- Previous behavior: Flutter could serialize `salad.groups` as a Dart instance string, and backend unknown save exceptions could collapse into `500 INTERNAL "Selection failed"` / Arabic `"فشل حفظ الاختيارات"`.
- Current behavior: Flutter serializes `salad.groups` as a JSON map, backend preflight rejects malformed legacy payloads with `400 VALIDATION_ERROR`, and valid premium salad saves still pass.
- Is it closed? Yes, for the reported premium salad serialization and malformed save-selection 500 path.

## Remaining Risks
Ranked:
1. Flutter premium salad product lookup is still loose and should be changed to exact `product.key == 'premium_large_salad'`.
2. `mealPlanner.integration.test.js` still reflects older legacy catalog and premium-protein salad expectations; it should be reconciled with the v3 subscription contract.
3. `subscription_addon_selection_readback.integration.test.js` remains an add-on readback confidence gap because prior failures were Mongo/test-infrastructure transaction issues, not the premium salad fixes.

## Broad Test Classification
### mealPlanner.integration.test.js
- Blocks this merge? No for the targeted premium salad 500/catalog fix.
- Reason: Prior observed failures centered on older expectations such as legacy `builderCatalog.premiumLargeSalad`, `premiumProteins`, and premium salad proteins. Those expectations conflict with the selected Option 1 subscription contract.
- Follow-up: Update the suite to assert the v3 `sections[]` contract and standard-only subscription salad protein rules.

### subscription_addon_selection_readback.integration.test.js
- Blocks this merge? No.
- Reason: Prior observed failures were Mongo memory-server write/transaction/catalog-change failures during persistence, while focused add-on validation paths passed.
- Follow-up: Stabilize the integration test environment or add retry handling for transient Mongo write conflicts in the test setup.

## Final Recommendation
- MERGE_WITH_RISKS

Reason:
The original reported path is effectively closed: Flutter emits valid JSON, backend malformed payloads return structured 400s, backend catalog no longer exposes unsaveable premium salad proteins, and targeted backend tests pass. The remaining risks are follow-up quality and contract-cleanup items rather than blockers for this specific fix set.
