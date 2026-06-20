# Screen Contract: 12_DELIVERY

Verified against `src/routes/courier.js`, `src/controllers/courierController.js`, `src/controllers/orderCourierController.js`, `src/mappers/deliveryMapper.js`, and the courier contract tests on 2026-06-20.

## 1. Screen Purpose
Provides delivery drivers (couriers) and operations managers with views of delivery schedules, shipping addresses, active delivery assignments, and fulfillment triggers (arriving, delivered, or canceled).

## 2. Dashboard Route
`/delivery`

## 3. Visible UI Requirements
* **Schedule Queue**: List of today's deliveries grouped by Delivery Window (e.g. `08:00 - 11:00`) and Zone.
* **Map/Navigation Links**: Direct navigation using address coordinates (`latitude`/`longitude`) or structured street fields.
* **Courier Actions**: Action buttons rendered dynamically based on status flags (`canCourierPickup`, `canMarkArrivingSoon`, `canMarkDelivered`, `canCancel`).

---

## Backend Endpoints

## GET /api/courier/deliveries/today

### Purpose
Lists subscription delivery days scheduled for today (filtered to `deliveryMode === "delivery"` only).

### Used By
Courier's daily subscription delivery queue screen.

### Auth
Requires `Authorization: Bearer {{dashboardToken}}`.
Allowed roles: `courier`, `admin`.

### Path Params
None.

### Query Params
None.

### Request Body
No request body.

### Success Response
```json
{
  "status": true,
  "data": [
    {
      "id": "665f1b2e7b9a4d0012c10001",
      "type": "subscription_delivery",
      "customerName": "Client One",
      "customerPhone": "+966500000001",
      "deliveryAddress": {
        "label": "Home",
        "city": "Riyadh",
        "district": "Al Yasmin",
        "street": "Olaya St",
        "building": "12",
        "floor": "2",
        "apartment": "4",
        "notes": "Near masjid",
        "latitude": 24.7136,
        "longitude": 46.6753,
        "formattedAddress": "Home, Al Yasmin, Olaya St, Bldg 12, Floor 2, Apt 4, Riyadh"
      },
      "deliveryZone": "Al Yasmin Zone",
      "deliveryWindow": "08:00-11:00",
      "status": "ready_for_delivery",
      "preparationStatus": "ready_for_delivery",
      "scheduledDate": "2026-06-20",
      "orderNumber": null,
      "subscriptionId": "665f1b2e7b9a4d0012a10000",
      "subscriptionDayId": "665f1b2e7b9a4d0012a10001",
      "mealCount": 2,
      "addonCount": 1,
      "premiumUpgradeCount": 0,
      "canCourierPickup": true,
      "canMarkArrivingSoon": false,
      "canMarkDelivered": false,
      "canCancel": true
    }
  ]
}
```

### Error Response
```json
{
  "status": false,
  "code": "FORBIDDEN",
  "message": "Dashboard courier permission is required"
}
```

### Frontend Notes
* **Filtering**: The backend automatically filters out branch pickup day subscriptions (`deliveryMode === "pickup"`).
* **Fulfillment State**: Driver should check status flags like `canCourierPickup` before attempting collection.

### Read-only and Editable Fields
* All fields in the response are read-only.

### Validation
* Only retrieves deliveries scheduled for the current KSA calendar date.

### Important Do/Don't
* **Do** display the `formattedAddress` if available, or fall back to structured fields.
* **Do Not** show the pickup button if `canCourierPickup` is `false`.

### Postman
```http
GET {{baseUrl}}/api/courier/deliveries/today
Authorization: Bearer {{dashboardToken}}
```

---

## GET /api/courier/orders/today

### Purpose
Lists one-time order deliveries scheduled for today.

### Used By
Courier's daily one-time order queue screen.

### Auth
Requires `Authorization: Bearer {{dashboardToken}}`.
Allowed roles: `courier`, `admin`.

### Path Params
None.

### Query Params
None.

### Request Body
No request body.

### Success Response
```json
{
  "status": true,
  "data": [
    {
      "id": "665f1b2e7b9a4d0012b20005",
      "type": "one_time_order",
      "customerName": "Client Two",
      "customerPhone": "+966500000002",
      "deliveryAddress": {
        "label": "Work",
        "city": "Riyadh",
        "district": "Sulaimaniyah",
        "street": "King Abdulaziz Rd",
        "building": null,
        "floor": null,
        "apartment": null,
        "notes": null,
        "latitude": null,
        "longitude": null,
        "formattedAddress": "Work, Sulaimaniyah, King Abdulaziz Rd, Riyadh"
      },
      "deliveryZone": "Sulaimaniyah Zone",
      "deliveryWindow": "12:00-15:00",
      "status": "ready_for_delivery",
      "preparationStatus": "confirmed",
      "scheduledDate": "2026-06-20",
      "orderNumber": "ORD-12345",
      "subscriptionId": null,
      "subscriptionDayId": null,
      "mealCount": 1,
      "addonCount": 0,
      "premiumUpgradeCount": 0,
      "canCourierPickup": true,
      "canMarkArrivingSoon": false,
      "canMarkDelivered": false,
      "canCancel": true
    }
  ]
}
```

### Error Response
```json
{
  "status": false,
  "code": "INTERNAL",
  "message": "Failed to list orders"
}
```

### Frontend Notes
* Return structure matches the unified courier DTO schema.
* Integrates with moyasar payment verification (only lists paid one-time orders).

### Validation
* Only lists orders with `paymentStatus = "paid"`.

### Postman
```http
GET {{baseUrl}}/api/courier/orders/today
Authorization: Bearer {{dashboardToken}}
```

---

## PUT /api/courier/deliveries/:id/pickup

### Purpose
Transitions a subscription delivery from `ready_for_delivery` to `out_for_delivery` (package collected by driver). Supports `/collect` as a canonical alias endpoint.

### Used By
Courier "Collect/Pickup" button on subscription queue items.

### Auth
Requires `Authorization: Bearer {{dashboardToken}}`.
Allowed roles: `courier`, `admin`.

### Path Params
| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | The Delivery record ObjectId. |

### Query Params
None.

### Request Body
No request body.

### Success Response
```json
{
  "status": true,
  "data": {
    "id": "665f1b2e7b9a4d0012c10001",
    "status": "out_for_delivery",
    "canCourierPickup": false,
    "canMarkArrivingSoon": true,
    "canMarkDelivered": true,
    "canCancel": true
  }
}
```

### Error Response
* **Invalid State Transition**: Returned if attempting to pick up a delivery not in `ready_for_delivery`.
```json
{
  "status": false,
  "code": "INVALID_TRANSITION",
  "message": "Invalid state transition"
}
```

### Frontend Notes
* **Idempotency**: If the delivery is already `out_for_delivery`, returns 200 OK with the current status (idempotent success).
* Call `/api/courier/deliveries/:id/collect` as the preferred endpoint to avoid namespace conflicts.

### Validation
* `id` must be a valid ObjectId.
* Underlying status must be `ready_for_delivery` (unless already in target state `out_for_delivery`).

### Postman
```http
PUT {{baseUrl}}/api/courier/deliveries/{{deliveryId}}/collect
Authorization: Bearer {{dashboardToken}}
```

---

## PUT /api/courier/deliveries/:id/arriving-soon

### Purpose
Sends an "Arriving Soon" SMS/push notification to the customer.

### Used By
Courier "Arriving Soon" button when approaching customer address.

### Auth
Requires `Authorization: Bearer {{dashboardToken}}`.
Allowed roles: `courier`, `admin`.

### Path Params
| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | The Delivery record ObjectId. |

### Query Params
None.

### Request Body
No request body.

### Success Response
```json
{
  "status": true,
  "data": {
    "id": "665f1b2e7b9a4d0012c10001",
    "status": "arriving_soon",
    "canMarkArrivingSoon": false,
    "canMarkDelivered": true,
    "canCancel": true
  }
}
```

### Error Response
```json
{
  "status": false,
  "code": "INVALID_TRANSITION",
  "message": "Invalid state transition"
}
```

### Frontend Notes
* Transition is only allowed when status is `out_for_delivery`.
* Idempotent: If reminder is already sent, succeeds returns current status without re-sending the message.

### Postman
```http
PUT {{baseUrl}}/api/courier/deliveries/{{deliveryId}}/arriving-soon
Authorization: Bearer {{dashboardToken}}
```

---

## PUT /api/courier/deliveries/:id/delivered

### Purpose
Marks the subscription delivery as delivered, completing the subscription day fulfillment.

### Used By
Courier "Delivered" button.

### Auth
Requires `Authorization: Bearer {{dashboardToken}}`.
Allowed roles: `courier`, `admin`.

### Path Params
| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | The Delivery record ObjectId. |

### Query Params
None.

### Request Body
No request body.

### Success Response
```json
{
  "status": true,
  "data": {
    "id": "665f1b2e7b9a4d0012c10001",
    "status": "delivered",
    "canCourierPickup": false,
    "canMarkArrivingSoon": false,
    "canMarkDelivered": false,
    "canCancel": false
  }
}
```

### Error Response
```json
{
  "status": false,
  "code": "INVALID_TRANSITION",
  "message": "Invalid state transition"
}
```

### Frontend Notes
* Transitions Delivery status to `delivered` and SubscriptionDay status to `fulfilled`.
* Triggers client-side notifications and deducts appropriate subscription day balance.

### Postman
```http
PUT {{baseUrl}}/api/courier/deliveries/{{deliveryId}}/delivered
Authorization: Bearer {{dashboardToken}}
```

---

## PUT /api/courier/deliveries/:id/cancel

### Purpose
Marks the delivery as failed or canceled (e.g. customer unavailable, wrong address).

### Used By
Courier "Cancel/Failed" button.

### Auth
Requires `Authorization: Bearer {{dashboardToken}}`.
Allowed roles: `courier`, `admin`.

### Path Params
| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | The Delivery record ObjectId. |

### Query Params
None.

### Request Body
Required:
* `reason` (string): Predefined cancellation reason code.
* `note` (string, optional): Extra courier description.

```json
{
  "reason": "customer_unreachable",
  "note": "Called 3 times, no answer at building gate."
}
```

### Success Response
```json
{
  "status": true,
  "data": {
    "id": "665f1b2e7b9a4d0012c10001",
    "status": "canceled",
    "canCourierPickup": false,
    "canMarkArrivingSoon": false,
    "canMarkDelivered": false,
    "canCancel": false
  }
}
```

### Error Response
```json
{
  "status": false,
  "code": "VALIDATION_ERROR",
  "message": "Cancellation reason is required"
}
```

### Frontend Notes
* Supported reasons: `customer_unreachable`, `wrong_address`, `client_refused`, `delivery_accident`, `other`.

### Postman
```http
PUT {{baseUrl}}/api/courier/deliveries/{{deliveryId}}/cancel
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{
  "reason": "customer_unreachable",
  "note": "Client unreachable"
}
```

---

## PUT /api/courier/orders/:id/arriving-soon

### Purpose
Sends an "Arriving Soon" SMS/push notification for a one-time order.

### Used By
Courier "Arriving Soon" button when approaching customer address for a one-time order.

### Auth
Requires `Authorization: Bearer {{dashboardToken}}`.
Allowed roles: `courier`, `admin`.

### Path Params
| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | The Order ObjectId. |

### Query Params
None.

### Request Body
No request body.

### Success Response
```json
{
  "status": true,
  "data": {
    "id": "665f1b2e7b9a4d0012b20005",
    "status": "arriving_soon"
  }
}
```

### Postman
```http
PUT {{baseUrl}}/api/courier/orders/{{orderId}}/arriving-soon
Authorization: Bearer {{dashboardToken}}
```

---

## PUT /api/courier/orders/:id/delivered

### Purpose
Marks the one-time order as delivered and transitions its status to `fulfilled`.

### Used By
Courier "Delivered" button for a one-time order.

### Auth
Requires `Authorization: Bearer {{dashboardToken}}`.
Allowed roles: `courier`, `admin`.

### Path Params
| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | The Order ObjectId. |

### Query Params
None.

### Request Body
No request body.

### Success Response
```json
{
  "status": true,
  "data": {
    "id": "665f1b2e7b9a4d0012b20005",
    "status": "delivered"
  }
}
```

### Postman
```http
PUT {{baseUrl}}/api/courier/orders/{{orderId}}/delivered
Authorization: Bearer {{dashboardToken}}
```

---

## PUT /api/courier/orders/:id/cancel

### Purpose
Marks the one-time order delivery as failed or canceled.

### Used By
Courier "Cancel/Failed" button for a one-time order.

### Auth
Requires `Authorization: Bearer {{dashboardToken}}`.
Allowed roles: `courier`, `admin`.

### Path Params
| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | The Order ObjectId. |

### Query Params
None.

### Request Body
Required:
* `reason` (string): Predefined cancellation reason code.
* `note` (string, optional): Extra courier description.

```json
{
  "reason": "customer_unreachable",
  "note": "Called twice, phone off."
}
```

### Success Response
```json
{
  "status": true,
  "data": {
    "id": "665f1b2e7b9a4d0012b20005",
    "status": "canceled"
  }
}
```

### Postman
```http
PUT {{baseUrl}}/api/courier/orders/{{orderId}}/cancel
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{
  "reason": "customer_unreachable"
}
```
