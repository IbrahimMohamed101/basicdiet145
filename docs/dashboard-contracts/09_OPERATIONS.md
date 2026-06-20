# Screen Contract: 09_OPERATIONS

Verified against `src/routes/dashboardOps.js`, `src/controllers/dashboard/opsController.js`, `src/services/dashboard/opsReadService.js`, `src/services/dashboard/opsTransitionService.js`, and the dashboard operations tests on 2026-06-20.

## 1. Screen Purpose
Provides real-time queues for kitchen staff, drivers, and cashiers to transition subscription days, one-time orders, and pickup requests through operational states (preparing, ready, fulfilled, no-show, canceled).

## 2. Dashboard Route
`/operations`

## 3. Visible UI Requirements
* **Kitchen Queue**: Shows items in preparation or locked, sorted by date (newest first).
* **Courier/Fulfillment Queue**: Shows delivery assignments, shipping address, delivery window, and courier action triggers.
* **Self-pickup Queue**: Shows ready packages, customer names, branch locations, and pickup codes.
* **Action Buttons**: Rendered dynamically based on `allowedActions` returned in the DTO.
* **Search / Cashier Look-up**: Real-time lookup by phone number, name, subscription references (`SUB-`), or order references (`ORD-`).

---

## Backend Endpoints

## GET /api/dashboard/ops/list

### Purpose
Retrieve the unified, daily operations queue containing subscription days, one-time orders, and branch pickup requests scheduled for a specific date.

### Used By
The `/operations` screen dashboard tables (Kitchen, Courier, and Self-pickup queues).

### Auth
Requires `Authorization: Bearer {{dashboardToken}}`.
Allowed roles: `admin`, `kitchen`, `courier`.

### Path Params
None.

### Query Params
| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `date` | string | Yes | The operations date in `YYYY-MM-DD` format (e.g. `2026-06-20`). |

### Request Body
No request body.

### Success Response
```json
{
  "status": true,
  "data": [
    {
      "source": "subscription",
      "entityType": "subscription_day",
      "entityId": "665f1b2e7b9a4d0012a10001",
      "id": "665f1b2e7b9a4d0012a10001",
      "type": "subscription",
      "mode": "delivery",
      "reference": "SUB-A10001",
      "status": "in_preparation",
      "statusLabel": "in_preparation",
      "fulfillmentType": "home_delivery",
      "plan": {
        "id": "665f1b2e7b9a4d0012a10000",
        "key": "plan_7_days",
        "name": "7 Days Plan"
      },
      "kitchenDetails": {
        "mealSlots": [
          {
            "slotIndex": 1,
            "slotKey": "slot_1",
            "selectionType": "standard_meal",
            "status": "complete",
            "meal": {
              "id": "665f1b2e7b9a4d0012b10002",
              "name": {
                "ar": "دجاج مشوي",
                "en": "Grilled Chicken"
              }
            }
          }
        ],
        "addons": []
      },
      "paymentValidity": {
        "paymentRequired": false,
        "paymentStatus": "paid",
        "paymentApplied": true,
        "pendingUnpaid": false,
        "superseded": false,
        "revisionMismatch": false,
        "canPrepare": true,
        "canFulfill": true,
        "reason": null
      },
      "ui": {
        "label": "in_preparation",
        "badge": "warning",
        "icon": "chef-hat"
      },
      "customer": {
        "id": "665f1b2e7b9a4d0012a10002",
        "name": "Client One",
        "phone": "+966500000001"
      },
      "context": {
        "date": "2026-06-17",
        "window": "08:00-11:00",
        "address": {
          "line1": "Test Address",
          "city": "Riyadh"
        },
        "branch": null,
        "pickupCode": null,
        "requiredMealCount": 1,
        "specifiedMealCount": 1,
        "unspecifiedMealCount": 0,
        "fulfillmentMode": "delivery",
        "consumptionState": "pending",
        "pickupRequested": false,
        "pickupPrepared": false,
        "pickupPreparationFlowStatus": "not_applicable",
        "dayEndConsumptionReason": null,
        "mealTypesSpecified": true
      },
      "delivery": {
        "id": "665f1b2e7b9a4d0012c10001",
        "deliveryId": "665f1b2e7b9a4d0012c10001",
        "status": "ready_for_delivery",
        "date": "2026-06-17",
        "address": {
          "line1": "Test Address",
          "city": "Riyadh"
        },
        "window": "08:00-11:00",
        "method": "delivery"
      },
      "pickup": null,
      "allowedActions": [
        {
          "id": "ready_for_delivery",
          "label": "جاهز للتوصيل",
          "color": "teal",
          "icon": "package",
          "endpoint": "/api/dashboard/ops/actions/ready_for_delivery",
          "method": "POST",
          "requiresReason": false
        }
      ],
      "timestamps": {
        "createdAt": "2026-06-19T08:00:00.000Z",
        "updatedAt": "2026-06-20T08:00:00.000Z"
      }
    }
  ]
}
```

### Error Response
```json
{
  "ok": false,
  "error": {
    "code": "INVALID",
    "message": "date must be in YYYY-MM-DD format"
  }
}
```

### Frontend Notes
* **Data Sources**: The response is a unified array from three database collections: `SubscriptionDay` (mapped as `entityType: "subscription_day"`), `Order` (mapped as `entityType: "order"`), and `SubscriptionPickupRequest` (mapped as `entityType: "subscription_pickup_request"`).
* **Read-only Fields**: All fields in the response are read-only for display. Action states must be triggered by sending requests to endpoints listed in `allowedActions`.
* **Editable Fields**: None. Action buttons should make requests directly to the endpoints specified in the `allowedActions` array.

### Validation
* `date` must be a valid string matching `/^\d{4}-\d{2}-\d{2}$/`.
* If a customer has a `pickup` delivery mode subscription, the direct subscription day is filtered out from the list if a matching `SubscriptionPickupRequest` exists for that day.

### Important Do/Don't
* **Do** render the action buttons dynamically from the `allowedActions` array.
* **Do Not** hardcode state transitions on the frontend. The backend controls all allowed state pathways.

### Postman
```http
GET {{baseUrl}}/api/dashboard/ops/list?date=2026-06-20
Authorization: Bearer {{dashboardToken}}
Accept-Language: ar
```

---

## GET /api/dashboard/ops/search

### Purpose
Search across active users, subscriptions, and one-time orders by customer name, phone number, subscription reference, or order reference.

### Used By
Fulfillment lookup drawer and cashier search fields.

### Auth
Requires `Authorization: Bearer {{dashboardToken}}`.
Allowed roles: `admin`, `kitchen`, `courier`.

### Path Params
None.

### Query Params
| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `q` | string | Yes | Search query. Must be at least 3 characters. |

### Request Body
No request body.

### Success Response
```json
{
  "status": true,
  "data": [
    {
      "source": "subscription",
      "entityType": "subscription_day",
      "entityId": "665f1b2e7b9a4d0012a10001",
      "id": "665f1b2e7b9a4d0012a10001",
      "type": "subscription",
      "mode": "delivery",
      "reference": "SUB-A10001",
      "status": "in_preparation",
      "statusLabel": "in_preparation",
      "fulfillmentType": "home_delivery",
      "plan": {
        "id": "665f1b2e7b9a4d0012a10000",
        "key": "plan_7_days",
        "name": "7 Days Plan"
      },
      "kitchenDetails": {
        "mealSlots": [],
        "addons": []
      },
      "paymentValidity": {
        "paymentRequired": false,
        "paymentStatus": "paid",
        "paymentApplied": true,
        "pendingUnpaid": false
      },
      "ui": {
        "label": "in_preparation",
        "badge": "warning",
        "icon": "chef-hat"
      },
      "customer": {
        "id": "665f1b2e7b9a4d0012a10002",
        "name": "Client One",
        "phone": "+966500000001"
      },
      "context": {
        "date": "2026-06-17",
        "window": "08:00-11:00",
        "address": {
          "line1": "Test Address",
          "city": "Riyadh"
        }
      },
      "delivery": {},
      "pickup": null,
      "allowedActions": [],
      "timestamps": {
        "createdAt": "2026-06-19T08:00:00.000Z",
        "updatedAt": "2026-06-20T08:00:00.000Z"
      }
    }
  ]
}
```

### Error Response
```json
{
  "ok": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred"
  }
}
```

### Frontend Notes
* Return structure matches the unified DTO schema returned by the list endpoint.
* Returns up to 50 results.
* If search query `q` is less than 3 characters, returns `{ "status": true, "data": [] }` without querying database.

### Validation
* `q` query string parameter must be provided.

### Important Do/Don't
* **Do** debounce input search fields on the frontend to prevent excessive search requests.
* **Do** support scanning reference codes (like typing `SUB-` or `ORD-`) directly into the search bar.

### Postman
```http
GET {{baseUrl}}/api/dashboard/ops/search?q=0500000001
Authorization: Bearer {{dashboardToken}}
```

---

## POST /api/dashboard/ops/actions/:action

### Purpose
Executes state transitions on a specified operations entity (SubscriptionDay, SubscriptionPickupRequest, or Order).

### Used By
Fulfillment state buttons in the queue lists.

### Auth
Requires `Authorization: Bearer {{dashboardToken}}`.
Allowed roles: `admin`, `kitchen`, `courier` (varies by action).
* Admin and Kitchen can prepare and lock items.
* Courier can dispatch, arrive, and cancel delivery items.
* Admin is required for `lock`, `cancel`, `no_show`, `reopen`, and `notify_arrival`.

### Path Params
| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `action` | string | Yes | Action ID. Supported: `lock`, `prepare`, `ready_for_delivery`, `dispatch`, `ready_for_pickup`, `fulfill`, `cancel`, `no_show`, `reopen`, `notify_arrival` (and URL hyphenated aliases `ready-for-pickup`, `ready-for-delivery`). |

### Query Params
None.

### Request Body
Required fields:
* `entityId` (string, Mongo ObjectId): The ID of the target day, order, or pickup request.
* `entityType` (string): The type of entity. Values: `subscription_day`, `subscription_pickup_request`, `order`.
* `payload` (object, optional): Action metadata e.g. `{ "reason": "Courier vehicle broke down", "notes": "Reschedule" }` for `cancel`.

```json
{
  "entityId": "665f1b2e7b9a4d0012a10001",
  "entityType": "subscription_day",
  "payload": {
    "reason": "Client requested change",
    "notes": "Operations override"
  }
}
```

### Success Response
Returns the updated, enriched DTO for the entity.
```json
{
  "status": true,
  "data": {
    "source": "subscription",
    "entityType": "subscription_day",
    "entityId": "665f1b2e7b9a4d0012a10001",
    "id": "665f1b2e7b9a4d0012a10001",
    "status": "ready_for_delivery",
    "allowedActions": []
  }
}
```

### Error Response
* **Pickup Request Required**: Returned if attempting to prepare or fulfill a branch pickup day directly without creating/using a pickup request.
```json
{
  "ok": false,
  "error": {
    "code": "PICKUP_REQUEST_REQUIRED",
    "message": "Pickup preparation requires an explicit client request"
  }
}
```
* **Invalid State Transition**: Returned if attempting to progress an entity along an unsupported state path.
```json
{
  "ok": false,
  "error": {
    "code": "INVALID_TRANSITION",
    "message": "Action dispatch is not allowed in current state"
  }
}
```
* **Invalid Pickup Code**: Returned when cashier tries to fulfill a pickup request with the wrong code.
```json
{
  "ok": false,
  "error": {
    "code": "INVALID_PICKUP_CODE",
    "message": "The provided pickup code is incorrect"
  }
}
```

### Frontend Notes
* **Idempotency**: All backend actions support idempotent calls. If the entity is already in the target state, the call succeeds and returns the current DTO.
* **Reason Prompt**: Show a modal prompting for a reason when `requiresReason` is true on the action configuration.

### Read-only and Editable Fields
* `entityId`, `entityType` are required request inputs.
* `payload.reason`, `payload.notes`, `payload.etaAt` are optional payload fields. All response properties are read-only.

### Validation
* `entityId` must be a valid 24-character hex ObjectId.
* `entityType` must be one of `subscription_day`, `subscription_pickup_request`, `order`.
* For `cancel`, a `payload.reason` is required.

### Important Do/Don't
* **Subscription Home Delivery Lifecycle**: For subscription home delivery operational flow, the allowed lifecycle must be:
  `open -> in_preparation -> ready_for_delivery -> out_for_delivery -> delivered`
* **Dispatch Action Constraints**: The `dispatch` action (transitioning status to `out_for_delivery`) must only appear in `allowedActions` and be executed after the subscription day is in `ready_for_delivery` status. Direct transitions from `in_preparation -> out_for_delivery` are disallowed.
* **Do Not** prepare subscription days with `deliveryMode === "pickup"` directly. They must go through `SubscriptionPickupRequest` flow.
* **Important Rule**: For branch pickup subscriptions, preparation and fulfillment must go through `SubscriptionPickupRequest`. The raw `subscription_day` must not expose `prepare`, `ready_for_pickup`, or `fulfill` actions unless a valid pickup request flow exists.
* **Do** verify `pickupCode` before performing `fulfill` on branch pickups.

### Postman
```http
POST {{baseUrl}}/api/dashboard/ops/actions/cancel
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{
  "entityId": "665f1b2e7b9a4d0012a10001",
  "entityType": "subscription_day",
  "payload": {
    "reason": "Customer unreachable"
  }
}
```

---

## PUT /api/dashboard/operations/subscription-days/:id/ready-for-delivery

### Purpose
Dedicated REST transition route to mark a subscription day as ready for courier delivery.

### Used By
Fulfillment operations dashboard "Ready for delivery" button.

### Auth
Requires `Authorization: Bearer {{dashboardToken}}`.
Allowed roles: `admin`, `kitchen`, `courier`.

### Path Params
| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | The SubscriptionDay ObjectId. |

### Query Params
None.

### Request Body
No request body.

### Success Response
```json
{
  "status": true,
  "data": {
    "source": "subscription",
    "entityType": "subscription_day",
    "entityId": "665f1b2e7b9a4d0012a10001",
    "status": "ready_for_delivery",
    "ui": {
      "label": "ready_for_delivery",
      "badge": "teal",
      "icon": "package"
    }
  }
}
```

### Error Response
```json
{
  "ok": false,
  "error": {
    "code": "DELIVERY_MODE_REQUIRED",
    "message": "Only applies to delivery subscriptions"
  }
}
```

### Frontend Notes
* This endpoint is a specialized wrapper that performs the `ready_for_delivery` action. It enforces that the underlying subscription is `deliveryMode === "delivery"`.
* The response contains the updated unified DTO.

### Validation
* `id` must be a valid ObjectId.
* Underling subscription must be in delivery mode.

### Important Do/Don't
* **Do** use this route for explicit transition of delivery subscription days in the kitchen dashboard.

### Postman
```http
PUT {{baseUrl}}/api/dashboard/operations/subscription-days/665f1b2e7b9a4d0012a10001/ready-for-delivery
Authorization: Bearer {{dashboardToken}}
```
