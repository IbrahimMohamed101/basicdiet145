# Premium Large Salad Full-Stack Contract Review

## Summary
- Status: BACKEND CATALOG CONTRACT FIXED.
- Original mismatch: backend save validation enforced a subscription-specific protein allowlist, while backend catalog output could expose any protein relation attached to the `premium_large_salad` product; Flutter rendered whatever the catalog exposed.
- Post-fix state: backend subscription planner catalog now filters `premium_large_salad` protein options through the same standard salad protein allowlist used by save validation, and emits backend-owned group min/max/required rules from `SALAD_SELECTION_GROUPS`.
- Current backend contract: `premium_large_salad` is a premium selection with canonical salad groups, exactly one protein, exactly one sauce, no carbs, no sandwich, and standard allowlisted salad proteins only.
- Current Flutter behavior: Flutter derives a `PremiumLargeSaladModel` from v3 `builderCatalog.sections[]`, renders the product's `optionGroups`, and sends legacy-style `salad.groups` JSON.
- Does Flutter match backend? Mostly for payload shape and group keys; not guaranteed for allowed proteins because Flutter trusts catalog options.
- Business decision needed? Yes: decide whether subscription premium salad allows standard salad proteins only, premium proteins too, or separate order/subscription salad rules.

## Backend Catalog Output
- Files inspected:
  - `src/config/mealPlannerContract.js`
  - `src/services/catalog/CatalogService.js`
  - `src/services/subscription/mealPlannerCatalogService.js`
  - `src/controllers/menuController.js`
  - `src/routes/subscriptions.js`
- Product key: `premium_large_salad`.
- Selection type: `premium_large_salad`.
- Group keys exposed: v3 catalog maps product option groups through `groupKeyResolver`; canonical known groups are `leafy_greens`, `vegetables`, `protein`, `cheese_nuts`, `fruits`, `sauce`; `vegetables_legumes` and `sauces` are aliases to `vegetables` and `sauce`; `extra_protein_50g` is excluded.
- Protein options exposed: default/v3 catalog uses product relations. In `buildV3ProductOptionGroups()`, premium salad gets a group resolver but no option filter, so attached protein options can be exposed even if save validation rejects them.
- Evidence:
  - `mealPlannerContract.js:167` defines `SALAD_SELECTION_GROUPS`, including `protein` min=1/max=1 and `sauce` min=1/max=1.
  - `mealPlannerContract.js:178` defines `SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS` and excludes premium keys such as `beef_steak`, `shrimp`, and `salmon`.
  - `CatalogService.js:776` builds premium salad option groups with `groupKeyResolver`, but no `optionFilter`.
  - `CatalogService.js:623` only filters options if an `optionFilter` function is passed.
  - `menuController.js:376` returns the v3 planner under `data.builderCatalog`.
- Risk: High. A Dashboard/product relation can make Flutter render a protein that backend save rejects with `SALAD_PROTEIN_NOT_ALLOWED`.

## Backend Save Validation
- Files inspected:
  - `src/services/subscription/mealSlotPlannerService.js`
  - `src/services/subscription/canonicalMealSlotPlannerService.js`
  - `src/services/subscription/subscriptionPlanningClientService.js`
- Required groups: exactly one protein and exactly one sauce.
- Accepted group keys: legacy save accepts canonical keys and aliases at preflight (`leafy_greens`, `vegetables`, `vegetables_legumes`, `protein`, `proteins`, `cheese_nuts`, `fruits`, `sauce`, `sauces`, `extra_protein_50g`), but deep legacy validation uses canonical `SALAD_SELECTION_GROUPS` keys.
- Allowed proteins: standard subscription salad allowlist in `SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS`: `boiled_eggs`, `tuna`, several chicken keys, and `fish_fillet`.
- Rejected proteins: premium proteins and non-allowlisted regular proteins; examples from tests include `beef`, `beef_steak`, and any premium option with `protein.isPremium`.
- Error behavior: malformed request shape returns `400 VALIDATION_ERROR`; business-rule failures commonly return planner validation errors such as `422 SALAD_PROTEIN_NOT_ALLOWED`.
- Evidence:
  - `mealSlotPlannerService.js:333` rejects carbs and sandwiches for premium salad.
  - `mealSlotPlannerService.js:342` requires `salad.groups` to be an object.
  - `mealSlotPlannerService.js:390` requires exactly one protein.
  - `mealSlotPlannerService.js:403` rejects `protein.isPremium` or proteins outside the allowlist.
  - `canonicalMealSlotPlannerService.js:689` rejects selected v3 `protein` options outside the same allowlist.
  - `subscriptionPlanningClientService.js:41` starts early malformed payload validation for legacy-style save payloads.
- Risk: Medium. Save validation is internally clear, but it can reject catalog-rendered choices if catalog relations include disallowed proteins.

## Flutter Rendering
- Files inspected:
  - `../mobile_app/lib/data/mappers/meal_planner_menu_mapper.dart`
  - `../mobile_app/lib/domain/model/meal_planner_menu_model.dart`
  - `../mobile_app/lib/presentation/plans/timeline/meal_planner/custom_premium_meal_builder_screen.dart`
  - `../mobile_app/lib/presentation/plans/timeline/meal_planner/widgets/protein_picker_sheet.dart`
- Source of premium salad config: `data.builderCatalog.sections[]` is remapped to `menu.builderCatalog.premiumLargeSalad`.
- Group keys rendered: whatever product `optionGroups` provide; UI normalizes `sauces` to `sauce`, `vegetable` to `vegetables`, and `cheesenuts`/`nutscheese` to `cheese_nuts`.
- Protein options rendered: first from premium salad option group ingredients; if none exist, fallback uses `catalog.proteins` only, not premium proteins.
- Min/max enforcement: Flutter enforces group `minSelect`/`maxSelect`; form requires selected protein and required groups.
- Evidence:
  - `meal_planner_menu_mapper.dart:721` builds `PremiumLargeSaladModel` from v3 product `optionGroups`.
  - `meal_planner_menu_mapper.dart:777` picks the first product whose key contains `salad`, not strict equality.
  - `custom_premium_meal_builder_screen.dart:201` uses config ingredients from protein group before falling back to standard proteins.
  - `custom_premium_meal_builder_screen.dart:367` normalizes group names and maps `sauces` to `sauce`.
  - `protein_picker_sheet.dart:331` shows salad builder in the premium tab when `premiumLargeSalad` exists.
- Risk: High if backend catalog exposes disallowed proteins. Flutter is catalog-driven and has no independent allowlist guard.

## Flutter Payload
- Files inspected:
  - `../mobile_app/lib/data/request/day_selection_request.dart`
  - `../mobile_app/lib/data/request/day_selection_request.g.dart`
  - `../mobile_app/lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart`
  - `../mobile_app/test/day_selection_request_serialization_test.dart`
- Payload shape: legacy-style `mealSlots[]` with `slotIndex`, `slotKey`, `selectionType: premium_large_salad`, `proteinId`, and `salad: { presetKey, groups }`.
- Group serialization: fixed; `SaladRequest` uses `explicitToJson`, and generated code calls `instance.groups.toJson()`.
- Group keys sent: `leafy_greens`, `vegetables`, `protein`, `cheese_nuts`, `fruits`, `sauce`.
- Protein/sauce selection shape: arrays of selected IDs under `groups.protein` and `groups.sauce`; Flutter also sets top-level `proteinId`.
- Evidence:
  - `meal_planner_bloc.dart:356` stores selected salad as `selectionType: premium_large_salad` and `protein: [event.proteinId]`.
  - `meal_planner_bloc.dart:1256` considers salad complete only with one protein, one sauce, and no carbs.
  - `meal_planner_bloc.dart:1323` builds the save payload with `SaladRequest`.
  - `day_selection_request.g.dart:80` emits `'groups': instance.groups.toJson()`.
  - `day_selection_request_serialization_test.dart:7` asserts encoded payload does not contain `Instance of`.
- Risk: Low for serialization and group keys; Medium for selected protein validity because Flutter sends whatever catalog option the user chose.

## Contract Match Matrix

| Area | Backend Catalog | Backend Save | Flutter UI | Flutter Payload | Match? |
|---|---|---|---|---|---|
| Product key | `premium_large_salad` product in v3 section | accepts `premium_large_salad` selection | derives salad product from section, loose key contains `salad` | sends `selectionType: premium_large_salad` | Partial |
| Selection type | `premium_large_salad` | `premium_large_salad` | uses `premium_large_salad` for selected slot | sends `premium_large_salad` | Yes |
| Group keys | canonicalized groups, aliases supported in catalog builder | canonical keys in deep validation; aliases only in preflight | normalizes aliases for display | sends canonical keys | Mostly |
| Required protein | min=1/max=1 | exactly one | requires selected protein | sends one `groups.protein` plus `proteinId` | Yes |
| Required sauce | min=1/max=1 | exactly one | enforces min/max | sends one `groups.sauce` | Yes |
| Allowed proteins | may expose relation-driven options unless filtered | standard allowlisted proteins only; premium rejected | renders catalog-provided protein group | sends selected rendered protein ID | No |

## Test Drift
### mealPlanner.integration.test.js
- Current failing expectations:
  - Expects legacy `builderCatalog.premiumLargeSalad` and `premiumProteins`.
  - Expects premium proteins such as shrimp/steak to be available for premium salad.
  - Expects premium salad with shrimp to save successfully.
- Outdated expectations:
  - Normal v3 endpoint now returns planner v3 under `data.builderCatalog.sections[]`, not legacy `builderCatalog.premiumLargeSalad`.
  - Current subscription salad rules reject premium proteins.
- Real mismatches:
  - The test captures real product/business ambiguity: some older flows expected premium proteins in salad, while current validation explicitly disallows them.
  - The fallback log `premium_large_salad not found, falling back to basic_salad` indicates seed/catalog setup mismatch in that suite.
- Required follow-up:
  - Update the test after business decides the contract. If standard-only is confirmed, remove premium-protein salad expectations and assert v3 `sections[]` contract.

### premiumLargeSaladV3Allowlist.test.js
- What it proves:
  - Canonical v3 save/validate accepts an allowlisted protein.
  - Disallowed regular and premium proteins are rejected with `SALAD_PROTEIN_NOT_ALLOWED`.
  - `extra_protein_50g` is rejected for subscription premium salad.
- Gaps:
  - It validates save behavior, not that the public catalog filters out disallowed relation options.

### subscriptionPlannerDashboardToFlutter.e2e.test.js
- What it proves:
  - Normal Flutter menu response exposes v3 `data.builderCatalog` and omits legacy fields.
  - A `premium_large_salad` product exists in v3 sections and has option groups.
  - Canonical v3 save with the seeded allowed chicken option succeeds.
  - Malformed legacy `salad.groups` and malformed `addonsOneTime` return 400.
- Gaps:
  - It does not seed disallowed proteins on the salad product and verify they are absent from catalog output.
  - It uses canonical v3 `selectedOptions`, while current Flutter save code sends legacy-style `salad.groups`.

## Decision Needed

Choose one preferred canonical contract:

1. Subscription premium salad allows standard salad proteins only.
2. Subscription premium salad allows premium proteins too.
3. Order flow and subscription flow have separate salad rules.

Current code implements option 1 for save validation: subscription premium salad allows standard allowlisted salad proteins only and rejects premium proteins. Product/business expectation is unclear because older integration tests still expect premium proteins in the salad builder. The safest product decision is likely option 3 if one-time/order salad customization differs from subscription entitlements; otherwise choose option 1 and enforce it consistently in catalog output.

## Required Fix Plan Later

### Backend-only fixes
- If option 1 is confirmed, add the same `isSubscriptionPremiumLargeSaladProtein` filtering to `buildCanonicalPlannerCatalogV3()` premium salad protein options.
- Add a catalog test proving disallowed regular/premium proteins are absent from `data.builderCatalog.sections[].products[].optionGroups[]`.
- Tighten Flutter-facing product selection by ensuring v3 premium salad catalog product key is exactly `premium_large_salad`.
- If option 2 is chosen, update backend save validation and allowlist to include the intended premium proteins.

### Flutter-only fixes
- Select the premium salad product by exact key `premium_large_salad` instead of any key containing `salad`.
- If backend cannot guarantee catalog filtering, add a defensive Flutter filter based on an explicit catalog rule field, not a hardcoded hidden allowlist.

### Test/docs fixes
- Update `mealPlanner.integration.test.js` to stop asserting legacy `builderCatalog.premiumLargeSalad` on normal v3 response.
- Align premium salad protein expectations in tests with the chosen business contract.
- Document canonical group keys as `leafy_greens`, `vegetables`, `protein`, `cheese_nuts`, `fruits`, `sauce`; aliases are input/catalog compatibility only.
- Add a full-stack test proving Flutter-visible premium salad proteins are exactly backend-saveable proteins.

## Post-Fix Verification

- `src/services/catalog/CatalogService.js` now filters v3 `premium_large_salad` protein options with `isSubscriptionPremiumLargeSaladProtein()`.
- v3 premium salad groups now prefer canonical keys such as `protein` and `sauce`, while retaining `sourceKey` for relation compatibility.
- v3 premium salad group rules now expose `minSelections`, `maxSelections`, `isRequired`, `required`, and `rules` from `SALAD_SELECTION_GROUPS`.
- Legacy/compatibility premium salad ingredient and option group builders also filter relation-provided proteins through the subscription salad allowlist.
- `tests/premiumLargeSaladV3Allowlist.test.js` verifies relation-attached disallowed proteins are absent from the v3 catalog and still rejected by save validation.
- `tests/subscriptionPlannerDashboardToFlutter.e2e.test.js` verifies the public Flutter-facing endpoint exposes canonical protein/sauce rules, hides premium/disallowed proteins, accepts a valid salad save, and rejects a disallowed protein save.

## Final Recommendation

- BACKEND_CONTRACT_FIXED
- Reason: Flutter now serializes and sends a backend-compatible shape, and the backend subscription planner catalog no longer exposes `premium_large_salad` protein options that save validation rejects. Business option 1 is now consistently represented for the subscription catalog and save validator.
