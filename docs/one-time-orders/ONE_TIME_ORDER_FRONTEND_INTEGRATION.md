# One-Time Order Frontend Integration Guide

This document defines the backend contract and correct behavior for Flutter/Mobile integration regarding one-time orders (Pickup).

## Backend Endpoints

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/orders/menu` | No | Fetch menu catalog and restaurant hours |
| `POST` | `/api/orders/quote` | Yes | Calculate price and validate availability |
| `POST` | `/api/orders` | Yes | Create a new order and initialize payment |
| `POST` | `/api/orders/:orderId/payments/:paymentId/verify` | Yes | Verify payment status from provider |
| `GET` | `/api/orders/:id` | Yes | Fetch order details and tracking status |

## 1. Pickup Quote Contract

### Request Shape (`POST /api/orders/quote`)

```json
{
  "fulfillmentMethod": "pickup",
  "pickup": {
    "branchId": "main",
    "pickupWindow": "18:00-20:00"
  },
  "items": [
    {
      "productId": "6a124af46864369ee09bbe4b",
      "qty": 1,
      "selectedOptions": []
    }
  ]
}
```

### Important rules for `pickup`:
- This app currently has exactly one permanent pickup branch: `"main"`.
- **`branchId`**: Optional for pickup in this app.
  - The permanent default pickup branch is `branchId: "main"`.
  - If Flutter sends an empty or `null` value, or omits `pickup.branchId`, the backend defaults to `"main"`.
  - Value may be a Mongo ObjectId from the `pickup_locations` list.
  - Value may also be a stable branch key/code/slug such as `"main"` when the backend branch setting exposes that stable identifier.
  - **DO NOT** send `"openTime"` or other field names as `branchId`.
- **`pickupWindow`**: Optional for pickup.
  - If omitted, `null`, or an empty string, the order is treated as ASAP / prepare immediately.
  - If provided, it must use format `HH:mm-HH:mm` and match a backend pickup window from `restaurantHours.pickupWindows`.

Default pickup branch:
- `branchId`: `"main"`
- Address: `H4GX+JF7، السلامة، جدة 23436، المملكة العربية السعودية`

Flutter may send `pickup.branchId = "main"` or omit `branchId` for pickup orders. Flutter may also omit `pickup.pickupWindow` for ASAP pickup. The backend still exposes branch/config data for compatibility, but clients do not need a branch picker while the app has one permanent branch.

ASAP pickup examples:

```json
{
  "fulfillmentMethod": "pickup",
  "pickup": {},
  "items": [
    {
      "productId": "6a124af46864369ee09bbe4b",
      "qty": 1,
      "selectedOptions": []
    }
  ]
}
```

```json
{
  "fulfillmentMethod": "pickup",
  "pickup": {
    "branchId": "main"
  },
  "items": [
    {
      "productId": "6a124af46864369ee09bbe4b",
      "qty": 1,
      "selectedOptions": []
    }
  ]
}
```

## 2. Restaurant Hours & Closed Behavior

The backend checks restaurant availability in `GET /api/orders/menu` and enforces it in `POST /api/orders/quote`.

### Restaurant Closed Response (`409 RESTAURANT_CLOSED`)

If the restaurant is closed (manually, via weekly schedule, or outside working hours), the backend returns:

```json
{
  "ok": false,
  "error": {
    "code": "RESTAURANT_CLOSED",
    "message": "Restaurant is currently closed",
    "details": {
      "code": "RESTAURANT_CLOSED",
      "reason": "RESTAURANT_CLOSED",
      "message": "Restaurant is currently closed",
      "messageAr": "المطعم مغلق حاليا. يمكنك الطلب خلال ساعات العمل.",
      "messageEn": "Restaurant is currently closed. Please order during working hours.",
      "restaurantHours": {
        "openTime": "10:00",
        "closeTime": "23:00",
        "isOpenNow": false
      }
    }
  }
}
```

### Correct Flutter Behavior:
1. **Always handle `409` as a business-state error**, not a crash.
2. Display the localized message from `error.details.messageAr` or `error.details.messageEn`.
3. Check `isOpenNow` from the menu response before allowing the user to proceed to the checkout screen.
4. If `isOpenNow` is `false`, show the `openTime` and `closeTime` to the user.

## 3. Item Shape

| Field | Type | Description |
| :--- | :--- | :--- |
| `productId` | `String` | Product ID from menu catalog |
| `qty` | `Integer` | Quantity (min 1) |
| `weightGrams` | `Integer` | Required ONLY for `per_100g` products (optional otherwise) |
| `selectedOptions` | `Array` | Array of `{ groupId, optionId, qty }` |

## 4. Error Handling Summary

| Code | Status | Meaning |
| :--- | :--- | :--- |
| `RESTAURANT_CLOSED` | 409 | Restaurant is closed (schedule or manual) |
| `INVALID_BRANCH` | 400 | `branchId` is invalid or not found |
| `EMPTY_ORDER` | 400 | `items` array is empty or missing |
| `ITEM_NOT_FOUND` | 404 | `productId` does not exist |
| `PRODUCT_NOT_AVAILABLE`| 409 | Product is inactive or not available for this branch |
| `INVALID_DELIVERY_WINDOW`| 400 | `pickupWindow` format is invalid or not in allowed list |

## QA Checklist for Frontend Integration
- [ ] Quote one item while restaurant is open (Success)
- [ ] Quote one item while restaurant is closed (409 RESTAURANT_CLOSED)
- [ ] Pass valid `branchId: "main"` (Success)
- [ ] Omit `pickup.branchId` for pickup and verify backend defaults to `main` (Success)
- [ ] Omit `pickup.pickupWindow` for pickup and verify backend treats it as ASAP (Success)
- [ ] Pass invalid `branchId: "something-else"` (400 INVALID_BRANCH)
- [ ] Display Arabic error message for restaurant closed
- [ ] If sending `pickupWindow`, verify the format matches `HH:mm-HH:mm`
