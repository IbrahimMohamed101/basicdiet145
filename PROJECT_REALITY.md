# PROJECT REALITY

This file describes the code that actually runs from the repo root in this workspace. The active app starts from `src/index.js` through the root `package.json`; the nested `basicdiet145/` folder looks like an older leftover copy, not the runtime that `npm start` launches here.

## 1. What Is This Project

This is a Node.js/Express/MongoDB backend for a meal business that sells subscription meal plans and one-time meal orders. Client users sign in with WhatsApp OTP, browse plans and meals, pay through Moyasar invoice links, and then manage delivery, pickup, and day-by-day meal choices. The same backend also runs the internal dashboard used by admins, kitchen staff, and couriers to manage catalog data, subscriptions, orders, payments, deliveries, and notifications.

### Who Uses It

- `client`: buys plans or one-time orders, manages profile, chooses meals, tops up credits, and tracks subscription/order state.
- `admin` and `superadmin`: manage plans, meals, premium meals, add-ons, users, subscriptions, orders, payments, settings, images, logs, and reports.
- `kitchen`: assigns meals, locks production days, and moves subscription days and one-time orders through kitchen states.
- `courier`: sees today's deliveries and marks them arriving, delivered, or canceled.

### Main Flow From Start To Finish

1. A client signs in with OTP, opens the menu, and chooses either a subscription or a one-time order.
2. The backend validates the request, creates a Moyasar invoice and a local `Payment` record, and waits for payment confirmation through a webhook or a verify endpoint.
3. After payment is applied, the backend creates or updates the real business record (`Subscription`, `SubscriptionDay`, `Order`, wallet balances, or day extras), then the kitchen and courier flows finish fulfillment and the notification jobs send reminders.

### Plain Reality Checks

- Saved payment methods are not implemented. `getSubscriptionPaymentMethods` in `src/controllers/subscriptionController.js` returns `supported: false`, `canManage: false`, and `mode: "invoice_only"`.
- Subscription delivery mode changes are not implemented. `buildSubscriptionOperationsMeta` in `src/services/subscriptionOperationsReadService.js` returns `modeChangeSupported: false`.
- Skipping days does not create make-up days. `buildSubscriptionOperationsMeta` in `src/services/subscriptionOperationsReadService.js` reports `compensationMode: "none"`, and the skip flow only marks days skipped.
- `POST /api/subscriptions/:id/activate` in `src/routes/subscriptions.js` and `POST /api/orders/:id/confirm` in `src/routes/orders.js` are mock endpoints that only exist outside production.
- `transitionDay` and `fulfillDay` exist in `src/controllers/subscriptionController.js` but are marked `@unwired` and are not mounted on any route.
- Some subscription behavior changes by environment flags in `src/utils/featureFlags.js`. The code can switch between legacy and canonical checkout/day-planning behavior, and it can switch between legacy and generic premium-wallet behavior.

## 2. The Full Cycle

### Flow A: Client Login, Registration, And Profile

1. The flow starts at `POST /api/app/login`, `POST /api/app/register`, or the generic `POST /api/auth/otp/request` in `src/routes/appAuth.js` and `src/routes/auth.js`.
2. `login` and `register` in `src/controllers/appAuthController.js` validate the phone, name, and email, then call `requestOtpForPhone` in `src/services/otpService.js`.
3. `otpService` writes or updates an `Otp` document in `src/models/Otp.js` and sends the OTP through `sendOtpWhatsapp` in `src/services/twilioWhatsappService.js`.
4. The user sends the code back to `POST /api/app/verify` or `POST /api/auth/otp/verify`, which both land in `verifyOtp` in `src/controllers/authController.js`.
5. `verifyOtp` checks the `Otp` record, creates or links `AppUser` and `User` records, applies the pending profile from registration if one was stored, and issues a JWT through `issueAppAccessToken` in `src/services/appTokenService.js`.
6. If the app user had saved FCM tokens before the core user existed, `verifyOtp` moves those tokens onto the `User` record.
7. The flow ends with a bearer token that unlocks protected client routes like `GET /api/app/profile`, `PUT /api/app/profile`, and `GET /api/app/subscriptions`.

### Flow B: Subscription Purchase And Activation

1. The user usually starts by reading `GET /api/subscriptions/menu`, `GET /api/plans`, `GET /api/popular_packages`, `GET /api/premium-meals`, and `GET /api/addons` from `src/routes/subscriptions.js`, `src/routes/plans.js`, `src/routes/popularPackages.js`, `src/routes/premiumMeals.js`, and `src/routes/addons.js`.
2. Pricing starts at `POST /api/subscriptions/quote` in `src/routes/subscriptions.js`, which calls `quoteSubscription` in `src/controllers/subscriptionController.js`.
3. `quoteSubscription` uses `resolveCheckoutQuoteOrThrow` in the same file to validate the plan, grams option, meals-per-day option, delivery choice, start date, premium items, add-ons, delivery zone, and settings-based prices.
4. Checkout starts at `POST /api/subscriptions/checkout`, which calls `checkoutSubscription` in `src/controllers/subscriptionController.js`.
5. `checkoutSubscription` requires a logged-in client, requires an idempotency key, rebuilds the quote, creates or reuses a `CheckoutDraft` in `src/models/CheckoutDraft.js`, creates a `Payment` in `src/models/Payment.js`, and creates a Moyasar invoice through `createInvoice` in `src/services/moyasarService.js`.
6. The client pays on the external Moyasar invoice page.
7. Payment comes back to the system in one of two ways: `POST /api/webhooks/moyasar` in `src/routes/webhooks.js` or `POST /api/subscriptions/checkout-drafts/:draftId/verify-payment` in `src/routes/subscriptions.js`.
8. Both paths end up validating the payment and then calling `applyPaymentSideEffects` in `src/services/paymentApplicationService.js`.
9. For subscription activation, payment side effects call `applySubscriptionActivationPayment` and `src/services/subscriptionActivationService.js`, which create the real `Subscription` in `src/models/Subscription.js` and its `SubscriptionDay` rows in `src/models/SubscriptionDay.js`.
10. The draft is marked completed, the payment is marked applied, and later reads like `GET /api/subscriptions`, `GET /api/subscriptions/:id`, and `GET /api/subscriptions/:id/days` return the live subscription.

### Flow C: Subscription Renewal

1. The renewal flow starts at `GET /api/subscriptions/:id/renewal-seed` in `src/routes/subscriptions.js`.
2. `getSubscriptionRenewalSeed` in `src/controllers/subscriptionController.js` reads the existing subscription and returns a reusable version of the old plan, delivery, premium, and add-on setup.
3. The user submits `POST /api/subscriptions/:id/renew`, which calls `renewSubscription` in the same controller.
4. `renewSubscription` rebuilds a new quote from the old subscription, creates a renewal `CheckoutDraft`, creates a `Payment`, and creates a Moyasar invoice.
5. Payment is then finalized by the same webhook and verify paths used for first-time subscription checkout.
6. The flow ends when payment side effects create the new renewed subscription data and the new subscription appears in the normal subscription read endpoints.

### Flow D: Subscription Day Planning, Freeze, Skip, Pickup, And Extras

1. The client reads `GET /api/subscriptions/:id/days`, `GET /api/subscriptions/:id/days/:date`, or `GET /api/subscriptions/:id/today` from `src/routes/subscriptions.js`.
2. Day meal selection is saved through `PUT /api/subscriptions/:id/days/:date/selection`, which calls `updateDaySelection` in `src/controllers/subscriptionController.js`.
3. `updateDaySelection` validates that the day belongs to the user, is still editable, and is before cutoff, then stores regular and premium meal selections, recalculates wallet usage, and recalculates whether extra payment is still needed.
4. If the selected premium meals cost more than the wallet covers, `POST /api/subscriptions/:id/days/:date/premium-overage/payments` creates a payment and `POST /api/subscriptions/:id/days/:date/premium-overage/payments/:paymentId/verify` verifies it.
5. If one-time add-ons are attached during planning, `POST /api/subscriptions/:id/days/:date/one-time-addons/payments` creates a payment and `POST /api/subscriptions/:id/days/:date/one-time-addons/payments/:paymentId/verify` verifies it.
6. If canonical day planning is enabled, `POST /api/subscriptions/:id/days/:date/confirm` calls `confirmDayPlanning`, which requires the meal count to match the plan and requires all premium overage and one-time add-on payments to be settled.
7. The same day can also be changed by `POST /api/subscriptions/:id/days/:date/skip`, `POST /api/subscriptions/:id/days/:date/unskip`, `POST /api/subscriptions/:id/skip-range`, `POST /api/subscriptions/:id/freeze`, `POST /api/subscriptions/:id/unfreeze`, `POST /api/subscriptions/:id/days/:date/pickup/prepare`, `PUT /api/subscriptions/:id/delivery`, and `PUT /api/subscriptions/:id/days/:date/delivery`.
8. Custom extras for a subscription day start at `POST /api/subscriptions/:id/days/:date/custom-salad` and `POST /api/subscriptions/:id/days/:date/custom-meal`, which create extra payments for those day-level custom items.
9. The flow ends when the day is frozen, skipped, confirmed, prepared for pickup, fulfilled by kitchen or courier, or left as a future editable day.

### Flow E: Subscription Wallet Top-Up And Wallet Consumption

1. The wallet flow starts at `GET /api/subscriptions/:id/wallet` or `GET /api/subscriptions/:id/wallet/history`.
2. A top-up starts at `POST /api/subscriptions/:id/premium/topup`, `POST /api/subscriptions/:id/premium-credits/topup`, or `POST /api/subscriptions/:id/addon-credits/topup`.
3. The controller creates a `Payment`, creates a Moyasar invoice, and returns a payment URL.
4. The invoice is finalized through `POST /api/subscriptions/:id/wallet/topups/:paymentId/verify` or the shared `POST /api/webhooks/moyasar` webhook.
5. Payment side effects add premium credits or add-on credits onto the subscription wallet data stored on the subscription and its wallet history.
6. The wallet is then consumed later by `POST /api/subscriptions/:id/premium-selections`, `DELETE /api/subscriptions/:id/premium-selections`, `POST /api/subscriptions/:id/addon-selections`, and `DELETE /api/subscriptions/:id/addon-selections`, or indirectly inside `updateDaySelection`.
7. The flow ends when the wallet balance changes and later day planning reads show the updated balance and usage history.

### Flow F: One-Time Order Purchase

1. The order flow starts at `GET /api/orders/menu` in `src/routes/orders.js`, which returns the orderable menu from `getOrderMenu` in `src/controllers/menuController.js`.
2. Checkout starts at `POST /api/orders/checkout`, which calls `checkoutOrder` in `src/controllers/orderController.js`.
3. `checkoutOrder` validates the selected meals, custom items, delivery mode, date, zone, window, and prices from settings.
4. If the request asks for tomorrow after cutoff, `checkoutOrder` moves the delivery date forward and stores that adjusted date on the order.
5. The controller creates an `Order` in `src/models/Order.js`, creates a `Payment`, creates a Moyasar invoice, and returns the payment URL.
6. While the order is still open and unpaid, `POST /api/orders/:id/items/custom-salad` and `POST /api/orders/:id/items/custom-meal` can append custom items and increase the pending price.
7. Payment is finalized through `POST /api/orders/:id/verify-payment` or the shared Moyasar webhook.
8. Once paid, the order becomes operational data for kitchen and courier routes. The user can also read `GET /api/orders`, `GET /api/orders/:id`, `GET /api/orders/:id/payment-status`, `POST /api/orders/:id/reject-adjusted-date`, and `DELETE /api/orders/:id` while the order is still cancelable.
9. The flow ends when kitchen and courier complete the order or when the order is canceled.

### Flow G: Dashboard Login And Admin Work

1. The admin flow starts at `POST /api/dashboard/auth/login` in `src/routes/dashboardAuth.js`.
2. `login` in `src/controllers/dashboardAuthController.js` checks the email and password against `DashboardUser` in `src/models/DashboardUser.js`, applies login lockout rules, and issues a dashboard JWT through `src/services/dashboardTokenService.js`.
3. The dashboard token unlocks `/api/admin/*` and `/api/dashboard/*` routes because both prefixes mount the same router from `src/routes/admin.js`.
4. The admin user can then manage plans, meals, premium meals, add-ons, meal categories, ingredients, settings, users, subscriptions, orders, payments, dashboard users, images, logs, reports, and manual cutoff from the controller functions in `src/controllers/adminController.js` and the catalog controllers mounted there.
5. The flow ends whenever one of those controller functions writes the updated document and returns it to the dashboard.

### Flow H: Kitchen Operations

1. This flow starts after a kitchen or admin user signs in with dashboard auth and calls routes in `src/routes/kitchen.js`.
2. `GET /api/kitchen/days/:date` calls `listDailyOrders` in `src/controllers/kitchenController.js` and returns the subscription-day workload for that date.
3. `PUT /api/kitchen/subscriptions/:id/days/:date/assign` calls `assignMeals` to save kitchen assignment data for the day.
4. `POST /api/kitchen/days/:date/lock` bulk-locks all open subscription days for that date and saves a locked snapshot.
5. `POST /api/kitchen/subscriptions/:id/days/:date/lock`, `/reopen`, `/in-preparation`, `/out-for-delivery`, `/ready-for-pickup`, and `/fulfill-pickup` move subscription days through kitchen states.
6. The same router also manages one-time orders through `GET /api/kitchen/orders/:date` and the one-time order transition endpoints in `src/controllers/orderKitchenController.js`.
7. The flow ends when subscription days or one-time orders are locked, prepared, ready, or fulfilled.

### Flow I: Courier Operations

1. This flow starts after a courier or admin user signs in with dashboard auth and calls routes in `src/routes/courier.js`.
2. `GET /api/courier/deliveries/today` calls `listTodayDeliveries` in `src/controllers/courierController.js` and returns today's subscription deliveries assigned to that courier.
3. `PUT /api/courier/deliveries/:id/arriving-soon`, `/delivered`, and `/cancel` move that subscription delivery through courier states and keep the `Delivery` and `SubscriptionDay` state in sync.
4. The same router also exposes `GET /api/courier/orders/today` and the order-delivery transition routes in `src/controllers/orderCourierController.js` for one-time orders.
5. The flow ends when the courier marks the delivery delivered or canceled and the order/day state is updated.

### Flow J: Moyasar Webhook And Direct Payment Verification

1. This flow starts either from `POST /api/webhooks/moyasar` in `src/routes/webhooks.js` or from one of the explicit verify endpoints on subscriptions, wallet top-ups, premium overage, one-time add-ons, or orders.
2. `handleMoyasarWebhook` in `src/controllers/webhookController.js` validates the webhook secret, looks up the existing `Payment`, rejects unknown references, and checks amount and currency.
3. The controller updates the local `Payment` status and prevents side effects from running twice if the payment was already applied.
4. If the payment is paid, it calls `applyPaymentSideEffects` in `src/services/paymentApplicationService.js`.
5. Payment side effects activate subscriptions, credit wallets, attach custom extras, mark day overage settled, or update one-time orders depending on `payment.type`.
6. If the payment is failed, canceled, or expired, the webhook also marks related drafts or orders as failed or canceled.
7. The flow ends when the payment record is final and the target business record has been updated.

### Flow K: Scheduled Automation And Notifications

1. This flow does not start from an HTTP request. It starts in `startJobs` in `src/jobs/index.js` when the server boots.
2. Every minute, the job loop runs `processDueDeliveryArrivingSoon`, checks whether the cutoff time has been reached, and checks whether daily reminder times have been reached.
3. `processDailyCutoff` in `src/services/automationService.js` runs once per KSA day after the configured cutoff time.
4. `processDailyMealSelectionReminders` and `processSubscriptionExpiryReminders` in `src/services/notificationSchedulerService.js` create reminder notifications for missing meal selections and upcoming expiry.
5. Push notifications are sent through Firebase in `src/utils/notify.js`, deduped in `src/services/notificationService.js`, and logged in `src/models/NotificationLog.js`.
6. The flow ends when notifications are written and sent, or when the cutoff automation finishes its daily pass.

## 3. Every Feature That Exists Right Now

The list below covers the implemented feature surface in the active backend code.

### Platform And Shared API Features

| Feature | What it does | Lives in | Trigger | Produces or changes |
| --- | --- | --- | --- | --- |
| API root endpoint | Returns a simple "backend is running" response | `src/app.js -> createApp` | `GET /` | Smoke-test JSON response |
| Health check | Checks Mongo connection and pings the database | `src/app.js -> createApp` | `GET /health` | 200 or 503 health response |
| Swagger docs | Serves two Swagger UIs and raw YAML files | `src/app.js -> mountSwaggerUi` | `GET /api-docs`, `GET /subscriptions-api-docs` | API documentation pages |
| Request language selection | Chooses Arabic or English response language | `src/middleware/requestLanguage.js` | Any `/api/*` request | Localized text selection in many reads |
| Rate limiting | Limits OTP, OTP verify, checkout, and dashboard login traffic | `src/middleware/rateLimit.js` | Matching endpoints | Rejects excess requests |
| Startup environment validation | Stops boot if required env is missing | `src/utils/validateEnv.js`, `src/index.js` | Server boot | Server exits on invalid env |
| Mongo startup and payment index check | Connects Mongo and ensures payment indexes | `src/db.js -> connectDb` | Server boot | Database connection and payment indexes |
| Default dashboard-user seeding | Ensures default dashboard users exist | `src/services/dashboardDefaultUsersService.js` | Server boot | Dashboard accounts inserted or updated |

### Client Auth And Profile Features

| Feature | What it does | Lives in | Trigger | Produces or changes |
| --- | --- | --- | --- | --- |
| App login OTP request | Sends OTP for an existing or new phone | `src/controllers/appAuthController.js -> login` | `POST /api/app/login` | `Otp` record and WhatsApp message |
| App registration OTP request | Sends OTP and stores pending full name/email | `src/controllers/appAuthController.js -> register` | `POST /api/app/register` | `Otp` record with pending profile |
| Generic OTP request | Sends OTP without app-specific wrapper | `src/controllers/authController.js -> requestOtp` | `POST /api/auth/otp/request` | `Otp` record and WhatsApp message |
| OTP verification | Verifies OTP and creates/links real user records | `src/controllers/authController.js -> verifyOtp` | `POST /api/app/verify`, `POST /api/auth/otp/verify` | `User`, `AppUser`, JWT token |
| Client profile read | Returns the authenticated client's profile | `src/controllers/appAuthController.js -> getProfile` | `GET /api/app/profile` | Serialized `User` data |
| Client profile update | Updates full name and/or email | `src/controllers/appAuthController.js -> updateProfile` | `PUT /api/app/profile` | Updated `User` and linked `AppUser` |
| Client device token add | Saves an FCM token for push | `src/controllers/authController.js -> updateDeviceToken` | `POST /api/auth/device-token` | `User.fcmTokens` updated |
| Client device token remove | Removes an FCM token | `src/controllers/authController.js -> deleteDeviceToken` | `DELETE /api/auth/device-token` | `User` and `AppUser` token cleanup |
| Client auth middleware | Protects client-only routes | `src/middleware/auth.js -> authMiddleware` | Any protected client route | Populates `req.userId` and client role |

### Public Catalog And Menu Features

| Feature | What it does | Lives in | Trigger | Produces or changes |
| --- | --- | --- | --- | --- |
| Subscription menu | Returns plans, meals, premium meals, add-ons, delivery options, and checkout flow hints | `src/controllers/menuController.js -> getSubscriptionMenu` | `GET /api/subscriptions/menu` | Combined subscription menu payload |
| One-time order menu | Returns orderable meals and custom-item support | `src/controllers/menuController.js -> getOrderMenu` | `GET /api/orders/menu` | Combined order menu payload |
| Delivery options | Returns zones, windows, and pickup locations | `src/controllers/menuController.js -> getDeliveryOptions` | `GET /api/subscriptions/delivery-options` | Delivery catalog payload |
| Plans list and detail | Returns active plans | `src/controllers/planController.js` | `GET /api/plans`, `GET /api/plans/:id` | Plan data |
| Popular packages | Returns the first three active plans using the first active grams/meals option | `src/controllers/popularPackageController.js -> listPopularPackages` | `GET /api/popular_packages` | Simplified featured plan cards |
| Meals catalog | Returns active regular meals | `src/controllers/mealController.js` | `GET /api/meals` | Meal list |
| Premium meals catalog | Returns active premium meals | `src/controllers/premiumMealController.js` | `GET /api/premium-meals` | Premium meal list |
| Add-ons catalog | Returns active add-ons | `src/controllers/addonController.js` | `GET /api/addons` | Add-on list |
| Salad ingredients catalog | Returns active salad ingredients | `src/controllers/saladIngredientController.js` | `GET /api/salad-ingredients` | Ingredient list |
| Meal ingredients catalog | Returns active meal ingredients | `src/controllers/mealIngredientController.js` | `GET /api/meal-ingredients` | Ingredient list |
| Custom salad price preview | Prices a custom salad before purchase for a signed-in client | `src/controllers/customSaladController.js -> previewCustomSaladPrice` | `POST /api/custom-salads/price` | Price and item snapshot |
| Custom meal price preview | Prices a custom meal before purchase for a signed-in client | `src/controllers/customMealController.js -> previewCustomMealPrice` | `POST /api/custom-meals/price` | Price and item snapshot |
| Public settings read | Returns live settings with defaults | `src/controllers/settingsController.js -> getSettings` | `GET /api/settings` | Settings payload |

### Subscription Features

| Feature | What it does | Lives in | Trigger | Produces or changes |
| --- | --- | --- | --- | --- |
| Subscription quote | Calculates subscription pricing before checkout | `src/controllers/subscriptionController.js -> quoteSubscription` | `POST /api/subscriptions/quote` | Pricing breakdown |
| Subscription checkout | Creates checkout draft, payment, and invoice | `src/controllers/subscriptionController.js -> checkoutSubscription` | `POST /api/subscriptions/checkout` | `CheckoutDraft`, `Payment`, invoice URL |
| Checkout draft read | Returns current status of a pending subscription checkout | `src/controllers/subscriptionController.js -> getCheckoutDraftStatus` | `GET /api/subscriptions/checkout-drafts/:draftId` | Draft status payload |
| Checkout draft payment verify | Verifies subscription payment directly with Moyasar | `src/controllers/subscriptionController.js -> verifyCheckoutDraftPayment` | `POST /api/subscriptions/checkout-drafts/:draftId/verify-payment` | Applies payment side effects if paid |
| Dev-only mock subscription activation | Marks a subscription as active without real payment in non-production | `src/controllers/subscriptionController.js -> activateSubscription` | `POST /api/subscriptions/:id/activate` outside production | Mock activation result |
| Client subscription list | Lists current user's subscriptions | `src/controllers/subscriptionController.js -> listCurrentUserSubscriptions` | `GET /api/subscriptions`, `GET /api/app/subscriptions` | Subscription list |
| Subscription detail | Returns a single subscription | `src/controllers/subscriptionController.js -> getSubscription` | `GET /api/subscriptions/:id` | Subscription data |
| Current subscription overview | Returns latest active or pending subscription overview | `src/controllers/subscriptionController.js -> getCurrentSubscriptionOverview` | `GET /api/subscriptions/current/overview` | Overview payload or `null` |
| Subscription renewal seed | Returns reusable old config for renewal | `src/controllers/subscriptionController.js -> getSubscriptionRenewalSeed` | `GET /api/subscriptions/:id/renewal-seed` | Renewal seed payload |
| Subscription renewal checkout | Creates a renewal payment flow | `src/controllers/subscriptionController.js -> renewSubscription` | `POST /api/subscriptions/:id/renew` | Renewal `CheckoutDraft`, `Payment`, invoice |
| Subscription operations metadata | Tells the app what actions are allowed right now | `src/controllers/subscriptionController.js -> getSubscriptionOperationsMeta` | `GET /api/subscriptions/:id/operations-meta` | Allow/deny data for cancel, freeze, skip, delivery, payment methods |
| Freeze preview | Shows what a freeze would do before writing it | `src/controllers/subscriptionController.js -> getSubscriptionFreezePreview` | `GET /api/subscriptions/:id/freeze-preview` | Freeze preview payload |
| Subscription cancel | Cancels an active or pending-payment subscription | `src/controllers/subscriptionController.js -> cancelSubscription` | `POST /api/subscriptions/:id/cancel` | Subscription status update |
| Subscription timeline | Returns date-by-date timeline including frozen extensions | `src/controllers/subscriptionController.js -> getSubscriptionTimeline` | `GET /api/subscriptions/:id/timeline` | Timeline payload |
| Payment methods endpoint | Explicitly reports that saved payment methods are not supported | `src/controllers/subscriptionController.js -> getSubscriptionPaymentMethods` | `GET /api/subscriptions/payment-methods` | Static unsupported payload |
| Wallet read | Returns subscription wallet balances | `src/controllers/subscriptionController.js -> getSubscriptionWallet` | `GET /api/subscriptions/:id/wallet` | Wallet payload |
| Wallet history read | Returns wallet transaction history | `src/controllers/subscriptionController.js -> getSubscriptionWalletHistory` | `GET /api/subscriptions/:id/wallet/history` | Wallet history payload |
| Wallet top-up status read | Returns the state of a wallet top-up payment | `src/controllers/subscriptionController.js -> getWalletTopupPaymentStatus` | `GET /api/subscriptions/:id/wallet/topups/:paymentId/status` | Payment status payload |
| Wallet top-up verify | Verifies a wallet top-up directly | `src/controllers/subscriptionController.js -> verifyWalletTopupPayment` | `POST /api/subscriptions/:id/wallet/topups/:paymentId/verify` | Credits wallet if paid |
| Legacy premium top-up | Tops up legacy premium count balance | `src/controllers/subscriptionController.js -> topupPremium` | `POST /api/subscriptions/:id/premium/topup` | Payment + legacy premium credits |
| Premium credits top-up | Tops up premium wallet credits | `src/controllers/subscriptionController.js -> topupPremiumCredits` | `POST /api/subscriptions/:id/premium-credits/topup` | Payment + premium credits |
| Add-on credits top-up | Tops up add-on wallet credits | `src/controllers/subscriptionController.js -> topupAddonCredits` | `POST /api/subscriptions/:id/addon-credits/topup` | Payment + add-on credits |
| Subscription day list | Returns all days for a subscription | `src/controllers/subscriptionController.js -> getSubscriptionDays` | `GET /api/subscriptions/:id/days` | Day list |
| Subscription day detail | Returns one day | `src/controllers/subscriptionController.js -> getSubscriptionDay` | `GET /api/subscriptions/:id/days/:date` | Day payload |
| Subscription today view | Returns today's day view | `src/controllers/subscriptionController.js -> getSubscriptionToday` | `GET /api/subscriptions/:id/today` | Today payload |
| Day selection update | Saves regular and premium meal picks for a day | `src/controllers/subscriptionController.js -> updateDaySelection` | `PUT /api/subscriptions/:id/days/:date/selection` | Updated `SubscriptionDay`, wallet usage, payment status |
| Day planning confirmation | Finalizes day planning in canonical mode | `src/controllers/subscriptionController.js -> confirmDayPlanning` | `POST /api/subscriptions/:id/days/:date/confirm` | Planning confirmation state |
| Premium overage day payment create | Creates payment for extra premium cost on a day | `src/controllers/subscriptionController.js -> createPremiumOverageDayPayment` | `POST /api/subscriptions/:id/days/:date/premium-overage/payments` | `Payment` + invoice |
| Premium overage day payment verify | Verifies that extra premium payment | `src/controllers/subscriptionController.js -> verifyPremiumOverageDayPayment` | `POST /api/subscriptions/:id/days/:date/premium-overage/payments/:paymentId/verify` | Marks premium overage paid |
| One-time add-on day payment create | Creates payment for one-time add-ons during planning | `src/controllers/subscriptionController.js -> createOneTimeAddonDayPlanningPayment` | `POST /api/subscriptions/:id/days/:date/one-time-addons/payments` | `Payment` + invoice |
| One-time add-on day payment verify | Verifies that one-time add-on payment | `src/controllers/subscriptionController.js -> verifyOneTimeAddonDayPlanningPayment` | `POST /api/subscriptions/:id/days/:date/one-time-addons/payments/:paymentId/verify` | Marks add-on payment paid |
| Skip one day | Marks a day skipped | `src/controllers/subscriptionController.js -> skipDay` | `POST /api/subscriptions/:id/days/:date/skip` | `SubscriptionDay` skipped state |
| Unskip one day | Reopens a skipped day when allowed | `src/controllers/subscriptionController.js -> unskipDay` | `POST /api/subscriptions/:id/days/:date/unskip` | `SubscriptionDay` reopened |
| Skip range | Skips several days starting from one date | `src/controllers/subscriptionController.js -> skipRange` | `POST /api/subscriptions/:id/skip-range` | Several day records updated |
| Freeze subscription | Marks days frozen and extends validity end date | `src/controllers/subscriptionController.js -> freezeSubscription` | `POST /api/subscriptions/:id/freeze` | Frozen days and new validity end date |
| Unfreeze subscription | Reverts frozen days when allowed | `src/controllers/subscriptionController.js -> unfreezeSubscription` | `POST /api/subscriptions/:id/unfreeze` | Unfrozen days and validity sync |
| Prepare pickup | Locks a pickup day and consumes credits immediately | `src/controllers/subscriptionController.js -> preparePickup` | `POST /api/subscriptions/:id/days/:date/pickup/prepare` | Pickup-ready day state |
| Subscription default delivery update | Updates default delivery address/window | `src/controllers/subscriptionController.js -> updateDeliveryDetails` | `PUT /api/subscriptions/:id/delivery` | Subscription delivery defaults |
| Subscription day delivery override | Updates one day's delivery details | `src/controllers/subscriptionController.js -> updateDeliveryDetailsForDate` | `PUT /api/subscriptions/:id/days/:date/delivery` | Day-level delivery override |
| Direct premium selection consumption | Consumes premium wallet value for a day selection | `src/controllers/subscriptionController.js -> consumePremiumSelection` | `POST /api/subscriptions/:id/premium-selections` | Wallet usage + day state |
| Direct premium selection removal | Refunds previously consumed premium selection | `src/controllers/subscriptionController.js -> removePremiumSelection` | `DELETE /api/subscriptions/:id/premium-selections` | Wallet refund + day state |
| Direct add-on selection consumption | Consumes add-on wallet value for a day selection | `src/controllers/subscriptionController.js -> consumeAddonSelection` | `POST /api/subscriptions/:id/addon-selections` | Wallet usage + day state |
| Direct add-on selection removal | Refunds previously consumed add-on selection | `src/controllers/subscriptionController.js -> removeAddonSelection` | `DELETE /api/subscriptions/:id/addon-selections` | Wallet refund + day state |
| One-time add-on purchase for a day | Creates separate payment for one add-on on a future day | `src/controllers/subscriptionController.js -> addOneTimeAddon` | `POST /api/subscriptions/:id/addons/one-time` | `Payment` + future day add-on intent |
| Custom salad purchase for a day | Creates payment-backed custom salad for one day | `src/controllers/customSaladController.js -> addCustomSaladToSubscriptionDay` | `POST /api/subscriptions/:id/days/:date/custom-salad` | `Payment` + custom-salad snapshot |
| Custom meal purchase for a day | Creates payment-backed custom meal for one day | `src/controllers/customMealController.js -> addCustomMealToSubscriptionDay` | `POST /api/subscriptions/:id/days/:date/custom-meal` | `Payment` + custom-meal snapshot |

### One-Time Order Features

| Feature | What it does | Lives in | Trigger | Produces or changes |
| --- | --- | --- | --- | --- |
| One-time order checkout | Creates an order, payment, and invoice | `src/controllers/orderController.js -> checkoutOrder` | `POST /api/orders/checkout` | `Order`, `Payment`, invoice URL |
| Dev-only mock order confirm | Marks order paid in non-production without provider payment | `src/controllers/orderController.js -> confirmOrder` | `POST /api/orders/:id/confirm` outside production | Mock order confirmation |
| Order payment status read | Returns stored payment status for an order | `src/controllers/orderController.js -> getOrderPaymentStatus` | `GET /api/orders/:id/payment-status` | Payment status payload |
| Order payment verify | Verifies order payment directly with Moyasar | `src/controllers/orderController.js -> verifyOrderPayment` | `POST /api/orders/:id/verify-payment` | Marks order paid if valid |
| Reject adjusted delivery date | Cancels an unpaid order whose date was auto-shifted after cutoff | `src/controllers/orderController.js -> rejectAdjustedDeliveryDate` | `POST /api/orders/:id/reject-adjusted-date` | Order canceled |
| Add custom salad to order | Appends a custom salad to an open unpaid order | `src/controllers/customSaladController.js -> addCustomSaladToOrder` | `POST /api/orders/:id/items/custom-salad` | Order items and amount updated |
| Add custom meal to order | Appends a custom meal to an open unpaid order | `src/controllers/customMealController.js -> addCustomMealToOrder` | `POST /api/orders/:id/items/custom-meal` | Order items and amount updated |
| Client order list | Returns the current user's orders | `src/controllers/orderController.js -> listOrders` | `GET /api/orders` | Order list |
| Client order detail | Returns one order | `src/controllers/orderController.js -> getOrder` | `GET /api/orders/:id` | Order payload |
| Client order cancel | Cancels an order before preparation | `src/controllers/orderController.js -> cancelOrder` | `DELETE /api/orders/:id` | Order status update |

### Dashboard Auth And Admin Features

| Feature | What it does | Lives in | Trigger | Produces or changes |
| --- | --- | --- | --- | --- |
| Dashboard login | Authenticates staff with email/password | `src/controllers/dashboardAuthController.js -> login` | `POST /api/dashboard/auth/login` | Dashboard JWT, login lockout updates |
| Dashboard current-user read | Returns dashboard user details if logged in | `src/controllers/dashboardAuthController.js -> me` | `GET /api/dashboard/auth/me` | Dashboard user payload |
| Dashboard logout | Stateless logout endpoint | `src/controllers/dashboardAuthController.js -> logout` | `POST /api/dashboard/auth/logout` | Simple success response |
| Dashboard overview | Returns high-level dashboard stats | `src/controllers/adminController.js -> getDashboardOverview` | `GET /api/admin/overview` | Overview payload |
| Dashboard search | Searches across dashboard data | `src/controllers/adminController.js -> searchDashboard` | `GET /api/admin/search` | Search results |
| Notification summary | Returns dashboard notification stats | `src/controllers/adminController.js -> getDashboardNotificationSummary` | `GET /api/admin/notifications/summary` | Summary payload |
| Today report | Returns today's report data | `src/controllers/adminController.js -> getTodayReport` | `GET /api/admin/reports/today` | Report payload |
| Admin image upload | Uploads images to Cloudinary | `src/controllers/uploadController.js -> uploadAdminImage` | `POST /api/admin/uploads/image` | Uploaded image URL data |
| Admin plans CRUD | Creates, reads, updates, deletes plans | `src/controllers/adminController.js` | `/api/admin/plans*` routes | `Plan` documents changed |
| Admin plan grams-row management | Creates, clones, deletes, toggles, sorts grams rows inside a plan | `src/controllers/adminController.js` | `/api/admin/plans/:id/grams*` routes | Nested plan pricing rows changed |
| Admin plan meals-option management | Creates, clones, deletes, toggles, sorts meals-per-day rows inside a grams row | `src/controllers/adminController.js` | `/api/admin/plans/:id/grams/:grams/meals*` routes | Nested plan pricing rows changed |
| Admin premium-meal CRUD | Manages premium meal catalog | `src/controllers/premiumMealController.js` | `/api/admin/premium-meals*` routes | `PremiumMeal` documents changed |
| Admin add-on CRUD | Manages add-on catalog | `src/controllers/addonController.js` | `/api/admin/addons*` routes | `Addon` documents changed |
| Admin meal-category CRUD | Manages meal categories | `src/controllers/mealCategoryController.js` | `/api/admin/meal-categories*` routes | `MealCategory` documents changed |
| Admin meal CRUD | Manages regular meals | `src/controllers/mealController.js` | `/api/admin/meals*` routes | `Meal` documents changed |
| Admin salad-ingredient CRUD | Manages salad ingredients | `src/controllers/saladIngredientController.js` | `/api/admin/salad-ingredients*` routes | `SaladIngredient` documents changed |
| Admin meal-ingredient CRUD | Manages custom-meal ingredients | `src/controllers/mealIngredientController.js` | `/api/admin/meal-ingredients*` routes | `MealIngredient` documents changed |
| Admin settings patch | Patches multiple settings in one request | `src/controllers/adminController.js -> patchSettings` | `PATCH /api/admin/settings` | `Setting` documents changed |
| Admin cutoff update | Updates cutoff time | `src/controllers/adminController.js -> updateCutoff` | `PUT /api/admin/settings/cutoff` | `Setting` changed |
| Admin delivery-window update | Updates delivery windows | `src/controllers/adminController.js -> updateDeliveryWindows` | `PUT /api/admin/settings/delivery-windows` | `Setting` changed |
| Admin skip-allowance update | Updates allowed skip count | `src/controllers/adminController.js -> updateSkipAllowance` | `PUT /api/admin/settings/skip-allowance` | `Setting` changed |
| Admin premium-price update | Updates premium pricing setting | `src/controllers/adminController.js -> updatePremiumPrice` | `PUT /api/admin/settings/premium-price` | `Setting` changed |
| Admin subscription-delivery-fee update | Updates subscription delivery fee | `src/controllers/adminController.js -> updateSubscriptionDeliveryFee` | `PUT /api/admin/settings/subscription-delivery-fee` | `Setting` changed |
| Admin VAT update | Updates VAT percentage | `src/controllers/adminController.js -> updateVatPercentage` | `PUT /api/admin/settings/vat-percentage` | `Setting` changed |
| Admin custom-salad base-price update | Updates base custom-salad price | `src/controllers/adminController.js -> updateCustomSaladBasePrice` | `PUT /api/admin/settings/custom-salad-base-price` | `Setting` changed |
| Admin custom-meal base-price update | Updates base custom-meal price | `src/controllers/adminController.js -> updateCustomMealBasePrice` | `PUT /api/admin/settings/custom-meal-base-price` | `Setting` changed |
| Admin app-user list/create/read/update | Manages client users from the dashboard | `src/controllers/adminController.js` | `/api/admin/users*` routes | `User` and related client data changed |
| Admin view user subscriptions | Reads one user's subscriptions | `src/controllers/adminController.js -> listAppUserSubscriptions` | `GET /api/admin/users/:id/subscriptions` | Subscription list |
| Admin subscriptions list/summary/export/read | Reads operational subscription data | `src/controllers/adminController.js` | `/api/admin/subscriptions*` read routes | Dashboard subscription payloads/export |
| Admin create subscription | Creates a subscription directly from dashboard without client checkout | `src/controllers/adminController.js -> createSubscriptionAdmin` | `POST /api/admin/subscriptions` | `Subscription` and `SubscriptionDay` data |
| Admin subscription cancel/extend/freeze/unfreeze/skip/unskip | Runs admin-side subscription operations | `src/controllers/adminController.js` | Matching `/api/admin/subscriptions/*` routes | Subscription or day state changed |
| Admin orders list/read | Reads one-time orders from dashboard | `src/controllers/adminController.js` | `/api/admin/orders*` routes | Order payloads |
| Admin payments list/read/verify | Reads and verifies payments from dashboard | `src/controllers/adminController.js` | `/api/admin/payments*` routes | Payment status and side effects |
| Admin dashboard-user CRUD | Manages dashboard accounts | `src/controllers/adminController.js` | `/api/admin/dashboard-users*` routes | `DashboardUser` documents changed |
| Admin dashboard-user password reset | Resets a dashboard user's password | `src/controllers/adminController.js -> resetDashboardUserPassword` | `POST /api/admin/dashboard-users/:id/reset-password` | Updated dashboard credentials |
| Admin activity-log read | Reads activity logs | `src/controllers/adminController.js -> listActivityLogs` | `GET /api/admin/logs` | Activity log payload |
| Admin notification-log read | Reads notification logs | `src/controllers/adminController.js -> listNotificationLogs` | `GET /api/admin/notification-logs` | Notification log payload |
| Admin manual cutoff trigger | Runs daily cutoff manually | `src/controllers/adminController.js -> triggerDailyCutoff` | `POST /api/admin/trigger-cutoff` | Cutoff automation run |

### Kitchen And Courier Features

| Feature | What it does | Lives in | Trigger | Produces or changes |
| --- | --- | --- | --- | --- |
| Kitchen daily subscription workload | Lists subscription days for one production date | `src/controllers/kitchenController.js -> listDailyOrders` | `GET /api/kitchen/days/:date` | Day workload payload |
| Kitchen bulk lock | Locks all open days for one date | `src/controllers/kitchenController.js -> bulkLockDaysByDate` | `POST /api/kitchen/days/:date/lock` | Locked day snapshots |
| Kitchen meal assignment | Saves assigned meals for a day | `src/controllers/kitchenController.js -> assignMeals` | `PUT /api/kitchen/subscriptions/:id/days/:date/assign` | Day assignment data |
| Kitchen subscription-day transitions | Moves a subscription day through lock, reopen, prep, delivery, and pickup states | `src/controllers/kitchenController.js` | Matching `/api/kitchen/subscriptions/:id/days/:date/*` routes | Day status changes |
| Kitchen pickup fulfillment | Completes a pickup day | `src/controllers/kitchenController.js -> fulfillPickup` | `POST /api/kitchen/subscriptions/:id/days/:date/fulfill-pickup` | Fulfilled `SubscriptionDay` |
| Kitchen one-time order list | Lists one-time orders by date | `src/controllers/orderKitchenController.js -> listOrdersByDate` | `GET /api/kitchen/orders/:date` | Order workload payload |
| Kitchen one-time order transitions | Moves one-time orders through kitchen states | `src/controllers/orderKitchenController.js -> transitionOrder` | Matching `/api/kitchen/orders/:id/*` routes | Order status changes |
| Courier today's subscription deliveries | Lists today's subscription deliveries for current courier | `src/controllers/courierController.js -> listTodayDeliveries` | `GET /api/courier/deliveries/today` | Delivery list |
| Courier subscription arriving-soon update | Marks a subscription delivery arriving soon | `src/controllers/courierController.js -> markArrivingSoon` | `PUT /api/courier/deliveries/:id/arriving-soon` | `Delivery` and notification state |
| Courier subscription delivered update | Marks a subscription delivery delivered | `src/controllers/courierController.js -> markDelivered` | `PUT /api/courier/deliveries/:id/delivered` | `Delivery` and `SubscriptionDay` fulfilled |
| Courier subscription cancel update | Cancels a subscription delivery | `src/controllers/courierController.js -> markCancelled` | `PUT /api/courier/deliveries/:id/cancel` | `Delivery` canceled and day adjusted |
| Courier today's one-time orders | Lists today's delivery orders for current courier | `src/controllers/orderCourierController.js -> listTodayOrders` | `GET /api/courier/orders/today` | Order delivery list |
| Courier one-time order transitions | Marks order delivery arriving, delivered, or canceled | `src/controllers/orderCourierController.js` | Matching `/api/courier/orders/:id/*` routes | `Order` and `Delivery` state changes |

### Payment, Notification, And Integration Features

| Feature | What it does | Lives in | Trigger | Produces or changes |
| --- | --- | --- | --- | --- |
| Moyasar invoice creation | Creates invoice-based payment links | `src/services/moyasarService.js -> createInvoice` | Checkout and top-up flows | External invoice + local payment metadata |
| Moyasar invoice fetch | Reads invoice state back from Moyasar | `src/services/moyasarService.js -> fetchInvoice` | Verify endpoints | Provider payment status |
| Moyasar webhook handling | Applies paid, failed, canceled, and expired payment events | `src/controllers/webhookController.js -> handleMoyasarWebhook` | `POST /api/webhooks/moyasar` | `Payment`, draft, order, wallet, or subscription updates |
| Shared payment side-effect dispatcher | Routes paid payments to the correct business logic | `src/services/paymentApplicationService.js -> applyPaymentSideEffects` | Webhook and verify endpoints | Activation, top-up, extra, or order writes |
| OTP over WhatsApp | Sends WhatsApp OTP messages | `src/services/twilioWhatsappService.js` | OTP request flows | Outbound WhatsApp message |
| Push notification send | Sends push notifications to saved FCM tokens | `src/utils/notify.js` | Order, delivery, and scheduled reminder flows | Firebase push send |
| Notification dedupe and logging | Prevents duplicate sends and stores send logs | `src/services/notificationService.js`, `src/models/NotificationLog.js` | Notification sends | Notification log records |
| Order lifecycle notifications | Sends order-related push messages | `src/services/orderNotificationService.js` | Order checkout/verify/delivery flows | User push notifications |
| Arriving-soon scheduler | Sends 1-hour arrival reminders for due deliveries | `src/services/notificationSchedulerService.js -> processDueDeliveryArrivingSoon` | Background job loop | Reminder notifications |
| Meal-selection reminder scheduler | Reminds clients to choose tomorrow's meals | `src/services/notificationSchedulerService.js -> processDailyMealSelectionReminders` | Background job loop after 22:00 KSA | Reminder notifications |
| Subscription-expiry reminder scheduler | Reminds clients about upcoming expiry | `src/services/notificationSchedulerService.js -> processSubscriptionExpiryReminders` | Background job loop after 09:00 KSA | Reminder notifications |
| Daily cutoff automation | Runs the daily cutoff process once per KSA day | `src/services/automationService.js -> processDailyCutoff` | Background job loop after configured cutoff or admin trigger | Daily state changes tied to cutoff |
| Cloudinary upload | Uploads admin images to Cloudinary | `src/services/cloudinaryUploadService.js` | Admin image upload and image-backed CRUD | Stored image asset and URL |

## 4. The Data

### Stored Data And What It Means In Real Life

| Data | What it means in real life | Main write points | Main read points |
| --- | --- | --- | --- |
| `User` in `src/models/User.js` | The real client account used for auth, profile, and push tokens | OTP verify, profile update, admin user management | Client profile, subscription and order ownership checks, notifications |
| `AppUser` in `src/models/AppUser.js` | App-facing user mirror keyed by phone, used during OTP and profile linking | OTP verify, profile sync, admin user creation | Registration checks and client-user linking |
| `DashboardUser` in `src/models/DashboardUser.js` | Internal staff login account for `superadmin`, `admin`, `kitchen`, or `courier` | Dashboard auth, startup seeding, admin dashboard-user CRUD | Dashboard auth middleware and admin account screens |
| `Otp` in `src/models/Otp.js` | One pending OTP attempt for a phone number | OTP request flows | OTP verify flow |
| `Plan` in `src/models/Plan.js` | A sellable subscription package with day count and grams/meals price matrix | Admin plan CRUD | Menu, quote, checkout, renewal, admin views |
| `MealCategory` in `src/models/MealCategory.js` | A category label for regular meals | Admin meal-category CRUD | Public and admin meal reads |
| `Meal` in `src/models/Meal.js` | A regular meal the business can sell | Admin meal CRUD | Menus, order checkout, day planning |
| `PremiumMeal` in `src/models/PremiumMeal.js` | A premium meal that costs extra | Admin premium-meal CRUD | Subscription menu, quote, day planning, wallet flows |
| `Addon` in `src/models/Addon.js` | An extra item that can be recurring or one-time | Admin add-on CRUD | Subscription menu, quote, day planning, wallet flows |
| `SaladIngredient` in `src/models/SaladIngredient.js` | An ingredient option for custom salads | Admin salad-ingredient CRUD | Custom salad preview and purchase |
| `MealIngredient` in `src/models/MealIngredient.js` | An ingredient option for custom meals | Admin meal-ingredient CRUD | Custom meal preview and purchase |
| `Zone` in `src/models/Zone.js` | A delivery area with its own fee | Seed/admin data and settings flows | Delivery options and checkout pricing |
| `Setting` in `src/models/Setting.js` | Business rules like cutoff time, windows, pickup points, prices, VAT, and allowances | Admin settings updates | Menus, checkout, scheduling, operations-meta, custom pricing |
| `CheckoutDraft` in `src/models/CheckoutDraft.js` | A pending subscription checkout or renewal before payment is fully applied | Subscription checkout and renewal | Draft status, payment verify, activation |
| `Subscription` in `src/models/Subscription.js` | A client's paid meal-plan contract and wallet balance | Activation, renewal, admin create, freeze/skip/delivery updates, top-ups | Client app, admin, kitchen, courier, reminders |
| `SubscriptionDay` in `src/models/SubscriptionDay.js` | One day inside a subscription, including meals, status, delivery override, custom items, and payment state | Activation, day planning, freeze/skip/pickup, kitchen/courier transitions | Client day views, kitchen, courier, reminders |
| `Payment` in `src/models/Payment.js` | Any invoice-backed money event in the system | Checkout, renewal, top-ups, day extras, order checkout | Webhook, verify endpoints, admin payment views |
| `Order` in `src/models/Order.js` | A one-time meal order outside the subscription system | Order checkout, custom-item append, payment verify, kitchen/courier transitions | Client order views, admin orders, kitchen, courier |
| `Delivery` in `src/models/Delivery.js` | A delivery task tied to a subscription day or one-time order | Fulfillment and courier flows | Courier views and delivery status changes |
| `ActivityLog` in `src/models/ActivityLog.js` | Internal audit-style log entries | Various admin and system write points | Admin log screen |
| `NotificationLog` in `src/models/NotificationLog.js` | A record of sent or deduped notifications | Notification service and scheduler flows | Admin notification logs and dedupe checks |

### How Data Moves Through The System

1. An HTTP request enters an Express route in `src/routes/*.js`.
2. The route hands control to a controller in `src/controllers/*.js`.
3. The controller validates the request, checks auth and role middleware, and calls service code when the logic is shared or payment-related.
4. Services and controllers read and write Mongo documents through the Mongoose models in `src/models/*.js`.
5. When money is involved, the controller creates a `Payment` first and calls Moyasar through `src/services/moyasarService.js`.
6. When the provider later says the payment is paid, the webhook or verify route updates the same `Payment` and then writes the real business record that the payment was for.
7. Read endpoints later rebuild app or dashboard responses from those stored documents plus live settings and localized text.
8. Background jobs read the same stored subscription, day, delivery, and user data to send reminders and run cutoff automation.

## 5. What Connects To What

### Feature Dependency Map

| Feature or area | Depends on | What breaks if it is removed |
| --- | --- | --- |
| Client auth | `Otp`, `User`, `AppUser`, `otpService`, `appTokenService` | Clients cannot sign in, verify, or reach protected app routes |
| Plans and catalog | `Plan`, `Meal`, `PremiumMeal`, `Addon`, `MealCategory`, ingredient models, `Setting` | Menus, quotes, checkout, and admin catalog screens stop working |
| Settings | `Setting` values like cutoff, windows, fees, VAT, prices | Checkout math, menu output, delivery options, skip allowance, reminders, and cutoff behavior become wrong or incomplete |
| Subscription checkout | `Plan`, catalog models, `Setting`, `CheckoutDraft`, `Payment`, `moyasarService` | New subscription purchases and renewals cannot start |
| Payment system | `Payment`, Moyasar invoice creation, webhook/verify code, payment side-effect dispatcher | Subscription activation, wallet top-ups, day extras, and one-time order payment all stop finishing |
| Checkout drafts | `CheckoutDraft` plus payment verification logic | Subscription checkout idempotency, recovery, and activation tracking break |
| Subscription activation | `subscriptionActivationService`, `Subscription`, `SubscriptionDay` | Paid subscriptions never become usable day-by-day plans |
| Subscription days | `SubscriptionDay` plus subscription service logic | Day planning, freeze, skip, pickup, kitchen worklists, courier delivery, and reminders break |
| Wallet logic | `Subscription`, premium/add-on wallet services, `Payment` | Premium selections, add-on selections, premium overage, and credit top-ups stop working |
| One-time orders | `Order`, `Payment`, menu pricing, order payment verify, kitchen/courier order controllers | The non-subscription buying flow stops working |
| Delivery records | `Delivery`, kitchen/courier controllers, fulfillment services | Courier views and delivery status tracking stop working cleanly |
| Dashboard auth | `DashboardUser`, `dashboardTokenService`, `dashboardAuth` middleware | Admin, kitchen, and courier routes become inaccessible |
| Admin management routes | Dashboard auth plus the core models they manage | No internal way to manage catalog, settings, users, payments, or reports |
| Push notifications | `User.fcmTokens`, Firebase send code, `NotificationLog` | Arrival, reminder, and order push notifications stop being sent and deduped |
| Background jobs | `startJobs`, settings, subscriptions, days, deliveries, notifications | Automatic cutoff, meal reminders, arrival reminders, and expiry reminders stop running |

### Feature-Level Connections

- Subscription purchase depends on the catalog being active and the settings being readable. If plans, premium meals, add-ons, zones, or settings are missing, quote and checkout cannot build a correct total.
- Subscription day planning depends on subscription activation having already created `SubscriptionDay` records. Without activation, there is nothing to plan.
- Premium overage and one-time add-on day payments depend on the general payment system. Without `Payment` and webhook/verify support, those day states remain unpaid and planning confirmation can block.
- Freeze and skip both depend on `SubscriptionDay` state plus rules from `subscriptionService` and `subscriptionOperationsReadService`. Remove those rules and the app no longer knows what actions are allowed.
- Kitchen flows depend on subscription day and order states already existing. The kitchen routes do not create subscriptions or orders; they only operate on existing ones.
- Courier flows depend on delivery-side records and fulfillment services. If `Delivery` or fulfillment logic is removed, courier actions stop updating the business state correctly.
- Admin create-subscription depends on the same subscription activation path used by paid checkout, just without the client payment step.
- Notifications depend on business events created by orders, subscription days, deliveries, and scheduled jobs. Remove those source records and there is nothing meaningful to notify about.

### Current Incompleteness Or Conditional Behavior

- Saved-card or tokenized payment-method management does not exist in the live code. The API exposes a read endpoint that explicitly says it is unsupported.
- Delivery mode can be updated at checkout time, but changing the delivery mode later is explicitly not supported in operations metadata.
- Mock activation and mock order confirmation are for non-production only.
- Some subscription internals are conditional:
- `PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE`, `PHASE1_CANONICAL_DRAFT_ACTIVATION`, `PHASE1_CANONICAL_ADMIN_CREATE`, `PHASE1_SHARED_PAYMENT_DISPATCHER`, `PHASE1_SNAPSHOT_FIRST_READS`, and `PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY` change how checkout and payment application behave.
- `PHASE2_CANONICAL_DAY_PLANNING` changes whether the confirm-day-planning path is active.
- `PHASE2_GENERIC_PREMIUM_WALLET` changes whether premium balance is handled in the newer generic-wallet mode or the older legacy-premium mode.
