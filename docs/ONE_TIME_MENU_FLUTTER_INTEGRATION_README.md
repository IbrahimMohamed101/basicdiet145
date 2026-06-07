# Flutter One-Time Menu Integration README

## 1. Purpose

This document explains how Flutter should integrate the new backend-driven one-time menu contract.

Target endpoint:

```http
GET /api/orders/menu
```

The backend and dashboard menu work is complete. Flutter must now consume the backend response dynamically instead of relying on hard-coded category keys, product keys, or old frontend layout rules.

The new menu UI contract is simple:

```text
product.ui.cardSize controls product card shape only.
Product behavior comes from business fields.
Builder/customization UI comes from optionGroups.
Restaurant availability comes from restaurantHours.
```

---

## 2. Current Backend Contract Summary

The endpoint returns:

```json
{
  "status": true,
  "data": {
    "source": "one_time_order",
    "fulfillmentMethod": "pickup",
    "currency": "SAR",
    "vatIncluded": true,
    "vatPercentage": 16,
    "itemTypes": [],
    "categories": [],
    "restaurantHours": {}
  }
}
```

Main surfaces Flutter must consume:

```text
data.categories[]
data.categories[].products[]
product.ui.cardSize
product.requiresBuilder
product.canAddDirectly
product.isCustomizable
product.pricingModel
product.optionGroups[]
product.optionGroups[].ui.displayStyle
product.optionGroups[].optionSections
data.restaurantHours
```

---

## 3. Important Architecture Rule

Flutter must separate **visual layout** from **business behavior**.

### Visual layout

Use only:

```text
product.ui.cardSize
```

Allowed values:

```text
large
medium
small
```

### Business behavior

Use:

```text
requiresBuilder
canAddDirectly
isCustomizable
pricingModel
optionGroups
```

### Builder option rendering

Use:

```text
optionGroups[].ui.displayStyle
optionGroups[].minSelections
optionGroups[].maxSelections
optionGroups[].isRequired
optionGroups[].options
optionGroups[].optionSections
```

Do not use `cardSize` to decide whether a product opens a builder or adds directly.

---

## 4. Endpoint

### Request

```http
GET /api/orders/menu
```

### Purpose

Returns the full one-time order menu:

* Categories.
* Products.
* Product card size.
* Product pricing.
* Product customization rules.
* Option groups.
* Restaurant hours.

---

## 5. Response Model Requirements

Flutter should update or create these models:

```text
OrderMenuResponse
OrderMenuData
MenuCategory
MenuProduct
ProductUi
OptionGroup
OptionGroupUi
MenuOption
OptionSection
RestaurantHours
```

Current audit findings:

```text
File: lib/data/response/order_menu_response.dart
Current issue: Product ui is not mapped.
Current issue: OptionGroup ui is not mapped.
Current issue: optionSections model does not exist.
Current issue: RestaurantHours is currently dynamic Map<String, dynamic>?.
```

Required model additions:

```dart
class ProductUi {
  final ProductCardSize cardSize;
}

enum ProductCardSize {
  large,
  medium,
  small,
}
```

Recommended fallback:

```text
Unknown or missing cardSize => medium
```

Option group UI:

```dart
class OptionGroupUi {
  final OptionDisplayStyle displayStyle;
}

enum OptionDisplayStyle {
  chips,
  radioCards,
  checkboxGrid,
  expansionTileFallback,
}
```

Recommended fallback:

```text
Unknown or missing displayStyle => expansionTileFallback
```

---

## 6. Product Card Size Contract

Every product returned from the menu endpoint has:

```json
{
  "ui": {
    "cardSize": "large"
  }
}
```

or:

```json
{
  "ui": {
    "cardSize": "medium"
  }
}
```

or:

```json
{
  "ui": {
    "cardSize": "small"
  }
}
```

### Meaning

| cardSize | Flutter UI meaning         | Expected usage                                                |
| -------- | -------------------------- | ------------------------------------------------------------- |
| `large`  | Main spotlight card        | Main custom-order products such as Basic Meal and Basic Salad |
| `medium` | Standard product card      | Meals or customizable products                                |
| `small`  | Compact quick product card | Carbs, sandwiches, desserts, juices, drinks, ice cream        |

### Important

`cardSize` is only a visual display hint.

Do not use it for:

```text
Add-to-cart behavior
Builder behavior
Pricing behavior
Availability behavior
Option group behavior
```

---

## 7. Recommended Card UI

### 7.1 Large Product Card

Use for:

```text
product.ui.cardSize == large
```

Recommended design:

```text
Large visual card
Prominent image area or fallback media block
Localized product name
Localized description if available
Price display
Primary CTA based on behavior
```

Expected products:

```text
basic_meal
basic_salad
```

Do not hard-code these keys in Flutter. They are listed only as backend examples.

Flutter should render large cards when:

```text
product.ui.cardSize == large
```

---

### 7.2 Medium Product Card

Use for:

```text
product.ui.cardSize == medium
```

Recommended design:

```text
Standard product row/card
Product image or fallback
Localized name
Short localized description if available
Price
CTA or action button based on behavior
```

Expected examples:

```text
Ready meals
Customizable meals with extra protein
Green salad
Fruit salad
Greek yogurt
```

Again, do not hard-code these product keys.

---

### 7.3 Small Product Card

Use for:

```text
product.ui.cardSize == small
```

Recommended design:

```text
Compact card
Small image/fallback
Localized product name
Price
Small + button for direct-add products
```

Expected examples:

```text
Carbs
Cold sandwiches
Desserts
Juices
Drinks
Ice cream
```

Do not hard-code category keys to choose this shape. Use `cardSize`.

---

## 8. Product Action Rules

When a product is tapped or its button is pressed, Flutter must decide behavior from business fields.

Recommended logic:

```dart
final hasOptions = product.optionGroups.isNotEmpty;

if (product.requiresBuilder == true || hasOptions) {
  openBuilder(product);
} else if (product.canAddDirectly == true) {
  addDirectlyToCart(product);
} else {
  showUnavailableOrUnsupportedState(product);
}
```

### Rule 1: Builder products

Open builder/customization screen if:

```text
requiresBuilder == true
```

or:

```text
optionGroups.length > 0
```

Examples:

```text
Basic Meal
Basic Salad
Green Salad
Fruit Salad
Greek Yogurt
Ready meals with extra protein option group
```

### Rule 2: Direct-add products

Add directly to cart if:

```text
canAddDirectly == true
optionGroups.length == 0
```

Examples:

```text
Water
Rice
Cold sandwiches
Some ready meals
Desserts
Juices
Drinks
Ice cream
```

### Rule 3: per_100g products

If:

```text
pricingModel == per_100g
```

Flutter must show the existing weight flow or builder flow.

Required fields for this flow:

```text
baseUnitGrams
defaultWeightGrams
minWeightGrams
maxWeightGrams
weightStepGrams
priceHalala
```

---

## 9. Pricing Display Rules

Backend prices are in halala.

Examples:

```text
1900 => 19 SAR
700  => 7 SAR
```

Use:

```text
product.priceHalala
product.currency
product.pricingModel
product.baseUnitGrams
```

### Fixed price

If:

```text
pricingModel == fixed
```

Display:

```text
19 SAR
```

or Arabic equivalent:

```text
19 ر.س
```

### Per weight

If:

```text
pricingModel == per_100g
```

Display:

```text
19 SAR / 100g
```

or Arabic equivalent:

```text
19 ر.س / 100 جم
```

### VAT

The response includes:

```text
vatIncluded
vatPercentage
```

If `vatIncluded == true`, the displayed price can be treated as VAT-inclusive.

---

## 10. Category Rendering

Render:

```text
data.categories[]
```

in ascending `sortOrder`.

Each category has:

```text
id
key
name
nameI18n
description
descriptionI18n
imageUrl
sortOrder
products
```

### Localization

Use:

```text
category.nameI18n[currentLocale]
```

Fallback order:

```text
nameI18n[currentLocale]
nameI18n.en
name
key
```

### Important

Do not use `category.key` to choose the product card layout.

Old pattern to avoid:

```dart
if (category.key == 'cold_sandwiches') {
  renderCompactScroll();
}
```

New pattern:

```dart
for each product:
  switch(product.ui.cardSize)
```

The category can still be used for grouping and titles.

---

## 11. Product Localization

Each product has:

```text
name
nameI18n
description
descriptionI18n
```

Flutter must use localized fields.

Recommended fallback for name:

```text
nameI18n[currentLocale]
nameI18n.en
name
key
```

Recommended fallback for description:

```text
descriptionI18n[currentLocale]
descriptionI18n.en
description
empty string
```

Current audit issue:

```text
order_menu_mapper.dart currently drops nameI18n and descriptionI18n.
```

This must be fixed.

---

## 12. Images and Fallbacks

Products have:

```text
imageUrl
```

Some backend products currently have empty image URLs.

Flutter must not break or show an ugly fallback when `imageUrl` is empty.

Recommended behavior:

```text
If imageUrl is not empty:
  show network image.

If imageUrl is empty:
  show clean branded placeholder.
```

Current audit issue:

```text
_MenuMediaBox currently ignores imageUrl in dynamic menu flows and uses acronym/initial fallback.
```

Recommended improvement:

```text
Use CachedNetworkImage or existing project image loader.
Keep a clean fallback for empty/broken images.
```

Expected file:

```text
lib/presentation/main/menu/menu_screen.dart
```

---

## 13. Builder / Customization Flow

When opening builder, render:

```text
product.optionGroups[]
```

Each option group contains:

```text
id
groupId
key
name
nameI18n
minSelections
maxSelections
isRequired
sortOrder
ui.displayStyle
options
optionSections
```

### Display style

Backend may return:

```text
chips
radio_cards
checkbox_grid
```

Flutter should map:

| Backend displayStyle | Flutter UI                     |
| -------------------- | ------------------------------ |
| `chips`              | Compact selectable chips       |
| `radio_cards`        | Single-select cards            |
| `checkbox_grid`      | Multi-select grid              |
| unknown/missing      | Current ExpansionTile fallback |

Current audit issue:

```text
displayStyle is not mapped.
Current UI defaults to ExpansionTile.
```

### Selection validation

Use:

```text
minSelections
maxSelections
isRequired
```

Current audit result:

```text
Validation already exists in _isValid.
```

Keep this logic.

### maxSelections

If `maxSelections` is null in future responses:

```text
null means unlimited
```

Do not coerce null to 1.

---

## 14. Option Sections

Some option groups may contain:

```text
optionSections
```

Example use case:

```text
Protein tabs:
Chicken
Beef
Fish
Eggs
Premium
```

Flutter should use optionSections to visually group options when present.

Recommended behavior:

```text
If optionSections exists and not empty:
  render sections/tabs using optionSections.

Else:
  render options directly.
```

Current audit issue:

```text
optionSections model does not exist.
```

Expected files to update:

```text
lib/data/response/order_menu_response.dart
lib/domain/model/order_menu_model.dart
lib/data/mappers/order_menu_mapper.dart
lib/presentation/main/menu/menu_screen.dart
```

---

## 15. Option Model

Each option includes:

```text
id
optionId
groupId
key
name
nameI18n
imageUrl
extraPriceHalala
extraWeightUnitGrams
extraWeightPriceHalala
sortOrder
proteinFamilyKey
proteinFamilyNameI18n
displayCategoryKey
```

Flutter should use:

```text
optionId or id when submitting selections
nameI18n for display
extraPriceHalala for price badges
imageUrl if available
proteinFamilyKey/displayCategoryKey for visual grouping if needed
```

---

## 16. Cart / Quote / Create Order Payload

The audit says menu UI changes should not affect cart or order payloads.

Relevant files:

```text
lib/data/request/order_quote_request.dart
lib/data/request/create_order_request.dart
```

Keep payload behavior unchanged.

Selected options should continue submitting:

```text
groupId
optionId
extraWeightGrams
qty
```

Product selection should continue using product ID.

Do not change checkout payload just because card UI changes.

---

## 17. Restaurant Hours

The response includes:

```text
restaurantHours.openTime
restaurantHours.closeTime
restaurantHours.isOpenNow
restaurantHours.reason
restaurantHours.messageAr
restaurantHours.messageEn
restaurantHours.pickupLocationId
restaurantHours.availablePickupLocationIds
restaurantHours.businessDate
restaurantHours.businessTomorrow
```

Flutter should use:

```text
isOpenNow
messageAr
messageEn
```

If `isOpenNow == false`:

```text
Show localized closed message.
Block checkout or follow current project business rule.
```

Current audit result:

```text
restaurantHours is passed to CartState.
isOpenNow controls isSelectedRestaurantClosed.
Checkout is blocked through canCheckout.
messageAr/messageEn are currently skipped for one-time orders.
```

Recommended improvement:

```text
Show messageAr/messageEn to the user when closed.
```

---

## 18. Files Expected To Change

Based on the Flutter audit, expected files:

```text
lib/data/response/order_menu_response.dart
lib/domain/model/order_menu_model.dart
lib/data/mappers/order_menu_mapper.dart
lib/presentation/main/menu/menu_screen.dart
```

Optional or likely related:

```text
lib/data/data_source/remote_data_source.dart
lib/data/data_source/remote_data_source_impl.dart
lib/domain/usecase/get_order_menu_usecase.dart
lib/presentation/main/cart/bloc/cart_state.dart
lib/data/request/order_quote_request.dart
lib/data/request/create_order_request.dart
```

Do not change request payloads unless a real compile/runtime issue requires it.

---

## 19. Implementation Plan

### Step 1: Update response DTOs

File:

```text
lib/data/response/order_menu_response.dart
```

Add:

```text
OrderMenuProductUiResponse
OrderMenuOptionGroupUiResponse
OrderMenuOptionSectionResponse
```

Attach:

```text
OrderMenuProductResponse.ui
OrderMenuOptionGroupResponse.ui
OrderMenuOptionGroupResponse.optionSections
```

Also strongly type restaurantHours if possible.

---

### Step 2: Update domain models

File:

```text
lib/domain/model/order_menu_model.dart
```

Add:

```text
ProductUi
ProductCardSize enum
OptionGroupUi
OptionDisplayStyle enum
OptionSection
RestaurantHours typed model
```

Keep safe defaults:

```text
cardSize missing/unknown => medium
displayStyle missing/unknown => expansion/default
```

---

### Step 3: Update mappers

File:

```text
lib/data/mappers/order_menu_mapper.dart
```

Map:

```text
product.ui.cardSize
optionGroup.ui.displayStyle
optionSections
nameI18n
descriptionI18n
restaurantHours
```

Do not parse old removed product UI fields:

```text
cardVariant
badge
ctaLabel
imageRatio
behaviorHint
priceLabelMode
```

These are no longer part of the public product card contract.

---

### Step 4: Replace hard-coded layout selection

File:

```text
lib/presentation/main/menu/menu_screen.dart
```

Current issue:

```text
Product/category rendering is driven by hard-coded category and product keys.
```

Required change:

```text
Use product.ui.cardSize to choose card shape.
```

Recommended logic:

```dart
switch (product.ui.cardSize) {
  case ProductCardSize.large:
    return LargeMenuProductCard(product: product);

  case ProductCardSize.medium:
    return MediumMenuProductCard(product: product);

  case ProductCardSize.small:
    return SmallMenuProductCard(product: product);
}
```

Do not choose card type by:

```text
product.key
category.key
itemType
```

except temporary fallback only if absolutely required.

---

### Step 5: Keep action logic business-based

Use:

```text
requiresBuilder
canAddDirectly
optionGroups
pricingModel
```

Do not use cardSize for actions.

Recommended logic:

```dart
bool get shouldOpenBuilder =>
    product.requiresBuilder == true || product.optionGroups.isNotEmpty;

bool get shouldAddDirectly =>
    product.canAddDirectly == true && product.optionGroups.isEmpty;
```

---

### Step 6: Support option group display styles

File:

```text
lib/presentation/main/menu/menu_screen.dart
```

Inside builder widgets, map:

```text
chips
radio_cards
checkbox_grid
```

to different option group UIs.

Keep existing ExpansionTile as fallback.

---

### Step 7: Add optionSections rendering

If group.optionSections exists:

```text
Render tabs/sections.
Filter or group options by optionIds/optionKeys.
```

If absent:

```text
Render group.options normally.
```

---

### Step 8: Improve image handling

File:

```text
lib/presentation/main/menu/menu_screen.dart
```

Update `_MenuMediaBox` to:

```text
Use imageUrl when present.
Use fallback placeholder only when imageUrl is empty or fails.
```

---

### Step 9: Improve localization

Update mapper/domain/UI to use:

```text
nameI18n
descriptionI18n
```

Fallback safely.

---

### Step 10: Keep cart/order payload unchanged

Do not change:

```text
order quote request
create order request
cart payload
selected option payload
```

unless necessary for compile compatibility.

---

## 20. QA Checklist

### API and parsing

```text
GET /api/orders/menu loads successfully.
No parsing crash when ui.cardSize is present.
No parsing crash when imageUrl is empty.
No parsing crash when optionSections is missing.
No parsing crash when optionSections is present.
No parsing crash when restaurantHours message fields are null.
```

### Category rendering

```text
Categories render sorted by sortOrder.
Category titles use nameI18n according to current locale.
No category layout depends on category.key.
```

### Card rendering

```text
large products render with large card.
medium products render with medium card.
small products render with small card.
No product card shape depends on product.key.
No product card shape depends on old cardVariant.
```

### Product behavior

```text
requiresBuilder=true opens builder.
optionGroups.length > 0 opens builder.
canAddDirectly=true and optionGroups=[] adds directly.
pricingModel=per_100g shows weight/builder flow.
pricingModel=fixed shows fixed price.
```

### Builder

```text
displayStyle=chips renders chips or safe equivalent.
displayStyle=radio_cards renders single-select cards or safe equivalent.
displayStyle=checkbox_grid renders multi-select grid or safe equivalent.
minSelections/maxSelections/isRequired validation works.
optionSections render grouped options when present.
```

### Localization

```text
Arabic product names use nameI18n.ar.
English product names use nameI18n.en.
Arabic descriptions use descriptionI18n.ar.
English descriptions use descriptionI18n.en.
Fallback works when translation is missing.
```

### Images

```text
Network image appears when imageUrl exists.
Fallback appears when imageUrl is empty.
Fallback appears when image loading fails.
No broken image icon appears.
```

### Restaurant hours

```text
isOpenNow=false blocks checkout.
Closed message appears using messageAr/messageEn when available.
isOpenNow=true allows normal checkout.
```

### Cart/order

```text
Direct-add product enters cart correctly.
Builder product enters cart with selected options correctly.
Quote request still works.
Create order request still works.
No request payload regression.
```

---

## 21. Non-Goals

Do not implement CatalogItem handling in Flutter.

Flutter must not send or manage:

```text
catalogItemId
```

Do not restore old public UI fields:

```text
cardVariant
badge
ctaLabel
imageRatio
behaviorHint
priceLabelMode
```

Do not use product/category keys as the primary card layout system.

Do not modify backend or dashboard from Flutter work.

Do not change checkout payload unless a real bug requires it.

---

## 22. Final Definition of Done

The Flutter one-time menu integration is complete when:

```text
1. GET /api/orders/menu is parsed fully.
2. product.ui.cardSize is mapped into domain models.
3. large/medium/small cards render correctly.
4. Product actions use business flags, not cardSize.
5. Option groups render and validate correctly.
6. displayStyle is supported or safely falls back.
7. optionSections are supported where present.
8. nameI18n/descriptionI18n are used for localization.
9. imageUrl is respected with a clean fallback.
10. restaurantHours open/closed state is respected.
11. Cart, quote, and create order flows still work.
12. No hard-coded product/category key layout remains except documented temporary fallback.
```

---

## 23. Suggested Validation Commands

Run:

```bash
flutter analyze --no-pub
```

Run existing menu-related tests if present.

Add focused tests if the project test setup supports it:

```text
menu response parsing test
cardSize mapping test
localized field fallback test
optionSections parsing test
displayStyle mapping test
product action decision test
```

Suggested test coverage:

```text
large card product maps correctly.
medium card product maps correctly.
small card product maps correctly.
requiresBuilder product opens builder.
direct product adds directly.
optionGroup displayStyle parses correctly.
nameI18n Arabic/English fallback works.
empty imageUrl does not crash UI.
```
