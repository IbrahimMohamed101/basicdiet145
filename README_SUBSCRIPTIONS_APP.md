# Application Subscription API Guide

This is the **complete implementation guide** for front-end and mobile engineers building the canonical subscription experience. It covers every user-facing flow, the exact sequence of API calls required, and the mental model of the underlying canonical system.

All endpoints here are mounted firmly at `/api/subscriptions`. 

---

## 1. 🧠 Mental Model of the System

To build a flawless front-end, you must first understand how the backend reasons about the data. Do not treat these APIs as simple CRUD wrappers; they enforce a rigid, predictable daily delivery lifecycle.

- **What is a Subscription?** 
  A `Subscription` is a long-lived contract. When a user buys a plan, a canonical `contractSnapshot` is frozen in time containing their exact pricing, delivery fees, taxes, and allowed meals per day. This snapshot is bulletproof; if the business changes a plan’s price tomorrow, active subscriptions remain untouched.
- **What is a SubscriptionDay?**
  A subscription is physically realized as a series of `SubscriptionDay` documents on a calendar. Every day you see in the timeline maps to an individual physical delivery box (or pickup). The app modifies *these days*, not the subscription itself.
- **What is a `lockedSnapshot`?**
  A feature of a `SubscriptionDay`. Once a day crosses the operational cutoff (usually midnight), the system clones the parent `contractSnapshot` and permanently bakes it into the day as the `lockedSnapshot`. At that point, the day is immutable and goes to the kitchen.
- **What is Draft vs Confirmed?**
  A day begins with `planningState: "draft"`. As the user makes meal selections, they are saved as a "draft". The kitchen *will not see them*. Only when the user explicitly triggers `/confirm` (and meets their quota without unpaid overages), the state flips to `planningState: "confirmed"`.
- **What is the Premium Wallet?**
  Users can buy "Premium Meals" upfront during checkout (e.g., 5 premium slots) or dynamically on specific days. These sit in an internal digital ledger on the subscription called the Premium Wallet.
- **What is Overage?**
  If a user has 0 premium slots in their Wallet, but selects a Wagyu Steak (Premium) for Tuesday, that is an **overage**. They cannot confirm Tuesday until they pay for that specific Wagyu Steak via a dynamic overage invoice.

---

## 2. 🔥 Frontend Behavior Rules (MUST FOLLOW)

The backend exposes immense flexibility, but it heavily relies on the front-end to drive state transitions securely.

1. **ALWAYS call `/verify-payment` after a payment gateway redirect.**
   - **Why:** Webhooks from payment providers (like Moyasar) can fail, get delayed, or drop. Do not make the user sit on a spinning loader waiting for a webhook to hit the backend. The moment the user redirects back to your success URL, instantly fire `/verify-payment` up to the backend. It forces an aggressive sync with the gateway.
2. **NEVER assume payment success strictly from the front-end.**
   - **Why:** A user can tamper with redirect URLs or query parameters. Always let the backend `/verify-payment` route validate the transaction legitimately via server-to-server calls.
3. **ALWAYS call `/confirm` again after an Overage or Add-on payment.**
   - **Why:** Paying for an overage does *not* automatically lock the day's meals! Verifying the payment strictly marks the overage as `paid`. The front-end MUST chain a second call to `POST /confirm` immediately afterward to transition the `planningState` to "confirmed".
4. **NEVER calculate subscription validity or extensions locally.**
   - **Why:** A subscription might end on May 30th. If the user freezes for 5 days, it ends on June 4th. If they skip 2 days, it shifts again. Do not rely on native JS `new Date()` math. **Always** fetch the canonical `/timeline` to display the calendar. 
5. **ALWAYS use `/timeline` to build calendar interfaces.**
   - **Why:** The timeline endpoint pre-calculates the exact chronological array of delivery days. It resolves the gaps for skips, blocks out frozen weeks seamlessly, and projects the exact dates you should render blocks for.

---

## 3. 🚨 Common Mistakes

- **Thinking "verify" = "confirm" ❌**
  If a user selects premium meals on an empty wallet, the backend returns `PREMIUM_OVERAGE_PAYMENT_REQUIRED`. The frontend redirects them to pay. When they return, the frontend calls `/verify`. **Mistake:** Assuming the day is now confirmed. **Reality:** The day is still a draft, but the bill is settled. You must call `/confirm` to finalize the day. 
- **Forgetting the second `/confirm` call after payment ❌**
  If you forget to hit confirm, the day remains a draft. The user will receive default meals instead of the premium meals they literally just paid for.
- **Calculating valid dates locally ❌**
  If you loop `for(i=0; i<20; i++) startDate.add(i, 'days')` to render a calendar, your app will crash the moment the user drops a freeze policy into the middle of the month. Rely on the `/timeline` array. It does the hard work.

---

## 4. 🌐 Language Switching Contract

The app can request Arabic or English from the same `/api/subscriptions` routes without changing paths.

### Supported languages

- `ar`
- `en`

### How to request a language

Use either:

- query param: `?lang=ar` or `?lang=en`
- header: `Accept-Language: ar` or `Accept-Language: en`

### Precedence

The backend resolves language in this order:

1. `req.query.lang`
2. `Accept-Language`
3. default fallback language

Current default fallback: **Arabic (`ar`)**.

### What changes vs what stays stable

Localized:

- `error.message`
- display names like plan/meal/add-on `name`
- human-readable summaries
- additive companion fields such as `statusLabel`, `paymentStatusLabel`, `deliveryModeLabel`, `sourceLabel`

Stable and not localized:

- `error.code`
- IDs
- enums like `status`, `paymentStatus`, `walletType`, `source`, `direction`

### Frontend rule

Use machine-readable fields for app logic, and use localized fields only for UI copy.

Examples:

- branch on `error.code === "PREMIUM_OVERAGE_PAYMENT_REQUIRED"`
- display `error.message`
- branch on `status === "paid"`
- display `paymentStatusLabel`

### Historical data note

Some older historical records still contain plain-string names instead of bilingual objects. In those cases the backend falls back safely to the stored value instead of rewriting history.

---

## 5. 📖 Complete User Story Flows

### Flow 1: Purchase a Subscription
*The user browses plans, builds their checkout basket, buys the subscription via Moyasar, and activates it.*

1. **App calls `GET /api/subscriptions/menu`** (Optional) to show available plans.
2. **App calls `POST /api/subscriptions/quote`** when the user selects a plan and configures days. The backend simulates the entire contract and returns precisely how much it will cost (base price + delivery zone fees).
3. **User taps "Checkout"**.
4. **App calls `POST /api/subscriptions/checkout`**. The backend securely creates a Checkout Draft and reaches out to Moyasar to create a payment intent. It returns a `draftId` and a `paymentUrl`.
5. **App redirects the user to `paymentUrl`**. The user enters their 3DS OTP code on the bank gateway.
6. **Moyasar redirects back to the App** (e.g., `myapp://checkout/success`).
7. **App aggressively calls `POST /api/subscriptions/checkout-drafts/:draftId/verify-payment`**.
8. The backend talks to Moyasar, confirms the payment, destroys the draft, and boots up a live, active subscription. The app routes the user to their dashboard.

### Flow 2: Daily Planning & Premium Overages (The Loop)
*The user views their upcoming delivery for Tuesday, selects their meals, realizes they accidentally picked premium items, pays the difference, and locks it in.*

1. User taps "Tuesday" on the calendar UI.
2. **App calls `PUT /api/subscriptions/:id/days/{date}/selection`**. The app sends an array of `mealIds`. The backend accepts them and updates the day. The day's `planningState` remains `"draft"`.
3. User taps "Save Meals".
4. **App calls `POST /api/subscriptions/:id/days/{date}/confirm`**.
5. The backend checks the wallet. The wallet is empty! The backend rejects the confirm and throws an error: `PREMIUM_OVERAGE_PAYMENT_REQUIRED`.
6. The app sees this error, shows a bottom sheet: "You owe 30 SAR for premium wagyu. Pay now?"
7. User taps "Pay".
8. **App calls `POST /api/subscriptions/:id/days/{date}/premium-overage/payments`**. The backend generates an invoice and returns a `paymentUrl`.
9. The app opens a webview to Moyasar. User pays.
10. The webview closes. The app detects the return.
11. **App aggressively calls `POST /api/subscriptions/:id/days/{date}/premium-overage/payments/:paymentId/verify`**. The backend marks the overage as paid.
12. **App seamlessly chains a call back to `POST /api/subscriptions/:id/days/{date}/confirm`**. The backend sees the bill is paid and flips the day to `planningState: "confirmed"`. Success!

### Flow 3: Managing Life Events (Freeze & Skip)
*The user is going on vacation for 3 days.*

1. User navigates to their settings and taps "Freeze Subscription". 
2. They select a date range.
3. **App calls `POST /api/subscriptions/:id/freeze`** with a `startDate` and `days` count.
4. The backend pauses the subscription, shifts the delivery calendar, and tacks 3 compensation days onto the very end of their subscription.
5. The App refreshes the UI by immediately calling **`GET /api/subscriptions/:id/timeline`**. The calendar instantly visualizes the 3 frozen days stripped out and the 3 new days added at the bottom.

---

## 6. 🗃️ Exhaustive Endpoint Reference

### 📦 Core Subscription & Checkout

#### `POST /api/subscriptions/checkout`
- **What this endpoint does:** Safely constructs an intent to start a subscription without dirtying live transactional databases. It creates a temporary "Draft" and an unpaid invoice.
- **Why it exists:** If a customer's payment fails or they abandon their cart, we don't want dead, unpaid subscriptions polluting the database. Drafts are safely garbage collected.
- **When the frontend should call this:** When the user clicks the final "Pay Now" button on the cart summary.
- **Important body fields:**
  - `planId`: String. The ID of the subscription plan.
  - `deliveryAddress`: Object. `{ location: [lng, lat], line1: "Street" }`.
  - `premiumCount` (Optional): Integer. How many premium wallet credits they are buying upfront.
  - `addons` (Optional): Array of `{ addonId }`. 
  - `deliveryMode` (Optional): `"delivery"` or `"pickup"`.
- **Response:**
  - `draftId`: You MUST save this locally to verify the redirect later.
  - `paymentId`: The internal database intent ID.
  - `paymentUrl`: The 3DS redirection URL the user must explicitly visit.
- **Common Errors:** 
  - `INVALID_SELECTION`: Frontend sent an inactive add-on or bad plan.

#### `POST /api/subscriptions/checkout-drafts/:draftId/verify-payment`
- **What this endpoint does:** Checks Moyasar for the payment status. If paid, it converts the Draft into a real Subscription.
- **Why it exists:** Enforces trustless payment resolution. Completely independent of fragile webhooks.
- **When to call this:** The millisecond the user is redirected back to the app from Moyasar.
- **Important Response:** Returns the newly activated `Subscription` object with its official `_id`. Move the user to their dashboard using this ID.
- **Edge cases:** If the user presses "Back" perfectly during processing, the endpoint operates idempotently. It won't create two subscriptions.

### 📅 Day Planning & Selection

#### `GET /api/subscriptions/:id/timeline`
- **What this endpoint does:** Compiles a chronological array (`days[]`) simulating the entire lifespan of the subscription from `startDate` to `validityEndDate`.
- **Why it exists:** Because freezes, skips, and administrative extensions warp time natively. The frontend cannot guess these dates.
- **When to call this:** First load of the dashboard, and immediately after any freeze/skip action.
- **Response Format:**
  - `validity`: Contains absolute bounding dates.
  - `days`: Array. Includes absolute `date`, `status` (active/skipped/delivered), `locked`, and `source` (`base` vs `freeze_extension`).

#### `PUT /api/subscriptions/:id/days/:date/selection`
- **What this endpoint does:** Modifies a day's meal selections array, mutating the day to a `"draft"` state.
- **Why it exists:** Users change their mind constantly. Drafts prevent accidental locked commitments.
- **When to call this:** As the user is ticking checkboxes on the meal interface.
- **Request Body:**
  - `selections`: Array of strings (Standard Meal IDs).
  - `premiumSelections`: Array of strings (Premium Meal IDs).
- **Common Errors:** 
  - `DAY_LOCKED`: You cannot edit a day that has crossed the operational cutoff (e.g. tomorrow's box is already in the kitchen).

#### `POST /api/subscriptions/:id/days/:date/confirm`
- **What this endpoint does:** Analyzes a draft day, asserts that all business rules are satisfied, deducts premium wallet balances if applicable, and locks the selection as `confirmed`.
- **Why it exists:** To prevent incomplete macro loads (picking 1 meal when the plan requires 3) or wage theft (stealing premium meals without paying).
- **When to call this:** When the user explicitly taps "Save & Confirm" on the UI, OR immediately following a successful overage payment verification.
- **Common Errors:**
  - `PLANNING_INCOMPLETE`: Frontend error. Prompt the user: "You need 2 more meals."
  - `PREMIUM_OVERAGE_PAYMENT_REQUIRED`: Frontend prompt: "You're short on premium credits. Look at the `premiumOverageCount` parameter we just returned to you, and trigger the overage flow."

### 💳 Payments (Overages / Addons)

#### `POST /api/subscriptions/:id/days/:date/premium-overage/payments`
- **What this endpoint does:** Issues an on-the-fly invoice.
- **Why it exists:** To frictionlessly upsell users mid-subscription when they crave premium steaks instead of normal chicken.
- **Request Body:** `premiumOverageCount` (Integer). Take this number directly from the validation error thrown during `/confirm`.
- **Response:** `paymentUrl`. Redirect the user here.

#### `POST /api/subscriptions/:id/days/:date/premium-overage/payments/:paymentId/verify`
- **What this endpoint does:** Authorizes the overage payment with Moyasar.
- **Why it exists:** Reliable manual sync. Wait for the `ok: true` response. 
- **CRITICAL AFTERMATH:** The day is NOT confirmed! If you stop here, the app creates extreme bug states. You MUST route back to `/confirm` immediately upon a 200 OK.

### ⏸️ Operations (Freeze/Skip)

#### `POST /api/subscriptions/:id/freeze`
- **What this endpoint does:** Freezes a continuous range, suspends deliveries, and extends validity automatically.
- **Why it exists:** So customers can travel without burning money.
- **Request Body:** `startDate` (YYYY-MM-DD), `days` (Integer).
- **Errors to handle:** `POLICY_VIOLATION`. The plan limits the user to a maximum amount of freeze days/times. Surface the error message string directly to the user so they know they hit a limit.

#### `POST /api/subscriptions/:id/days/:date/skip`
- **What this endpoint does:** Cancels delivery for a localized single day without extending boundaries.
- **Errors to handle:** `ALLOWANCE_EXCEEDED`: Subscriptions have finite skip allowances. Alert the user gracefully. 

#### `POST /api/subscriptions/:id/days/:date/unskip` & `POST /api/subscriptions/:id/unfreeze`
- **What these endpoints do:** Restores days and dynamically contracts the `validityEndDate` natively. Call `/timeline` immediately to refresh visually!
