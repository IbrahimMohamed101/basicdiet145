# Subscription App UI Endpoint Audit

هذا الملف يراجع شاشات الاشتراكات الظاهرة في الـ UI المرفق، ويربط كل شاشة بالـ endpoints الحالية في الـ backend بعد تنفيذ تحسينات الـ mobile parity.

الحالات المستخدمة هنا:

- متوافقة
- متوافقة جزئيا
- غير مدعومة بالكامل

ملاحظات عامة:

- هذا التقييم خاص بـ App endpoints تحت `/api/subscriptions/*`
- شاشات الـ admin / dashboard لها endpoints مختلفة تحت `/api/admin/*` و `/api/dashboard/*`
- الـ response contract المعتمد الآن في التنفيذ والتوثيق هو:

```json
{ "ok": true, "data": {} }
```

---

## 1. My Subscription

### Endpoints المطلوبة

- `GET /api/subscriptions`
- `GET /api/subscriptions/:id`
- `GET /api/subscriptions/:id/wallet`
- `GET /api/subscriptions/:id/today`
- `GET /api/subscriptions/:id/timeline`

### كيف تتغذى الشاشة

- بيانات الكارت الرئيسي تأتي من `GET /api/subscriptions` أو `GET /api/subscriptions/:id`
  - `planName`
  - `status`
  - `remainingMeals`
  - `totalMeals`
  - `deliveryMode`
  - `selectedMealsPerDay`
  - `startDate`
  - `validityEndDate`
- بيانات كارت الـ wallet تأتي من `GET /api/subscriptions/:id/wallet`
  - `premiumSummary`
  - `addonsSummary`
  - `premiumBalance`
  - `addonBalance`
  - `totals`
- زر `Today's Meals` يفتح على `GET /api/subscriptions/:id/today`
- زر `View Timeline` يفتح على `GET /api/subscriptions/:id/timeline`

### الحكم

- متوافقة

### الملاحظات

- الشاشة تتغذى من أكثر من endpoint، وهذا مقبول ولا يحتاج aggregate endpoint إضافي حاليا.
- كارت الـ wallet في الـ UI يعرض قيمة مالية مختصرة، بينما الـ backend يرجع رصيد مفصل بالكمية + السعر للوحدة، لذلك الـ frontend سيحسب القيمة المعروضة من الـ rows.

---

## 2. Manage Subscription

### Endpoints المطلوبة

- `GET /api/subscriptions/:id`
- `GET /api/subscriptions/:id/operations-meta`
- `POST /api/subscriptions/:id/cancel`
- `GET /api/subscriptions/payment-methods`
- التنقل إلى:
  - `GET /api/subscriptions/:id/freeze-preview`
  - `POST /api/subscriptions/:id/freeze`
  - `POST /api/subscriptions/:id/days/:date/skip`
  - `POST /api/subscriptions/:id/skip-range`
  - `PUT /api/subscriptions/:id/delivery`

### الحكم

- متوافقة جزئيا

### ما هو المدعوم

- `Cancel Subscription` أصبح مدعومًا للعميل:
  - `POST /api/subscriptions/:id/cancel`
- `operations-meta` أصبح المصدر الأساسي لتغذية:
  - `cancel`
  - `freeze`
  - `skip`
  - `delivery`
  - `paymentMethods`
- `Payment Methods` أصبح لها app endpoint واضح للـ capability:
  - `GET /api/subscriptions/payment-methods`

### الفجوات

- إدارة وسائل الدفع المحفوظة نفسها ما زالت غير مدعومة بالكامل.
- endpoint الحالي يرجع capability فقط:

```json
{
  "ok": true,
  "data": {
    "supported": false,
    "canManage": false,
    "provider": "moyasar",
    "mode": "invoice_only",
    "reasonCode": "PROVIDER_TOKENIZATION_UNAVAILABLE",
    "methods": []
  }
}
```

---

## 3. Freeze Subscription

### Endpoints المطلوبة

- `GET /api/subscriptions/:id`
- `GET /api/subscriptions/:id/operations-meta`
- `GET /api/subscriptions/:id/freeze-preview`
- `POST /api/subscriptions/:id/freeze`

### Query preview

```http
GET /api/subscriptions/:id/freeze-preview?startDate=2026-04-05&days=5
```

### Payload التنفيذ

```json
{
  "startDate": "2026-04-05",
  "days": 5
}
```

### الحكم

- متوافقة

### ما هو المدعوم

- قراءة `freezePolicy` و usage من:
  - `GET /api/subscriptions/:id/operations-meta`
- بناء `Impact Summary` قبل التنفيذ من:
  - `GET /api/subscriptions/:id/freeze-preview`
- تنفيذ التجميد من:
  - `POST /api/subscriptions/:id/freeze`
- استلام:
  - `targetDates`
  - `newlyFrozenDates`
  - `alreadyFrozenDates`
  - `frozenDaysTotalAfter`
  - `validityEndDateAfter`
  - `extensionDaysAdded`

### ملاحظة

- شاشة الـ preview أصبحت الآن مدعومة من الـ backend مباشرة، ولا تحتاج حسابات front-end محلية لتقدير الأثر.

---

## 4. Skip Days - Single Day

### Endpoints المطلوبة

- `GET /api/subscriptions/:id/operations-meta`
- `GET /api/subscriptions/:id/days`
- أو `GET /api/subscriptions/:id/timeline`
- `POST /api/subscriptions/:id/days/:date/skip`
- اختياري عند التراجع:
  - `POST /api/subscriptions/:id/days/:date/unskip`

### الحكم

- متوافقة

### ما هو المدعوم

- اختيار يوم واحد وتخطيه
- معرفة حالة الأيام من `timeline` أو `days`
- معرفة skip usage والحد المسموح به من:
  - `GET /api/subscriptions/:id/operations-meta`
- التراجع عن التخطي لو اليوم ما زال قابلا لذلك

### البيانات التي تغذي شريط الحد

- `skippedCount`
- `skipRemaining`
- `skipAllowance`

### ملاحظة مهمة

- backend يعلن صراحة أن مصدر limit الحالي هو:
  - `allowanceScope: "global_setting"`
- لذلك لا يُفضّل أن يربط الـ UI هذا الحد بصياغة "this month" إلا إذا كانت هذه هي القاعدة المعتمدة product-wise.

---

## 5. Skip Days - Date Range

### Endpoints المطلوبة

- `GET /api/subscriptions/:id/operations-meta`
- `GET /api/subscriptions/:id/days`
- أو `GET /api/subscriptions/:id/timeline`
- `POST /api/subscriptions/:id/skip-range`

### Payloads المدعومة الآن

الـ payload القديم ما زال مدعومًا:

```json
{
  "startDate": "2026-04-05",
  "days": 3
}
```

والـ payload الجديد المطابق للـ UI أصبح مدعومًا أيضًا:

```json
{
  "startDate": "2026-04-05",
  "endDate": "2026-04-07"
}
```

### الحكم

- متوافقة

### ما هو المدعوم

- إرسال `Start Date` + `End Date` مباشرة كما في الـ UI
- الحفاظ على backward compatibility مع `days`
- إعادة `requestedRange` في response لتأكيد:
  - `startDate`
  - `endDate`
  - `days`
- معرفة الـ limit والـ remaining من `operations-meta`

### ملاحظة

- إذا أرسل الـ client كلًا من `days` و `endDate` معًا، فيجب أن يصفا نفس الـ inclusive range، وإلا يرجع backend خطأ `INVALID`.

---

## 6. Delivery Settings

### Endpoints المطلوبة

- `GET /api/subscriptions/:id`
- `GET /api/subscriptions/:id/operations-meta`
- `GET /api/subscriptions/delivery-options`
- `PUT /api/subscriptions/:id/delivery`
- اختياري للتعديل على يوم واحد فقط:
  - `PUT /api/subscriptions/:id/days/:date/delivery`

### Payloads المدعومة الآن

الـ payload legacy ما زال مدعومًا:

```json
{
  "deliveryAddress": {
    "street": "123 Main Street",
    "building": "4B",
    "city": "Dubai",
    "district": "Dubai Marina",
    "notes": "Leave at door",
    "lat": 25.2048,
    "lng": 55.2708
  },
  "deliveryWindow": "08:00 - 10:00",
  "deliveryZoneId": "65f000000000000000000040"
}
```

والـ payload nested الجديد أصبح مدعومًا:

```json
{
  "delivery": {
    "type": "delivery",
    "zoneId": "65f000000000000000000040",
    "address": {
      "city": "Dubai",
      "district": "Dubai Marina",
      "street": "Street 1",
      "building": "12",
      "apartment": "4B",
      "notes": "Leave at reception"
    },
    "slot": {
      "type": "delivery",
      "window": "08:00 - 10:00",
      "slotId": ""
    }
  }
}
```

ولاشتراكات الـ pickup:

```json
{
  "delivery": {
    "type": "pickup",
    "pickupLocationId": "pickup-1"
  }
}
```

### الحكم

- متوافقة

### ما هو المدعوم

- قراءة العنوان الحالي
- قراءة الـ delivery windows والـ zones والـ pickup locations من:
  - `GET /api/subscriptions/delivery-options`
- تحديث:
  - `deliveryAddress`
  - `deliveryWindow`
  - `deliveryZoneId`
  - `pickupLocationId`
- حفظ `notes` و `lat/lng` داخل العنوان
- دعم current-mode updates لكل من:
  - `delivery`
  - `pickup`

### الملاحظات

- زر `Use Current Location` ليس له endpoint خاص، وهذا طبيعي. التطبيق يلتقط الـ GPS ثم يمرر `lat/lng` داخل `deliveryAddress`.
- تغيير نوع الاشتراك من `delivery` إلى `pickup` أو العكس أثناء اشتراك active ما زال غير مدعوم business-wise داخل هذا flow.

---

## 7. Meal Timeline

### Endpoints المطلوبة

- `GET /api/subscriptions/:id/timeline`
- `GET /api/subscriptions/:id/days/:date`
- اختياري:
  - `GET /api/subscriptions/:id/days`

### الحكم

- متوافقة

### ما هو المدعوم

- إظهار الأيام من `startDate` حتى `validityEndDate`
- إظهار الحالات:
  - `planned`
  - `locked`
  - `delivered`
  - `frozen`
  - `skipped`
  - `extension`
- إظهار هل اليوم امتداد ناتج عن تجميد أم لا
- فتح تفاصيل يوم معين عند الضغط عليه

---

## 8. Wallet Details

هذه الشاشة مرتبطة بزر `View Details` الموجود في كارت الـ wallet.

### Endpoints المطلوبة

- `GET /api/subscriptions/:id/wallet`
- `GET /api/subscriptions/:id/wallet/history`
- `POST /api/subscriptions/:id/premium-credits/topup`
- `POST /api/subscriptions/:id/addon-credits/topup`
- `GET /api/subscriptions/:id/wallet/topups/:paymentId/status`
- `POST /api/subscriptions/:id/wallet/topups/:paymentId/verify`

### الحكم

- متوافقة

---

## 9. Payment Methods

هذه الشاشة موجودة في الـ UI داخل `Manage Subscription`.

### Endpoints الحالية

- `GET /api/subscriptions/payment-methods`

### الحكم

- غير مدعومة بالكامل

### ما هو المدعوم حاليا

- capability endpoint فقط لمعرفة هل الميزة متاحة أم لا

### ما هو غير المدعوم بعد

- `GET saved methods list` الفعلية من provider vault
- `POST add payment method`
- `DELETE remove payment method`
- `set default payment method`

---

## الخلاصة التنفيذية

### الشاشات المتوافقة

- My Subscription
- Freeze Subscription
- Skip Days - Single Day
- Skip Days - Date Range
- Delivery Settings
- Meal Timeline
- Wallet Details

### الشاشات المتوافقة جزئيا

- Manage Subscription

### الشاشات غير المدعومة بالكامل

- Payment Methods

### أهم الـ endpoints الجديدة التي تمت إضافتها أو توسيعها

- `POST /api/subscriptions/:id/cancel`
- `GET /api/subscriptions/:id/operations-meta`
- `GET /api/subscriptions/:id/freeze-preview`
- `GET /api/subscriptions/payment-methods`
- `POST /api/subscriptions/:id/skip-range`
  - أصبح يدعم `endDate` بالإضافة إلى `days`
- `PUT /api/subscriptions/:id/delivery`
  - أصبح يدعم `deliveryZoneId`
  - ويدعم `pickupLocationId`
  - ويدعم payload nested باسم `delivery`
- `GET /api/subscriptions/delivery-options`
  - أصبح موثقًا أيضًا في `swagger`

### ما الذي ما زال deferred

- saved payment methods الحقيقية provider-wise
- تغيير `deliveryMode` بين `delivery` و `pickup` أثناء اشتراك active
- أي pricing semantics خاصة بتغيير zone mid-subscription

---

## ملاحظة تقنية إضافية

تم توحيد التوثيق مع التنفيذ، وأصبح الـ swagger يعكس الـ envelope الصحيح:

```json
{ "ok": true, "data": {} }
```

ولم يعد هناك mismatch قديم بين `status` في التوثيق و `ok` في التنفيذ.
