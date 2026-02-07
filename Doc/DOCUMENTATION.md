# BasicDiet145 – Backend System Documentation

## 1. Project Overview

**BasicDiet145** is a KSA-focused diet and meal management platform that supports subscription-based meal plans and one-time meal orders, with flexible delivery and pickup workflows.

The system is designed to handle real-world operational constraints such as daily cutoffs, kitchen preparation, courier delivery, and credit-based consumption.

**Technology Stack:**
- **Backend**: Node.js 20+, Express 4.x
- **Database**: MongoDB 7+ with Mongoose ODM
- **Authentication**: 
  - Client (Mobile): Firebase Phone OTP → JWT
  - Dashboard (Admin/Kitchen/Courier): Better Auth (Session/Cookie)
- **Payment**: Moyasar webhooks
- **Notifications**: Firebase Cloud Messaging (FCM)
- **Logging**: Winston
- **API Documentation**: Swagger/OpenAPI 3.0

**Timezone:** All date and time logic strictly follows **Asia/Riyadh** (KSA time).

---

## 2. Core Concept

The platform supports two main customer journeys:

### 2.1 Subscription-based Meals

- The user subscribes to a plan (e.g., 7 days × 3 meals/day)
- Each day represents a production and delivery unit
- Meals are selected, prepared, delivered, or picked up
- Credits are deducted based on fulfillment rules

### 2.2 One-time Orders (No Subscription)

- The user places a single order
- Can include meals, premium items, and custom salads
- Payment and fulfillment are independent of subscriptions

---

## 3. Target Market & Constraints

| Aspect | Details |
|--------|---------|
| **Market** | Kingdom of Saudi Arabia (KSA) |
| **Timezone** | Asia/Riyadh (mandatory) |
| **Operational Constraint** | Daily cutoff time after which tomorrow's orders are locked; future days (after tomorrow) remain editable |

---

## 4. System Roles

### 4.1 Client (Mobile App User)

- Authenticates using phone number OTP (Firebase)
- Subscribes to plans
- Selects daily meals
- Skips days
- Requests pickup or delivery
- Places one-time orders
- Receives notifications

### 4.2 Admin (Dashboard)

- Creates and manages plans
- Controls business rules (cutoff, skip allowance, prices)
- Views logs and system activity
- Manages dashboard users (kitchen / courier)

### 4.3 Kitchen Staff (Dashboard)

- Views daily production list
- Assigns meals when user doesn't select
- Marks orders as prepared / ready

### 4.4 Courier (Dashboard)

- Views assigned deliveries
- Marks deliveries as delivered or canceled

---

## 5. Authentication & Security

### Client Authentication

1. **Firebase Phone OTP** on mobile
2. Backend verifies Firebase ID token
3. Issues JWT for API access

**Key Endpoints:**
- `POST /api/auth/otp/request` - Request OTP
- `POST /api/auth/otp/verify` - Verify OTP and receive JWT
- `POST /api/auth/device-token` - Update FCM token

### Dashboard Authentication

1. **Better Auth** (email + password)
2. Session-based authentication using cookies
3. Access restricted via `DashboardUser` allowlist

**Endpoints:**
- All dashboard auth handled via Better Auth at `/api/dashboard-auth/*`

---

## 6. Subscription System

### 6.1 Plans

A **Plan** defines:
- Number of days
- Meals per day (fixed)
- Grams (nutritional reference)
- Price
- Skip allowance (how many skips are compensated)

Plans are created and managed by Admin.

**Model:** `Plan`
```javascript
{
  name: String,
  daysCount: Number,
  mealsPerDay: Number,
  grams: Number,
  price: Number,
  skipAllowance: Number,
  isActive: Boolean
}
```

### 6.2 Subscription Lifecycle

#### Checkout

- Subscription record created in `pending_payment` status
- Returns a payment URL

**Endpoint:** `POST /api/subscriptions/checkout`

#### Activation

- Subscription becomes `active`
- Daily entries (`SubscriptionDay`) are generated
- Validity dates are set

**Endpoint:** `POST /api/subscriptions/{id}/activate` (mock)

#### Daily Operations

Each day can be:
- **open** → available for editing
- **locked** → cutoff passed, immutable
- **in_preparation** → kitchen preparing
- **out_for_delivery** / **ready_for_pickup** → in transit or ready
- **fulfilled** → completed
- **skipped** → user or system skipped

---

## 7. SubscriptionDay (Daily Unit)

Each subscription day represents one real-world operational order.

**State Machine:**
```
open → locked → in_preparation → out_for_delivery|ready_for_pickup → fulfilled
  ↓
skipped
```

**Key Properties:**
- Selected meals
- Premium meals
- One-time add-ons
- Delivery overrides
- Locked snapshot (immutable)
- Fulfilled snapshot (immutable)

**Model:** `SubscriptionDay`
```javascript
{
  subscriptionId: ObjectId,
  date: Date,
  status: Enum,
  selections: [ObjectId],
  premiumSelections: [ObjectId],
  addonsOneTime: [ObjectId],
  customSalads: [Object],
  pickupRequested: Boolean,
  creditsDeducted: Boolean,
  lockedSnapshot: Object,
  fulfilledSnapshot: Object,
  deliveryAddressOverride: Object,
  deliveryWindowOverride: String
}
```

---

## 8. Daily Meal Selection

- User can select meals for any future day
- Only **tomorrow** is blocked after cutoff
- Total selections must equal plan `mealsPerDay`
- If user doesn't select: **kitchen auto-assigns meals at cutoff**

**Endpoint:** `PUT /api/subscriptions/{id}/days/{date}/selection`

**Business Rules:**
- Cannot edit if day status is `locked`, `in_preparation`, `out_for_delivery`, `ready_for_pickup`, or `fulfilled`
- Cannot edit tomorrow if after cutoff
- Must select exactly `plan.mealsPerDay` meals

---

## 9. Premium Meals

Premium meals consume **premium credits**.

- Credits can be topped up via payment
- Current enforcement is **soft**: selection allowed even if insufficient
- API flags `requiresPremiumTopup` when balance is low

**Endpoint:** `POST /api/subscriptions/{id}/premium/topup`

---

## 10. Add-ons

### Subscription Add-ons

- Fixed add-ons applied to all days
- Stored on the subscription

### One-time Add-ons

- Applied to a specific day
- Paid separately
- Stored on `SubscriptionDay`

**Endpoint:** `POST /api/subscriptions/{id}/addons/one-time`

**Model:** `Addon`
```javascript
{
  name: String,
  price: Number,
  type: Enum ['subscription', 'one_time'],
  isActive: Boolean
}
```

---

## 11. Custom Salad Builder

User can build a custom salad by choosing ingredients.

- Pricing is calculated server-side
- Ingredient limits and pricing enforced
- Supported for:
  - One-time orders (fully)
  - Subscription days (pricing exists; payment partially implemented)

**Endpoints:**
- `POST /api/custom-salads/price` - Preview price
- `POST /api/subscriptions/{id}/days/{date}/custom-salad` - Add to subscription day
- `POST /api/orders/{id}/items/custom-salad` - Add to order

**Model:** `SaladIngredient`
```javascript
{
  name_en: String,
  name_ar: String,
  price: Number,
  calories: Number,
  maxQuantity: Number,
  isActive: Boolean
}
```

---

## 12. Skip Logic

### Single Day Skip

- Deducts daily meal credits
- Changes day status to `skipped`

**Endpoint:** `POST /api/subscriptions/{id}/days/{date}/skip`

### Range Skip

- User can skip multiple days in one action
- Useful for travel scenarios

**Endpoint:** `POST /api/subscriptions/{id}/skip-range`

### Skip Allowance

- Defined per plan
- First N skips extend subscription validity
- Additional skips only deduct credits

**Business Rule:**
- If `skippedCount < plan.skipAllowance`, extend `validityEndDate` by 1 day
- Always deduct meal credits

---

## 13. Delivery & Pickup

### Delivery

- Delivery windows validated against system settings
- Courier marks:
  - **Delivered** → credits deducted, status = `fulfilled`
  - **Canceled** → treated as skip

**Endpoints:**
- `PUT /api/subscriptions/{id}/days/{date}/delivery` - Update delivery details for specific day
- `PUT /api/subscriptions/{id}/delivery` - Update global delivery settings
- `PUT /api/courier/deliveries/{id}/delivered` - Mark as delivered
- `PUT /api/courier/deliveries/{id}/cancel` - Cancel delivery

### Pickup

- User requests preparation
- Credits deducted **immediately**
- Kitchen prepares order
- User picks up

**Endpoint:** `POST /api/subscriptions/{id}/days/{date}/pickup/prepare`

**Business Rule:**
- Immediately transitions to `locked` status
- Deducts credits upfront

---

## 14. One-Time Orders (No Subscription)

User places a single order.

- Can include:
  - Meals
  - Premium items
  - Custom salads
- Payment is currently mocked
- Fulfillment flow is isolated from subscriptions

**Order State Machine:**
```
created → confirmed → preparing → out_for_delivery|ready_for_pickup → fulfilled|canceled
```

**Endpoints:**
- `POST /api/orders/checkout` - Create order
- `POST /api/orders/{id}/confirm` - Mock payment confirmation
- `GET /api/orders` - List orders
- `GET /api/orders/{id}` - Get order details

**Model:** `Order`
```javascript
{
  userId: ObjectId,
  status: Enum,
  deliveryMode: Enum ['delivery', 'pickup'],
  deliveryDate: Date,
  items: [Object],
  pricing: Object,
  deliveryAddress: Object,
  deliveryWindow: String,
  paymentStatus: Enum
}
```

---

## 15. Payments

### Payment Provider

**Moyasar** (webhook-based)

**Supported Payment Flows:**
- Premium top-ups
- One-time add-ons
- Partial support for subscription activation

**Payment Safety:**
- Idempotent webhook handling
- Duplicate events are ignored
- Applied payments are locked (via `applied` flag)

**Endpoint:** `POST /webhooks/moyasar`

**Model:** `Payment`
```javascript
{
  provider: 'moyasar',
  type: Enum,
  status: Enum,
  amount: Number,
  currency: String,
  userId: ObjectId,
  subscriptionId: ObjectId,
  orderId: ObjectId,
  applied: Boolean,
  metadata: Object
}
```

---

## 16. Automation Jobs

### Daily Cutoff Job

Runs every minute:
1. Checks if cutoff time has passed
2. Locks tomorrow's `open` days
3. Auto-assigns meals if user didn't select
4. Creates immutable `lockedSnapshot`
5. Optionally sends notification to user

**Manual Trigger:** `POST /api/admin/trigger-cutoff`

**File:** `src/jobs/index.js`

---

## 17. Notifications

- **Firebase Cloud Messaging (FCM)**
- Used for:
  - Cutoff lock warnings
  - Delivery updates
  - Pickup ready alerts
- All notifications logged in `NotificationLog`

**Model:** `NotificationLog`
```javascript
{
  userId: ObjectId,
  title: String,
  body: String,
  data: Object,
  sent: Boolean,
  error: String,
  createdAt: Date
}
```

---

## 18. Logging & Observability

### Activity Logging

`ActivityLog` records all important actions:
- Entity type (e.g., "SubscriptionDay", "Order")
- Entity ID
- Action (e.g., "skip", "lock", "fulfill")
- Role performing the action
- Metadata

**Endpoint:** `GET /api/admin/logs`

### Structured Logging

- **Winston** for structured logs
- Log levels: error, warn, info, debug

### Health Check

**Endpoint:** `GET /health`

Returns API and database connectivity status.

---

## 19. API Documentation

### OpenAPI / Swagger

Full API documentation available:
- **YAML File:** `swagger.yaml`
- **Endpoint:** `GET /api-docs`

### API Base Path

All API routes are under `/api`

### Main API Groups

| Group | Endpoints | Description |
|-------|-----------|-------------|
| **Auth** | `/auth/*` | OTP login, device tokens |
| **Plans** | `/plans/*` | List and view plans |
| **Subscriptions** | `/subscriptions/*` | Checkout, activation, meal selection, skips, premium, add-ons |
| **Orders** | `/orders/*` | One-time meal orders |
| **Custom Salads** | `/custom-salads/*`, `/salad-ingredients` | Salad builder |
| **Kitchen** | `/kitchen/*` | Daily production, state transitions |
| **Courier** | `/courier/*` | Deliveries, completion |
| **Admin** | `/admin/*` | Plans, settings, users, logs |
| **Webhooks** | `/webhooks/*` | Payment events |

---

## 20. Project Structure

```
basicdiet145/
├── src/
│   ├── app.js                    # Express app and middleware
│   ├── index.js                  # Server entry point and job startup
│   ├── db.js                     # MongoDB connection
│   ├── auth/
│   │   └── betterAuth.js         # Better Auth configuration
│   ├── config/
│   │   └── env.js                # Environment variables
│   ├── routes/
│   │   ├── index.js              # Route aggregator
│   │   ├── auth.js               # Auth routes
│   │   ├── plans.js              # Plan routes
│   │   ├── subscriptions.js      # Subscription routes
│   │   ├── orders.js             # Order routes
│   │   ├── customSalads.js       # Salad routes
│   │   ├── saladIngredients.js   # Ingredient routes
│   │   ├── kitchen.js            # Kitchen routes
│   │   ├── courier.js            # Courier routes
│   │   ├── admin.js              # Admin routes
│   │   └── webhooks.js           # Webhook routes
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── planController.js
│   │   ├── subscriptionController.js
│   │   ├── orderController.js
│   │   ├── customSaladController.js
│   │   ├── saladIngredientController.js
│   │   ├── kitchenController.js
│   │   ├── courierController.js
│   │   ├── orderKitchenController.js
│   │   ├── orderCourierController.js
│   │   ├── adminController.js
│   │   ├── settingsController.js
│   │   └── webhookController.js
│   ├── models/
│   │   ├── User.js
│   │   ├── DashboardUser.js
│   │   ├── Plan.js
│   │   ├── Subscription.js
│   │   ├── SubscriptionDay.js
│   │   ├── Meal.js
│   │   ├── Addon.js
│   │   ├── Order.js
│   │   ├── SaladIngredient.js
│   │   ├── Payment.js
│   │   ├── Delivery.js
│   │   ├── Setting.js
│   │   ├── ActivityLog.js
│   │   └── NotificationLog.js
│   ├── services/
│   │   ├── automationService.js   # Cutoff automation
│   │   ├── customSaladService.js  # Salad pricing
│   │   ├── fulfillmentService.js  # Credit deduction
│   │   ├── moyasarService.js      # Payment integration
│   │   └── subscriptionService.js # Subscription logic
│   ├── jobs/
│   │   └── index.js               # Daily cutoff job
│   ├── middleware/
│   │   ├── auth.js                # JWT authentication
│   │   ├── dashboardAuth.js       # Dashboard auth
│   │   └── rateLimit.js           # Rate limiting
│   └── utils/
│       ├── logger.js              # Winston logger
│       ├── date.js                # KSA timezone helpers
│       ├── notification.js        # FCM notifications
│       └── ...                    # Other utilities
├── swagger.yaml                   # OpenAPI 3.0 spec
├── .env                           # Environment variables
├── .env.example                   # Environment template
├── package.json                   # Dependencies
├── Dockerfile                     # Docker image
├── docker-compose.yml             # Local development
└── DOCUMENTATION.md               # This file
```

---

## 21. User Story (End-to-End)

> As a client in Saudi Arabia, I open the app and sign in using my phone number and OTP.
> 
> I choose a meal subscription that fits my schedule and pay through Moyasar.
> 
> Each day, before the cutoff time, I select my meals or skip the day if needed.
> 
> If I forget, the system locks the day and assigns meals automatically.
> 
> My meals are delivered within my chosen time window, or I pick them up when ready.
> 
> Credits are deducted fairly, and I can upgrade to premium meals anytime by topping up.
> 
> If I just want one meal without subscribing, I place a one-time order and receive it directly.

---

## 22. Local Development

### Prerequisites

- **Node.js** 20+
- **MongoDB** 7+ or compatible

### Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create `.env` from `.env.example`:**
   ```bash
   cp .env.example .env
   ```

3. **Update `.env` with your values**

4. **Start the server:**
   ```bash
   npm start
   ```

### Docker

Build and run with Docker Compose:

```bash
docker-compose up --build
```

The API will be exposed on port `3000`.

---

## 23. Environment Variables

See `.env.example` for the full list. Key values include:

| Variable | Description |
|----------|-------------|
| `PORT` | API port (default: 3000) |
| `MONGO_URI` | MongoDB connection string |
| `MONGO_DB` | Database name |
| `APP_TIMEZONE` | Timezone (default: `Asia/Riyadh`) |
| `JWT_SECRET` | JWT signing secret |
| `FIREBASE_PROJECT_ID` | Firebase Admin credentials |
| `FIREBASE_CLIENT_EMAIL` | Firebase Admin credentials |
| `FIREBASE_PRIVATE_KEY` | Firebase Admin credentials |
| `MOYASAR_SECRET_KEY` | Payment integration |
| `MOYASAR_WEBHOOK_SECRET` | Payment webhook validation |
| `CORS_ORIGINS` | Allowed origins for CORS |
| `OTP_RATE_LIMIT_*` | Rate limit settings for OTP |
| `CHECKOUT_RATE_LIMIT_*` | Rate limit settings for checkout |
| `LOG_LEVEL` | Logging level (default: info) |

---

## 24. Security Best Practices

- **JWT** for client API access
- **Session/Cookie** for dashboard access via Better Auth
- **Helmet** for security headers
- **CORS** configured with allowed origins
- **Rate limiting** on OTP and checkout endpoints
- **Structured logging** via Winston
- **Health check** endpoint at `GET /health`

---

## 25. Current Limitations & Notes

⚠️ **Important Gaps:**

1. **Subscription checkout payment is mocked** - Real Moyasar integration incomplete
2. **One-time order payment confirmation is mocked**
3. **Add-on catalog management not exposed via API** - Admin cannot CRUD addons
4. **Meal CRUD endpoints missing** - Admin cannot create/update/delete meals
5. **No automated tests** in this repository
6. **Production readiness requires payment hardening**

---

## 26. Deployment Considerations

### Production Checklist

- [ ] Configure real Moyasar credentials
- [ ] Set strong `JWT_SECRET`
- [ ] Configure Firebase Admin SDK with production credentials
- [ ] Enable CORS only for production domains
- [ ] Set up MongoDB replication for high availability
- [ ] Configure logging to external service (e.g., CloudWatch, Datadog)
- [ ] Set up monitoring and alerting
- [ ] Enable HTTPS/TLS
- [ ] Configure rate limits appropriately
- [ ] Run security audit
- [ ] Test payment webhooks in production
- [ ] Set up backup and disaster recovery

### Scalability Considerations

- Use MongoDB indexes on frequently queried fields
- Consider Redis for session storage (Better Auth)
- Implement caching for frequently accessed data (plans, settings)
- Use message queues for async operations (notifications)
- Consider CDN for static assets
- Implement database connection pooling

---

## 27. Testing Strategy

### Manual Testing

Use the Swagger UI at `/api-docs` for exploratory testing.

### Postman/Thunder Client

Import the OpenAPI spec for automated API testing.

### Recommended Test Coverage

- [ ] Authentication flows (OTP, JWT)
- [ ] Subscription checkout and activation
- [ ] Meal selection and validation
- [ ] Skip logic and credit deduction
- [ ] Premium top-up flow
- [ ] One-time order flow
- [ ] Custom salad pricing
- [ ] Delivery and pickup workflows
- [ ] Kitchen and courier state transitions
- [ ] Payment webhook handling
- [ ] Daily cutoff automation

---

## 28. Conclusion

**BasicDiet145** is a production-grade backend architecture with strong business logic foundations.

With a small number of remaining decisions and integrations (primarily around payment flows and admin meal management), it is well-positioned for real-world deployment in the KSA market.

---

## 29. Contact & Support

For questions or contributions, please contact the development team.

**API Docs:** `GET /api-docs`  
**Health Check:** `GET /health`  
**Version:** 0.1.0
