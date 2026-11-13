# Basic Diet menu nutrition – staged recovery (2026-10-22)

Related: [incident #167](https://github.com/IbrahimMohamed101/basicdiet145/issues/167).

## Why a staged rollout
The live calorie values in the kitchen spreadsheet, printed menu, own app, HungerStation and Keeta have **not** been reconciled. Numeric defaults and legacy `verified` statuses are not evidence of nutritional accuracy. An active nutrition record must be approved against a real portion and source before changing any customer-facing number.

**Do not run a bulk update that guesses missing calories, sets 0, or auto-marks existing rows verified. Do not activate the strict gate before reviewing the audit.**

## Current API (dashboard auth required)
- `GET /api/dashboard/menu/nutrition-audit` — read-only published-menu report for sellable products and attached options. Fields: current numeric kcal, reconstructed macro kcal (triage only), approval status and issue codes; no source-backed values are edited.
- `POST /api/dashboard/catalog-items/:id/nutrition/approve` — admin/superadmin only; canonical review for linked menu products/options.
- `POST /api/dashboard/menu/options/:id/nutrition/approve` — admin/superadmin only; for **unlinked** standalone options, including sauces. Linked options must use the CatalogItem endpoint.

Example approval payload (illustrative structure; values are **not** real Basic Diet data):

```json
{
  "nutrition": {
    "calories": 100,
    "proteinGrams": 5,
    "carbsGrams": 10,
    "fatGrams": 4
  },
  "nutritionSource": "Signed kitchen recipe / dietitian-approved calculation, version 1",
  "nutritionBasis": "per_serving",
  "nutritionServingSizeGrams": 20
}
```

Required: finite nonnegative kcal/P/C/F, documented source (5–500 characters), serving basis `per_serving` or `per_100g`, positive portion grams. `per_100g` always uses 100 grams. Only the authenticated reviewer identity is accepted; caller cannot supply another reviewer. Current code records reviewer identity/time and audit history.

`PATCH /api/dashboard/catalog-items/:id` and `PATCH /api/dashboard/menu/options/:id` reject unreviewed nutrition changes to customer-visible published records with `PUBLISHED_NUTRITION_REQUIRES_APPROVAL`; review endpoint changes the numbers with approval in one operation. A draft CatalogItem nutrition edit clears any previous approval.

## Strict release preflight — OFF by default

`MENU_NUTRITION_APPROVAL_GATE=true`

When enabled, the standard dashboard create-product/create-option flows create drafts instead of auto-publishing them. `POST /api/dashboard/menu/publish` scans active visible available products and **attached** options, including drafts, and rejects publishing if missing/bogus zero, unapproved, wrong serving basis, or material macro-versus-kcal discrepancies exist. It runs before any publish mutations. Do not turn this on until audit completeness and UI workflows are tested.

This is **not** an external delivery-platform sync. HungerStation and Keeta must be corrected and verified through their appropriate merchant workflows.

## Mobile compatibility
Legacy Flutter `NutritionResponse` converts missing numeric fields to `0` and existing UI hides calories <= 0. We preserve the existing numeric API fields in this PR for compatibility, while exposing `nutritionVerified` and `nutritionDataStatus` on new-menu product/option payloads. **Do not claim legacy numeric content is approved simply because it is displayed.** Upgrading the mobile UI to suppress unknown values consistently requires write access to Basic-Diet/mobile_app and a release plan.

## Release gates
1. Run `GET /api/dashboard/menu/nutrition-audit` in read-only mode after staging release and review every item.
2. Kitchen/nutrition specialist sign off recipes by SKU, portion/weight, sauces, oils, preparation state and allergens. Compare macros using 4/4/9 only as an anomaly signal, not the final calorie formula.
3. Approve documented values; map brand SKU+portion to app, branch menu, HungerStation and Keeta, then update and visually verify each channel.
4. Enable strict gate in staging; run full menu, pricing and Flutter contract suites.
5. Review all other publish/migration/admin paths before enabling in production; preserve current menu and rollback procedure.
6. Deploy production only after tests, operational sign-off and correct values are verified. No production DB migration occurs automatically from this PR.
