# دليل تكامل Meal Planner

هذا الملف هو المرجع التنفيذي الكامل للشخص الذي سيعمل على التطبيق.
الهدف منه أن يعرف بالضبط:
- يبدأ بأي endpoint
- يرسل ماذا
- يتوقع ماذا في الرد
- متى يعمل validate
- متى يعمل save
- متى يسمح بالـ confirm
- وكيف يتعامل مع الوجبات المميزة premium meals
- وما هو المتاح فعليًا الآن في الـ public API وما هو غير متاح

هذا الدليل مبني على **الكود الحالي الفعلي** داخل المشروع، وليس على افتراضات قديمة.

## 1. الفكرة الأساسية

النظام لم يعد يعتمد على `mealIds[]` كاختيار مباشر.
الاختيار اليومي الآن يعتمد على:
- `mealSlots[]`

كل slot يمثل وجبة واحدة داخل اليوم.
وكل slot يتكوّن من:
- `proteinId`
- `carbId`

إذًا مصدر الحقيقة الوحيد للـ planner هو:
- `mealSlots[]`

لا تعتمد في التطبيق على:
- `selections[]`
- `premiumUpgradeSelections[]`

هذه الحقول ما زالت موجودة لأغراض توافق داخلي أو قديم، لكنها ليست المصدر الذي يجب أن يبني عليه التطبيق حالة الـ planner.

## 2. أهم المفاهيم التي يجب أن يفهمها مطور التطبيق

### 2.1 Meal Slot
كل slot يمثل مكان وجبة داخل اليوم.

أهم الحقول التي تهم التطبيق:
- `slotIndex`
- `slotKey`
- `status`
- `proteinId`
- `carbId`
- `proteinFamilyKey`
- `isPremium`
- `premiumSource`
- `premiumExtraFeeHalala`

### 2.2 Slot Status
القيم الحالية:
- `empty`: لا يوجد protein ولا carb
- `partial`: يوجد واحد فقط منهما
- `complete`: يوجد protein و carb

### 2.3 plannerMeta
هذا هو الملخص الذي يجب أن يعتمد عليه التطبيق بدل أي حساب محلي.

أهم الحقول:
- `requiredSlotCount`
- `emptySlotCount`
- `partialSlotCount`
- `completeSlotCount`
- `beefSlotCount`
- `premiumSlotCount`
- `premiumCoveredByBalanceCount`
- `premiumPendingPaymentCount`
- `premiumPaidExtraCount`
- `premiumTotalHalala`
- `isDraftValid`
- `isConfirmable`

### 2.4 paymentRequirement
هذا الحقل هو المرجع الأساسي لمعرفة هل هذا اليوم يحتاج دفع إضافي أم لا.

الحقول الحالية:
- `status`
- `requiresPayment`
- `pricingStatus`
- `blockingReason`
- `canCreatePayment`
- `premiumSelectedCount`
- `premiumPendingPaymentCount`
- `pendingAmountHalala`
- `amountHalala`
- `currency`

إذا كان:
- `paymentRequirement.requiresPayment === true`

فالتطبيق **لا يجب** أن يسمح بالـ confirm.

### 2.5 commercialState
هذا الحقل هو الحقيقة التجارية المباشرة لليوم، ولا يجب على التطبيق إعادة تركيبه يدويًا.

القيم الحالية:
- `draft`
- `payment_required`
- `ready_to_confirm`
- `confirmed`

المعنى العملي:
- `draft`: التخطيط غير مكتمل أو غير صالح
- `payment_required`: التخطيط مكتمل لكن ما زال يحتاج تسوية premium extra
- `ready_to_confirm`: التخطيط مكتمل ولا يوجد payment required لكن اليوم لم يتم confirm بعد
- `confirmed`: تم confirm بنجاح وأصبح اليوم مؤكدًا من جهة الـ planner

### 2.6 readiness fields
تمت إضافة حقول مشتقة جاهزة للاستخدام بدل إعادة تركيب readiness logic محليًا:
- `isFulfillable`
- `canBePrepared`

في السلوك الحالي:
- لا يصبح أي منهما `true` قبل `confirm`
- لا يكفي أن تكون `mealSlots` كاملة
- لا يكفي أن يكون اليوم `saved`

### 2.7 premiumSummary
هذا object يلخص حالة الـ premium meals لليوم بشكل موحد:
- `selectedCount`
- `coveredByBalanceCount`
- `pendingPaymentCount`
- `paidExtraCount`
- `totalExtraHalala`
- `currency`

### 2.8 premiumExtraPayment
هذا object يوضح حالة premium extra payment الحالية لليوم نفسه.

أهم الحقول:
- `status`
- `paymentId`
- `providerInvoiceId`
- `amountHalala`
- `currency`
- `expiresAt`
- `reused`
- `revisionHash`

أهم القيم:
- `none`
- `pending`
- `paid`
- `failed`
- `expired`
- `revision_mismatch`

### 2.9 plannerRevisionHash
هذا hash يمثل revision الحالية للـ planner.

يستخدمه backend لكي:
- يحدد هل payment الحالية ما زالت صالحة لنفس التخطيط
- يكتشف إذا عدّل المستخدم `mealSlots` بعد إنشاء payment
- يعلّم حالة الدفع بأنها `revision_mismatch` عند الحاجة

## 3. الإندبوينتات المستخدمة في السايكل

هذه هي الإندبوينتات التي تدخل في سايكل الـ Meal Planner نفسه.

### 3.1 تحميل بيانات اليوم
`GET /subscriptions/:id/days/:date`

هذا هو أول endpoint في السايكل.

وظيفته:
- جلب حالة اليوم الحالية
- جلب `mealSlots`
- جلب `plannerMeta`
- جلب `plannerRevisionHash`
- جلب `commercialState`
- جلب `isFulfillable`
- جلب `canBePrepared`
- جلب `premiumSummary`
- جلب `premiumExtraPayment`
- جلب `rules`
- جلب `paymentRequirement`
- جلب `plannerState`

يجب أن يبدأ التطبيق بهذا endpoint عند فتح شاشة التخطيط ليوم معين.

#### متى يستخدم
- عند فتح الصفحة لأول مرة
- بعد `save`
- بعد `confirm`
- بعد أي عملية backend تغيّر حالة اليوم
- بعد أي تدفق دفع ناجح للـ premium extra أو أي تسوية مرتبطة باليوم

#### ماذا يحتاج من التطبيق
- `subscriptionId`
- `date`

#### ماذا يفعل التطبيق بعد الرد
- يبني الـ UI من `mealSlots[]`
- يقرأ `plannerMeta`
- يقرأ `commercialState`
- يقرأ `isFulfillable`
- يقرأ `canBePrepared`
- يقرأ `premiumSummary`
- يقرأ `premiumExtraPayment`
- يقرأ `paymentRequirement`
- يحدد هل اليوم editable أم لا من:
  - `status`
  - `plannerState`
- يحدد هل اليوم ready فعليًا أم لا من:
  - `commercialState`
  - `isFulfillable`
  - `canBePrepared`

#### قاعدة مهمة جدًا
لا تعتمد على:
- `selectedMeals === requiredMeals`
- أو `plannerMeta.isConfirmable` وحده
- أو `status = planned`

لكي تعتبر اليوم جاهزًا.

المرجع الصحيح للجاهزية الآن هو:
- `commercialState`
- `isFulfillable`
- `canBePrepared`
- `paymentRequirement`

#### إن كان الرد 404
هذا يعني:
- اليوم غير موجود في قاعدة البيانات لهذا الاشتراك أو التاريخ

وفي هذه الحالة التطبيق لا يجب أن يفترض يومًا مخططًا جاهزًا.

### 3.2 تحميل كتالوج البروتينات والكارب
`GET /subscriptions/meal-planner-menu`

هذا endpoint يستخدم بالتوازي مع endpoint اليوم.

وظيفته:
- جلب قائمة البروتينات
- جلب قائمة الكارب
- جلب التصنيفات
- جلب metadata اللازمة لعرض الأصناف داخل التطبيق

#### لماذا هو مهم
لأن `mealSlots` تحتوي IDs، بينما أسماء الأكلات والصور والفئات تأتي من الكتالوج.

#### ماذا يفعل التطبيق بعد الرد
- يربط `proteinId` و `carbId` مع عناصر الكتالوج
- يبني شاشة الاختيار
- يميز الأصناف الـ premium من خلال بيانات الكتالوج

### 3.3 فحص المسودة بدون حفظ
`POST /subscriptions/:id/days/:date/selection/validate`

هذا endpoint اختياري من ناحية الـ flow، لكنه موصى به جدًا.

وظيفته:
- التحقق من الـ draft الحالي
- إرجاع أخطاء slot-level
- إرجاع `plannerMeta` المحسوبة من الكود
- إرجاع `paymentRequirement`

#### متى يستخدم
- بعد كل تعديل مهم في الاختيار
- عند اختيار protein
- عند اختيار carb
- قبل الضغط على save لو أردت feedback لحظي

#### الـ payload
يجب إرسال:

```json
{
  "mealSlots": [
    {
      "slotIndex": 1,
      "slotKey": "slot_1",
      "proteinId": "PROTEIN_ID",
      "carbId": "CARB_ID"
    }
  ]
}
```

#### الرد في حالة النجاح
يرجع:
- `valid: true`
- `mealSlots`
- `plannerMeta`
- `plannerRevisionHash`
- `premiumSummary`
- `premiumExtraPayment`
- `paymentRequirement`
- `commercialState`
- `isFulfillable`
- `canBePrepared`
- `rules`

#### الرد في حالة الفشل
إما:
- `valid: false` داخل payload
أو error response حسب نوع الفشل

ويكون الأهم للتطبيق:
- `slotErrors[]`

كل عنصر في `slotErrors[]` قد يحتوي:
- `slotIndex`
- `field`
- `code`
- `message`

#### ماذا يفعل التطبيق بعد الرد
- يربط كل خطأ بالـ slot المناسب من خلال `slotIndex`
- لا يحسب validity محليًا
- يعتمد على:
  - `plannerMeta.isDraftValid`
  - `plannerMeta.isConfirmable`
  - `paymentRequirement.requiresPayment`
  - `commercialState`

### 3.4 حفظ المسودة
`PUT /subscriptions/:id/days/:date/selection`

هذا endpoint هو endpoint الحفظ الفعلي.

وظيفته:
- معالجة `mealSlots`
- بناء الـ processed slots
- حفظ اليوم
- تحديث `plannerMeta`
- تحديث `plannerRevisionHash`
- تحديث `premiumSummary`
- تحديث `premiumExtraPayment`
- تحديث `commercialState`
- تحديث `materializedMeals`
- تحديث حالة premium داخل اليوم
- استهلاك premium balance عندما يكون متوفرًا

### قاعدة مهمة جدًا
هذا endpoint يحفظ **draft فقط**.

هو لا يعني:
- approval
- readiness
- fulfillment permission
- confirmation

#### متى يستخدم
- عند الضغط على Save
- عند مغادرة الشاشة إذا كان التطبيق يعمل auto-save
- عند الانتقال لخطوة تالية مع الحاجة لتثبيت draft في backend

#### الـ payload
الحد الأدنى:

```json
{
  "mealSlots": [
    {
      "slotIndex": 1,
      "slotKey": "slot_1",
      "proteinId": "PROTEIN_ID",
      "carbId": "CARB_ID"
    },
    {
      "slotIndex": 2,
      "slotKey": "slot_2",
      "proteinId": "PROTEIN_ID_2",
      "carbId": "CARB_ID_2"
    }
  ]
}
```

وقد يحتوي أيضًا على:
- `addonsOneTime`
- `oneTimeAddonSelections`

#### الرد
يرجع اليوم بعد الحفظ، وأهم ما يجب قراءته:
- `data.mealSlots`
- `data.plannerMeta`
- `data.plannerRevisionHash`
- `data.commercialState`
- `data.isFulfillable`
- `data.canBePrepared`
- `data.premiumSummary`
- `data.premiumExtraPayment`
- `data.paymentRequirement`
- `data.plannerState`
- `data.status`

#### ماذا يفعل التطبيق بعد الرد
- يستبدل الـ local draft بما عاد من backend
- لا يحتفظ بنسخة محلية قديمة بعد الحفظ
- يعيد حساب أزرار UI من الرد الجديد
- لا يعتبر اليوم جاهزًا لمجرد نجاح الـ save

### 3.5 إنشاء Payment للـ Premium Extra
`POST /subscriptions/:id/days/:date/premium-extra/payments`

هذا endpoint هو المسؤول عن بدء شراء الزيادة الخاصة بالـ premium meals لليوم الحالي.

#### متى يستخدم
- بعد `save`
- عندما يكون:
  - `paymentRequirement.requiresPayment === true`
  - و `plannerMeta.premiumPendingPaymentCount > 0`
- و `paymentRequirement.canCreatePayment === true`
- بعد أن يراجع التطبيق المبلغ من:
  - `paymentRequirement.pendingAmountHalala`

#### ماذا يفعل backend
- يتأكد أن اليوم ما زال `open`
- يتأكد أن `premiumExtraPayment.status !== paid`
- يتأكد أن الحالة الحالية قابلة لإنشاء payment
- يربط payment بالـ `plannerRevisionHash` الحالي
- ينشئ invoice/payment
- يربط payment باليوم

#### الرد المهم للتطبيق
- `paymentId`
- `paymentUrl`
- `amountHalala`
- `currency`
- `reused`
- `plannerRevisionHash`
- `premiumExtraPayment`
- `premiumSummary`
- `paymentRequirement`
- `commercialState`

#### ماذا يفعل التطبيق بعد الرد
- يفتح `paymentUrl` أو WebView
- يحتفظ بـ `paymentId`
- يحتفظ أيضًا بالحالة العائدة من الرد بدل افتراض أن الدفع ما زال صالحًا بعد أي تعديل محلي
- لا يعمل `confirm` قبل خطوة verify

### 3.6 التحقق من Payment بعد الدفع
`POST /subscriptions/:id/days/:date/premium-extra/payments/:paymentId/verify`

هذا endpoint هو المسؤول عن إنهاء دورة شراء الـ premium extra.

#### متى يستخدم
- بعد رجوع المستخدم من صفحة الدفع
- بعد webhook/redirect success
- عند polling حالة الدفع إذا كان التطبيق يعمل retry flow

#### ماذا يفعل backend
- يقرأ حالة invoice من مزود الدفع
- يحدّث payment status
- يقارن payment revision مع `plannerRevisionHash` الحالية
- إذا اختلفت revision:
  - يرجع `PREMIUM_EXTRA_REVISION_MISMATCH`
  - ويظهر `premiumExtraPayment.status = revision_mismatch` داخل حالة اليوم
- إذا كانت الحالة `paid`:
  - يحول الـ slots من `pending_payment` إلى `paid_extra`
  - يعيد حساب `plannerMeta`
  - يعيد اشتقاق `premiumSummary`
  - يعيد اشتقاق `paymentRequirement`
  - يعيد اشتقاق `commercialState`
  - يعيد إسقاط `materializedMeals`
  - يحدّث `baseMealSlots`
  - يغيّر `premiumExtraPayment.status` إلى `paid`

#### ماذا يفعل التطبيق بعد الرد
- إذا كانت `paymentStatus === "paid"`:
  - يعيد جلب اليوم عبر `GET /subscriptions/:id/days/:date`
  - أو يعتمد على الرد ثم يحدث الحالة المحلية
- يتأكد أن:
  - `paymentRequirement.requiresPayment === false`
  - و `premiumSummary.pendingPaymentCount === 0`
  - و `commercialState === "ready_to_confirm"` أو `confirmed` حسب المرحلة
- بعدها فقط يفعّل زر confirm

### 3.7 تأكيد اليوم
`POST /subscriptions/:id/days/:date/confirm`

هذا endpoint هو آخر endpoint في السايكل.

وظيفته:
- إعادة التحقق من `mealSlots` المخزنة
- رفض اليوم إذا كان ناقصًا أو غير صالح
- رفض اليوم إذا كانت هناك دفعات معلقة لازمة
- رفض اليوم إذا لم يكن في `commercialState = ready_to_confirm`
- وضع:
  - `plannerState = "confirmed"`

#### متى يستخدم
- فقط بعد أن يصبح اليوم ready
- فقط بعد أن تكون كل الـ slots المطلوبة complete
- فقط بعد أن يصبح `paymentRequirement.requiresPayment === false`
- فقط بعد أن يصبح `commercialState === "ready_to_confirm"`

#### لا يجب استدعاؤه إذا
- `plannerMeta.isConfirmable === false`
- أو `paymentRequirement.requiresPayment === true`
- أو `status !== "open"`
- أو `plannerState === "confirmed"`
- أو `commercialState !== "ready_to_confirm"`

#### الرد
يرجع:
- `ok: true`
- `success: true`
- `plannerState`
- `data`

#### ماذا يفعل التطبيق بعد الرد
- يعتبر اليوم مقفولًا من جهة الـ planner
- يعطل التعديل
- يعرض badge أو حالة confirmed
- يعتبر readiness نهائية فقط إذا:
  - `commercialState === "confirmed"`
  - `isFulfillable === true`
  - `canBePrepared === true`

## 4. ترتيب السايكل الصحيح داخل التطبيق

هذا هو الترتيب الذي يجب أن يطبقه التطبيق من أول ما المستخدم يفتح اليوم حتى نهاية السايكل.

### المرحلة 1: فتح الشاشة
1. استدعاء:
   - `GET /subscriptions/:id/days/:date`
2. استدعاء:
   - `GET /subscriptions/meal-planner-menu`

### المرحلة 2: بناء الشاشة
يبني التطبيق:
- الـ slots
- قائمة البروتينات
- قائمة الكارب
- حالة كل slot
- حالة confirm button

المرجع هنا:
- `mealSlots`
- `plannerMeta`
- `paymentRequirement`
- `commercialState`
- `isFulfillable`
- `canBePrepared`

### المرحلة 3: المستخدم يختار الأكل
عند أي تعديل:
- التطبيق يحدّث local draft
- ثم الأفضل أن ينادي:
  - `POST /selection/validate`

### المرحلة 4: إظهار نتيجة الـ validate
من الرد:
- لو في `slotErrors` يتم عرضها على الـ UI
- لو `paymentRequirement.requiresPayment === true` يظهر أن اليوم يحتوي premium extras تحتاج تسوية
- لو `plannerMeta.isConfirmable === false` يمنع confirm
- لو `commercialState === "draft"` لا يعتبر اليوم ready حتى لو كان جزء من الـ UI مكتمل شكليًا

### المرحلة 5: الحفظ الفعلي
بعد أن ينتهي المستخدم من اختياراته:
- التطبيق ينادي:
  - `PUT /selection`

ثم:
- يعيد بناء الشاشة من الرد
- لا يعتمد على draft قديم

### المرحلة 6: التحقق من وجود premium payment
بعد الحفظ يقرأ التطبيق:
- `paymentRequirement.requiresPayment`
- `paymentRequirement.canCreatePayment`
- `commercialState`

#### إن كانت `false`
لا يعني هذا أن اليوم ready للتنفيذ.

يمكن الانتقال مباشرة لزر confirm فقط إذا:
- `commercialState === "ready_to_confirm"`

#### إن كانت `true`
هذا يعني:
- يوجد premium slot أو أكثر حالته `pending_payment`
- لا يجوز confirm الآن

### المرحلة 7: إنشاء payment للـ premium extra
عندما تكون:
- `paymentRequirement.requiresPayment === true`

فالتطبيق ينادي:
- `POST /subscriptions/:id/days/:date/premium-extra/payments`

ثم:
- يستقبل `paymentId`
- يفتح `paymentUrl`
- لا يسمح بالـ confirm أثناء وجود الدفع pending
- إذا تغيّر `plannerRevisionHash` بعد ذلك، يجب اعتبار payment القديمة غير صالحة

### المرحلة 8: verify بعد نجاح الدفع
بعد عودة المستخدم من الدفع أو نجاح مزود الدفع:
- التطبيق ينادي:
  - `POST /subscriptions/:id/days/:date/premium-extra/payments/:paymentId/verify`

ثم:
- يتأكد أن الدفع أصبح `paid`
- يعيد تحميل اليوم
- يتأكد أن `paymentRequirement.requiresPayment === false`
- ويتأكد أن `commercialState === "ready_to_confirm"`

### المرحلة 9: confirm
بعد اختفاء الدفع المعلق واكتمال الـ slots:
- التطبيق ينادي:
  - `POST /subscriptions/:id/days/:date/confirm`

## 5. كيف تعمل الوجبات المميزة Premium Meals

### 5.1 كيف يعرف النظام أن الوجبة premium
من الكتالوج.
إذا كان الـ protein المختار:
- `isPremium === true`

فهذا slot premium.

### 5.2 كيف يحدد النظام هل تحتاج دفع أم لا
عند بناء الـ draft:
- إذا وجد backend رصيد premium balance لنفس البروتين، يضبط:
  - `premiumSource = "balance"`
- إذا لم يجد رصيدًا، يضبط:
  - `premiumSource = "pending_payment"`

### 5.3 كيف يعرف التطبيق أن هناك دفع مطلوب
من:
- `paymentRequirement.requiresPayment`

وأيضًا يمكن فهم التفاصيل من:
- `premiumSummary.pendingPaymentCount`
- `premiumSummary.totalExtraHalala`
- `paymentRequirement.pricingStatus`
- `paymentRequirement.blockingReason`

### 5.4 كيف يعرف التطبيق أن slot premium تم تغطيته
من `mealSlots` نفسها:
- `isPremium`
- `premiumSource`

أهم الحالات:
- `none`: عادي
- `balance`: premium ومغطى
- `pending_payment`: premium وغير مسدد
- `paid_extra`: premium وتم سداد الزيادة
- `paid`: premium في حالة مدفوعة ومعاملة كمسددة

### 5.5 كيف يعرف التطبيق أن payment القديمة لم تعد صالحة
من:
- `premiumExtraPayment.status === "revision_mismatch"`

وهذا يعني:
- المستخدم عدّل `mealSlots` بعد إنشاء payment
- لا يجب استخدام payment القديمة في verify
- يجب إنشاء payment جديدة للحالة الحالية إذا ما زال `paymentRequirement.canCreatePayment === true`

## 6. هل التطبيق يستطيع الآن شراء Premium Meals من الـ public API؟

نعم.

الموجود فعليًا الآن في هذا الفرع:
- `POST /subscriptions/:id/days/:date/premium-extra/payments`
- `POST /subscriptions/:id/days/:date/premium-extra/payments/:paymentId/verify`

وهما المسؤولان عن:
- إنشاء payment للـ premium extra day
- التحقق من payment
- تحويل slot من `pending_payment` إلى `paid_extra`

### السايكل الصحيح للـ premium payment
1. المستخدم يحفظ اليوم عبر:
   - `PUT /subscriptions/:id/days/:date/selection`
2. التطبيق يقرأ:
   - `paymentRequirement.requiresPayment`
3. إذا كانت `true`:
   - ينادي `POST /subscriptions/:id/days/:date/premium-extra/payments`
4. التطبيق يفتح `paymentUrl`
5. بعد نجاح الدفع:
   - ينادي `POST /subscriptions/:id/days/:date/premium-extra/payments/:paymentId/verify`
6. بعدها يعيد جلب اليوم عبر:
   - `GET /subscriptions/:id/days/:date`
7. يتأكد أن:
  - `premiumSource` أصبح `paid_extra` أو حالة مسددة
  - `paymentRequirement.requiresPayment === false`
  - `commercialState === "ready_to_confirm"`
8. بعدها فقط يسمح بالـ confirm

## 7. قواعد الـ Confirm التي يجب أن يلتزم بها التطبيق

زر الـ confirm يجب أن يكون disabled إذا تحقق أي شرط من التالي:
- `plannerMeta.isConfirmable === false`
- `paymentRequirement.requiresPayment === true`
- `plannerState === "confirmed"`
- `status !== "open"`
- `commercialState !== "ready_to_confirm"`
- `isFulfillable === true` ليس شرطًا للـ confirm بل نتيجة بعده

## 8. قاعدة اللحم Beef Rule

هذه نقطة حساسة جدًا ويجب أن يفهمها مطور التطبيق كما هي في الكود الحالي.

### القاعدة الحالية الفعلية
الـ beef limit الحالي لا يعد كل beef slot.

بل يعد فقط:
- `proteinFamilyKey === "beef"`
- و `isPremium !== true`

أي أنه يعد:
- regular beef فقط

ولا يدمج معه:
- premium beef

### أمثلة صحيحة
- `regular beef + chicken` = صالح
- `regular beef + premium beef` = صالح
- `regular beef + premium beef + chicken` = صالح إذا كانت بقية الشروط سليمة

### أمثلة مرفوضة
- `regular beef + regular beef` = مرفوضة بـ `BEEF_LIMIT_EXCEEDED`

### ماذا عن `two premium beef meals`
في الكود الحالي:
- لا يوجد منع مستقل لهما من خلال beef rule نفسها
- أي أنهما ليسا blocked بسبب قاعدة اللحم وحدها
- قد يُمنع السيناريو فقط إذا تعارض مع:
  - slot count
  - payment state
  - أو أي rule آخر

## 9. أخطاء يجب أن يتعامل معها التطبيق

أهم الأخطاء التي قد تظهر في هذا السايكل:
- `BEEF_LIMIT_EXCEEDED`
- `PLANNING_INCOMPLETE`
- `MEAL_SLOT_COUNT_EXCEEDED`
- `COMPLETE_SLOT_COUNT_EXCEEDED`
- `INVALID_SLOT_INDEX`
- `DUPLICATE_SLOT_INDEX`
- `DUPLICATE_SLOT_KEY`
- `LOCKED`
- `PREMIUM_EXTRA_PAYMENT_NOT_REQUIRED`
- `PREMIUM_EXTRA_ALREADY_PAID`
- `PREMIUM_EXTRA_REVISION_MISMATCH`
- `NO_PENDING_PREMIUM_EXTRA`
- `CHECKOUT_IN_PROGRESS`
- `SUB_INACTIVE`
- `SUB_EXPIRED`
- `NOT_FOUND`
- `FORBIDDEN`

### كيف يتعامل معها التطبيق
- أخطاء `slotErrors[]` تعرض عند الـ slot المناسب
- أخطاء `LOCKED` تمنع التعديل وتحوّل الشاشة لوضع read-only
- أخطاء `PLANNING_INCOMPLETE` تعني لا confirm
- أخطاء `PLANNER_UNCONFIRMED` تعني لا execution / no prepare قبل confirm
- أخطاء `PREMIUM_PAYMENT_REQUIRED` تعني لا confirm قبل تسوية premium extra
- أخطاء `BEEF_LIMIT_EXCEEDED` تعني تعديل الاختيارات
- أخطاء premium payment تعني إعادة مزامنة اليوم أو إعادة محاولة الدفع حسب الكود الراجع

## 10. قواعد الأيام والتعديل

### save و validate
في الكود الحالي:
- يقبلان اليوم الحالي والمستقبلي
- يرفضان الماضي
- يرفضان غدًا إذا انتهى cutoff
- يرفضان الأيام غير المفتوحة

### confirm
الـ confirm أيضًا يراجع صلاحية التاريخ وحالة اليوم قبل الإغلاق.

### rule مهمة جدًا للتطبيق
لا تعتبر كل يوم مستقبلي locked.
اليوم المستقبلي يمكن أن يكون editable بشكل طبيعي إذا:
- `status === "open"`
- و `plannerState !== "confirmed"`
- ولا يوجد cutoff أو business restriction مانعة

## 11. What The App Must Do After Each Endpoint

### بعد `GET /days/:date`
- يبني الشاشة
- يحدد editable / read-only
- يحدد هل confirm متاح مبدئيًا
- يقرأ `commercialState`
- يقرأ `isFulfillable`
- يقرأ `canBePrepared`

### بعد `GET /meal-planner-menu`
- يربط IDs بالأسماء والصور والتصنيفات

### بعد `POST /selection/validate`
- يعرض أخطاء الـ slots
- يحدث حالة confirm button
- يحدث تنبيه premium payment إذا لزم
- يحدث `commercialState` في الواجهة

### بعد `PUT /selection`
- يستبدل الحالة المحلية بالحالة العائدة من backend
- يعيد تقييم payment requirement
- يعيد تقييم `commercialState`
- لا يعتبر save = confirm
- لا يعتمد على draft قديم

### بعد `POST /premium-extra/payments`
- يحتفظ بـ `paymentId`
- يفتح `paymentUrl`
- يدخل المستخدم في payment flow

### بعد `POST /premium-extra/payments/:paymentId/verify`
- إذا كان الدفع ناجحًا يعيد تحميل اليوم
- يتأكد أن `requiresPayment` اختفت
- ويتأكد أن `premiumExtraPayment.status !== revision_mismatch`
- يفعّل confirm فقط بعد نجاح verify

### بعد `POST /confirm`
- يقفل التفاعل
- يعرض confirmed state
- يمنع مزيدًا من التعديل
- يعتبر readiness حقيقية فقط بعد الرد الناجح

## 12. Endpoints خارج السايكل الأساسي لكنها مرتبطة به

هذه ليست جزءًا من core planner flow، لكنها قد تؤثر حسب شاشة التطبيق:

### Bulk Save
`PUT /subscriptions/:id/days/selections/bulk`

يستخدم إذا أردت تطبيق اختيارات متشابهة على عدة أيام.
ليس مطلوبًا في السايكل الأساسي لليوم الواحد.

### One-Time Addon Payments
الموجود حاليًا في router:
- `POST /subscriptions/:id/days/:date/one-time-addons/payments`
- `POST /subscriptions/:id/days/:date/one-time-addons/payments/:paymentId/verify`

هذه endpoints تخص one-time addons، وليست هي flow شراء premium meals.

### Timeline
`GET /subscriptions/:id/timeline`

هذا endpoint ما زال يحتفظ بـ `status` التوافقي مثل:
- `open`
- `planned`
- `locked`

لكن لا يجب اعتباره مصدر الحقيقة الوحيد للجاهزية.

الحقول الأهم الآن داخل كل day في timeline:
- `commercialState`
- `isFulfillable`
- `canBePrepared`
- `paymentRequirement`
- `mealSlots`

إذا كان اليوم في timeline يظهر مثلًا:
- `status = planned`

فهذا **لا يعني** أنه ready للتنفيذ.

المعنى الصحيح يعتمد على:
- `commercialState`
- `isFulfillable`
- `paymentRequirement`

## 13. الخلاصة التنفيذية السريعة

إذا أردت السايكل المختصر جدًا داخل التطبيق:

1. افتح الشاشة:
   - `GET /subscriptions/:id/days/:date`
   - `GET /subscriptions/meal-planner-menu`
2. المستخدم يختار:
   - عدل local `mealSlots[]`
3. افحص:
   - `POST /subscriptions/:id/days/:date/selection/validate`
4. احفظ:
   - `PUT /subscriptions/:id/days/:date/selection`
5. اقرأ:
  - `plannerMeta`
  - `commercialState`
  - `paymentRequirement`
6. إن كان `requiresPayment === true`:
  - أنشئ payment:
    - `POST /subscriptions/:id/days/:date/premium-extra/payments`
   - بعد الدفع اعمل verify:
     - `POST /subscriptions/:id/days/:date/premium-extra/payments/:paymentId/verify`
   - ثم أعد جلب اليوم
7. إن كان `requiresPayment === false` و `commercialState === "ready_to_confirm"`:
   - `POST /subscriptions/:id/days/:date/confirm`
8. بعد الرد:
   - اقفل الشاشة واعرض confirmed

## 14. ملاحظات أخيرة لمطور التطبيق

- لا تحسب validity محليًا.
- لا تبني business rules من عندك.
- لا تعتبر كل beef ممنوعًا مع بعضه.
- لا تعتبر اليوم المستقبلي locked تلقائيًا.
- لا تسمح بالـ confirm إذا كان هناك premium payment pending.
- اعتمد دائمًا على:
  - `mealSlots`
  - `plannerMeta`
  - `commercialState`
  - `isFulfillable`
  - `canBePrepared`
  - `premiumSummary`
  - `premiumExtraPayment`
  - `paymentRequirement`
  - `plannerState`
  - `status`
