# Dynamic Menu UI Diagnostic: `light_collection` Reverting to `meal_builder`

## Executive Summary
After a comprehensive cross-stack audit (Dashboard, Backend API, and Flutter Mobile), we have conclusively identified the root causes of the reported issue: **"The operator selects `light_collection` for a menu UI card variant, but the value later remains or appears as `meal_builder`."**

The **Backend** and **API** layers persist and return the correct value (`light_collection`). The primary fault lies in the **Flutter rendering layer**, which hardcodes `light_collection` to behave identically to `meal_builder`, merging them entirely in the UI. A secondary fault exists in the **Dashboard's local normalizers**, which aggressively fallback to `meal_builder` when data is missing, overwriting the backend's default.

---

## 1. Flutter Mobile App (Primary Visual Bug)
In the mobile application, `light_collection` is parsed correctly but functionally **erased during rendering**:

- **File**: `mobile_app-main/lib/presentation/main/menu/menu_screen.dart`
- **Issue**: Flutter explicitly skips creating a discrete UI section for any category tagged `light_collection` or `meal_builder`:
  ```dart
  if (category.cardVariant == 'meal_builder' || category.cardVariant == 'light_collection') {
    continue;
  }
  ```
- **The Result**: Instead of a separate "Light Collection" section, Flutter scoops up ALL configurable products (including those in the `light_collection`) and places them under a single, hardcoded "Custom Order" chip (`Strings.customOrder.tr()`). 
- **User Impact**: Because `Strings.customOrder` localized to Arabic is **"منشئ الوجبات"** (Meal Builder), any category configured as `light_collection` immediately looks to the operator as if it reverted to "Meal Builder".

---

## 2. Dashboard Normalizer Fallbacks (Secondary Bug)
While the Dashboard correctly allows saving `light_collection` and correctly transmits it to the backend, it contains unsafe fallback logic that can mask or overwrite the backend's intended schemas:

- **File**: `client_dashbourd-main/src/utils/menuFormValues.ts`
- **Issue**: The form initialization strictly defaults missing UI values to `meal_builder`, ignoring the backend's documented schema default (`addon_collection`).
  ```typescript
  export const getMenuCategoryFormValues = (category?: MenuCategory | null) => ({
    ui: {
      cardVariant: category?.ui?.cardVariant ?? "meal_builder",
    },
  });
  ```
- **File**: `client_dashbourd-main/src/utils/menuResponseNormalizers.ts` (API Normalizer)
  ```typescript
  ui: {
    cardVariant: raw.ui?.cardVariant ?? raw.ui?.card_variant ?? raw.cardVariant ?? raw.card_variant ?? "meal_builder",
  },
  ```
- **User Impact**: If a legacy category in the database has no `ui.cardVariant` defined (i.e. `{}`), the backend API returns it as-is. The Dashboard intercepts this and forces it to display as `meal_builder` in the dropdown. If the operator clicks "Save", it will falsely overwrite the category with `meal_builder`.

---

## 3. Backend Persistence & API (Cleared of Fault)
The Node.js backend operates perfectly as designed. Our audit verified:
- **Persistence**: Tested against the Production database API. cURL requests confirm that `light_collection` exists and is persisted precisely (e.g. `2 "cardVariant":"light_collection"`).
- **Validation**: Schema constraints and `catalogKeyUiHelpers.js` enforce all 4 category card variants accurately. 
- **Publishing**: `menuCatalogService.js` correctly propagates the `ui` subdocument to the `OrderMenuCategories` list via `serializePublicCategory()`.

---

## Recommended Action Plan

### For the Flutter Frontend Team:
1. **Refactor `menu_screen.dart`**: Stop hardcoding `light_collection` to group with `meal_builder`. 
2. **Implement Distinct UI Maps**: Branch the rendering logic in `_layoutFor(category)` to natively respect `light_collection`.

### For the Dashboard Team:
1. **Remove Aggressive Fallbacks**: Change the default fallbacks in `menuFormValues.ts` and `menuResponseNormalizers.ts` from `"meal_builder"` to the correct API standard `"addon_collection"`.

> [!NOTE]
> The backend layer requires **zero changes**. The data is 100% correct in the source database.
