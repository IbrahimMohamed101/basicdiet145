# Branch Pickup Pickup Items - Flutter Handoff

This is the final Flutter handoff document for integrating the new **Branch Pickup unified pickup-items** flow.

## TL;DR

* Use `data.pickupItems` as the source of truth for the UI and selection.
* On confirmation, send `selectedPickupItemIds` to `POST /pickup-requests`.
* Do not use `mealCount` in any flow that includes add-ons.
* Do not put add-ons inside `selectedMealSlotIds`.
* After a pickup request is created successfully, refresh pickup availability and verify that the selected items disappear from the default response.

## Base Rules

* All Flutter requests must use `Authorization: Bearer <clientToken>`.
* Do not use an admin/dashboard token from Flutter.
* Dates must use `YYYY-MM-DD`.
* Creating a pickup request is currently allowed only for the current business date, according to backend rules.
* `selectedPickupItemIds` is the new primary selection flow.
* `selectedMealSlotIds` is legacy compatibility for meal slots only.
* `mealCount` is a legacy fallback and must not be used in any flow that includes add-ons.
* Use a stable `idempotencyKey` for the same user attempt, especially when retrying after timeout or network failure.

## What Changed And Why

Branch Pickup is no longer only meal-count based. It is now **item-id based**.

Instead of telling the backend:

```txt
Reserve one meal
```

Flutter must tell the backend:

```txt
Reserve these exact pickup items
```

Examples:

```txt
slot_1
slot_2
addon_<addonId>_1
addon_<addonId>_2
```

Reason:

A single subscription day can contain meals and independent add-ons. If Flutter sends only `mealCount`, the backend cannot know which add-ons were selected.

If Flutter sends only `selectedMealSlotIds`, the backend will reserve only meals, and add-ons will remain available.

Important rule:

```txt
selectedPickupItemIds = source of truth
selectedMealSlotIds = legacy meals-only compatibility
mealCount = legacy fallback, not for add-on selection flows
```

## Flutter Must Implement This Flow

1. Call pickup availability without `includeUnavailable`.
2. Render `data.pickupItems` directly, or use `data.sections` for grouping.
3. When the user selects an item, store `item.itemId`.
4. On confirmation, send `selectedPickupItemIds`.
5. Store `requestId` from the create response.
6. Poll or refresh pickup request status.
7. Refresh pickup availability after successful request creation.
8. Verify that selected items no longer appear in default availability.

## Endpoints

### Get Pickup Availability

```http
GET /api/subscriptions/:subscriptionId/pickup-availability?date=YYYY-MM-DD
Authorization: Bearer <clientToken>
```

Query params:

```txt
date=YYYY-MM-DD              required
includeUnavailable=true      optional, shows reserved/fulfilled/no_show/history items
includeHistory=true          optional, similar history visibility mode
```

Important note:

Payment-blocked items may still appear in default availability so Flutter can show a disabled state or a payment CTA. These items are not selectable and must not be sent inside `selectedPickupItemIds`.

### Create Pickup Request

```http
POST /api/subscriptions/:subscriptionId/pickup-requests
Authorization: Bearer <clientToken>
Content-Type: application/json
```

### Get Pickup Request Status

```http
GET /api/subscriptions/:subscriptionId/pickup-requests/:requestId/status
Authorization: Bearer <clientToken>
```

### List Pickup Requests

```http
GET /api/subscriptions/:subscriptionId/pickup-requests?date=YYYY-MM-DD&status=active
Authorization: Bearer <clientToken>
```

`status` can be:

```txt
active
all
```

## Correct Request Body Vs Wrong Request Body

Correct:

```json
{
  "date": "YYYY-MM-DD",
  "selectedPickupItemIds": [
    "slot_1",
    "addon_A_1",
    "addon_B_1"
  ],
  "idempotencyKey": "pickup-YYYY-MM-DD-subscriptionId-clientAttemptId"
}
```

Wrong: this reserves only the meal and does not reserve selected add-ons.

```json
{
  "date": "YYYY-MM-DD",
  "selectedMealSlotIds": ["slot_1"]
}
```

Wrong: the backend cannot know which add-ons were selected.

```json
{
  "date": "YYYY-MM-DD",
  "mealCount": 1
}
```

Wrong: add-ons must never be sent as meal slot ids.

```json
{
  "date": "YYYY-MM-DD",
  "selectedMealSlotIds": ["slot_1", "addon_A_1"]
}
```

## Availability Response Fields

```json
{
  "status": true,
  "data": {
    "subscriptionId": "...",
    "date": "YYYY-MM-DD",
    "subscriptionDayId": "...",
    "remainingMeals": 8,
    "summary": {
      "availableSelectableCount": 4,
      "availableMealSlotCount": 2,
      "availableAddonCount": 2,
      "canCreatePickupRequest": true,
      "titleAr": "عناصر متاحة للاستلام",
      "titleEn": "Items available for pickup",
      "emptyTextAr": "",
      "emptyTextEn": ""
    },
    "pickupItems": [],
    "sections": [],
    "dayAddons": []
  }
}
```

## Exact UI Mapping For Pickup Items

For each pickup item, Flutter should read these fields:

```txt
item.itemId
item.itemType
item.categoryKey
item.title.ar
item.title.en
item.subtitle.ar
item.subtitle.en
item.display.titleAr
item.display.titleEn
item.display.statusTextAr
item.display.statusTextEn
item.display.selectionTextAr
item.display.selectionTextEn
item.availability.state
item.availability.available
item.availability.canSelect
item.payment.required
```

The selection button is enabled only when:

```txt
item.availability.available == true && item.availability.canSelect == true
```

If the item is not selectable, show:

```txt
item.display.statusTextAr/statusTextEn
```

Use bilingual fields according to the app language. Do not show raw ids such as `slot_1` or `addon_A_1` as customer-facing titles except as a final fallback.

Important:

Flutter should rely mainly on:

```txt
item.availability.state
item.availability.available
item.availability.canSelect
item.payment.required
```

Do not build critical UI logic only on the exact value of `unavailableReason`, because the backend may keep some legacy reason strings for compatibility.

## Pickup Item Shape

Example add-on item:

```json
{
  "itemId": "addon_64f000000000000000000001_1",
  "itemType": "addon",
  "source": "dayAddon",
  "sourceId": "64f000000000000000000001",
  "slotId": null,
  "categoryKey": "addons",
  "quantity": 1,
  "title": {
    "ar": "إضافة بروتين",
    "en": "Protein Add-on"
  },
  "subtitle": {
    "ar": "إضافة مدفوعة",
    "en": "Paid add-on"
  },
  "product": {
    "id": "64f000000000000000000001",
    "name": {
      "ar": "إضافة بروتين",
      "en": "Protein Add-on"
    }
  },
  "components": [],
  "payment": {
    "required": false,
    "status": "not_required",
    "reason": null,
    "reasonLabel": {
      "ar": "",
      "en": ""
    }
  },
  "availability": {
    "state": "available",
    "available": true,
    "canSelect": true,
    "unavailableReason": null,
    "reasonLabel": {
      "ar": "",
      "en": ""
    },
    "reservedByPickupRequestId": null
  },
  "display": {
    "titleAr": "إضافة بروتين",
    "titleEn": "Protein Add-on",
    "statusTextAr": "متاح للاستلام",
    "statusTextEn": "Available for pickup",
    "selectionTextAr": "اختر هذا العنصر للاستلام",
    "selectionTextEn": "Select this item for pickup"
  },
  "selectionMode": "independent"
}
```

Meal item ids:

```txt
slot_1
slot_2
slot_3
```

Add-on item ids:

```txt
addon_<addonId>_1
addon_<addonId>_2
```

## Section Mapping

`sections` exists to make UI grouping easier. `pickupItems` remains the source of truth.

Expected `sectionKey` values:

```txt
meals
premium_meals
salads
proteins
sandwiches
addons
```

Flutter rules:

* You may render the UI from `data.sections`.
* Selected ids must still come from `pickupItems[].itemId`, or from section items that resolve to the same pickup item.
* Do not generate local ids in Flutter.
* Do not collect ids from `dayAddons` separately if add-ons already exist inside `pickupItems`.

## Default Vs IncludeUnavailable

Default availability:

```http
GET /api/subscriptions/:subscriptionId/pickup-availability?date=YYYY-MM-DD
```

The default response shows remaining selectable items and may show payment-blocked items as disabled/payment CTA items.

It hides:

```txt
reserved items
fulfilled items
no_show items
add-ons that were already selected in a previous pickup request
```

`includeUnavailable=true`:

```http
GET /api/subscriptions/:subscriptionId/pickup-availability?date=YYYY-MM-DD&includeUnavailable=true
```

This returns all items with their state. It is useful for history, debug screens, or disabled-state UI. It is not recommended for the normal selection screen.

Example reserved add-on:

```json
{
  "itemId": "addon_A_1",
  "availability": {
    "state": "reserved",
    "available": false,
    "canSelect": false,
    "unavailableReason": "SLOT_ALREADY_RESERVED",
    "reservedByPickupRequestId": "..."
  },
  "display": {
    "statusTextAr": "تم طلب استلام هذه الإضافة بالفعل",
    "statusTextEn": "This add-on has already been requested for pickup",
    "selectionTextAr": "",
    "selectionTextEn": "",
    "unavailableTextAr": "تم طلب استلام هذه الإضافة بالفعل",
    "unavailableTextEn": "This add-on has already been requested for pickup"
  }
}
```

## Add-ons Rules

* Add-ons are independent pickup items.
* Quantity `2` means two independent units:

```txt
addon_A_1
addon_A_2
```

* Selecting `addon_A_1` does not reserve `addon_A_2`.
* Selected add-ons must disappear from default availability after request creation.
* Do not render `dayAddons` as a separate selectable UI if `pickupItems` already includes add-ons.
* Do not duplicate add-ons from both `dayAddons` and `pickupItems`.
* When sending the POST request, send add-on unit ids exactly as received from the backend.

## Meal Components Are Not Pickup Items

A meal pickup item may contain:

```txt
protein
carb
sauce
side
```

These are components only. They are not independent pickup items.

Do not allow the user to select protein, carb, sauce, or side separately inside the pickup request.

The only exception is when the backend returns a real independent item, for example:

```txt
item.itemType = "protein_extra"
```

In that case, it can be selected as an independent pickup item using `item.itemId`.

## Payment Blocked Items

Some items may appear in default availability while payment-blocked so the user can understand why the item is disabled or see a payment CTA.

Flutter rules:

* If `item.payment.required == true` or `item.availability.canSelect == false`, do not allow the item to be selected.
* Show a payment CTA or disabled state according to the design.
* Do not send payment-blocked ids inside `selectedPickupItemIds`.
* If payment-blocked ids are sent, the backend will usually reject the request with `PAYMENT_REQUIRED`, `ADDON_PAYMENT_REQUIRED`, or `PREMIUM_PAYMENT_REQUIRED`.

## Create Pickup Request Response

```json
{
  "status": true,
  "data": {
    "requestId": "...",
    "subscriptionId": "...",
    "subscriptionDayId": "...",
    "date": "YYYY-MM-DD",
    "mealCount": 1,
    "selectedMealSlotIds": ["slot_1"],
    "selectedPickupItemIds": ["slot_1", "addon_A_1", "addon_B_1"],
    "selectedPickupItems": [],
    "addonCount": 2,
    "itemCount": 3,
    "selectionMode": "pickup_item_ids",
    "currentStep": 2,
    "status": "locked",
    "statusLabel": "Your order is locked",
    "message": "Modification period has ended. Waiting for kitchen.",
    "isReady": false,
    "isCompleted": false,
    "pickupCode": null,
    "pickupCodeIssuedAt": null,
    "creditsReserved": true,
    "idempotent": false,
    "nextAction": "poll_pickup_request_status"
  }
}
```

Important:

```txt
mealCount = meal/premium meal items only
addonCount = add-on items only
itemCount = all selected pickup items
remainingMeals decreases by selected meal items only, not by add-ons
```

## Request Status UI Mapping

```txt
locked:
  Waiting for kitchen. Do not show pickupCode.

in_preparation:
  Kitchen is preparing. Do not show pickupCode.

ready_for_pickup:
  Show ready state and pickupCode.

fulfilled:
  Show completed.

no_show:
  Show missed pickup / final state.

canceled:
  Show canceled state.
```

Status response includes the selected item fields, so the app can continue showing the exact request contents:

```json
{
  "status": true,
  "data": {
    "requestId": "...",
    "status": "ready_for_pickup",
    "currentStep": 4,
    "isReady": true,
    "isCompleted": false,
    "pickupCode": "123456",
    "selectedPickupItemIds": ["slot_1", "addon_A_1"],
    "mealCount": 1,
    "addonCount": 1,
    "itemCount": 2
  }
}
```

## Error Handling

Flutter must handle these error codes:

```txt
400 INVALID_SELECTED_PICKUP_ITEM_IDS
400 DUPLICATE_SELECTED_PICKUP_ITEM_IDS
409 IDEMPOTENCY_CONFLICT
422 PICKUP_ITEM_NOT_FOUND
422 PICKUP_ITEM_UNAVAILABLE
422 ADDON_PAYMENT_REQUIRED
422 PREMIUM_PAYMENT_REQUIRED
422 PAYMENT_REQUIRED
422 INSUFFICIENT_CREDITS
```

Recommended Flutter actions:

```txt
PICKUP_ITEM_UNAVAILABLE:
  Refresh availability because the item was probably reserved or its state changed.

PICKUP_ITEM_NOT_FOUND:
  Refresh availability and rebuild local selection state.

ADDON_PAYMENT_REQUIRED / PREMIUM_PAYMENT_REQUIRED / PAYMENT_REQUIRED:
  Show payment CTA or disabled state.

INSUFFICIENT_CREDITS:
  Show a message that the meal credit balance is not enough.

DUPLICATE_SELECTED_PICKUP_ITEM_IDS:
  Clean the local selected set and retry only if appropriate.

INVALID_SELECTED_PICKUP_ITEM_IDS:
  Review serialization. The payload must send an array of non-empty strings.

IDEMPOTENCY_CONFLICT:
  The same idempotencyKey was reused with a different payload. Use a new key only for a new user intent.
```

## Network Log Acceptance Criteria

The Flutter team must verify request logs before handoff.

Before request, day availability contains:

```txt
slot_1
slot_2
slot_3
addon_A_1
addon_A_2
addon_B_1
addon_B_2
```

User selects:

```txt
slot_1
addon_A_1
addon_B_1
```

POST body must contain:

```json
{
  "selectedPickupItemIds": ["slot_1", "addon_A_1", "addon_B_1"]
}
```

Next default availability must return only:

```txt
slot_2
slot_3
addon_A_2
addon_B_2
```

It must not return:

```txt
slot_1
addon_A_1
addon_B_1
```

## Flutter Implementation Checklist

```txt
[ ] Parse data.pickupItems.
[ ] Group UI by data.sections if needed.
[ ] Keep selected Set<String>.
[ ] Add/remove item.itemId only.
[ ] Send selectedPickupItemIds in POST.
[ ] Do not send add-ons as selectedMealSlotIds.
[ ] Do not rely on mealCount for add-on flows.
[ ] Refresh availability after success.
[ ] Confirm selected items disappeared from default availability.
[ ] Poll pickup request status using requestId.
[ ] Handle idempotency with a stable key for retries.
[ ] Handle payment-blocked items as disabled/payment CTA.
[ ] Handle empty state using summary.titleAr/titleEn and summary.emptyTextAr/emptyTextEn.
[ ] Use bilingual fields for all customer-facing text.
```

## Minimal Dart Model Hints

These are hints only. They are not mandatory production models.

```dart
class PickupAvailability {
  final String subscriptionId;
  final String date;
  final int remainingMeals;
  final List<PickupItem> pickupItems;
  final List<PickupSection> sections;

  PickupAvailability({
    required this.subscriptionId,
    required this.date,
    required this.remainingMeals,
    required this.pickupItems,
    required this.sections,
  });
}

class PickupItem {
  final String itemId;
  final String itemType;
  final String categoryKey;
  final LocalizedText title;
  final LocalizedText? subtitle;
  final PickupDisplay display;
  final PickupAvailabilityState availability;
  final PickupPayment payment;

  PickupItem({
    required this.itemId,
    required this.itemType,
    required this.categoryKey,
    required this.title,
    required this.subtitle,
    required this.display,
    required this.availability,
    required this.payment,
  });
}

class CreatePickupRequestBody {
  final String date;
  final List<String> selectedPickupItemIds;
  final String idempotencyKey;

  CreatePickupRequestBody({
    required this.date,
    required this.selectedPickupItemIds,
    required this.idempotencyKey,
  });

  Map<String, dynamic> toJson() => {
    'date': date,
    'selectedPickupItemIds': selectedPickupItemIds,
    'idempotencyKey': idempotencyKey,
  };
}
```

Selection helper:

```dart
bool canSelect(PickupItem item) {
  return item.availability.available == true &&
      item.availability.canSelect == true;
}
```

## Backend Verification Notes

Backend tests cover:

```txt
selected add-ons are persisted in selectedPickupItemIds
selected add-ons disappear from default availability
includeUnavailable=true shows selected add-ons as reserved
selectedMealSlotIds legacy flow reserves meals only
dashboard queue shows selected-only meals/add-ons for pickup request rows
wallet accounting decrements remainingMeals by meal items only
```

## Final Handoff Summary

As long as Flutter sends `selectedPickupItemIds`, the backend will reserve exactly the selected items, whether they are meals or add-ons, and will hide them from default pickup availability after request creation.

Golden rule:

```txt
Use selectedPickupItemIds.
Do not use mealCount or selectedMealSlotIds for add-ons.
Refresh availability after success.
```
