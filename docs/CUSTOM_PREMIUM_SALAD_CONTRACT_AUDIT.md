# Custom Premium Salad Contract Audit - Backend

## Date: 2026-04-28

---

## Files Inspected

| File | Purpose |
|------|---------|
| `src/services/subscription/mealPlannerCatalogService.js` | Main service building the meal planner catalog |
| `src/models/SaladIngredient.js` | Mongoose model for salad ingredients |
| `src/models/BuilderCarb.js` | Builder carb model |
| `src/models/BuilderCategory.js` | Builder category model |
| `tests/mealPlanner.integration.test.js` | Integration tests |
| `scripts/migrate-salad-ingredient-groups.js` | Migration script for group assignment |
| `scripts/fix-builder-encoding.js` | Encoding fix script |

---

## Problems Found

### 1. groupKey Used Ingredient Name Instead of Category
**Location**: `mealPlannerCatalogService.js:30-31`

```javascript
// OLD (BROKEN) - Uses ingredient name as groupKey
const groupKey = String(ing.name && (ing.name.ar || ing.name.en) || "");
```

This caused `groupKey` to be values like "عسل بالليمون", "فاصوليا حمراء" - ingredients' display names, not categories.

### 2. carbId Was Null
**Location**: `mealPlannerCatalogService.js:45`

```javascript
// OLD (BROKEN)
carbId: null,
```

The custom premium salad always had null carbId, breaking the slot selection.

### 3. Wrong preset.key
**Location**: `mealPlannerCatalogService.js:51`

```javascript
// OLD (BROKEN)
key: CUSTOM_PREMIUM_SALAD_KEY,  // "custom_premium_salad"
```

Should be "large_salad" to match the carb category.

### 4. No groupKey Field in SaladIngredient Model
**Location**: `SaladIngredient.js`

The model had no `groupKey` field for categorizing ingredients into vegetables/addons/fruits/nuts/sauce.

### 5. Dynamic Groups Instead of Fixed Categories
Previous implementation dynamically generated groups from ingredient names, not from fixed categories.

---

## Fixes Applied

### 1. Updated SaladIngredient Model
Added `groupKey` field with enum validation:

```javascript
groupKey: { 
  type: String, 
  required: true, 
  enum: ["vegetables", "addons", "fruits", "nuts", "sauce"] 
}
```

Also added `sortOrder` for consistent ordering.

### 2. Updated mealPlannerCatalogService.js

**New implementation:**
- Fetches `large_salad` carbs by filtering on `displayCategoryKey: LARGE_SALAD_KEY`
- Uses fixed `PRESET_GROUPS` with proper structure:
  ```javascript
  const PRESET_GROUPS = [
    { key: "vegetables", name: { ar: "خضروات", en: "Vegetables" }, minSelect: 0, maxSelect: 99 },
    { key: "addons", name: { ar: "إضافات", en: "Addons" }, minSelect: 0, maxSelect: 99 },
    { key: "fruits", name: { ar: "فواكه", en: "Fruits" }, minSelect: 0, maxSelect: 99 },
    { key: "nuts", name: { ar: "مكسرات", en: "Nuts" }, minSelect: 0, maxSelect: 99 },
    { key: "sauce", name: { ar: "الصوص", en: "Sauce" }, minSelect: 1, maxSelect: 1 },
  ];
  ```
- Filters out orphan ingredients (invalid groupKey values)
- Warns when data issues detected
- Preset.key = "large_salad"
- carbId not null

### 3. Created Migration Script
`scripts/migrate-salad-ingredient-groups.js`:
- Maps Arabic/English ingredient names to category group keys
- Handles corrupted strings (هالينو)
- Validates against known patterns
- Reports unknown ingredients for manual review

---

## Tests Run

### Unit Tests
```bash
npm run test
# Result: 25 passed, 0 failed
```

### Integration Tests
```bash
npm run test:integration
# Result: 25 passed, 0 failed, 0 skipped
```

### Test Coverage for customPremiumSalad
New test assertion verifies:
- `salad.id == "custom_premium_salad"`
- `salad.carbId != null`
- `salad.preset.key == "large_salad"`
- Groups include: vegetables, addons, fruits, nuts, sauce
- Sauce minSelect=1, maxSelect=1
- All ingredient groupKeys exist in preset.groups
- No groupKey equals name (category vs ingredient)
- Valid UTF-8 (no  � replacement characters)

---

## Data Contract

### Backend Response (clean)

```json
{
  "enabled": true,
  "id": "custom_premium_salad",
  "carbId": "64abc123...",
  "selectionType": "custom_premium_salad",
  "name": "سلطة مميزة",
  "extraFeeHalala": 3000,
  "currency": "SAR",
  "preset": {
    "key": "large_salad",
    "name": "سلطة مميزة",
    "selectionType": "custom_premium_salad",
    "fixedPriceHalala": 3000,
    "currency": "SAR",
    "groups": [
      { "key": "vegetables", "name": "خضروات", "minSelect": 0, "maxSelect": 99 },
      { "key": "addons", "name": "إضافات", "minSelect": 0, "maxSelect": 99 },
      { "key": "fruits", "name": "فواكه", "minSelect": 0, "maxSelect": 99 },
      { "key": "nuts", "name": "مكسرات", "minSelect": 0, "maxSelect": 99 },
      { "key": "sauce", "name": "الصوص", "minSelect": 1, "maxSelect": 1 }
    ]
  },
  "ingredients": [
    { "id": "...", "groupKey": "sauce", "name": "عسل بالليم", "calories": 50 }
  ]
}
```

---

## Remaining Risks

1. **Existing production data** - Ingredients without groupKey need migration script to run against production DB
2. **Large salad carb** - Must have a BuilderCarb with displayCategoryKey: "large_salad"
3. **New category** - Test seeding adds BuilderCategory with key "large_salad" for dimension "carb"

---

## Next Steps

1. Run migration on production:
   ```bash
   node scripts/migrate-salad-ingredient-groups.js
   ```

2. Ensure BuilderCategory and BuilderCarb for "large_salad" exist

3. Verify Flutter integration after backend is updated