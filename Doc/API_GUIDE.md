# BasicDiet145 – API Integration Guide

This guide helps frontend developers and third-party integrators understand how to work with the BasicDiet145 API.

---

## Base URL

```
http://localhost:3000/api
```

In production, replace with your deployed URL: `https://api.yourdomain.com/api`

---

## Authentication

### Client (Mobile) Authentication

BasicDiet145 uses **Firebase Phone OTP** for mobile authentication, then issues a **JWT** for subsequent API calls.

#### Step 1: Request OTP

```http
POST /api/auth/otp/request
Content-Type: application/json

{
  "phone": "+966501234567"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "OTP sent"
}
```

> **Note:** OTP is sent via Firebase Auth SMS. You must configure Firebase in your mobile app to receive and verify OTP.

#### Step 2: Verify OTP and Get JWT

After user enters OTP in your app, use Firebase SDK to get an `idToken`:

```javascript
// React Native / Flutter
const credential = firebase.auth.PhoneAuthProvider.credential(verificationId, code);
const userCredential = await firebase.auth().signInWithCredential(credential);
const idToken = await userCredential.user.getIdToken();
```

Then exchange it for a JWT:

```http
POST /api/auth/otp/verify
Content-Type: application/json

{
  "idToken": "FIREBASE_ID_TOKEN_HERE"
}
```

**Response:**
```json
{
  "ok": true,
  "token": "JWT_TOKEN_HERE",
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "phone": "+966501234567",
    "name": "Ahmed",
    "role": "client",
    "isActive": true
  }
}
```

#### Step 3: Use JWT for All Subsequent Requests

```http
GET /api/subscriptions/{id}
Authorization: Bearer JWT_TOKEN_HERE
```

### Dashboard Authentication

Dashboard users (admin, kitchen, courier) use **Better Auth** with session cookies.

**Sign In:**

```http
POST /api/dashboard-auth/sign-in
Content-Type: application/json

{
  "email": "admin@example.com",
  "password": "secure_password"
}
```

Better Auth returns a session cookie automatically. All subsequent dashboard requests include this cookie.

---

## Common Response Format

All API responses follow this structure:

### Success Response

```json
{
  "ok": true,
  "data": { /* Resource data */ }
}
```

### Error Response

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message"
  }
}
```

**Common Error Codes:**
- `UNAUTHORIZED` - Missing or invalid token
- `FORBIDDEN` - Insufficient permissions
- `VALIDATION_ERROR` - Invalid request data
- `NOT_FOUND` - Resource not found
- `CUTOFF_PASSED` - Action blocked by cutoff time
- `INSUFFICIENT_CREDITS` - Not enough meal/premium credits
- `INTERNAL` - Server error

---

## Core Workflows

### 1. Browse and Subscribe to a Plan

#### List Active Plans

```http
GET /api/plans
Authorization: Bearer {JWT}
```

**Response:**
```json
{
  "ok": true,
  "data": [
    {
      "_id": "60d5ec49f1b2c8b1f8c4e8a1",
      "name": "7-Day Balanced Plan",
      "daysCount": 7,
      "mealsPerDay": 3,
      "grams": 400,
      "price": 350,
      "skipAllowance": 2,
      "isActive": true
    }
  ]
}
```

#### Preview Subscription Price

```http
POST /api/subscriptions/preview
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "planId": "60d5ec49f1b2c8b1f8c4e8a1",
  "premiumCount": 5,
  "addons": [
    { "addonId": "60d5ec49f1b2c8b1f8c4e8a2" }
  ]
}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "total": 450,
    "breakdown": {
      "planPrice": 350,
      "premiumPrice": 50,
      "addonsPrice": 50
    }
  }
}
```

#### Checkout Subscription

```http
POST /api/subscriptions/checkout
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "planId": "60d5ec49f1b2c8b1f8c4e8a1",
  "premiumCount": 5,
  "addons": [
    { "addonId": "60d5ec49f1b2c8b1f8c4e8a2" }
  ],
  "deliveryMode": "delivery",
  "deliveryAddress": {
    "line1": "123 King Fahd Road",
    "city": "Riyadh",
    "notes": "Building B, Apt 5"
  },
  "deliveryWindow": "12:00-14:00",
  "startDate": "2026-02-10"
}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "payment_url": "https://moyasar.com/pay/xyz123",
    "subscriptionId": "60d5ec49f1b2c8b1f8c4e8a3",
    "total": 450
  }
}
```

> **Action:** Redirect user to `payment_url` to complete payment via Moyasar.

#### Activate Subscription (Mock - for testing only)

```http
POST /api/subscriptions/{subscriptionId}/activate
Authorization: Bearer {JWT}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "_id": "60d5ec49f1b2c8b1f8c4e8a3",
    "status": "active",
    "startDate": "2026-02-10",
    "endDate": "2026-02-17",
    "totalMeals": 21,
    "remainingMeals": 21
  }
}
```

---

### 2. View Subscription Days

```http
GET /api/subscriptions/{subscriptionId}/days
Authorization: Bearer {JWT}
```

**Response:**
```json
{
  "ok": true,
  "data": [
    {
      "_id": "60d5ec49f1b2c8b1f8c4e8a4",
      "subscriptionId": "60d5ec49f1b2c8b1f8c4e8a3",
      "date": "2026-02-10",
      "status": "open",
      "selections": [],
      "premiumSelections": [],
      "creditsDeducted": false
    },
    {
      "_id": "60d5ec49f1b2c8b1f8c4e8a5",
      "subscriptionId": "60d5ec49f1b2c8b1f8c4e8a3",
      "date": "2026-02-11",
      "status": "open",
      "selections": [],
      "premiumSelections": [],
      "creditsDeducted": false
    }
  ]
}
```

---

### 3. Select Meals for a Specific Day

```http
PUT /api/subscriptions/{subscriptionId}/days/{date}/selection
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "selections": [
    "60d5ec49f1b2c8b1f8c4e8a6",
    "60d5ec49f1b2c8b1f8c4e8a7",
    "60d5ec49f1b2c8b1f8c4e8a8"
  ],
  "premiumSelections": [
    "60d5ec49f1b2c8b1f8c4e8a9"
  ]
}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "_id": "60d5ec49f1b2c8b1f8c4e8a4",
    "date": "2026-02-10",
    "status": "open",
    "selections": ["60d5ec49f1b2c8b1f8c4e8a6", "60d5ec49f1b2c8b1f8c4e8a7", "60d5ec49f1b2c8b1f8c4e8a8"],
    "premiumSelections": ["60d5ec49f1b2c8b1f8c4e8a9"]
  },
  "requiresPremiumTopup": false
}
```

**Business Rules:**
- Total `selections.length` must equal `plan.mealsPerDay`
- Cannot edit if day is `locked`, `in_preparation`, `out_for_delivery`, `ready_for_pickup`, or `fulfilled`
- Cannot edit tomorrow if current time is after cutoff

---

### 4. Skip a Day

```http
POST /api/subscriptions/{subscriptionId}/days/{date}/skip
Authorization: Bearer {JWT}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "_id": "60d5ec49f1b2c8b1f8c4e8a4",
    "date": "2026-02-10",
    "status": "skipped",
    "creditsDeducted": true
  }
}
```

**Notes:**
- Skipping deducts meal credits immediately
- If within skip allowance, validity is extended by 1 day

---

### 5. Skip Multiple Days (Range)

```http
POST /api/subscriptions/{subscriptionId}/skip-range
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "startDate": "2026-02-15",
  "days": 3
}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "skippedDates": ["2026-02-15", "2026-02-16", "2026-02-17"],
    "rejected": []
  }
}
```

---

### 6. Top-Up Premium Credits

```http
POST /api/subscriptions/{subscriptionId}/premium/topup
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "count": 5,
  "successUrl": "https://yourapp.com/success",
  "backUrl": "https://yourapp.com/cancel"
}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "payment_url": "https://moyasar.com/pay/abc456"
  }
}
```

> **Action:** Redirect user to `payment_url`.

---

### 7. Request Pickup Preparation

```http
POST /api/subscriptions/{subscriptionId}/days/{date}/pickup/prepare
Authorization: Bearer {JWT}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "status": "locked",
    "creditsDeducted": true,
    "pickupRequested": true
  }
}
```

**Notes:**
- Immediately locks the day and deducts credits
- Use this when user confirms they will pick up tomorrow

---

### 8. Place a One-Time Order

```http
POST /api/orders/checkout
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "meals": [
    { "mealId": "60d5ec49f1b2c8b1f8c4e8a6", "quantity": 2 },
    { "mealId": "60d5ec49f1b2c8b1f8c4e8a7", "quantity": 1 }
  ],
  "customSalads": [
    {
      "ingredients": [
        { "ingredientId": "60d5ec49f1b2c8b1f8c4e8b1", "quantity": 1 },
        { "ingredientId": "60d5ec49f1b2c8b1f8c4e8b2", "quantity": 2 }
      ]
    }
  ],
  "deliveryMode": "delivery",
  "deliveryDate": "2026-02-12",
  "deliveryAddress": {
    "line1": "456 Al Olaya Street",
    "city": "Riyadh"
  }
}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "payment_url": "https://moyasar.com/pay/def789",
    "orderId": "60d5ec49f1b2c8b1f8c4e8b3"
  }
}
```

---

### 9. Build a Custom Salad (Price Preview)

```http
POST /api/custom-salads/price
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "ingredients": [
    { "ingredientId": "60d5ec49f1b2c8b1f8c4e8b1", "quantity": 2 },
    { "ingredientId": "60d5ec49f1b2c8b1f8c4e8b2", "quantity": 1 }
  ]
}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "ingredientId": "60d5ec49f1b2c8b1f8c4e8b1",
        "name_en": "Lettuce",
        "name_ar": "خس",
        "unitPriceSar": 5,
        "quantity": 2,
        "calories": 10
      },
      {
        "ingredientId": "60d5ec49f1b2c8b1f8c4e8b2",
        "name_en": "Chicken",
        "name_ar": "دجاج",
        "unitPriceSar": 15,
        "quantity": 1,
        "calories": 120
      }
    ],
    "totalPriceSar": 25
  }
}
```

---

## Updating Delivery Details

### Update Global Delivery Settings

```http
PUT /api/subscriptions/{subscriptionId}/delivery
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "deliveryAddress": {
    "line1": "New Address",
    "city": "Jeddah"
  },
  "deliveryWindow": "18:00-20:00"
}
```

### Override Delivery for a Specific Day

```http
PUT /api/subscriptions/{subscriptionId}/days/{date}/delivery
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "deliveryAddressOverride": {
    "line1": "Temporary Address",
    "city": "Riyadh"
  },
  "deliveryWindowOverride": "10:00-12:00"
}
```

---

## Dashboard API (Kitchen & Courier)

### Kitchen: View Daily Production List

```http
GET /api/kitchen/days/{date}
Cookie: session={SESSION_COOKIE}
```

**Response:**
```json
{
  "ok": true,
  "data": [
    {
      "subscriptionDayId": "60d5ec49f1b2c8b1f8c4e8a4",
      "userId": "507f1f77bcf86cd799439011",
      "userName": "Ahmed",
      "date": "2026-02-10",
      "status": "locked",
      "selections": [/* meal objects */],
      "deliveryMode": "delivery"
    }
  ]
}
```

### Kitchen: Mark Day as In Preparation

```http
POST /api/kitchen/subscriptions/{subscriptionId}/days/{date}/in-preparation
Cookie: session={SESSION_COOKIE}
```

### Courier: View Today's Deliveries

```http
GET /api/courier/deliveries/today
Cookie: session={SESSION_COOKIE}
```

### Courier: Mark Delivery as Delivered

```http
PUT /api/courier/deliveries/{deliveryId}/delivered
Cookie: session={SESSION_COOKIE}
```

---

## Webhooks

### Moyasar Payment Webhook

BasicDiet145 listens for payment events from Moyasar:

```http
POST /webhooks/moyasar
Content-Type: application/json
X-Moyasar-Signature: {HMAC_SIGNATURE}

{
  "id": "moyasar_payment_id",
  "status": "paid",
  "amount": 45000,
  "currency": "SAR",
  "metadata": {
    "paymentId": "60d5ec49f1b2c8b1f8c4e8c1"
  }
}
```

**Notes:**
- Webhook is verified using `MOYASAR_WEBHOOK_SECRET`
- Payment records are marked as `paid` and `applied`
- Credits are added to subscription or order is confirmed

---

## Error Handling Best Practices

### Check `ok` Field

```javascript
const response = await fetch('/api/subscriptions/123', {
  headers: { Authorization: `Bearer ${token}` }
});
const json = await response.json();

if (!json.ok) {
  // Handle error
  console.error(json.error.message);
  if (json.error.code === 'UNAUTHORIZED') {
    // Redirect to login
  }
}
```

### Handle Network Errors

```javascript
try {
  const response = await fetch('/api/subscriptions/123');
  if (!response.ok) throw new Error('Network error');
  const json = await response.json();
  // Process data
} catch (error) {
  console.error('API call failed:', error);
}
```

---

## Rate Limiting

The following endpoints have rate limits:

| Endpoint | Limit |
|----------|-------|
| `POST /api/auth/otp/request` | 5 requests per 15 minutes per IP |
| `POST /api/subscriptions/checkout` | 10 requests per hour per IP |
| `POST /api/orders/checkout` | 10 requests per hour per IP |

**Rate Limit Headers:**
```
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 4
X-RateLimit-Reset: 1644567890
```

**429 Response:**
```json
{
  "ok": false,
  "error": {
    "code": "RATE_LIMIT",
    "message": "Too many requests. Please try again later."
  }
}
```

---

## Testing with Swagger UI

Visit **http://localhost:3000/api-docs** to explore the full API interactively.

---

## Example: Full Mobile App Flow

```javascript
// 1. Request OTP
await fetch('/api/auth/otp/request', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: '+966501234567' })
});

// 2. Verify OTP (after Firebase)
const { token } = await fetch('/api/auth/otp/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ idToken: firebaseToken })
}).then(r => r.json());

// 3. Get Plans
const plans = await fetch('/api/plans', {
  headers: { Authorization: `Bearer ${token}` }
}).then(r => r.json());

// 4. Checkout
const checkout = await fetch('/api/subscriptions/checkout', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    planId: plans.data[0]._id,
    deliveryMode: 'delivery',
    deliveryAddress: { /* ... */ },
    startDate: '2026-02-10'
  })
}).then(r => r.json());

// 5. Redirect to payment
window.location.href = checkout.data.payment_url;

// 6. After payment, view subscription
const subscription = await fetch(`/api/subscriptions/${checkout.data.subscriptionId}`, {
  headers: { Authorization: `Bearer ${token}` }
}).then(r => r.json());
```

---

## Support

- **Swagger Docs:** http://localhost:3000/api-docs
- **Health Check:** http://localhost:3000/health
- **Main Documentation:** See `DOCUMENTATION.md`
- **Architecture Diagrams:** See `ARCHITECTURE.md`

---

This guide should enable you to integrate with BasicDiet145 effectively. For questions, refer to the OpenAPI spec or contact the development team.
