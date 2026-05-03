# منطق Timeline واستهلاك أيام الاشتراك

## 1. الفكرة التجارية الأساسية

القاعدة التجارية المطلوبة هي أن الاشتراك يعمل مثل اشتراك الجيم: اليوم يُحسب على العميل عندما يمر تاريخ اليوم، سواء حضر أو استلم أو تم التوصيل له أم لا. عدم اختيار الوجبات، عدم الاستلام، أو فشل التوصيل لا يعني وحده أن اليوم لا يُخصم. الاستثناءات الأساسية هي الأيام التي تم عمل `skip` أو `freeze` لها حسب سياسة الاشتراك.

في الكود الحالي هذه القاعدة مطبقة جزئياً فقط. يوجد خصم عند `fulfilled`، وعند `no_show` للاستلام من الفرع، ويوجد Job يومي يحوّل بعض أيام `pickup` في تاريخ العمل الحالي إلى `consumed_without_preparation`. لكن لا يوجد Settlement عام لكل الأيام السابقة، ولا يوجد تحويل تلقائي شامل لكل يوم سابق غير `skipped`/`frozen` إلى حالة مستهلكة.

## 2. الموديلات الأساسية

### `Subscription`

الموديل موجود في `src/models/Subscription.js`.

- `status`: حالة الاشتراك التجارية العامة: `pending_payment`, `active`, `frozen`, `expired`, `canceled`, `completed`.
- `startDate`, `endDate`: حدود الاشتراك الأصلية.
- `validityEndDate`: نهاية الصلاحية بعد تعويضات `skip`/`freeze`.
- `totalMeals`: إجمالي الوجبات عند التفعيل.
- `remainingMeals`: الرصيد الذي يتم إنقاصه عند استهلاك يوم.
- `selectedMealsPerDay`: عدد الوجبات المطلوب يومياً.
- `deliveryMode`: إما `delivery` أو `pickup`.
- `deliveryAddress`, `deliveryWindow`, `deliverySlot`, `pickupLocationId`: بيانات التنفيذ.
- `premiumBalance`, `premiumSelections`: رصيد واستخدامات البروتينات/الاختيارات المدفوعة.
- `addonBalance`, `addonSelections`: رصيد واستخدامات الإضافات.
- `skipDaysUsed`: عدد أيام `skip` التعويضية المستخدمة.

عند التفعيل، `buildCanonicalActivationPayload` في `src/services/subscription/subscriptionActivationService.js` يحسب `totalMeals = daysCount * mealsPerDay` ويضع `remainingMeals = totalMeals`. نفس الخدمة تنشئ أيام الاشتراك كلها كـ `SubscriptionDay` بحالة `open`.

### `SubscriptionDay`

الموديل موجود في `src/models/SubscriptionDay.js`.

- `date`: تاريخ اليوم بصيغة `YYYY-MM-DD` حسب توقيت KSA/`Asia/Riyadh`.
- `status`: حالة اليوم التشغيلية/اليومية.
- `selections`: اختيار الوجبات القديم.
- `mealSlots`: مصدر التخطيط الحديث للوجبات. كل slot يحتوي `status` مثل `empty`, `partial`, `complete`.
- `plannerState`: `draft` أو `confirmed`.
- `plannerMeta`: عدادات التخطيط مثل `requiredSlotCount`, `completeSlotCount`, `premiumPendingPaymentCount`.
- `plannerRevisionHash`: Hash مشتق من `mealSlots` و`addonSelections` في `buildPlannerRevisionHash`.
- `addonSelections`: إضافات اليوم، وقد تكون `subscription`, `wallet`, `pending_payment`, `paid`.
- `premiumUpgradeSelections`: اختيارات Premium المستهلكة/المدفوعة على اليوم.
- `premiumExtraPayment`: حالة دفع Premium الإضافي لليوم.
- `pickupRequested`, `pickupRequestedAt`, `pickupPreparationStartedAt`, `pickupPreparedAt`, `pickupCode`, `pickupVerifiedAt`, `pickupNoShowAt`: حقول مسار الاستلام من الفرع.
- `deliveryAddressOverride`, `deliveryWindowOverride`: تعديلات تنفيذ يوم محدد.
- `lockedSnapshot`, `fulfilledSnapshot`: Snapshot للتخطيط والتنفيذ عند القفل أو التسليم.
- `creditsDeducted`: أهم حقل استهلاك؛ يمنع خصم نفس اليوم مرتين.
- `dayEndConsumptionReason`: سبب استهلاك يوم بدون تحضير، مثل `pickup_window_ended_without_prepare`.
- `canonicalDayActionType`: يميز أيام `freeze` و`skip` في الـ timeline.

لا توجد حقول مخزنة باسم `commercialState`, `consumptionState`, `paymentRequirement`, `canBePrepared`, `isFulfillable`. هذه حقول مشتقة في خدمات القراءة.

## 3. حالات `SubscriptionDay`

| الحالة | المعنى | نهائية؟ | تُحسب مستهلكة؟ | Kitchen | Courier | Pickup | Dashboard ops | من يضعها |
|---|---|---:|---:|---:|---:|---:|---|---|
| `open` | يوم مفتوح للتخطيط/التعديل. في الـ timeline يظهر `planned` إذا توجد اختيارات. | لا | لا إلا إذا خصمه cutoff job لاحقاً | يظهر إذا له عناصر في عمليات المطبخ | لا | يمكن طلب prepare للـ pickup | lock/prepare حسب الشروط | التفعيل في `subscriptionActivationService.js`، و`unskip`/`unfreeze`/`reopen` |
| `planned` | ليست حالة مخزنة في DB. هي label في timeline عندما `status=open` و`selected > 0`. | لا | لا | مثل `open` | لا | حسب readiness | لا توجد transition مباشرة | `buildSubscriptionTimeline` |
| `locked` | اليوم مقفل وسnapshot محفوظة. | لا | لا بذاته | نعم | قد ينتقل للتوصيل | نعم إذا pickupRequested | prepare/dispatch/reopen/cancel | `preparePickupForClient`, `kitchenController.transitionDay`, lock action |
| `in_preparation` | قيد التحضير. | لا | لا بذاته | نعم | لا | نعم للـ pickup | ready/dispatch/cancel | `kitchenController.transitionDay`, `opsTransitionService.handlePrepare` |
| `ready_for_pickup` | جاهز للاستلام من الفرع. | لا | لا بذاته | نعم | لا | نعم | verify/fulfill/no_show/cancel | `kitchenController.transitionDay`, `opsTransitionService.handleReadyForPickup` |
| `out_for_delivery` | خرج للتوصيل. | لا | لا بذاته | نعم | نعم | لا | fulfill/cancel | `kitchenController.transitionDay`, `opsTransitionService.handleDispatch` |
| `fulfilled` | تم تنفيذ اليوم: استلام أو توصيل. | نعم | نعم، عبر `consumeSubscriptionDayCredits` إن لم يكن `creditsDeducted=true` | تاريخي/نهائي | نهائي | نهائي | idempotent فقط | `fulfillSubscriptionDay`, `verifyPickup`, `fulfillPickup`, dashboard `fulfill` |
| `consumed_without_preparation` | اليوم خُصم بدون تحضير. | نعم | نعم، لأن job يخصم ثم يضع الحالة | يظهر كـ not prepared | لا | حالة مكتملة | لا transition بعده | `automationService.processDailyCutoff` فقط في الكود الحالي |
| `delivery_canceled` | فشل/إلغاء توصيل. التعليق في الموديل يقول لا يوجد تعويض تلقائي. | عملياً نهائية في service الحديث، ويمكن `open` في `utils/state.js` القديم | لا يوجد خصم في مسار cancel | تاريخي | نهائي | لا | reopen في بعض flows القديمة فقط | `opsTransitionService.handleCancel`, `kitchenController.transitionDay` |
| `canceled_at_branch` | إلغاء من الفرع للـ pickup. | عملياً نهائية/قابلة للفتح في بعض rules | غالباً لا؛ `cancelAtBranch` يعيد الرصيد إذا كان مخصوماً | تاريخي | لا | نهائي | reopen حسب transition القديمة | `kitchenController.cancelAtBranch`, dashboard cancel |
| `no_show` | العميل لم يستلم من الفرع بعد التجهيز. | نعم | نعم في `markPickupNoShow` | تاريخي | لا | نهائي | لا transition بعده إلا قواعد قديمة في `utils/state.js` تسمح `open` | `kitchenController.markPickupNoShow`, dashboard cancel مع `noShow` |
| `skipped` | يوم تم تخطيه. | نعم في مسار العميل، قابل لـ `unskip` قبل المعالجة | `skip` التعويضي لا يخصم؛ `operational skip` يخصم | لا | لا | لا | unskip إن كان غير معالج | `performSkipDay`, `performSkipRange`, `applyOperationalSkipForDate` |
| `frozen` | يوم مجمد. | نعم/قابل لـ `unfreeze` قبل المعالجة | لا | لا | لا | لا | unfreeze | `freezeSubscriptionForClient` |
| `canceled` | غير موجود كحالة في `SubscriptionDay` enum. | - | - | - | - | - | - | موجود في orders فقط |

## 4. الفرق بين `status` و `commercialState`

`status` هو lifecycle تشغيلي لليوم: مفتوح، مقفل، تحضير، توصيل، تم، skipped/frozen، إلخ. مصدره `SubscriptionDay.status`.

`commercialState` مشتق في `src/services/subscription/subscriptionDayCommercialStateService.js`:

- `draft`: التخطيط غير مكتمل.
- `payment_required`: التخطيط مكتمل لكن يوجد Premium/Add-on يحتاج دفع.
- `ready_to_confirm`: التخطيط مكتمل ولا يحتاج دفع، لكن `plannerState` ليس `confirmed`.
- `confirmed`: التخطيط مكتمل ومدفوع ومؤكد.

`paymentRequirement` مشتق من `buildPaymentRequirement`. يحسب هل يوجد `premiumPendingPaymentCount` أو `addonPendingPaymentCount`، وهل يمكن إنشاء دفع، وما سبب الحظر مثل `PREMIUM_PAYMENT_REQUIRED`, `ADDON_PAYMENT_REQUIRED`, `PLANNING_INCOMPLETE`, `PLANNER_UNCONFIRMED`, أو `LOCKED`.

`canBePrepared` و`isFulfillable` يرجعان true فقط عندما:

- `plannerState=confirmed`
- `commercialState=confirmed`
- لا يوجد دفع مطلوب
- `status=open`

`consumptionState` مشتق في `subscriptionDayFulfillmentStateService.js`. هو وصف قراءة وليس source of truth للخصم. أمثلة: `pending_day`, `consumable_today`, `consumed`, `pickup_no_show_consumed`, `consumed_without_preparation`, `skipped`, `frozen`.

Flutter يجب أن يستخدم:

- `status` لعرض المرحلة التشغيلية.
- `commercialState` و`paymentRequirement` للتخطيط والدفع.
- `canBePrepared`/`isFulfillable` لمعرفة جاهزية التحضير.
- `consumptionState` كعرض/مؤشر، وليس لتنفيذ خصم من العميل.

## 5. Timeline response

Endpoint العميل هو `GET /api/subscriptions/:id/timeline` في `src/routes/subscriptions.js`. الكنترولر هو `getSubscriptionTimeline` في `src/controllers/subscriptionController.js`، ويستدعي `buildSubscriptionTimeline` في `src/services/subscription/subscriptionTimelineService.js`.

طريقة البناء:

- يقرأ الاشتراك.
- إذا كان الاشتراك غير canonical ويحمل `userId`، يحاول إيجاد آخر اشتراك canonical active لنفس المستخدم.
- يحسب `startDate`, `endDate`, `validityEndDate`.
- يقرأ كل `SubscriptionDay` للاشتراك.
- يقرأ `getCompensationSnapshot` لأيام `freeze` و`skip` التعويضية.
- يبني يوم لكل تاريخ من `startDate` إلى `validityEndDate`.
- إذا لا يوجد `SubscriptionDay` يرجع `open`.
- إذا `canonicalDayActionType=freeze` يرجع `frozen`.
- إذا `canonicalDayActionType=skip` يرجع `skipped`.
- غير ذلك يطبع الحالات عبر `normalizeTimelineStatus`.
- إذا الحالة normalized هي `open` وعدد الوجبات المختارة أكبر من صفر، يعرضها كـ `planned`.

الـ labels تأتي من `resolveReadLabel` وملفات localization. `paymentRequirement`, `commercialState`, `plannerRevisionHash`, `premiumSummary`, `canBePrepared`, `isFulfillable` تأتي من `buildDayCommercialState`. حقول التنفيذ مثل `lockedReason`, `lockedMessage`, `fulfillmentSummary`, `pickupLocation`, `deliveryAddress`, `deliveryWindow` تأتي من `buildFulfillmentReadFields`.

`premiumMealsRemaining` و`premiumBalanceBreakdown` يتم حسابها من `subscription.premiumBalance`. `fulfillmentSummary` يعتمد على `deliveryMode` ووجود عنوان/نافذة توصيل أو موقع pickup.

مثال 2026-05-03:

- إذا يوم `2026-05-01` رجع `status=locked`، فالسبب من الكود أن اليوم في DB غالباً `locked` أو حالة تشغيلية مثل `in_preparation`/`out_for_delivery`/`ready_for_pickup`، لأن `normalizeTimelineStatus` يحول هذه الحالات إلى `locked`. لا يوجد في timeline تحويل تلقائي بسبب أن التاريخ صار في الماضي.
- إذا يوم `2026-05-02` رجع `status=planned`، فالسبب أن `SubscriptionDay.status=open` وفيه وجبات مختارة (`meals.selected > 0`). `planned` هنا label للقراءة وليس status مخزنة.

إذا كان المطلوب أن كل الأيام السابقة غير `skipped`/`frozen` تُغلق كمستهلكة، فهذا غير مطبق في `buildSubscriptionTimeline`.

## 6. خصم الأيام / احتساب الاستهلاك

مصدر الخصم الفعلي هو `remainingMeals` في `Subscription`. الخصم يتم عبر `consumeSubscriptionDayCredits` في `src/services/subscription/subscriptionDayConsumptionService.js`. هذه الدالة:

- ترفض إن لم يوجد day/subscription.
- إذا `day.creditsDeducted=true` ترجع idempotent ولا تخصم.
- تحسب عدد الوجبات من `lockedSnapshot.mealsPerDay` أو `fulfilledSnapshot.deductedCredits` أو `resolveMealsPerDay(subscription)`.
- تعمل `$inc: { remainingMeals: -mealsToDeduct }` بشرط وجود رصيد كاف.
- تضع `day.creditsDeducted=true`.

الحالات التي تخصم في الكود الحالي:

- `fulfilled`: عبر `fulfillSubscriptionDay`.
- `no_show`: عبر `kitchenController.markPickupNoShow`.
- `consumed_without_preparation`: عبر `automationService.processDailyCutoff`.
- `skipped` غير تعويضي في `applyOperationalSkipForDate` يخصم ويزيد `skippedCount`، لكن هذا ليس مسار skip العميل العادي.

الحالات التي لا تخصم بذاتها:

- `open`, `planned`, `locked`, `in_preparation`, `ready_for_pickup`, `out_for_delivery`.
- `skipped` التعويضي (`skipCompensated=true`) لا يخصم.
- `frozen` لا يخصم.
- `delivery_canceled` و`canceled_at_branch` لا يخصمان في مسارات الإلغاء الحالية؛ `cancelAtBranch` قد يعيد الرصيد إذا كان اليوم مخصوماً.

هل يوجد auto-consume للأيام السابقة؟ لا بشكل عام. الكود الحالي لا يحوّل الأيام السابقة تلقائياً إلى `consumed_without_preparation` كقاعدة عامة.

الموجود فقط هو `processDailyCutoff`:

- يعمل على `date=today` وليس كل الأيام السابقة.
- يستخدم `getTodayKSADate()` وليس `getRestaurantBusinessDate()`.
- يقرأ أيام ليست `skipped`, `frozen`, `fulfilled`, `no_show`, `consumed_without_preparation`.
- يشترط `pickupRequested != true` و`creditsDeducted != true`.
- يطبق فقط على اشتراكات `deliveryMode=pickup`.
- يتجاهل `in_preparation` و`ready_for_pickup`.
- يخصم الرصيد ويضع `status=consumed_without_preparation`.

ماذا يحدث حالياً:

- يوم `planned` مؤكد ومر بدون fulfillment: يبقى غالباً `planned`/`open` في timeline، إلا إذا دخل job pickup بشروطه.
- يوم `open` بدون تخطيط ومر: يبقى `open` في timeline، إلا إذا كان له record في تاريخ cutoff الحالي واشتراكه pickup وتنطبق شروط job.
- يوم `locked` ومر: يبقى `locked` غالباً. job قد يستهلك pickup locked إذا لم يكن `pickupRequested`، لكن هذا ليس settlement عام.
- يوم `ready_for_pickup` ومر ولم يستلم العميل: لا يتحول تلقائياً إلى `no_show`; يحتاج dashboard action `markPickupNoShow`.
- يوم `out_for_delivery` ومر بدون delivery: لا يتحول تلقائياً إلى `delivery_canceled` أو consumed; يحتاج ops action.

الفجوة مع منطق الجيم: لا توجد خدمة موحدة idempotent تسوي كل الأيام السابقة غير `skipped`/`frozen` كمستهلكة.

## 7. Skip logic

Endpoints العميل:

- `POST /api/subscriptions/:id/days/skip`
- `POST /api/subscriptions/:id/days/:date/skip`
- `POST /api/subscriptions/:id/days/:date/unskip`
- `POST /api/subscriptions/:id/skip-range`

المسارات في `src/routes/subscriptions.js`، والكنترولر في `subscriptionController.js`: `skipDay`, `unskipDay`, `skipRange`. التنفيذ في `subscriptionSkipClientService.js` ثم `subscriptionSkipService.js`.

الشروط:

- الاشتراك يجب أن يكون `active`.
- التاريخ يجب أن يكون مستقبلياً/من الغد حسب المسار وسياسة cutoff.
- `applyCompensatedSkipForDate` يسمح فقط إذا اليوم غير موجود أو `status=open`.
- إذا اليوم `fulfilled`, `frozen`, أو غير `open` يتم الرفض/الإرجاع بحالة مناسبة.
- سياسة skip تأتي من `resolveSubscriptionSkipPolicy`: default `enabled=true`, `maxDays=0` إذا لا توجد policy.

الأثر:

- اليوم يصبح `status=skipped`.
- `skippedByUser=true`.
- `skipCompensated=true`.
- `creditsDeducted=false`.
- `canonicalDayActionType=skip`.
- يزيد `skipDaysUsed`.
- `syncSubscriptionValidity` يمد `validityEndDate` بعدد أيام `skip` التعويضية.

`skipped` التعويضي لا يخصم من `remainingMeals`. توجد audit/activity logs عبر `writeLogSafely`، ومسارات admin تعيد استخدام نفس controller بعد وضع `req.userId` كمالك الاشتراك ثم تضيف `SubscriptionAuditLog`.

## 8. Freeze logic

Endpoints:

- `POST /api/subscriptions/:id/freeze`
- `POST /api/subscriptions/:id/unfreeze`
- admin: `POST /api/admin/subscriptions/:id/freeze`, `POST /api/admin/subscriptions/:id/unfreeze`

التنفيذ في `subscriptionFreezeClientService.js`.

الشروط:

- الاشتراك `active`.
- `freezePolicy.enabled=true`.
- التاريخ من المستقبل/الغد حسب validation وcutoff.
- الأيام المستهدفة يجب أن تكون `open` أو `frozen`.
- حدود policy: default `maxDays=31`, `maxTimes=1` إذا لا توجد policy.

الأثر:

- اليوم يصبح `status=frozen`.
- `canonicalDayActionType=freeze`.
- لا يتم خصم `remainingMeals`.
- `syncSubscriptionValidity` يمد `validityEndDate` بعدد الأيام المجمدة.
- `unfreeze` يعيد اليوم إلى `open` ويحذف `canonicalDayActionType`، ثم يعيد حساب validity.

ملاحظة: `Subscription.status` نفسه لا يتحول إلى `frozen` في مسار freeze الحالي؛ التجميد هنا على مستوى الأيام.

## 9. Fulfillment / Ops logic

مصادر العمليات:

- Kitchen controller: `src/controllers/kitchenController.js`.
- Dashboard unified ops: `src/services/dashboard/opsTransitionService.js`.
- قواعد transition العامة: `src/utils/state.js`.
- خدمة transition أحدث وغير مستخدمة في كل المسارات: `subscriptionDayTransitionService.js`.

العمليات:

- `prepare`: من `locked` إلى `in_preparation`. للـ pickup يحتاج `pickupRequested=true`.
- `ready_for_pickup`: من `in_preparation` إلى `ready_for_pickup`. يصدر `pickupCode`.
- `dispatch`: من `locked` أو `in_preparation` إلى `out_for_delivery` للتوصيل فقط، وينشئ/يحدث `Delivery`.
- `notify_arrival`: يحدث delivery reminder فقط ولا يغير `SubscriptionDay.status`.
- `fulfill`: يحول إلى `fulfilled` ويخصم credits عبر `fulfillSubscriptionDay`.
- `cancel`: للتوصيل يضع `delivery_canceled`; للـ pickup يضع `canceled_at_branch` أو `no_show` حسب payload في dashboard service.
- `reopen`: بعض المسارات تسمح بإرجاع حالات failure إلى `open`; `kitchenController.reopenLockedDay` يفتح فقط `locked` إذا لم يكن `pickupRequested` ولا `creditsDeducted`.
- `pickup_no_show`: في `markPickupNoShow` من `ready_for_pickup` إلى `no_show` ويخصم credits.

`fulfill` هو إكمال تشغيلي:

- pickup fulfill = العميل استلم من الفرع، أو تم التحقق من كود الاستلام.
- delivery fulfill = تم التوصيل.

لكن في منطق الجيم، عدم وجود `fulfill` لا يعني بالضرورة عدم خصم اليوم. الكود الحالي لا يطبق هذه القاعدة بشكل شامل إلا في cutoff job المحدود.

## 10. Payment and Premium logic

`paymentRequirement` مشتق في `buildPaymentRequirement`:

- إذا يوجد slot premium أو add-on بـ `pending_payment` يصبح `requiresPayment=true`.
- `premiumSource` في slot قد يكون `none`, `balance`, `pending_payment`, `paid_extra`, `paid`.
- `balance` يعني مغطى من رصيد premium.
- `paid_extra`/`paid` يعني تمت تسويته.
- `pending_payment` يمنع confirmation/preparation.

`premiumSummary` يحسب:

- `selectedCount`
- `coveredByBalanceCount`
- `pendingPaymentCount`
- `paidExtraCount`
- `totalExtraHalala`

إذا payment مطلوب، `canCreatePayment=true` فقط عندما اليوم غير locked ويوجد مبلغ priced. بعد الدفع، خدمات مثل `paymentApplicationService.js` و`premiumExtraDayPaymentService.js` تغير مصادر slots/addons إلى مدفوعة وتعيد حساب `plannerRevisionHash`.

الدفع يؤثر على `commercialState` و`canBePrepared`. لا يوجد في الكود ما يقول إن payment status وحده يخصم يوم الاشتراك. الخصم يحصل عبر fulfillment/no-show/cutoff consumption.

## 11. Expected business rule vs current implementation

| السيناريو | المتوقع بمنطق الجيم | السلوك الحالي | Gap / OK | حالة مقترحة لاحقاً |
|---|---|---|---|---|
| Past planned confirmed day | يخصم اليوم إذا لم يكن skipped/frozen | يبقى `planned`/`open` غالباً، إلا pickup cutoff بشروط محدودة | Gap | `consumed_without_preparation` |
| Past open unselected day | قرار منتج، لكن حسب قاعدة الجيم يخصم | يبقى `open` غالباً؛ job يستهلك pickup date=today فقط إذا يوجد day record | Gap | `consumed_without_preparation` إذا المنتج وافق |
| Past locked day | يخصم إذا لم يكن skipped/frozen | يبقى `locked` غالباً | Gap | `consumed_without_preparation` أو status أدق |
| Past skipped day | لا يخصم ويمد الصلاحية | لا يخصم في skip التعويضي ويمد الصلاحية | OK |
| Past frozen day | لا يخصم ويمد الصلاحية | لا يخصم ويمد الصلاحية | OK |
| Past ready_for_pickup pickup day | يخصم؛ غالباً `no_show` إذا العميل لم يحضر | لا يتحول تلقائياً؛ يحتاج dashboard action | Gap | `no_show` |
| Past out_for_delivery delivery day | يخصم أو يفشل حسب قرار المنتج | لا يتحول تلقائياً | Gap | `consumed_without_preparation` أو `delivery_canceled` حسب السياسة |

## 12. What Flutter should do now

Flutter يجب أن يعرض الحالة كما تأتي من backend ولا يحاول تسوية الأيام client-side.

استخدم:

- `status` لعرض اليوم في التقويم.
- `commercialState` و`paymentRequirement` لخطوات التخطيط والدفع.
- `mealSlots`, `selectedMealIds`, `dailyMeals` لعرض الوجبات.
- `canBePrepared`, `isFulfillable`, `planningReady`, `fulfillmentReady` لتمكين أزرار التحضير/التنفيذ.
- `lockedReason`, `lockedMessage`, `fulfillmentSummary` لرسائل القفل والتنفيذ.
- `consumptionState` للعرض فقط.

لليوم السابق الذي يظهر `planned` أو `locked`، لا تفترض Flutter أنه استُهلك. اعرضه كحالة backend الحالية، ويمكن إظهار أنه تاريخ سابق إذا احتاج UX، لكن لا تخصم أو تغير الحالة من التطبيق.

إذا ظهر `skipped` أو `frozen` اعرضه كاستثناء غير مستهلك. إذا ظهر `consumed_without_preparation` أو `no_show` اعرضه كحالة نهائية مستهلكة.

## 13. Recommended backend fix later

لا يتم تنفيذ شيء في هذه المهمة. التوصية المستقبلية:

- إضافة خدمة automatic past-day settlement.
- تكون idempotent وتعتمد على `creditsDeducted`.
- تعمل على كل أيام الماضي قبل business date، وربما على يوم العمل الحالي بعد cutoff/إغلاق المطعم.
- تستثني `skipped` و`frozen`.
- تحترم الحالات النهائية الحالية مثل `fulfilled`, `no_show`, `delivery_canceled`, `canceled_at_branch`.
- تحول الأيام غير النهائية المستهلكة إلى `consumed_without_preparation`، أو إلى status أدق إذا قرر المنتج.
- تكتب `dayEndConsumptionReason`.
- تكتب `SubscriptionAuditLog`/ActivityLog.
- تضيف tests لـ pickup/delivery/open/planned/locked/ready/out_for_delivery.

لمنطق الجيم، يجب أن يقوم backend بتسوية الأيام السابقة غير `skipped` وغير `frozen` إلى حالة نهائية مستهلكة مثل `consumed_without_preparation`، إلا إذا كانت حالة نهائية أكثر تحديداً مناسبة.

## 14. Questions / decisions needed from product owner

- هل اليوم السابق `open` بدون أي اختيار يخصم؟
- هل اليوم السابق `locked` يخصم إذا كان سبب القفل نقص موقع pickup أو عنوان delivery؟
- هل `ready_for_pickup` بدون استلام يصبح `no_show` أم `consumed_without_preparation`؟
- هل `out_for_delivery` بدون تسليم يصبح `delivery_canceled` أم `consumed_without_preparation`؟
- هل auto-settlement يحدث عند منتصف الليل، عند cutoff، عند إغلاق المطعم، أم عند القراءة؟
- هل تمديد `validityEndDate` يحدث فقط مع `skip` و`freeze`؟
- هل `delivery_canceled` يخصم اليوم أم يعوض لاحقاً بقرار admin؟

## 15. Summary for backend owner

الكود الحالي يملك نظام تخطيط ودفع وتنفيذ منفصل جيداً:

- `status` للحياة التشغيلية لليوم.
- `commercialState`/`paymentRequirement` للتخطيط والدفع.
- `creditsDeducted` و`remainingMeals` هما مصدر خصم الرصيد.
- `skip` و`freeze` التعويضيان لا يخصمان ويمدان `validityEndDate`.

ما لا يطابق منطق الجيم هو غياب settlement عام للأيام السابقة. أهم الملفات لتعديل لاحق:

- `src/services/automationService.js`: حالياً cutoff محدود لـ pickup وتاريخ اليوم فقط.
- `src/services/subscription/subscriptionDayConsumptionService.js`: دالة الخصم المركزية.
- `src/services/subscription/subscriptionTimelineService.js`: لا يجب أن يسوي وحده، لكنه يظهر الفجوة في القراءة.
- `src/services/subscription/subscriptionDayFulfillmentStateService.js`: يعرض `consumptionState`.
- `src/controllers/kitchenController.js` و`src/services/dashboard/opsTransitionService.js`: مسارات التنفيذ اليدوية.
