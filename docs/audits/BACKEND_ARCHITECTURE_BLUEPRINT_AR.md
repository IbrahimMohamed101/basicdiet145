> Status: Historical / audit reference. Do not use this as the current frontend or API implementation source of truth. For current frontend handoff docs, see `docs/frontend-handoff/`.

# BasicDiet Backend Architecture Blueprint

هذا التقرير يوثق البنية الحالية كما تظهر من الكود والاختبارات والوثائق في المستودع. لم يتم تشغيل seeds أو migrations، ولم يتم تغيير أي كود. قرأت أولاً `graphify-out/GRAPH_REPORT.md` حسب تعليمات المشروع؛ أهم العقد المركزية كانت حول `validateObjectId()`, `getRequestLang()`, `performSubscriptionCheckout()`, `performSubscriptionRenewal()`, و `buildSubscriptionTimeline()`، وهذا يؤكد أن النظام متشعب حول التحقق، اللغة، الاشتراكات، والـ timeline.

## 1. Executive Summary

الـ backend هو تطبيق Express/Node.js يستخدم MongoDB عبر Mongoose. وظيفته إدارة مصادقة التطبيق، مصادقة Dashboard، طلبات one-time، كتالوج one-time menu، الاشتراكات وmeal planner، الدفع عبر Moyasar، webhooks، عمليات Dashboard، عمليات kitchen/courier، المحتوى والإعدادات والرفع، بالإضافة إلى scripts واختبارات تحقق.

النمط المعماري الحالي هو طبقات تقليدية:

```text
Route -> Middleware -> Controller -> Service -> Mongoose Model -> Response/Serializer
```

نقاط modularity الواضحة:

- one-time orders لها حزمة خدمات داخل `src/services/orders/`.
- الاشتراكات لها حزمة كبيرة داخل `src/services/subscription/`.
- كتالوج one-time menu مفصول في models وخدمة `menuCatalogService`.
- عمليات dashboard للطلبات one-time مفصولة في `orderDashboardService` و `orderOpsTransitionService`.
- الدفع المركزي موجود في `Payment` وخدمات Moyasar/تطبيق الدفع، لكن تطبيق الدفع يختلف حسب نوع المصدر.

مناطق التداخل/الازدواج:

- هناك كتالوج one-time مستقل (`MenuCategory`, `MenuProduct`, `MenuOption*`) وكتالوج subscription planner مستقل (`BuilderProtein`, `BuilderCarb`, `SaladIngredient`, `Addon`, `Sandwich`, `Plan`).
- مفاهيم proteins/carbs/salad/sauces/addons/images/names/active/sort موجودة في النظامين، لكن قواعد التسعير والاختيار مختلفة.
- يوجد legacy compatibility في `Order`, `SubscriptionDay`, و`Addon`، ما يعني أن أي refactor واسع قد يكسر عقوداً قديمة غير واضحة بالكامل.

أكثر المناطق خطورة: payments/webhooks، idempotency، pricing بالـ Halala وVAT included، `SubscriptionDay` transitions، day payments للـ premium/addons، redirect URLs، وresponse shapes المتوقعة من Flutter.

## 2. Repository Top-Level Map

`src/`: الكود التشغيلي الأساسي. يعدل عند تغيير API أو منطق العمل أو النماذج.

`src/app.js`: يبني Express app، يضيف `helmet`, `cors`, JSON body limit، تطبيع top-level `status`، sanitization عبر `validateAndFixResponse`, health endpoints، Swagger UI، تركيب payment public routes، ثم `/api` مع `requestLanguageMiddleware`، ومعالج الأخطاء.

`src/index.js`: نقطة تشغيل الإنتاج. يقرأ env، يتحقق بـ `validateEnv()`, يتصل بقاعدة البيانات عبر `connectDb()`, يشغل jobs، ثم يبدأ HTTP server.

`src/config/`: إعدادات مثل `cloudinary.js`, `env.js`, و`mealPlannerContract.js`. يعدل عند تغيير عقود planner أو env/config.

`src/controllers/`: طبقة HTTP orchestration. أمثلة: `orderController.js`, `subscriptionController.js`, `paymentController.js`, `webhookController.js`, `dashboard/menuController.js`, `admin/mealPlannerMenu.controller.js`.

`src/routes/`: تعريف endpoints وتركيب middleware. أمثلة: `orders.js`, `subscriptions.js`, `payments.js`, `webhooks.js`, `dashboardMenu.js`, `dashboardOrders.js`, `dashboardOps.js`, `kitchen.js`, `courier.js`.

`src/models/`: Mongoose schemas والعلاقات والفهارس. أمثلة: `Order.js`, `Payment.js`, `Subscription.js`, `SubscriptionDay.js`, `MenuProduct.js`, `BuilderProtein.js`.

`src/services/`: منطق العمل القابل لإعادة الاستخدام. أهم الحزم: `orders/`, `subscription/`, `dashboard/`, `kitchenOperations/`, `admin/mealPlannerMenu.service.js`, `moyasarService.js`, `paymentApplicationService.js`.

`src/middleware/`: المصادقة، rate limit، اللغة، upload، async wrapper. أمثلة: `auth.js`, `dashboardAuth.js`, `rateLimit.js`, `requestLanguage.js`.

`src/utils/`: helpers مشتركة مثل `paymentRedirectUrls.js`, `pricing.js`, `orderState.js`, `apiError.js`, `validateEnv.js`, `optionalPagination.js`.

`scripts/`: seeds/migrations/validation. أمثلة: `seed-one-time-menu.js`, `seedBuilderCatalogData.js`, `migrate-builder-protein-groups.js`, `validate-backend.js`, `validate-data-integrity.js`. لا تشغل ضد production إلا مع guardrails واضحة.

`tests/`: اختبارات unit/integration/contract. أمثلة: `oneTimeMenuCatalog.test.js`, `oneTimeOrderFullFlow.test.js`, `mobileApiContracts.test.js`, `mealPlanner.integration.test.js`, `webhookSecurity.test.js`.

`docs/`: وثائق تصميم وتشغيل. أمثلة: `meal-planner/MEAL_PLANNER_CANONICAL_CONTRACT.md`, `one-time-orders/one-time-menu-catalog.md`, `backend/BACKEND_VALIDATION_STRATEGY_AR.md`.

`graphify-out/`: knowledge graph. يحتوي `GRAPH_REPORT.md`, `graph.json`, `graph.html`. يستخدم قبل أسئلة architecture.

`logs/`: سجلات تشغيل إن وجدت. يبدو من هيكل الملفات أنها ليست طبقة منطق عمل.

## 3. Request Lifecycle Architecture

المسار العام:

```text
Client -> src/app.js -> src/routes/index.js -> middleware -> controller -> service -> model/db -> serializer/response
```

`GET /api/orders/menu`: يدخل عبر `src/routes/orders.js` بدون auth، إلى `orderController.getOrderMenu`، ثم `orderMenuService.getOneTimeOrderMenu` و/أو `menuCatalogService.getPublishedMenu`، ويقرأ published menu models و`Setting`.

`POST /api/orders/quote`: بعد `authMiddleware` و`checkoutLimiter` يذهب إلى `orderController.quoteOrder` ثم `menuPricingService.priceMenuCart`. الخدمة تتحقق من منع حقول subscription عبر `assertNoForbiddenOneTimeFields` وتعيد تسعيراً من السيرفر.

`POST /api/orders` أو `/checkout`: ينشئ order/payment في `orderController`. توجد request hash/idempotency من `idempotencyKey` و`requestHash`. الإنشاء يربط `Order` بـ `Payment` ويستدعي `moyasarService.createInvoice`.

Dashboard order transition: `POST /api/dashboard/orders/:orderId/actions/:action` يدخل عبر `dashboardAuthMiddleware` وrole middleware، ثم `orderDashboardController.handleOrderAction`، ثم `orderDashboardService.executeDashboardOrderAction`، ثم `orderOpsTransitionService.executeOrderAction`، ويكتب `ActivityLog`.

Payment verify/webhook: `GET /api/payments/verify` يستخدم `paymentController.verifyPayment` و`paymentFlowService`. Webhook يدخل عبر `POST /api/webhooks/moyasar` إلى `webhookController.handleMoyasarWebhook`. one-time order payments تمر عبر `orderPaymentService.applyOrderWebhookInvoice`. الاشتراكات/day payments تمر عبر `paymentApplicationService` أو خدمات subscription payment المتخصصة.

اللغة: `/api` كله يمر عبر `requestLanguageMiddleware`. الأخطاء تمر غالباً عبر `asyncHandler` و`errorResponse`. Serialization موجودة صراحة في `orderSerializationService` للطلبات، وفي خدمات subscription client serialization/support للاشتراكات.

## 4. Domain Architecture Map

### 4.1 Authentication

App auth:

- Routes: `src/routes/auth.js`, `src/routes/appAuth.js`.
- Controllers: `authController.js`, `appAuthController.js`.
- Services: `otpService.js`, `twilioWhatsappService.js`, `appTokenService.js`.
- Models: `User.js`, `AppUser.js`, `Otp.js`.
- Middleware: `authMiddleware` في `src/middleware/auth.js`.
- OTP endpoints: `/api/auth/otp/request`, `/api/auth/otp/verify`, وapp aliases `/api/app/login`, `/api/app/register`, `/api/app/verify`.

Dashboard auth:

- Routes: `src/routes/dashboardAuth.js`.
- Controller: `dashboardAuthController.js`.
- Services: `dashboardTokenService.js`, `dashboardPasswordService.js`.
- Model: `DashboardUser.js`.
- Middleware: `dashboardAuthMiddleware`, `dashboardOptionalAuthMiddleware`, `dashboardRoleMiddleware`.
- توجد lockout settings عبر env (`DASHBOARD_AUTH_LOCK_MINUTES`, `DASHBOARD_AUTH_MAX_FAILED_ATTEMPTS`).

### 4.2 One-Time Orders

- Routes: `src/routes/orders.js`.
- Controller: `src/controllers/orderController.js`.
- Models: `Order.js`, `Payment.js`, ويظهر ارتباط legacy/custom بـ `SaladIngredient`, `MealIngredient`, `MenuProduct`, `MenuVersion`.
- Services: `orderMenuService.js`, `orderPricingService.js`, `menuCatalogService.js`, `menuPricingService.js`, `orderPaymentService.js`, `orderSerializationService.js`, `idempotencyService.js`.
- Tests: `oneTimeOrderFullFlow.test.js`, `mobileApiContracts.test.js`, `oneTimeMenuCatalog.test.js`, `oneTimeOrderOps.test.js`, `orderPaymentIdempotency.test.js`, `oneTimeOrderDeliveryGate.test.js`.

التدفق الحالي:

- menu retrieval من `/api/orders/menu`.
- quote من `/api/orders/quote` بتسعير backend، Halala، VAT included.
- create/checkout ينشئ `Order` بحالة `pending_payment` و`Payment` نوعه `one_time_order`.
- idempotency موجودة عبر `idempotencyKey` و`requestHash` وفهارس `Order`.
- pickup-only موثق ومختبر؛ delivery مرفوض في اختبارات `oneTimeMenuCatalog.test.js` و`oneTimeOrderDeliveryGate.test.js`.
- snapshots محفوظة في `Order.items.productSnapshot`, `selectedOptions`, `pricingSnapshot`, و`menuVersionId`.
- tracking/detail عبر `GET /api/orders`, `GET /api/orders/:id`, و`GET /api/orders/:id/payment-status`.
- Dashboard visibility عبر `src/routes/dashboardOrders.js` وخدمة `orderDashboardService`.

### 4.3 One-Time Menu Catalog

- Models: `MenuCategory`, `MenuProduct`, `MenuOptionGroup`, `MenuOption`, `ProductOptionGroup`, `ProductGroupOption`, `MenuVersion`, `MenuAuditLog`.
- Dashboard routes: `src/routes/dashboardMenu.js`.
- Dashboard controller: `src/controllers/dashboard/menuController.js`.
- Services: `src/services/orders/menuCatalogService.js`, `src/services/orders/menuPricingService.js`.
- Seed: `scripts/seed-one-time-menu.js`.
- Docs: `docs/one-time-orders/one-time-menu-catalog.md`.
- Tests: `tests/oneTimeMenuCatalog.test.js`.

العلاقات:

- `MenuCategory -> MenuProduct`.
- `MenuProduct -> ProductOptionGroup -> MenuOptionGroup`.
- `MenuProduct + MenuOptionGroup -> ProductGroupOption -> MenuOption`.
- `MenuVersion` يحتفظ snapshot عند publish.
- `MenuAuditLog` يسجل CRUD/reorder/visibility/availability/publish.

السلوك الظاهر:

- Dashboard CRUD يدير categories/products/groups/options/relations/selection rules.
- publish عبر `POST /api/dashboard/menu/publish`.
- customer catalog يقرأ المنشور والمتاح فقط.
- quote/create يعيدان التحقق من catalog availability، ما يحمي من stale mobile selections.

### 4.4 Subscription / Meal Planner

- Routes: `src/routes/subscriptions.js`, `src/routes/adminMealPlannerMenu.routes.js`, وبعض admin routes في `src/routes/admin.js`.
- Controller: `subscriptionController.js`, `menuController.js`, `admin/mealPlannerMenu.controller.js`.
- Services: معظم `src/services/subscription/`، خاصة `subscriptionQuoteService`, `subscriptionCheckoutService`, `subscriptionActivationService`, `mealSlotPlannerService`, `subscriptionTimelineService`, `subscriptionSelectionClientService`, `subscriptionDay*`, `unifiedDayPaymentService`.
- Admin catalog service: `src/services/admin/mealPlannerMenu.service.js`.
- Models: `Subscription`, `SubscriptionDay`, `Plan`, `BuilderProtein`, `BuilderCarb`, `BuilderCategory`, `SaladIngredient`, `Addon`, `Sandwich`, `CheckoutDraft`.
- Docs: `docs/meal-planner/MEAL_PLANNER_CANONICAL_CONTRACT.md`, `docs/product-flows/unified-selection-payment-flow.md`, `docs/dashboard-api/SUBSCRIPTION_TIMELINE_AND_DAY_CONSUMPTION_LOGIC_AR.md`.
- Tests: `checkout.integration.test.js`, `mealPlanner.integration.test.js`, `meal_planner_types.test.js`, `mealPlannerPaymentContract.test.js`, `subscriptionBalancePolicy.test.js`, `subscriptionDayModificationPolicy.test.js`, `fulfillmentStatusEndpoint.test.js`.

التدفق:

- `POST /api/subscriptions/quote` يحسب quote.
- `POST /api/subscriptions/checkout` ينشئ draft/payment.
- verify ينشط الاشتراك وينشئ days.
- `SubscriptionDay.mealSlots` هو مصدر planner canonical حسب docs.
- selection/update/validate/confirm عبر `/days/:date/selection`, `/selection/validate`, `/confirm`.
- skip/freeze/delivery updates/pickup prepare موجودة كخدمات منفصلة.
- premium/overage/addon payments عبر unified day payment وخدمات `premiumExtraDayPaymentService`, `premiumOverageDayPaymentService`, `oneTimeAddonDayPlanningPaymentService`.

### 4.5 Payments

- Routes: `src/routes/payments.js`, `src/routes/webhooks.js`, وأيضاً endpoints داخل orders/subscriptions.
- Controllers: `paymentController.js`, `webhookController.js`.
- Model: `Payment.js`.
- Services: `moyasarService.js`, `paymentFlowService.js`, `paymentApplicationService.js`, `paymentProviderMetadataService.js`, `orders/orderPaymentService.js`, `subscription/*PaymentService.js`.
- Utils: `utils/paymentRedirectUrls.js`.
- Tests: `paymentInitLogging.test.js`, `webhookSecurity.test.js`, `orderPaymentIdempotency.test.js`, `moyasar_retry.test.js`, `unified_day_payment_verify.test.js`.

`Payment.type` يدعم: `one_time_order`, `subscription_activation`, `subscription_renewal`, `premium_extra_day`, `day_planning_payment`, `one_time_addon_day_planning`, custom salad/meal types، وغيرها. يوجد unique indexes على `providerInvoiceId`, `providerPaymentId`, و`operationIdempotencyKey`.

Redirect URLs يتم تطبيعها في `normalizePaymentRedirectUrls`: يقبل HTTPS فقط، ويستخدم fallback `/payment-success` و`/payment-cancel`. deep links غير HTTPS لا تمر كـ provider redirect مباشر، ويبدو أنها تعالج عبر backend fallback.

### 4.6 Dashboard Operations

- Routes: `dashboardOrders.js`, `dashboardBoards.js`, `dashboardOps.js`, وadmin dashboard routes داخل `admin.js`.
- Controllers: `dashboard/orderDashboardController.js`, `dashboard/opsActionController.js`, `dashboard/opsBoardController.js`, `dashboard/opsController.js`, `dashboard/cashierController.js`.
- Services: `services/dashboard/opsActionPolicy.js`, `opsReadService.js`, `opsSearchService.js`, `opsTransitionService.js`, `orders/orderOpsTransitionService.js`, `orders/orderDashboardService.js`.
- Model: `ActivityLog.js`.
- Tests: `oneTimeOrderOps.test.js`, `opsSearchService.test.js`, dashboard admin tests.

Dashboard orders one-time تستخدم `source = one_time_order` و`entityType = order`. Unified ops يتعامل كذلك مع subscription days. مسارات cashier موجودة تحت `/api/dashboard/ops/cashier/*`.

### 4.7 Kitchen / Courier / Fulfillment

- Routes: `src/routes/kitchen.js`, `src/routes/courier.js`.
- Controllers: `kitchenController.js`, `courierController.js`, `kitchenOperationsController.js`, `orderKitchenController.js`, `orderCourierController.js`.
- Services: `services/kitchenOperations/*`, `fulfillmentService.js`, `deliveryWorkflowService.js`, `deliveryOperationsService.js`.
- Models: `SubscriptionDay`, `Delivery`, `Order`, `ActivityLog`.

Subscription fulfillment يدعم statuses مثل `locked`, `in_preparation`, `out_for_delivery`, `ready_for_pickup`, `fulfilled`, `delivery_canceled`, `canceled_at_branch`, `no_show`. One-time pickup ops lifecycle موثق كـ `confirmed -> in_preparation -> ready_for_pickup -> fulfilled`. دعم one-time delivery يبدو محدوداً ومحاطاً ببوابات/اختبارات؛ بالنسبة للـ launch الحالي one-time pickup-only.

### 4.8 Settings / Content / Uploads / Misc

- Settings/admin: `src/routes/admin.js`, `settingsController.js`, `Setting.js`.
- Content/legal: `src/routes/content.js`, `contentController.js`, `appContentService.js`, `AppContent.js`, و`defaultSubscriptionTermsAr.js`.
- Uploads: `src/config/cloudinary.js`, `cloudinaryUploadService.js`, `adminImageService.js`, `middleware/imageUpload.js`, endpoint `/api/admin/uploads/image`.
- Zones: `Zone.js`, `zoneController.js`.
- Notifications: `notificationService.js`, `notificationSchedulerService.js`, `NotificationLog.js`, FCM/Twilio helpers.

## 5. Data Model Relationship Map

One-Time:

- `MenuCategory` يحتوي `MenuProduct`.
- `MenuProduct` يرتبط بـ `ProductOptionGroup` التي تربطه بـ `MenuOptionGroup`.
- `MenuOptionGroup` يحتوي `MenuOption`.
- `ProductGroupOption` يحدد option داخل product/group، مع overrides للأسعار/الأوزان والإتاحة.
- `MenuVersion` يحفظ publish snapshot؛ `MenuAuditLog` يسجل تغييرات الكتالوج.
- `Order` يحتوي `items` snapshots ويرتبط بـ `Payment` عبر `paymentId`.
- `Order.items` قد تحمل `productId`, `menuVersionId`, `productSnapshot`, `selectedOptions`, `pricingSnapshot`.

Subscription:

- `User/AppUser -> Subscription`.
- `Subscription -> SubscriptionDay` عبر `subscriptionId`.
- `Plan -> Subscription` عبر `planId`.
- `SubscriptionDay.mealSlots` يشير إلى `BuilderProtein`, `BuilderCarb`, وأحياناً `Meal`/`Sandwich` حسب الحقول.
- `BuilderProtein/BuilderCarb` يستخدمان `BuilderCategory`.
- `SaladIngredient` يغذي premium large salad groups.
- `Addon` يستخدم كـ plan/item، subscription/one_time حسب `kind` و`billingMode`.

Payment:

- `Payment` يرتبط اختيارياً بـ `orderId` أو `subscriptionId`.
- provider IDs: `providerInvoiceId`, `providerPaymentId`.
- idempotency: `operationIdempotencyKey`, `operationRequestHash`, وفهارس unique جزئية.

Dashboard:

- `DashboardUser` هو مستخدم Dashboard مستقل.
- `ActivityLog` يسجل entityType/entityId/action/byRole/meta.

انظر `docs/audits/backend-architecture-map.mmd` لمخطط Mermaid compact.

## 6. Business Flow Diagrams

### 6.1 One-Time Order Flow

```text
GET /api/orders/menu
-> POST /api/orders/quote
-> POST /api/orders or /api/orders/checkout
-> Order pending_payment + Payment one_time_order
-> Moyasar invoice/paymentUrl
-> verify or webhook
-> Order confirmed + paymentStatus paid
-> Dashboard prepare
-> ready_for_pickup
-> fulfilled
```

### 6.2 Subscription Checkout Flow

```text
POST /api/subscriptions/quote
-> POST /api/subscriptions/checkout
-> CheckoutDraft + Payment subscription_activation
-> Moyasar payment
-> verifyCheckoutDraftPayment or webhook
-> activate subscription
-> generate SubscriptionDay rows
-> meal planner selection/update/confirm
-> optional day payments for premium/addons
-> kitchen/courier/pickup fulfillment
```

### 6.3 Dashboard Operations Flow

```text
dashboard auth
-> list/search/queue/detail
-> allowedActions/action policy
-> transition service
-> model update
-> ActivityLog
-> serialized DTO
```

### 6.4 Payment Flow

```text
create local Payment
-> normalize redirect URLs / attach redirect context
-> create Moyasar invoice
-> save provider invoice id/url
-> verify endpoint or Moyasar webhook
-> normalize provider status
-> apply payment side effect
-> mark Payment applied
-> update Order/Subscription/SubscriptionDay
```

## 7. One-Time Menu vs Subscription Menu Comparison

### Current One-Time Menu System

- Source models: `MenuCategory`, `MenuProduct`, `MenuOptionGroup`, `MenuOption`, `ProductOptionGroup`, `ProductGroupOption`, `MenuVersion`, `MenuAuditLog`.
- Admin CRUD: `/api/dashboard/menu/*` in `dashboardMenu.js`.
- Customer endpoint: `/api/orders/menu`.
- Pricing: `menuPricingService.priceMenuCart`, supports `fixed` and `per_100g`, extra option price/weight.
- Option rules: `minSelections`, `maxSelections`, required/visibility/availability per product relation.
- Snapshots: `Order.items.productSnapshot`, `selectedOptions`, `pricingSnapshot`, `menuVersionId`.
- Tests: `oneTimeMenuCatalog.test.js`, `oneTimeOrderFullFlow.test.js`, `mobileApiContracts.test.js`.

### Current Subscription Menu System

- Source models: `Plan`, `BuilderProtein`, `BuilderCarb`, `BuilderCategory`, `SaladIngredient`, `Addon`, `Sandwich`.
- Admin CRUD: `/api/admin/meal-planner-menu/*` and `/api/dashboard/meal-planner/*`; broader admin catalog also exists in `admin.js`.
- Customer endpoints: `/api/subscriptions/menu`, `/api/subscriptions/meal-planner-menu`, `/api/subscriptions/delivery-options`.
- Pricing/plan logic: `subscriptionQuoteService`, `subscriptionCheckoutService`, `Plan.gramsOptions.mealsOptions`, addon billing modes, premium balances.
- Selection rules: `mealSlotPlannerService` and `mealPlannerContract.js`.
- Day/slot logic: `SubscriptionDay.mealSlots`, `plannerMeta`, `premiumExtraPayment`, `materializedMeals`.
- Tests: `meal_planner_types.test.js`, `mealPlanner.integration.test.js`, `checkout.integration.test.js`, `mealPlannerPaymentContract.test.js`.

### Overlap

- proteins.
- carbs.
- salad ingredients/groups/sauces.
- sandwiches.
- add-ons.
- localized names/descriptions.
- images.
- active/available flags.
- sort ordering.
- pricing labels/currency.

### Differences

- One-time يدعم weight pricing وoptions per product.
- Subscription يعتمد على plan allowance وmeals per day/grams/days count.
- Subscription لديه meal slots وday lifecycle.
- Subscription لديه skip/freeze/cutoff.
- Subscription لديه premium balance/overage/addon entitlements/day payments.
- One-time لديه order snapshots وحياة order payment منفصلة.
- Subscription planning snapshots وmaterialized meals تختلف عن order item snapshots.

### Risk of Keeping Duplication

- احتمال اختلاف أسماء/صور/إتاحة نفس المكونات بين القناتين.
- صعوبة إدارة active flags/sort ordering مرتين.
- تكلفة أعلى في QA عند إضافة protein/carb/sauce جديد.
- احتمال أن يظهر عنصر في one-time ولا يظهر في subscription أو العكس دون قصد.

### Risk of Full Unification

- دمج كامل قد يكسر pricing: one-time `per_100g` لا يساوي subscription plan allowance.
- قد يخلط order lifecycle مع `SubscriptionDay` lifecycle.
- قد يكسر Flutter contracts القائمة للـ menu والـ planner.
- قد يخلط addons: subscription plan add-ons ليست item add-ons اليومية دائماً.
- خطر على payment metadata/snapshots لأن كل تدفق يعتمد على metadata مختلفة.

### Recommended Direction

التوصية: Shared base catalog + channel-specific rules/adapters، مع بقاء business flows منفصلة.

بمعنى: يمكن مشاركة identity/name/image/category/sort/active لبعض المواد، لكن قواعد one-time pricing/options/snapshots تبقى في adapter one-time، وقواعد subscription allowance/slots/premium/skip/freeze/day payments تبقى في adapter subscription. الدمج الكامل الآن عالي المخاطر.

## 8. Existing Validation & Test Coverage Map

أوامر موجودة:

- `npm run validate:backend`: يشغل الاختبارات الأساسية كما في `scripts/validate-backend.js`.
- `npm run test:one-time-full-flow`: one-time E2E تقريباً.
- `npm run test:mobile-contracts`: عقود mobile API.
- `npm run test:one-time-menu`: كتالوج one-time وDashboard menu CRUD/pricing/snapshots.
- `npm run test:payment-init-logging`: logging آمن عند init payment.
- `NODE_ENV=test node tests/webhookSecurity.test.js`: webhook security مع DB اختبار.
- `NODE_ENV=test node tests/orderPaymentIdempotency.test.js`: idempotency للطلب/الدفع.
- `NODE_ENV=test node tests/moyasar_retry.test.js`: retry behavior.
- Subscription tests: `meal_planner_types.test.js`, `mealPlanner.integration.test.js`, `checkout.integration.test.js`, `subscriptionBalancePolicy.test.js`, `subscriptionBalanceConcurrency.test.js`, `subscriptionFulfillmentConcurrency.test.js`.
- Dashboard tests: `oneTimeOrderOps.test.js`, `dashboardAdminEndpoints.test.js`, `opsSearchService.test.js`.

فجوات مرشحة:

- subscription mobile contracts ليست بنفس وضوح one-time mobile contracts.
- full subscription E2E من quote إلى fulfillment يحتاج أمر مستقل واضح.
- staging validation موجود لكنه يحتاج ضبط بيئة آمن.
- data integrity validation موجود (`validate:data`, `checkCatalogHealth`) لكنه حساس للبيئة.
- Dashboard full E2E شامل لكل الأدوار غير مؤكد من الكود الحالي.

## 9. Risk Areas

- Payments/webhooks: خطر double-apply أو late webhook. ملفات: `Payment.js`, `webhookController.js`, `orderPaymentService.js`, `paymentApplicationService.js`. الفحص: idempotency/concurrency tests.
- Idempotency: خطر reuse خاطئ أو request hash mismatch. ملفات: `idempotencyService.js`, `Order.js`, `Payment.js`, `subscriptionNonCheckoutPaymentService.js`. الفحص: repeated create/verify/webhook.
- Subscription day transitions: خطر خصم وجبات أو تغيير status بشكل غير صحيح. ملفات: `SubscriptionDay.js`, `subscriptionDay*Service.js`, `fulfillmentService.js`. الفحص: lifecycle/concurrency tests.
- Menu catalog migration: خطر كسر published catalog أو snapshots. ملفات: `menuCatalogService.js`, `Menu*`, `seed-one-time-menu.js`. الفحص: catalog regression قبل وبعد.
- Dashboard status transitions: خطر إظهار actions غير مسموحة. ملفات: `orderOpsTransitionService.js`, `opsActionPolicy.js`, `opsTransitionService.js`. الفحص: role/action matrix.
- Halala/VAT included: خطر حساب مزدوج. ملفات: `menuPricingService.js`, `subscriptionQuoteService.js`, `utils/pricing.js`. الفحص: vat tests وsnapshot totals.
- Production seed scripts: خطر تعديل production catalog. ملفات: `scripts/seed-one-time-menu.js`, seed scripts الأخرى. الفحص: env guardrails وdry-run/staging.
- Redirect URLs: خطر deep links أو non-HTTPS provider redirects. ملف: `paymentRedirectUrls.js`. الفحص: mobile deep link/payment tests.
- Flutter response shape: خطر تغيير `status/data/error` أو fields. ملفات: controllers/serialization. الفحص: `mobileApiContracts.test.js` وإضافة subscription contracts.

## 10. Recommended Architecture Before Any Menu Unification

قبل أي دمج:

- تدقيق كل models والحقول المشتركة فعلاً بين الكتالوجين.
- تحديد source of truth لكل identity: protein/carb/sauce/addon/sandwich.
- فصل shared catalog identity عن channel rules.
- بقاء one-time `MenuProduct/ProductOptionGroup/ProductGroupOption` لقواعد options/weight/pricing.
- بقاء subscription `Plan/SubscriptionDay/mealSlots/premiumBalance` لقواعد الاشتراك.
- إنشاء adapter/service layer إن تم الدمج: `oneTimeCatalogAdapter` و`subscriptionPlannerCatalogAdapter`.
- الحفاظ على backward compatibility لـ Flutter وDashboard: لا تغيير response shape بدون versioning.
- منع migration مباشرة على production قبل data integrity report.
- اختبارات إلزامية قبل التنفيذ: one-time menu/full flow/mobile contracts/payment idempotency/subscription checkout/meal planner/day payment/dashboard ops.

## 11. Recommended Next Steps

1. Keep current one-time flow stable.
2. Finish architecture blueprint review مع الفريق.
3. Add subscription mobile contracts.
4. Add subscription full E2E.
5. Add data integrity validation للكتالوجين.
6. Audit menu overlap بجدول mapping للمواد.
7. Design shared catalog/channel rules.
8. Implement only Phase 1 with tests وبدون migration واسعة.

## 12. Appendix

أوامر مهمة:

```bash
npm run validate:backend
npm run test:one-time-full-flow
npm run test:mobile-contracts
npm run test:one-time-menu
npm run test:payment-init-logging
NODE_ENV=test node tests/webhookSecurity.test.js
NODE_ENV=test node tests/orderPaymentIdempotency.test.js
NODE_ENV=test node tests/moyasar_retry.test.js
npm run validate:data
```

أوامر يجب التعامل معها بحذر لأنها قد تكتب بيانات:

```bash
npm run seed:one-time-menu
node scripts/seedBuilderCatalogData.js
node scripts/seedPremiumCatalog.js
node scripts/migrate-builder-protein-groups.js
node scripts/migrate-salad-ingredient-groups.js
```

ترتيب قراءة مقترح:

1. `src/app.js`, `src/routes/index.js`.
2. `src/routes/orders.js`, `src/controllers/orderController.js`, `src/services/orders/*`.
3. `src/routes/dashboardMenu.js`, `src/services/orders/menuCatalogService.js`.
4. `src/routes/subscriptions.js`, `src/controllers/subscriptionController.js`, `src/services/subscription/*`.
5. `src/models/Order.js`, `Payment.js`, `Subscription.js`, `SubscriptionDay.js`.
6. `docs/one-time-orders/one-time-menu-catalog.md`.
7. `docs/meal-planner/MEAL_PLANNER_CANONICAL_CONTRACT.md`.
8. `docs/product-flows/unified-selection-payment-flow.md`.

Glossary:

- One-time order: طلب مستقل مدفوع مرة واحدة، حالياً pickup-only حسب docs/tests.
- Menu catalog: كتالوج one-time الديناميكي.
- Meal planner: نظام اختيار وجبات أيام الاشتراك.
- Meal slot: خانة وجبة داخل `SubscriptionDay`.
- Premium balance: رصيد اختيارات premium داخل subscription.
- Unified day payment: دفع يومي موحد لتغطية premium/addons في planner.
- Halala: الوحدة الصغرى للـ SAR؛ 100 Halala = 1 SAR.
- VAT included: الأسعار شاملة الضريبة ولا يجب جمعها مرة ثانية في العميل.
