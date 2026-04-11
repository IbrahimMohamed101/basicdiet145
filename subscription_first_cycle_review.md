# Subscription First Cycle Review

## 1. Executive Summary

أول دورة تشغيلية للاشتراك تبدأ فعليًا عند تفعيل الاشتراك، وليس عند أول cutoff. عند التفعيل تقوم خدمة `persistActivatedSubscription` في `src/services/subscription/subscriptionActivationService.js` بإنشاء سجل `Subscription` ثم إنشاء سجلات `SubscriptionDay` لكل الأيام المخططة. أول يوم يبدأ بحالة `open` داخل `SubscriptionDay`، وهذا هو الكيان التشغيلي الأساسي الذي تتحرك عليه بقية الدورة.

بعد ذلك يوجد مساران فعليان لإدخال اليوم إلى التنفيذ:

1. مسار عام مشترك: المستخدم يخطط اليوم عبر `PUT /subscriptions/:id/days/:date/selection` ثم يؤكد التخطيط عبر `POST /subscriptions/:id/days/:date/confirm`، وبعدها يتم قفل اليوم إلى `locked` إما أوتوماتيكيًا عبر cutoff (`processDailyCutoff`) أو يدويًا من المطبخ عبر kitchen lock endpoints.
2. مسار pickup المبكر: المستخدم نفسه يستطيع دفع اليوم مباشرة إلى المسار التشغيلي عبر `POST /subscriptions/:id/days/:date/pickup/prepare`، وهذه نقطة مهمة جدًا لأنها تقوم بقفل اليوم `locked` وتسجيل `pickupRequested` وخصم/تثبيت الوجبات لذلك اليوم، وبالتالي تجعل اليوم جاهزًا للظهور في queue الخاص بالمطبخ.

الفرق الأساسي بين `delivery` و `pickup` هو مكان تأكيد الإتمام:

- في `delivery`، المطبخ يحول `SubscriptionDay` إلى `out_for_delivery`، وهذا ينشئ/يحدث سجل `Delivery`. بعدها الكوريير هو المسؤول عن endpoint التأكيد النهائي: `PUT /courier/deliveries/:id/delivered`. هذه الـ endpoint تستدعي `fulfillSubscriptionDay` لتغيير `SubscriptionDay.status` إلى `fulfilled` ثم تجعل `Delivery.status` = `delivered`.
- في `pickup`، لا يوجد كيان منفصل مثل `Delivery`. كل شيء يبقى على `SubscriptionDay`: طلب التحضير، كود الاستلام، التحقق، `no_show`، والإتمام النهائي. نقطة التحقق الأساسية هي `POST /kitchen/pickups/:dayId/verify`، وهي التي تطابق الكود ثم تستدعي `fulfillSubscriptionDay` وتحول اليوم إلى `fulfilled`.

الخلاصة التنفيذية: `SubscriptionDay` هو source of truth التشغيلي للاشتراكات، بينما `Delivery` هو سجل تنفيذ ثانوي لمسار التوصيل فقط بعد dispatch.

## 2. Delivery Lifecycle

### 2.1 أول يوم فعليًا كيف يبدأ

1. عند التفعيل:
   `src/services/subscription/subscriptionActivationService.js`
   `persistActivatedSubscription`
   تنشئ `SubscriptionDay` entries مسبقًا، وكل يوم يبدأ `status = "open"`.

2. المستخدم يجهز اليوم:
   `PUT /api/subscriptions/:id/days/:date/selection`
   `src/controllers/subscriptionController.js`
   `updateDaySelection`
   هذا المسار يكتب اختيارات اليوم على `SubscriptionDay` ويحدث بيانات التخطيط والـ premium/add-on state.

3. المستخدم يؤكد التخطيط:
   `POST /api/subscriptions/:id/days/:date/confirm`
   `src/controllers/subscriptionController.js`
   `confirmDayPlanning`
   هذا يثبت canonical planning ويجعل اليوم صالحًا للانتقال إلى التنفيذ.

4. الانتقال من planning إلى operational lock:
   المسار الفعلي المعتاد في التشغيل اليومي هو `src/services/automationService.js`
   `processDailyCutoff`
   هذه الخدمة تبحث عن `SubscriptionDay` بحالة `open` لتاريخ الغد، وتتحقق من صحة التخطيط، وتبني `lockedSnapshot`، ثم تنقل الحالة إلى `locked`.

### 2.2 متى يظهر اليوم للمطبخ

المطبخ يقرأ queue اليومي عبر:

- `GET /api/kitchen/days/:date`
- controller: `src/controllers/kitchenController.js`
- function: `listDailyOrders`

هذه القراءة تعتمد على `SubscriptionDay` مباشرة، وتستخدم `lockedSnapshot || fulfilledSnapshot` لتثبيت البيانات التشغيلية مثل العنوان، النافذة الزمنية، الإضافات، ومحتوى الوجبات. لذلك اليوم يصبح ذا معنى تشغيلي كامل للمطبخ بمجرد وجود `lockedSnapshot` ودخوله `locked`.

### 2.3 الانتقال داخل المطبخ

المطبخ يستطيع تحريك يوم الاشتراك عبر:

- `POST /api/kitchen/subscriptions/:id/days/:date/in-preparation`
- `POST /api/kitchen/subscriptions/:id/days/:date/out-for-delivery`

كلاهما يمر عبر:

- controller: `src/controllers/kitchenController.js`
- function: `transitionDay`

التحول إلى `out_for_delivery` مهم جدًا لأنه:

1. يتحقق أن `sub.deliveryMode === "delivery"`.
2. يشترط وجود `day.lockedSnapshot`.
3. ينشئ أو يحدث سجل `Delivery` عبر `Delivery.updateOne({ dayId }, ... upsert: true)`.

هذه هي نقطة التحول التي يدخل بها اليوم فعليًا إلى courier queue.

### 2.4 متى يظهر للكوريير

الكوريير لا يقرأ `SubscriptionDay` مباشرة، بل يقرأ `Delivery`:

- `GET /api/courier/deliveries/today`
- controller: `src/controllers/courierController.js`
- function: `listTodayDeliveries`

هذه الدالة تجمع `SubscriptionDay` الخاصة بتاريخ اليوم ثم تجلب `Delivery` المرتبط بها. لذلك اليوم لا يدخل courier queue إلا بعد أن يحوله kitchen إلى `out_for_delivery`.

### 2.5 من يحدد أن الطلب تم تسليمه فعلًا

نقطة التأكيد الفعلية للتسليم هي:

- `PUT /api/courier/deliveries/:id/delivered`
- controller: `src/controllers/courierController.js`
- function: `markDelivered`

وهنا يحدث التالي داخل transaction:

1. استدعاء `fulfillSubscriptionDay({ dayId })` من `src/services/fulfillmentService.js`.
2. تحديث `Delivery.status = "delivered"` و `deliveredAt`.

النتيجة:

- `SubscriptionDay.status` يصبح `fulfilled`.
- `Delivery.status` يصبح `delivered`.

إذًا الـ endpoint التي تعني أن الأوردر وصل فعلًا في مسار الاشتراكات هي endpoint الكوريير، وليس endpoint المستخدم.

### 2.6 ما الذي يتحدث بعد التسليم

بعد `markDelivered`:

- `SubscriptionDay`
  - `status: fulfilled`
  - `fulfilledAt`
  - `fulfilledSnapshot`
  - `creditsDeducted: true`
  - `pickupRequested: false`

- `Subscription`
  - يتم خصم `remainingMeals` داخل `fulfillSubscriptionDay` إذا لم تكن الوجبات قد خُصمت مسبقًا.

- `Delivery`
  - `status: delivered`
  - `deliveredAt`

## 3. Pickup Lifecycle

### 3.1 ما هي endpoint اليوزر التي تبدأ المسار

المسار الأهم في pickup هو:

- `POST /api/subscriptions/:id/days/:date/pickup/prepare`
- controller: `src/controllers/subscriptionController.js`
- function: `preparePickup`

هذه الـ endpoint هي user-facing، وهي التي:

1. تتحقق أن الاشتراك `active`.
2. تتحقق أن التاريخ مستقبلي ومسموح قبل cutoff.
3. تتحقق أن `deliveryMode === "pickup"`.
4. تتحقق من صلاحية اليوم للتنفيذ عبر `validateDayBeforeLockOrPrepare`.
5. تبني `lockedSnapshot` عبر `lockDaySnapshot`.
6. تغير `SubscriptionDay` إلى:
   - `status = "locked"`
   - `pickupRequested = true`
   - `creditsDeducted = true`
7. تخصم من `Subscription.remainingMeals`.

هذه هي أقوى نقطة تحول user-driven في pickup، وهي المسار الذي يسمح للمطبخ بالبدء فعليًا في التحضير حتى لو لم ننتظر cutoff العام.

### 3.2 متى يظهر للمطبخ

المطبخ يقرأ pickup queue عبر:

- `GET /api/kitchen/pickups/:date`
- `GET /api/kitchen/today-pickup`
- controller: `src/controllers/kitchenController.js`
- function: `listPickupsByDate`

هذه القراءة تعتمد على:

- `SubscriptionDay.status in ["locked", "in_preparation", "ready_for_pickup", "fulfilled", "canceled_at_branch", "no_show"]`
- وكون `deliveryMode` في `lockedSnapshot || fulfilledSnapshot` يساوي `pickup`

إذًا نقطة الظهور للمطبخ هي أن يصبح اليوم `locked` مع snapshot يحمل `deliveryMode = "pickup"`. وهذا قد يحدث عبر:

1. `preparePickup` من المستخدم.
2. `processDailyCutoff` أو kitchen manual lock في حالة الاشتراك pickup أيضًا.

لكن إذا كان المطلوب هو "ما هي endpoint اليوزر التي تجعل الوجبات تدخل مسار التحضير؟" فالإجابة الدقيقة هي `POST /subscriptions/:id/days/:date/pickup/prepare`.

### 3.3 خطوات المطبخ في pickup

1. بدء التحضير:
   - `POST /api/kitchen/subscriptions/:id/days/:date/in-preparation`
   - `kitchenController.transitionDay`

2. إعلان الجاهزية للاستلام:
   - `POST /api/kitchen/subscriptions/:id/days/:date/ready-for-pickup`
   - `kitchenController.transitionDay`

   عند هذه النقطة:
   - يتم إصدار pickup code عبر `issuePickupCode`
   - يتم إرسال notification للمستخدم

3. المستخدم أو التطبيق يمكنه رؤية اليوم الحالي عبر:
   - `GET /api/app-auth/today-pickup`
   - `src/controllers/appAuthController.js`
   - `getTodayPickup`

   هذه القراءة تعرض `pickupCode` فقط عندما تكون الحالة `ready_for_pickup`.

### 3.4 Endpoint التحقق عند الاستلام

نقطة التحقق الأساسية عند الاستلام هي:

- `POST /api/kitchen/pickups/:dayId/verify`
- controller: `src/controllers/kitchenController.js`
- function: `verifyPickup`

الذي يحدث داخلها:

1. تتحقق أن اليوم موجود.
2. تتحقق أن الحالة `ready_for_pickup`.
3. تتحقق أن `pickupCode` صادر.
4. تطابق الكود المرسل مع `day.pickupCode`.
5. تسجل:
   - `pickupVerifiedAt`
   - `pickupVerifiedByDashboardUserId`
6. تستدعي `fulfillSubscriptionDay({ dayId })`.

هذه هي endpoint التي تؤكد أن العميل استلم الوجبة بالفعل أو أن الكود تم التحقق منه.

### 3.5 متى تعتبر الوجبة fulfilled

في pickup، تتحول الوجبة إلى `fulfilled` عندما تنجح `verifyPickup`. يوجد أيضًا endpoint ثانوية:

- `POST /api/kitchen/subscriptions/:id/days/:date/fulfill-pickup`

لكنها ليست المسار الأساسي، لأنها ترفض الإتمام المباشر إذا كان هناك pickup code صادر ولم يتم التحقق منه. لذلك المسار الفعلي المعتمد على الكود هو:

`ready_for_pickup` -> `verifyPickup` -> `fulfilled`

### 3.6 حالات بديلة في pickup

- `POST /api/kitchen/pickups/:dayId/no-show`
  يحول اليوم إلى `no_show` وقد يعيد credits حسب إعداد `pickup_no_show_restore_credits`.

- `POST /api/kitchen/subscriptions/:id/days/:date/cancel-at-branch`
  يحول اليوم إلى `canceled_at_branch` لمسار pickup فقط، وقد يعيد credits إذا كانت خُصمت.

## 4. Endpoint Inventory

| Surface | Method | Route | Controller Function | Key Service Functions | Models Affected | Main Transition |
| --- | --- | --- | --- | --- | --- | --- |
| User | `POST` | `/api/subscriptions/checkout` | `subscriptionController.checkoutSubscription` | activation path later reaches `persistActivatedSubscription` after payment verification | `SubscriptionCheckoutDraft`, `Payment`, later `Subscription`, `SubscriptionDay` | يبدأ دورة الاشتراك لكن لا يدخل اليوم التشغيل بعد |
| User | `PUT` | `/api/subscriptions/:id/days/:date/selection` | `subscriptionController.updateDaySelection` | `performDaySelectionUpdate` | `SubscriptionDay` | يبقى `open` لكن يحدّث planning/selections |
| User | `POST` | `/api/subscriptions/:id/days/:date/confirm` | `subscriptionController.confirmDayPlanning` | `performDayPlanningConfirmation` | `SubscriptionDay` | يبقى `open` لكن يثبت canonical planning |
| User | `POST` | `/api/subscriptions/:id/days/:date/pickup/prepare` | `subscriptionController.preparePickup` | `validateDayBeforeLockOrPrepare`, `lockDaySnapshot` | `SubscriptionDay`, `Subscription` | `open -> locked` مع `pickupRequested=true` |
| Admin | `POST` | `/api/admin/trigger-cutoff` | `adminController.triggerDailyCutoff` | `processDailyCutoff` | `SubscriptionDay` | `open -> locked` للأيام المستحقة |
| Kitchen | `GET` | `/api/kitchen/days/:date` | `kitchenController.listDailyOrders` | snapshot read helpers | `SubscriptionDay` | قراءة queue المطبخ |
| Kitchen | `POST` | `/api/kitchen/days/:date/lock` | `kitchenController.bulkLockDaysByDate` | `validateDayBeforeLockOrPrepare`, `buildLockedDaySnapshot` | `SubscriptionDay` | `open -> locked` جماعيًا |
| Kitchen | `PUT` | `/api/kitchen/subscriptions/:id/days/:date/assign` | `kitchenController.assignMeals` | canonical planning helpers | `SubscriptionDay` | لا يغير الحالة بالضرورة، لكنه يملأ اليوم |
| Kitchen | `POST` | `/api/kitchen/subscriptions/:id/days/:date/in-preparation` | `kitchenController.transitionDay` | `canTransition` | `SubscriptionDay` | `locked -> in_preparation` |
| Kitchen | `POST` | `/api/kitchen/subscriptions/:id/days/:date/out-for-delivery` | `kitchenController.transitionDay` | `canTransition` | `SubscriptionDay`, `Delivery` | `locked/in_preparation -> out_for_delivery` وإنشاء/تحديث `Delivery` |
| Kitchen | `POST` | `/api/kitchen/subscriptions/:id/days/:date/ready-for-pickup` | `kitchenController.transitionDay` | `canTransition`, `issuePickupCode` | `SubscriptionDay` | `locked/in_preparation -> ready_for_pickup` |
| Kitchen | `GET` | `/api/kitchen/pickups/:date` | `kitchenController.listPickupsByDate` | snapshot read helpers | `SubscriptionDay` | قراءة pickup queue |
| Kitchen | `GET` | `/api/kitchen/today-pickup` | `kitchenController.listTodayPickups` | alias لـ `listPickupsByDate` | `SubscriptionDay` | قراءة pickup queue لليوم الحالي |
| App User | `GET` | `/api/app-auth/today-pickup` | `appAuthController.getTodayPickup` | status ordering helpers | `SubscriptionDay`, `Subscription` | قراءة حالة pickup للمستخدم |
| Kitchen | `POST` | `/api/kitchen/pickups/:dayId/verify` | `kitchenController.verifyPickup` | `fulfillSubscriptionDay` | `SubscriptionDay`, `Subscription` | `ready_for_pickup -> fulfilled` |
| Kitchen | `POST` | `/api/kitchen/subscriptions/:id/days/:date/fulfill-pickup` | `kitchenController.fulfillPickup` | `fulfillSubscriptionDay` | `SubscriptionDay`, `Subscription` | إتمام pickup بعد التحقق أو إذا لا يوجد code |
| Kitchen | `POST` | `/api/kitchen/pickups/:dayId/no-show` | `kitchenController.markPickupNoShow` | `getPickupNoShowRestoreCreditsSetting` | `SubscriptionDay`, `Subscription` | `ready_for_pickup -> no_show` |
| Kitchen | `POST` | `/api/kitchen/subscriptions/:id/days/:date/cancel-at-branch` | `kitchenController.cancelAtBranch` | branch cancel logic | `SubscriptionDay`, `Subscription` | `locked/in_preparation/ready_for_pickup -> canceled_at_branch` |
| Courier | `GET` | `/api/courier/deliveries/today` | `courierController.listTodayDeliveries` | day lookup + `Delivery.find` | `Delivery`, `SubscriptionDay` | قراءة courier queue |
| Courier | `PUT` | `/api/courier/deliveries/:id/arriving-soon` | `courierController.markArrivingSoon` | delivery workflow helpers | `Delivery` | لا يغير day status |
| Courier | `PUT` | `/api/courier/deliveries/:id/delivered` | `courierController.markDelivered` | `fulfillSubscriptionDay` | `Delivery`, `SubscriptionDay`, `Subscription` | `out_for_delivery -> fulfilled` على اليوم و`delivered` على الـ delivery |
| Courier | `PUT` | `/api/courier/deliveries/:id/cancel` | `courierController.markCancelled` | delivery cancellation helpers | `Delivery`, `SubscriptionDay`, `Subscription` | `out_for_delivery -> delivery_canceled` في السيناريو المناسب |

## 5. State Transition Map

### 5.1 SubscriptionDay state machine

المصدر: `src/utils/state.js`

- `open`
  - يغيّرها:
    - `processDailyCutoff` في `src/services/automationService.js`
    - `kitchenController.bulkLockDaysByDate`
    - `subscriptionController.preparePickup`
  - الانتقالات:
    - `open -> locked`
    - `open -> skipped`
    - `open -> frozen`

- `locked`
  - يغيّرها:
    - `kitchenController.transitionDay`
  - الانتقالات:
    - `locked -> in_preparation`
    - `locked -> out_for_delivery`
    - `locked -> ready_for_pickup`
    - `locked -> canceled_at_branch`

- `in_preparation`
  - يغيّرها:
    - `kitchenController.transitionDay`
  - الانتقالات:
    - `in_preparation -> out_for_delivery`
    - `in_preparation -> ready_for_pickup`
    - `in_preparation -> canceled_at_branch`

- `out_for_delivery`
  - يغيّرها:
    - `courierController.markDelivered`
    - `courierController.markCancelled`
  - الانتقالات:
    - `out_for_delivery -> fulfilled`
    - `out_for_delivery -> delivery_canceled`

- `ready_for_pickup`
  - يغيّرها:
    - `kitchenController.verifyPickup`
    - `kitchenController.fulfillPickup`
    - `kitchenController.markPickupNoShow`
    - `kitchenController.cancelAtBranch`
  - الانتقالات:
    - `ready_for_pickup -> fulfilled`
    - `ready_for_pickup -> canceled_at_branch`
    - `ready_for_pickup -> no_show`

- terminal states
  - `fulfilled`
  - `delivery_canceled`
  - `canceled_at_branch`
  - `no_show`
  - `skipped`
  - `frozen`

### 5.2 Delivery state machine

المصدر: `src/models/Delivery.js`

- `scheduled`
- `out_for_delivery`
- `delivered`
- `canceled`

الانتقال الفعلي المستخدم للاشتراكات:

1. kitchen dispatch:
   `kitchenController.transitionDay(..., "out_for_delivery")`
   يكتب `Delivery.status = "out_for_delivery"`

2. courier confirmation:
   `courierController.markDelivered`
   يكتب `Delivery.status = "delivered"`

3. courier cancel:
   `courierController.markCancelled`
   يكتب `Delivery.status = "canceled"`

### 5.3 First-cycle focus map

أول يوم تشغيل للاشتراك يمر غالبًا بهذا التسلسل:

- `Subscription` active
- `SubscriptionDay` created at activation with `open`
- user updates selections
- user confirms planning
- cutoff أو manual lock أو pickup prepare يحول اليوم إلى `locked`
- من هنا يتفرع:
  - delivery: `locked -> in_preparation -> out_for_delivery -> fulfilled`
  - pickup: `locked -> in_preparation -> ready_for_pickup -> fulfilled`

## 6. Controllers and Services Involved

### Controllers

- `src/controllers/subscriptionController.js`
  - `checkoutSubscription`
  - `updateDaySelection`
  - `confirmDayPlanning`
  - `preparePickup`

- `src/controllers/kitchenController.js`
  - `listDailyOrders`
  - `listPickupsByDate`
  - `bulkLockDaysByDate`
  - `assignMeals`
  - `transitionDay`
  - `fulfillPickup`
  - `verifyPickup`
  - `markPickupNoShow`
  - `cancelAtBranch`

- `src/controllers/courierController.js`
  - `listTodayDeliveries`
  - `markArrivingSoon`
  - `markDelivered`
  - `markCancelled`

- `src/controllers/appAuthController.js`
  - `getTodayPickup`

- `src/controllers/adminController.js`
  - `triggerDailyCutoff`

### Services

- `src/services/subscription/subscriptionActivationService.js`
  - `persistActivatedSubscription`
  - source of first `SubscriptionDay` creation

- `src/services/automationService.js`
  - `processDailyCutoff`
  - auto-lock path from planning to operations

- `src/services/fulfillmentService.js`
  - `fulfillSubscriptionDay`
  - shared terminal mutator for both delivery and pickup

- `src/services/subscription/subscriptionDayExecutionValidationService.js`
  - `validateDayBeforeLockOrPrepare`
  - execution gate before lock/prepare

- `src/services/subscription/subscriptionDayOperationalSnapshotService.js`
  - `buildLockedDaySnapshot`
  - operational snapshot source used by kitchen/pickup reads

- `src/services/subscription/subscriptionSelectionService.js`
  - `performDaySelectionUpdate`

- `src/services/subscription/subscriptionDayPlanningService.js`
  - canonical planning draft/confirm logic

- `src/services/deliveryWorkflowService.js`
  - delivery-side normalization and cancellation helper logic used by courier controller

## 7. Models Affected

### SubscriptionDay

الكيان الأهم في هذه الدورة.

أهم الحقول المستخدمة تشغيليًا:

- `status`
- `selections`
- `premiumSelections`
- `lockedSnapshot`
- `fulfilledSnapshot`
- `lockedAt`
- `fulfilledAt`
- `pickupRequested`
- `pickupCode`
- `pickupVerifiedAt`
- `pickupVerifiedByDashboardUserId`
- `pickupNoShowAt`
- `creditsDeducted`
- `operationAuditLog`
- `deliveryAddressOverride`
- `deliveryWindowOverride`

### Subscription

يتأثر أساسًا في:

- `status` عند التفعيل/الإلغاء
- `remainingMeals` عند `preparePickup` أو `fulfillSubscriptionDay` أو restore policies

### Delivery

يُستخدم فقط في مسار التوصيل. أهم الحقول:

- `subscriptionId`
- `dayId`
- `status`
- `address`
- `window`
- `deliveredAt`
- `canceledAt`

### Payment / Checkout Drafts

ليست هي source of truth للدورة التشغيلية، لكنها المصدر الذي يبدأ منه التفعيل الذي ينتج عنه `SubscriptionDay`.

## 8. Source of Truth

### الحكم المختصر

الـ source of truth التشغيلي للاشتراكات هو `SubscriptionDay`.

### لماذا

لأن جميع الحالات التشغيلية المهمة موجودة عليه:

- `open`
- `locked`
- `in_preparation`
- `out_for_delivery`
- `ready_for_pickup`
- `fulfilled`
- `delivery_canceled`
- `canceled_at_branch`
- `no_show`

ولأن جميع عناصر pickup الحرجة موجودة عليه أيضًا:

- `pickupRequested`
- `pickupCode`
- `pickupVerifiedAt`
- `pickupNoShowAt`

### دور Delivery

`Delivery` ليس مصدر الحقيقة الأساسي، بل سجل execution مخصص للكوريير. يتم إنشاؤه فقط عندما ينقل kitchen اليوم إلى `out_for_delivery`. بعد ذلك يتم إبقاؤه متزامنًا مع `SubscriptionDay` في لحظة التسليم أو الإلغاء.

### كيف تتم المزامنة

- dispatch:
  `kitchenController.transitionDay(..., "out_for_delivery")`
  يكتب على `SubscriptionDay.status` ويُنشئ/يحدث `Delivery`.

- delivered:
  `courierController.markDelivered`
  أولًا يستدعي `fulfillSubscriptionDay` لتحديث `SubscriptionDay` ثم يكتب `Delivery.status = "delivered"`.

- pickup:
  لا يوجد كيان منفصل، فتظل المزامنة داخل `SubscriptionDay` فقط.

### دور snapshots

`lockedSnapshot` و `fulfilledSnapshot` ليسا state machines مستقلين، لكنهما read-models تشغيلية مجمدة تُستخدم لإعطاء kitchen/pickup views نسخة ثابتة من البيانات حتى لو تغيرت بيانات الاشتراك لاحقًا.

## 9. Risks / Gaps / Ambiguities

1. توجد أكثر من نقطة لتحويل اليوم من `open` إلى `locked`.
   المسارات هي cutoff، bulk kitchen lock، و`preparePickup`.
   هذا صحيح وظيفيًا لكنه يزيد تعقيد تتبع المسار الفعلي لأول يوم إن لم يكن هناك runbook واضح يحدد أي مسار هو المعتمد لكل mode.

2. يوجد split واضح في truth model بين `SubscriptionDay` و`Delivery` في مسار delivery.
   الحالة التشغيلية النهائية موجودة على `SubscriptionDay`، لكن queue الكوريير مبني على `Delivery`. هذا يفرض ضرورة فهم endpoint الربط بدقة، وهي `transitionDay(..., "out_for_delivery")`.

3. naming ambiguity في طبقة القراءة.
   `src/services/subscription/subscriptionTimelineService.js` يطبع `fulfilled` على شكل `delivered` في timeline normalization. هذا جيد للـ UX، لكنه قد يربك المراجعة الهندسية لأن الحالة الحقيقية في الموديل تبقى `fulfilled`.

4. هناك دوال غير موصولة routing-wise داخل `subscriptionController.js`.
   توجد وظائف انتقال يوم غير مستخدمة فعليًا في المسار الراهن، بينما المسار الحقيقي في التشغيل يمر عبر `kitchenController.transitionDay` و`courierController.markDelivered`. هذا يستحق توضيحًا أو تنظيفًا حتى لا يختلط على المطورين المسار الحقيقي.

5. `fulfillPickup` ليست primary path رغم وجودها.
   المسار الحقيقي المعتمد على pickup code هو `verifyPickup`. وجود endpoint ثانية للإتمام قد يسبب سوء استخدام من فرق التشغيل إذا لم يكن هذا موثقًا.

6. Kitchen queues تعتمد بقوة على `lockedSnapshot` / `fulfilledSnapshot`.
   إذا وُجد أي bug يمنع snapshot generation أو يسمح بانتقال حالة بدون snapshot، ستظهر قراءات تشغيلية ناقصة أو غير متسقة.

7. pickup لا يملك model منفصل.
   هذا يبسط النظام، لكنه يجعل كثيرًا من المنطق متجمعًا على `SubscriptionDay`، بما فيه verification وno-show والسياسات الراجعة للرصيد. أي تغيير هناك يؤثر مباشرة على التشغيل.

## 10. Final Verdict

المسار الفعلي لأول دورة تشغيلية في الاشتراكات داخل هذا المشروع واضح بعد تتبع الكود:

- أول يوم تشغيلي يُخلق عند activation داخل `SubscriptionDay`.
- التخطيط يظل user-facing على `SubscriptionDay` حتى يتحول اليوم إلى `locked`.
- `SubscriptionDay` هو المصدر الرئيسي للحالة التشغيلية.
- في `delivery`، kitchen هو من يرسل اليوم إلى `out_for_delivery`، ثم courier هو من يؤكد الوصول عبر `PUT /courier/deliveries/:id/delivered`.
- في `pickup`, المستخدم يستطيع بدء المسار تشغيليًا عبر `POST /subscriptions/:id/days/:date/pickup/prepare`, والمطبخ يؤكد الاستلام الحقيقي عبر `POST /kitchen/pickups/:dayId/verify`.

إذا كان المطلوب runbook عملي مختصر:

- Delivery first cycle:
  `selection` -> `confirm` -> `cutoff/lock` -> `kitchen in-preparation` -> `kitchen out-for-delivery` -> `courier delivered`

- Pickup first cycle:
  `selection` -> `confirm` -> `user pickup/prepare` أو `cutoff/lock` -> `kitchen in-preparation` -> `kitchen ready-for-pickup` -> `kitchen verify`

وبصياغة حاسمة:

- endpoint تأكيد الوصول في delivery: `PUT /api/courier/deliveries/:id/delivered`
- endpoint user التي تُدخل pickup إلى المسار التشغيلي: `POST /api/subscriptions/:id/days/:date/pickup/prepare`
- endpoint التحقق عند pickup: `POST /api/kitchen/pickups/:dayId/verify`
