# Codex Task: Read-Only Integration Review — Subscription Meal Planner

## Role

You are a senior full-stack engineer doing a **fast, targeted, read-only integration review**.

You have access to:
- Backend: `APP/basicdiet145/src/`
- Flutter app: `mobile_app/lib/`

---

## Absolute Rules

**READ-ONLY. No exceptions.**

| Allowed | Banned |
|---|---|
| `cat`, `grep`, `find`, `ls`, `head`, `tail`, `wc`, `sed -n`, `awk` | `git`, `npm`, `flutter`, `dart`, `node` |
| Read any file | Modify any source file |
| Create/update the report file below | Create any other file |

**The only allowed write action:**
```
docs/SUBSCRIPTION_MEAL_PLANNER_INTEGRATION_REVIEW.md
```

Do not patch, refactor, fix, format, add tests, or generate scripts.
Do not run commands that may create cache or build artifacts.

---

## Token Budget Rules

Be fast. Be targeted.

- Do not read the full repo. Use `grep` first, then `cat` only what's relevant.
- Do not paste long code blocks in the report. Use short evidence bullets.
- Do not flag style issues — only flag integration risks that can break the planner flow.
- If the full review exceeds token budget, complete high-priority sections first and leave the rest as `TODO`.

**Priority order (highest risk first):**

1. Flutter Save Selection Payload
2. Premium Large Salad End-to-End
3. Backend Save Selection Validation
4. Backend Error Handling 400 vs 500
5. Flutter Menu Fetch & Parser
6. Legacy Contract Usage
7. Addons / addonsOneTime Flow
8. Backend Menu Contract
9. Flutter UI Rendering
10. Carbs & Meal Business Rules
11. Test Coverage Inventory

---

## Context: What Changed

The system migrated to a v3 menu contract:

```
GET /api/subscriptions/meal-planner-menu?lang=ar
```

Flutter **must** now:
1. Read from `data.builderCatalog`
2. Validate `data.builderCatalog.contractVersion === "meal_planner_menu.v3"`
3. Render from `data.builderCatalog.sections[]`

**Banned legacy paths — Flutter must not use any of these:**

```
data.plannerCatalog
data.builderCatalogV2
data.builderCatalog.categories
data.builderCatalog.proteins
data.builderCatalog.carbs
data.builderCatalog.premiumProteins
data.builderCatalog.premiumLargeSalad
```

**Current production 500 error:**

```
PUT /api/subscriptions/:subscriptionId/days/:date/selection
→ 500 { "code": "INTERNAL", "message": "فشل حفظ الاختيارات" }
```

**Suspected root causes:**

```
salad.groups → "Instance of 'SaladGroupsRequest'"  ← toJson() missing or wrong
addonsOneTime                                        ← malformed or missing
backend swallowing validation errors as 500          ← no 400 path
Flutter still reading legacy menu fields             ← parser not updated
```

---

## Key Files — Start Here Only

### Flutter
```
mobile_app/lib/data/request/day_selection_request.dart
mobile_app/lib/data/request/day_selection_request.g.dart
mobile_app/lib/data/response/meal_planner_menu_response.dart
mobile_app/lib/data/mappers/meal_planner_menu_mapper.dart
mobile_app/lib/domain/model/meal_planner_menu_model.dart
mobile_app/lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart
mobile_app/lib/presentation/plans/timeline/meal_planner/custom_premium_meal_builder_screen.dart
mobile_app/lib/presentation/plans/timeline/meal_planner/widgets/protein_picker_sheet.dart
mobile_app/lib/presentation/plans/timeline/meal_planner/widgets/carb_picker_sheet.dart
mobile_app/test/menu_contract_parsing_test.dart
```

### Backend
```
APP/basicdiet145/src/config/mealPlannerContract.js
APP/basicdiet145/src/services/subscription/mealPlannerCatalogService.js
APP/basicdiet145/src/controllers/subscriptionController.js
APP/basicdiet145/src/routes/subscriptions.js
APP/basicdiet145/src/utils/subscription/carbSelectionValidator.js
APP/basicdiet145/src/utils/subscription/premiumIdentity.js
APP/basicdiet145/src/utils/apiError.js
APP/basicdiet145/src/utils/errorResponse.js
APP/basicdiet145/src/locales/ar.js
```

---

## Targeted Grep List

Run these searches before reading any file. Classify each hit before diving deeper.

```bash
# v3 contract
grep -r "builderCatalog" --include="*.dart" -l
grep -r "contractVersion" --include="*.dart" -l
grep -r "meal_planner_menu.v3" -r .
grep -r "sections" --include="*.dart" -l

# Legacy paths (any hit in Flutter parser/payload is HIGH RISK)
grep -r "plannerCatalog" -r .
grep -r "builderCatalogV2" -r .
grep -r "premiumLargeSalad" -r .
grep -r "builderCatalog\.proteins" -r .
grep -r "builderCatalog\.carbs" -r .
grep -r "builderCatalog\.categories" -r .

# Payload risk
grep -r "SaladGroupsRequest" -r .
grep -r "toJson" --include="*.dart" -l
grep -r "Instance of" --include="*.dart" .
grep -r "addonsOneTime" -r .

# Backend error
grep -r "فشل حفظ الاختيارات" -r .
grep -r "selectionType" -r .
grep -r "premium_large_salad" -r .
```

**Classify every legacy hit as:**
- `safe_compat` — exists only in backend compatibility layer, never reaches app
- `active_usage` — used in Flutter parser or payload path → **High/Critical risk**
- `unknown` — needs deeper inspection

---

## Section Status Rules

| Status | Meaning |
|---|---|
| `TODO` | Not yet reviewed |
| `IN_PROGRESS` | Partially reviewed |
| `DONE` | Fully reviewed — files + evidence + findings + risk all present |
| `BLOCKED` | Cannot complete — missing file, ambiguous code, or external dependency |

**Never mark `DONE` with `TBD` still inside the section.**
**Never mark `DONE` without at least one concrete evidence bullet.**

---

## Sections

### 01 · Flutter Save Selection Payload

**Status:** TODO

**Goal:** Verify the exact payload Flutter sends to `PUT .../days/:date/selection`.

**Check:**
- `mealSlots[]` shape: `slotIndex`, `slotKey`, `selectionType`
- `proteinId` / `proteinKey` / `premiumKey`
- `carbs` object shape
- `salad` and `salad.groups` — serializes as JSON, not Dart instance string
- `addonsOneTime` shape
- Every nested model has correct `toJson()`
- `jsonEncode(body)` cannot produce `"Instance of '...'"` anywhere

**Focus files:**
```
day_selection_request.dart
day_selection_request.g.dart
meal_planner_bloc.dart
custom_premium_meal_builder_screen.dart
```

---

### 02 · Premium Large Salad End-to-End

**Status:** TODO

**Goal:** Confirm `premium_large_salad` works from catalog lookup to saved payload.

**Check:**
- Flutter finds it via `product.key == "premium_large_salad"` inside `sections[]`
- Not from `data.builderCatalog.premiumLargeSalad`
- `product.action == "open_builder"` triggers builder screen
- Builder reads `product.optionGroups` (not legacy salad fields)
- Handles groups: `leafy_greens`, `vegetables_legumes`, `fruits`, `proteins`, `cheese_nuts`, `sauces`
- Enforces: `proteins` min=1 max=1, `sauces` min=1 max=1
- `salad.groups` serializes as proper JSON (not `"Instance of 'SaladGroupsRequest'"`)
- Backend accepts same shape
- Invalid salad payload → `400`, not `500`

---

### 03 · Backend Save Selection Validation

**Status:** TODO

**Goal:** Confirm backend validates the full payload before touching any data.

**Check:**
- Route + controller for `PUT .../days/:date/selection`
- Validates: `mealSlots`, `selectionType`, `proteinId`/`proteinKey`, `premiumKey`, `carbs`, `salad.groups`, `addonsOneTime`
- Invalid payload → `400` (not `500`)
- No subscription mutation before validation passes
- Subscription date parsing handled correctly

---

### 04 · Backend Error Handling — 400 vs 500

**Status:** TODO

**Goal:** Find the exact code path that turns a validation failure into `500 "فشل حفظ الاختيارات"`.

**Check:**
- `try/catch` wrapping the save-selection handler
- Where validation errors are swallowed or re-thrown as generic errors
- `apiError.js` — custom error classes
- `errorResponse.js` — error mapping
- Arabic locale key for `"فشل حفظ الاختيارات"` in `ar.js`
- Exact line where a validation `throw` gets caught and mapped to 500

**Do not fix. Document the future fix only.**

---

### 05 · Flutter Menu Fetch & Parser

**Status:** TODO

**Goal:** Confirm Flutter reads v3 menu only.

**Check:**
- Reads `data.builderCatalog` (not any legacy path)
- Validates `contractVersion == "meal_planner_menu.v3"` before parsing
- Reads `data.builderCatalog.sections[]`
- No silent fallback to legacy structures
- `fromJson` in response/model supports v3 shape
- Handles `nameI18n` fallback (ar → en → key)
- Handles missing/empty `imageUrl`
- Handles empty `addonCatalog`

---

### 06 · Legacy Contract Usage

**Status:** TODO

**Goal:** List every remaining reference to banned paths and classify each.

**Search for:** (use grep results from the targeted grep list above)
```
plannerCatalog · builderCatalogV2 · premiumLargeSalad · premiumProteins
builderCatalog.proteins · builderCatalog.carbs · builderCatalog.categories
```

**For each hit:**
- File path + line number
- Classification: `safe_compat` / `active_usage` / `unknown`
- Risk level — any `active_usage` in Flutter parser or payload is **Critical**

---

### 07 · Addons / addonsOneTime Flow

**Status:** TODO

**Goal:** Confirm add-ons are safe in the v3 planner flow.

**Check:**
- Source of `addonCatalog` in the menu response — is it empty or populated?
- Flutter's source of `addonsOneTime` IDs — stale IDs risk
- Backend accepts `addonsOneTime` in save-selection payload
- If add-ons require payment: backend returns payment-required response, not `500`
- No legacy add-on source mixed into the v3 planner

---

### 08 · Backend Menu Contract

**Status:** TODO

**Goal:** Confirm the backend returns a correct v3 response shape.

**Check:**
- Endpoint exists and is routed
- Returns `data.builderCatalog`
- `contractVersion == "meal_planner_menu.v3"`
- `sections[]` present and non-empty
- Expected section keys: `premium`, `sandwich`, `chicken`, `beef`, `fish`, `eggs`, `carbs`
- Each section has `sortOrder`
- Products have `action`
- Configurable products have `optionGroups`
- `addonCatalog` field present (may be empty)

---

### 09 · Flutter UI Rendering

**Status:** TODO

**Goal:** Confirm the UI is built dynamically from `sections[]`, not hardcoded arrays.

**Check:**
- Sections sorted by `sortOrder`
- Each section rendered from `section.key`
- `product.action` drives UX: `open_builder` → builder, `direct_add` → immediate add
- Sandwiches do not trigger carbs selection
- No hardcoded legacy category lists in the UI layer

---

### 10 · Carbs & Meal Business Rules

**Status:** TODO

**Goal:** Confirm carbs and meal-type rules match between Flutter and backend.

**Check:**
- Carbs apply only to `standard_meal` and `premium_meal`
- Carbs do not apply to `sandwich`
- `maxTypes = 2`, `maxTotalGrams = 300`, `unit = "grams"`
- Premium meal options include: `beef_steak`, `shrimp`, `salmon`
- Beef max slots/day = 1 — identify who enforces this: Flutter, backend, or both
- `selectionType` values match between Flutter and backend

---

### 11 · Test Coverage Inventory

**Status:** TODO

**Goal:** Inventory existing tests only. Do not create new tests.

**Check (backend):**
- v3 menu response shape
- `save-selection` with `standard_meal`
- `save-selection` with `premium_meal`
- `save-selection` with valid `premium_large_salad`
- Invalid `premium_large_salad` → expects `400`
- `addonsOneTime` / payment-required path

**Check (Flutter):**
- v3 parser (`fromJson` on `sections[]`)
- `toJson` payload correctness
- No `"Instance of"` in encoded payload

---

## Report Structure

```markdown
# Subscription Meal Planner Integration Review

## Review Rules
- Read-only. No source code changes.
- Only this report file was created/updated.
- Fast targeted inspection — no broad audit.

## Executive Summary
- Overall status: TODO / PARTIAL / PASS / FAIL
- Biggest current risk:
- Most likely root cause of the 500:
- Is Flutter using the v3 contract correctly?
- Is the backend accepting the Flutter save-selection payload?
- Recommended first fix section:

## Review Progress Board

| Section | Status | Risk | Owner | Notes |
|---|---|---|---|---|
| 01 Flutter Save Selection Payload | TODO | Unknown | Flutter | |
| 02 Premium Large Salad End-to-End | TODO | High | Flutter + Backend | |
| 03 Backend Save Selection Validation | TODO | High | Backend | |
| 04 Backend Error Handling 400 vs 500 | TODO | High | Backend | |
| 05 Flutter Menu Fetch & Parser | TODO | High | Flutter | |
| 06 Legacy Contract Usage | TODO | High | Flutter + Backend | |
| 07 Addons / addonsOneTime Flow | TODO | High | Flutter + Backend | |
| 08 Backend Menu Contract | TODO | Medium | Backend | |
| 09 Flutter UI Rendering | TODO | Medium | Flutter | |
| 10 Carbs & Meal Business Rules | TODO | Medium | Flutter + Backend | |
| 11 Test Coverage Inventory | TODO | Medium | Flutter + Backend | |

---

## 01 · Flutter Save Selection Payload

**Status:** TODO

**Files inspected:**
- `path/to/file.dart` — `ClassName.methodName()` — behavior observed

**Evidence:**
- Short bullet. File + line reference if available.

**Findings:**
- Finding 1 — why it matters — Risk: Low / Medium / High / Critical
- Finding 2 ...

**Required fixes later, not now:**
- Fix 1
- Fix 2

---

[repeat for sections 02–11]

---

## Final Patch Plan

Do not implement. Document only:
- Confirmed bugs
- Contract mismatches
- Missing validations
- Exact files needing future changes (Flutter and backend listed separately)
- Safest fix order

## Final Recommendation

**Verdict:** PASS / PARTIAL / FAIL

**Reason:** ...
```

---

## Evidence Rules

Every finding must include:
1. File path (repo-relative)
2. Function or class name (if applicable)
3. Exact behavior observed (one line, not a paragraph)
4. Why it matters for this integration
5. Risk level: `Low` / `Medium` / `High` / `Critical`

Do not write vague findings like "may have issues" or "probably works".
Do not say "probably" unless you explicitly state that evidence is incomplete.
If evidence is incomplete → mark section `BLOCKED` and state exactly what is missing.

---

## Terminal Output (print after writing the report)

```
Report: docs/SUBSCRIPTION_MEAL_PLANNER_INTEGRATION_REVIEW.md
Overall status: [TODO / PARTIAL / PASS / FAIL]
Sections DONE: [list]
Sections BLOCKED: [list]
Top 3 risks:
  1. ...
  2. ...
  3. ...
Recommended first fix section: [number · name]
```

---

## Final Reminder

Read fast. Grep first. Cat only what's needed.
Do not consume context on unrelated files.
No fixes. No code changes.
Only write the review report.
