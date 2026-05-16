# Pickup Multi-Request Frontend Contract

هذا المستند يوضح عقد الـ frontend لمسار استلام الفرع الجديد. المسار الجديد خاص فقط بالاشتراكات التي ترجع في الـ overview:

```json
{
  "pickupPreparation": {
    "mode": "multi_request"
  }
}
```

إذا `mode != "multi_request"` أو الحقل غير موجود، استخدم flow الـ legacy الحالي.

---

## الفرق بين courier و pickup

- `courier / delivery`: يظل day-based. اليوم الواحد له `SubscriptionDay.status` واحد، والاستهلاك يتم مرة واحدة حسب منطق courier الحالي.
- `pickup / استلام من الفرع`: يستخدم `SubscriptionPickupRequest` كـ source of truth للطلب، الحالة، الكود، وحجز الرصيد. يمكن إنشاء أكثر من request في نفس اليوم طالما `remainingMeals` يكفي.
- endpoint القديم:
  `POST /api/subscriptions/:id/days/:date/pickup/prepare`
  هو legacy ولا يستخدم في `multi_request`.

---

## Overview

```http
GET /api/subscriptions/current/overview
Authorization: Bearer <token>
```

داخل `data.pickupPreparation` في pickup multi-request:

```json
{
  "flowStatus": "available",
  "reason": null,
  "buttonLabel": "تجهيز الطلب",
  "message": null,
  "mode": "multi_request",
  "canCreatePickupRequest": true,
  "availableMealBalance": 6,
  "activePickupRequestCount": 1,
  "latestPickupRequest": {
    "requestId": "665000000000000000000001",
    "subscriptionId": "664000000000000000000001",
    "subscriptionDayId": "666000000000000000000001",
    "date": "2026-05-18",
    "mealCount": 2,
    "currentStep": 3,
    "status": "in_preparation",
    "statusLabel": "Kitchen is preparing your meals",
    "message": "Chef is hand-picking ingredients for your order.",
    "isReady": false,
    "isCompleted": false,
    "pickupCode": null,
    "pickupCodeIssuedAt": null,
    "fulfilledAt": null,
    "createdAt": "2026-05-18T09:00:00.000Z"
  }
}
```

Important nullable fields:

- `latestPickupRequest`: `null` إذا لا يوجد request سابق اليوم.
- `pickupCode`: يظهر فقط في `ready_for_pickup` و `fulfilled`.
- `pickupCodeIssuedAt`: يظهر فقط مع `pickupCode`.
- `fulfilledAt`: يظهر فقط في `fulfilled`.

`flowStatus = "available"` يعني يمكن إظهار زر إنشاء pickup request جديد. لا تعتبر request سابق `fulfilled/no_show/canceled` مانعًا إذا `canCreatePickupRequest = true`.

---

## Create Pickup Request

```http
POST /api/subscriptions/:id/pickup-requests
Authorization: Bearer <token>
Content-Type: application/json
```

Body:

```json
{
  "date": "2026-05-18",
  "mealCount": 2,
  "idempotencyKey": "optional-client-generated-key"
}
```

Success:

```json
{
  "status": true,
  "data": {
    "requestId": "665000000000000000000001",
    "subscriptionId": "664000000000000000000001",
    "subscriptionDayId": "666000000000000000000001",
    "date": "2026-05-18",
    "mealCount": 2,
    "currentStep": 2,
    "status": "locked",
    "statusLabel": "Your order is locked",
    "message": "Modification period has ended. Waiting for kitchen.",
    "isReady": false,
    "isCompleted": false,
    "pickupCode": null,
    "pickupCodeIssuedAt": null,
    "fulfilledAt": null,
    "createdAt": "2026-05-18T09:00:00.000Z",
    "creditsReserved": true,
    "idempotent": false,
    "nextAction": "poll_pickup_request_status"
  }
}
```

Frontend mealCount:

- اعرض للمستخدم اختيار عدد الوجبات المطلوب استلامها الآن.
- الحد الأدنى `1`.
- الحد الأقصى يجب ألا يتجاوز `availableMealBalance`.
- backend سيعيد `INSUFFICIENT_CREDITS` إذا تغير الرصيد بين الـ overview والـ create.
- استخدم `idempotencyKey` لكل tap/submit intent لمنع double tap من إنشاء requestين لنفس العملية.

---

## List Pickup Requests

```http
GET /api/subscriptions/:id/pickup-requests?date=2026-05-18&status=active
Authorization: Bearer <token>
```

Query:

- `date` اختياري.
- `status=active` يرجع فقط:
  `locked`, `in_preparation`, `ready_for_pickup`.
- `status=all` أو عدم إرسال status يرجع كل الطلبات.

Response:

```json
{
  "status": true,
  "data": {
    "requests": [
      {
        "requestId": "665000000000000000000001",
        "subscriptionId": "664000000000000000000001",
        "subscriptionDayId": "666000000000000000000001",
        "date": "2026-05-18",
        "mealCount": 2,
        "currentStep": 4,
        "status": "ready_for_pickup",
        "statusLabel": "Your order is ready",
        "message": "Use this pickup code at the branch.",
        "isReady": true,
        "isCompleted": false,
        "pickupCode": "123456",
        "pickupCodeIssuedAt": "2026-05-18T10:00:00.000Z",
        "fulfilledAt": null,
        "createdAt": "2026-05-18T09:00:00.000Z",
        "creditsReserved": true
      }
    ]
  }
}
```

---

## Get Request Status

```http
GET /api/subscriptions/:id/pickup-requests/:requestId/status
Authorization: Bearer <token>
```

Response shape is the same status payload used in create/list.

Status lifecycle:

| status | currentStep | isReady | isCompleted | pickupCode |
|---|---:|---|---|---|
| `locked` | 2 | false | false | null |
| `in_preparation` | 3 | false | false | null |
| `ready_for_pickup` | 4 | true | false | visible |
| `fulfilled` | 4 | true | true | visible if stored |
| `no_show` | 4 | false | true | null |
| `canceled` | 1 | false | true | null |

Polling rules:

- Start polling after create succeeds and `nextAction = "poll_pickup_request_status"`.
- Poll this request-specific endpoint, not the old day status endpoint.
- Continue polling while status is `locked` or `in_preparation`.
- Stop polling on `ready_for_pickup`, `fulfilled`, `no_show`, or `canceled`.
- Stop polling on any 4xx error and show the mapped message.

---

## Error Handling

Common errors:

| code | HTTP | Frontend behavior |
|---|---:|---|
| `INVALID_DELIVERY_MODE` | 400 | Use legacy/non-pickup UX or hide action |
| `INVALID_DATE` | 400 | Refresh overview/date; only KSA today is valid |
| `INVALID_MEAL_COUNT` | 400 | Ask user to choose a valid meal count |
| `INSUFFICIENT_CREDITS` | 422 | Refresh overview and show insufficient balance |
| `SUB_INACTIVE` / `SUB_EXPIRED` | 422 | Disable create and show subscription state |
| `PLANNING_INCOMPLETE` | 422 | Navigate to meal planner |
| `PLANNER_UNCONFIRMED` / `PLANNING_UNCONFIRMED` | 422 | Ask user to confirm planner |
| `PREMIUM_OVERAGE_PAYMENT_REQUIRED` | 422 | Navigate to payment |
| `PREMIUM_PAYMENT_REQUIRED` | 422 | Navigate to payment |
| `ONE_TIME_ADDON_PAYMENT_REQUIRED` | 422 | Navigate to payment |
| `DAY_SKIPPED` | 409 | Disable create for this day |
| `NOT_FOUND` | 404 | Refresh local state |
| `FORBIDDEN` | 403 | Logout or account mismatch handling |
| `UNAUTHORIZED` | 401 | Refresh/login |

---

## Backend Guarantees

- Creating a request atomically reserves `mealCount` from `remainingMeals`.
- Fulfillment and no-show consume the reservation marker only; they do not decrement `remainingMeals` again.
- Cancel releases reserved meals once if the request was not consumed.
- End-of-day settlement changes active requests to `no_show` and consumes the reservation.
- `SubscriptionDay.status`, `SubscriptionDay.pickupRequested`, and `SubscriptionDay.pickupCode` are legacy fields and are not the source of truth for `multi_request`.
