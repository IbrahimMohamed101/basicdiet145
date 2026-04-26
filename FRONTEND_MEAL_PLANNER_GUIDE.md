# دليل الفرونت إند لمخطط الوجبات (Meal Planner)

---

## 1. Overview

### المفهوم الأساسي

نظام اختيار الوجبات يعتمد على `mealSlots[]` وليس `mealIds[]`. هذا تغيير مهم يجب على الفرونت إند فهمه.

كل يوم اشتراك يحتوي على slots (مواقيت) محددة. كل slot يمثل وجبة واحدة في اليوم. عدد الـ slots يعتمد على خطة الاشتراك.

**الـ backend هو مصدر الحقيقة الوحيد.** لا تحسب أي شيء محليًا (سعر، صحة، جاهزية للتأكيد). اعتمد دائمًا على الرد من الـ API.

### لماذا mealSlots بدلاً من mealIds؟

الطريقة القديمة (mealIds) كانت محدودة ولا تدعم:
- سلطة كبيرة + بروتين (custom_premium_salad)
- سندوتش كامل كوجبة (sandwich)
- بناء السلطة يدويًا

الطريقة الجديدة (mealSlots) تدعم كل الخيارات وتدعم الدفع للوجبات المميزة.

---

## 2. Endpoints Used

هذه الـ endpoints بالترتيب الصحيح:

### 2.1 GET /api/subscriptions/meal-planner-menu

جلب الكatalog (البروتينات، الكاربوهيدرات، التصنيفات، سلطة كبيرة).

**مطلوب في:**
-首次 فتح شاشة اختيار الوجبات
- عند بدء يوم جديد

### 2.2 GET /api/subscriptions/:id/days/:date

جلب يوم معين with all slots, planner state, commercial state.

**مطلوب في:**
- عند فتح يوم معين
- بعد كل save/validate/confirm لتحديث البيانات

### 2.3 POST /api/subscriptions/:id/days/:date/selection/validate

فحص selections بدون حفظ. يرجع الأخطاء والجاهزية.

**مطلوب في:**
- بعد تغييرات مهمة (تغيير protein، إضافة سلطة)
- قبل الـ save للتأكد من صحة البيانات

### 2.4 PUT /api/subscriptions/:id/days/:date/selection

حفظ الـ selections كdraft. هذا يحفظ فقط ولا يؤكد.

**مطلوب في:**
- عند الضغط على زر "حفظ" أو "التالي"

### 2.5 POST /api/subscriptions/:id/days/:date/premium-extra/payments

إنشاء payment للوجبات المميزة (قيمة ثابتة 3000 halala).

**مطلوب في:**
- فقط لو `paymentRequirement.requiresPayment === true`
- فقط للـ custom_premium_salad (سلطة كبيرة + بروتين)

### 2.6 POST /api/subscriptions/:id/days/:date/premium-extra/payments/:paymentId/verify

التحقق من نجاح الدفع وتحديث state الوجبات.

**مطلوب في:**
- بعد نجاح الدفع من بوابة الدفع
- يجب إعادة تحميل اليوم بعده

### 2.7 POST /api/subscriptions/:id/days/:date/confirm

تأكيد اليوم نهائيًا. هذا الخطوة الأخيرة.

**مطلوب في:**
- بعد إكمال كل الـ slots
- بعد دفع كل المبلغ المطلوب
- عندما كل الشروط تتحقق

---

## 3. Correct Frontend Flow

السايكل الكامل بالترتيب:

```
1. افتح الشاشة
   ├── جلب الـ catalog (meal-planner-menu)
   └── جلب اليوم المطلوب (days/:date)

2. اعرض slots من backend
   ├── mealSlots[] contains all slots
   ├── slotIndex (1, 2, 3...)
   ├── slotKey (slot_1, slot_2...)
   └── status (empty, partial, complete)

3. المستخدم يختار الوجبة
   ├── اختار protein
   ├── اختار carb (عادي أو سلطة)
   ├── أو اختار sandwich
   ���── أو يبنى سلطة كبيرة + بروتين

4. اضغط "حفظ" أو "التالي"
   ├── أرسل mealSlots[] للـ validate
   ├── راجع slotErrors لو موجودة
   ├── راجع plannerMeta.isConfirmable
   └── راجع paymentRequirement

5. لو paymentRequirement.requiresPayment === true
   ├── أنشئ payment
   ├── افتح بوابة الدفع
   └── بعد الدفع أرسل verify

6. بعد نجاح الدفع
   ├── أعد تحميل اليوم
   └── تأكد من paymentRequirement.requiresPayment === false

7. اضغط "تأكيد"
   ├── تأكد من كل الشروط
   └── أرسل confirm
```

---

## 4. Meal Planner Catalog

### Response: GET /api/subscriptions/meal-planner-menu

الـ response يحتوي على:

```json
{
  "builderCatalog": {
    "proteins": [...],
    "carbs": [...],
    "categories": [...],
    "customPremiumSalad": {...}
  }
}
```

### 4.1 البروتينات

من `builderCatalog.proteins[]`:

- كل protein له:
  - `id`: معرف البروتين
  - `name`: الاسم
  - `selectionType`: "standard_combo" أو "sandwich"
  - `isFullMealReplacement`: true/false
  - `isPremium`: true/false
  - `extraFeeHalala`: إذا premium، السعر الإضافي

**فلتر البروتينات العادية:**
```dart
proteins.where((p) => p.selectionType == 'standard_combo').toList()
```

### 4.2 الكارب

من `builderCatalog.carbs[]`:

- كل carb له:
  - `id`: معرف الكرب
  - `name`: الاسم
  - `displayCategoryKey`: التصنيف

### 4.3 التصنيفات

من `builderCatalog.categories[]`:

- `key`: مفتاح التصنيف (beef, chicken, fish...)
- `name`: اسم التصنيف

### 4.4 السندوتشات

**السندوتشات موجودة داخل `builderCatalog.proteins[]`** مع شروط:

```dart
sandwiches = proteins.where((p) =>
  p.selectionType == 'sandwich' &&
  p.isFullMealReplacement == true
).toList();
```

### 4.5 سلطة كبيرة + بروتين

من `builderCatalog.customPremiumSalad`:

```json
{
  "enabled": true,
  "carbId": "680largeSalad222222222222",
  "selectionType": "custom_premium_salad",
  "name": {"ar": "سلطة كبيرة + بروتين"},
  "extraFeeHalala": 3000,
  "preset": {
    "key": "large_salad",
    "groups": [
      {"key": "vegetables", "minSelect": 0, "maxSelect": 99},
      {"key": "addons", "minSelect": 0, "maxSelect": 99},
      {"key": "fruits", "minSelect": 0, "maxSelect": 99},
      {"key": "nuts", "minSelect": 0, "maxSelect": 99},
      {"key": "sauce", "minSelect": 1, "maxSelect": 1}
    ]
  },
  "ingredients": [...]
}
```

---

## 5. Selection Types

ثلاثة أنواع من الاختيارات:

### 5.1 standard_combo (وجبة عادية)

- بروتين + كارب عادي
- يحتاج: `proteinId` + `carbId`
- لا يحتاج دفع إلا لو protein premium

**Request:**
```json
{
  "slotIndex": 1,
  "slotKey": "slot_1",
  "selectionType": "standard_combo",
  "proteinId": "680aaa111111111111111111",
  "carbId": "680bbb222222222222222222"
}
```

### 5.2 custom_premium_salad (سلطة كبيرة + بروتين)

- وجبة مميزة ثابتة السعر
- السعر: 3000 halala (30 SAR)
- لا تضيف فرق البروتين فوقها
- تستخدم premium credit لو موجود
- لو مفيش credit تدخل pending_payment
- تحتاج: `proteinId` + `carbId` (large salad) + `customSalad` object

**Request:**
```json
{
  "slotIndex": 2,
  "slotKey": "slot_2",
  "selectionType": "custom_premium_salad",
  "proteinId": "680premium111111111111111",
  "carbId": "680largeSalad222222222222",
  "customSalad": {
    "presetKey": "large_salad",
    "vegetables": [
      "680veg111111111111111111",
      "680veg222222222222222222",
      "680veg333333333333333333",
      "680veg444444444444444444",
      "680veg555555555555555555"
    ],
    "addons": ["680addon1111111111111111"],
    "fruits": [],
    "sauce": ["680sauce1111111111111"]
  }
}
```

### 5.3 sandwich (سندوتش كامل)

- سندوتش بدل الوجبة كامل
- يظهر في تصنيف "سندوتشات"
- يحتاج: `sandwichId` فقط
- لا يحتاج proteinId
- لا يحتاج carbId
- لا يدخل في premium
- لا يحتاج دفع
- لا يستهلك premium balance

**Request:**
```json
{
  "slotIndex": 3,
  "slotKey": "slot_3",
  "selectionType": "sandwich",
  "sandwichId": "680sandwich11111111111111"
}
```

---

## 6. UI Rules

قواعد الـ UI للفرونت إند:

### 6.1 standard_combo
- اعرض قائمة البروتينات
- بعد اختيار protein، اعرض قائمة الكاربوهيدرات
- سمح بالاختيار

### 6.2 custom_premium_salad
- افتح شاشة بناء السلطة (Salad Builder)
- اعرض المكونات من catalog
- فرض الاختيارات حسب الـ groups:
  - vegetables: اختيار حر (0 أو أكثر)
  - addons: اختيار حر (0 أو أكثر)
  - fruits: اختيار حر (0 أو أكثر)
  - nuts: اختيار حر (0 أو أكثر)
  - sauce: 1 إجبارية

### 6.3 sandwich
- اعرض تصنيف "سندوتشات"
- عند الضغط على سندوتش، أقفل الـ slot مباشرة
- لا تفتح شاشة الكرب
- لا ترسل carbId

### 6.4 قواعد مهمة

**DO:**
- اعتمد على validate response لحساب الصحة
- اعتمد على save response للـ payment
- اقرأ plannerMeta.isConfirmable قبل confirm

**DON'T:**
- لا تحسب السعر محليًا
- لا تحسب validity محليًا
- لا تفرضRules من عندك

---

## 7. Custom Premium Salad Builder

### البيانات المصدر

من `builderCatalog.customPremiumSalad`: 

### 7.1 Groups (مجموعات المكونات)

```json
{
  "groups": [
    {"key": "vegetables", "minSelect": 0, "maxSelect": 99},
    {"key": "addons", "minSelect": 0, "maxSelect": 99},
    {"key": "fruits", "minSelect": 0, "maxSelect": 99},
    {"key": "nuts", "minSelect": 0, "maxSelect": 99},
    {"key": "sauce", "minSelect": 1, "maxSelect": 1}
  ]
}
```

### 7.2 الـ UI

- اعرض كل مجموعة отдельно
- اعرض المكونات في كل مجموعة من `ingredients[]`
- فرض الـ min/max selection
- اعرض السعر: 3000 halala (30 SAR)
- **السعر للعرض فقط** - الـ backend هو مصدر الحقيقة

### 7.3 القواعد

- vegetables: اختيار حر (0 أو أكثر)
- addons: اختيار حر (0 أو أكثر)
- fruits: اختيار حر (0 أو أكثر)
- nuts: اختيار حر (0 أو المزيد)
- sauce: لازم تختار 1 بالضبط
- **البروتين** يتم اختياره من مستوى الـ slot (proteinId) وليس داخل customSalad

---

## 8. Sandwich UI

### 8.1 عرض السندوتشات

- اعرض تصنيف "سندوتشات" (من `categories`)
- السندوتشات تأتي من `builderCatalog.proteins[]` حيث:
  - `selectionType == "sandwich"`
  - `isFullMealReplacement == true`

### 8.2 اختيار سندوتش

عند الضغط على سندوتش:

```json
{
  "slotIndex": 3,
  "slotKey": "slot_3",
  "selectionType": "sandwich",
  "sandwichId": "680sandwich11111111111111"
}
```

**-important:**
- أرسل `selectionType: "sandwich"`
- أرسل `sandwichId`
- لا ترسل `proteinId`
- لا ترسل `carbId`
- لا تفتح شاشة اختيار الكرب

### 8.3 السندوتش = meal slot كامل

السندوتش يعتبر meal slot كامل (status: "complete"):
- لا يحتاج more input
- لا يحتاج payment
- لا يحتاج premium balance

---

## 9. Validate Selection

### Endpoint

**POST** `/api/subscriptions/:id/days/:date/selection/validate`

### Request

```json
{
  "mealSlots": [
    {
      "slotIndex": 1,
      "slotKey": "slot_1",
      "selectionType": "standard_combo",
      "proteinId": "680aaa111111111111111111",
      "carbId": "680bbb222222222222222222"
    },
    {
      "slotIndex": 2,
      "slotKey": "slot_2",
      "selectionType": "custom_premium_salad",
      "proteinId": "680premium111111111111111",
      "carbId": "680largeSalad222222222222",
      "customSalad": {
        "presetKey": "large_salad",
        "vegetables": [...],
        "addons": [...],
        "fruits": [],
        "sauce": [...]
      }
    }
  ]
}
```

### Response

```json
{
  "valid": true,
  "plannerRevisionHash": "abc123def456",
  "plannerMeta": {
    "requiredSlotCount": 2,
    "completeSlotCount": 2,
    "isConfirmable": false,
    ...
  },
  "premiumSummary": {...},
  "paymentRequirement": {
    "requiresPayment": true,
    "amountHalala": 3000,
    "blockingReason": "premium_pending_payment",
    ...
  }
}
```

### متى تستخدم؟

- بعد تغييرات مهمة
- قبل الـ save للتأكد من صحة البيانات
- بعد إضافة custom_premium_salad
- بعد إضافة sandwich

---

## 10. Save Selection

### Endpoint

**PUT** `/api/subscriptions/:id/days/:date/selection`

### Request

نفس structure الـ validate.

### Response

```json
{
  "status": true,
  "plannerRevisionHash": "abc123def456",
  "plannerMeta": {...},
  "paymentRequirement": {
    "requiresPayment": true,
    "amountHalala": 3000,
    "canCreatePayment": true,
    ...
  },
  "mealSlots": [...]
}
```

### ملاحظات

- هذا يحفظ **draft فقط** (ليس confirm)
- بعد الـ save، استبدل local state بالـ response
- اقرأ `paymentRequirement` من الرد
- اقرأ `commercialState` من الرد
- لو `requiresPayment === true`، أنشئ payment

---

## 11. Payment Logic

### 11.1 فحص الدفع

من response:

```dart
if (paymentRequirement.requiresPayment == true) {
  // يحتاج دفع
} else {
  // لا يحتاج دفع
}
```

### 11.2 إنشاء Payment

**POST** `/api/subscriptions/:id/days/:date/premium-extra/payments`

### Response

```json
{
  "status": true,
  "paymentId": "662f3e7c9a00000000000005",
  "payment_url": "https://pay.example.test/invoice_123",
  "providerInvoiceId": "inv_123456",
  "amountHalala": 3000,
  "plannerRevisionHash": "abc123def456",
  "commercialState": "payment_required"
}
```

### 11.3 التحقق من الدفع

**POST** `/api/subscriptions/:id/days/:date/premium-extra/payments/:paymentId/verify`

### Response

```json
{
  "status": true,
  "plannerRevisionHash": "xyz789abc123",
  "premiumExtraPayment": {
    "status": "paid",
    "paidAt": "2026-04-20T10:30:00.000Z"
  },
  "paymentRequirement": {
    "requiresPayment": false
  },
  "commercialState": "ready_to_confirm"
}
```

### 11.4 بعد الـ verify

- أعد تحميل اليوم (GET days/:date)
- تأكد من `requiresPayment == false`
- الآن ممكن تعمل confirm

### 11.5 ملاحظات مهمة

- هذا خاص بـ **custom_premium_salad** فقط
- سلطة كبيرة + بروتين تدخل هنا لو no premium credit
- sandwich لا يحتاج دفع
- standard_combo لا يحتاج دفع إلا لو premium protein

---

## 12. Confirm Logic

### Endpoint

**POST** `/api/subscriptions/:id/days/:date/confirm`

### شروط التأكيد

**لا تسمح بزر confirm إلا إذا:**

```dart
final canConfirm = 
  paymentRequirement.requiresPayment == false &&
  commercialState == "ready_to_confirm" &&
  plannerMeta.isConfirmable == true &&
  plannerState == "draft" &&
  status == "open";
```

### Response

```json
{
  "success": true,
  "plannerState": "confirmed",
  "commercialState": "confirmed",
  "plannerRevisionHash": "abc123def456"
}
```

### أخطاء محتملة

- `PREMIUM_PAYMENT_REQUIRED`: لم يتم الدفع
- `PLANNING_INCOMPLETE`:Selectionات ناقصة
- `LOCKED`: اليوم مقفل

---

## 13. Important Response Fields

### 13.1 mealSlots[]

```json
"mealSlots": [
  {
    "slotIndex": 1,
    "slotKey": "slot_1",
    "status": "complete", // empty, partial, complete
    "selectionType": "standard_combo",
    "proteinId": "680aaa111111111111111111",
    "carbId": "680bbb222222222222222222",
    "sandwichId": null,
    "customSalad": null,
    "displayName": {"ar": "دجاج مشوي + أرز أبيض"},
    "isPremium": false,
    "premiumSource": "none",
    "premiumExtraFeeHalala": 0
  }
]
```

### 13.2 plannerMeta

```json
"plannerMeta": {
  "requiredSlotCount": 2,
  "emptySlotCount": 0,
  "partialSlotCount": 0,
  "completeSlotCount": 2,
  "beefSlotCount": 0,
  "premiumSlotCount": 1,
  "premiumCoveredByBalanceCount": 0,
  "premiumPendingPaymentCount": 1,
  "premiumTotalHalala": 3000,
  "isDraftValid": true,
  "isConfirmable": false
}
```

### 13.3 paymentRequirement

```json
"paymentRequirement": {
  "status": "priced",
  "requiresPayment": true,
  "pricingStatus": "priced",
  "blockingReason": "premium_pending_payment",
  "canCreatePayment": true,
  "premiumSelectedCount": 1,
  "premiumPendingPaymentCount": 1,
  "pendingAmountHalala": 3000,
  "amountHalala": 3000,
  "currency": "SAR"
}
```

### 13.4 commercialState

```json
"commercialState": "payment_required"
```

### 13.5 premiumSummary

```json
"premiumSummary": {
  "selectedCount": 1,
  "coveredByBalanceCount": 0,
  "pendingPaymentCount": 1,
  "paidExtraCount": 0,
  "totalExtraHalala": 3000,
  "currency": "SAR"
}
```

---

## 14. premiumSource Values

مصدر الـ premium:

| القيمة | المعنى |
|--------|--------|
| none | غير premium |
| balance | تم الدفع من الرصيد |
| pending_payment | يحتاج دفع |
| paid_extra | تم الدفع كإضافة |

---

## 15. commercialState Values

الحالة التجارية:

| القيمة | المعنى |
|--------|--------|
| draft | تم الحفظ كمسودة |
| payment_requiresPayment يتطلب دفع |
| ready_to_confirm | جاهز للتأكيد |
| confirmed | تم التأكيد |

---

## 16. Full Example Flow

### يوم فيه 3 slots:

- slot 1: standard_combo (دجاج مشوي + أرز)
- slot 2: custom_premium_salad (سلطة كبيرة + ستيك بقري)
- slot 3: sandwich (تركي)

### 1. Validate Request

```json
{
  "mealSlots": [
    {
      "slotIndex": 1,
      "slotKey": "slot_1",
      "selectionType": "standard_combo",
      "proteinId": "680chicken11111111111111",
      "carbId": "680rice2222222222222222"
    },
    {
      "slotIndex": 2,
      "slotKey": "slot_2",
      "selectionType": "custom_premium_salad",
      "proteinId": "680beef11111111111111",
      "carbId": "680largeSalad222222222222",
      "customSalad": {
        "presetKey": "large_salad",
        "vegetables": [],
        "addons": [],
        "fruits": [],
        "nuts": [],
        "sauce": ["s1"]
      }
    },
    {
      "slotIndex": 3,
      "slotKey": "slot_3",
      "selectionType": "sandwich",
      "sandwichId": "680turkey1111111111111"
    }
  ]
}
```

### 2. Validate Response

```json
{
  "valid": true,
  "plannerMeta": {
    "requiredSlotCount": 3,
    "completeSlotCount": 3,
    "isConfirmable": false
  },
  "paymentRequirement": {
    "requiresPayment": true,
    "amountHalala": 3000,
    "blockingReason": "premium_pending_payment"
  }
}
```

### 3. Save Request

نفس الـ validate request.

### 4. Save Response

```json
{
  "status": true,
  "plannerRevisionHash": "abc123",
  "paymentRequirement": {
    "requiresPayment": true,
    "amountHalala": 3000,
    "canCreatePayment": true
  },
  "commercialState": "payment_required"
}
```

### 5. Create Payment

**POST** `/api/subscriptions/:id/days/:date/premium-extra/payments`

### Payment Response

```json
{
  "status": true,
  "paymentId": "pay_123",
  "payment_url": "https://...",
  "amountHalala": 3000,
  "commercialState": "payment_required"
}
```

### 6. After Payment

- افتح.payment_url في متصفح
- المستخدم يدفع
- بعد نجاح، اقرا result

### 7. Verify Payment

**POST** `/api/subscriptions/:id/days/:date/premium-extra/payments/pay_123/verify`

### Verify Response

```json
{
  "status": true,
  "plannerRevisionHash": "xyz789",
  "premiumExtraPayment": {
    "status": "paid",
    "paidAt": "2026-04-20T10:30:00Z"
  },
  "paymentRequirement": {
    "requiresPayment": false
  },
  "commercialState": "ready_to_confirm"
}
```

### 8. Reload Day

GET `/api/subscriptions/:id/days/:date`

يرجع:
- `paymentRequirement.requiresPayment === false`
- `commercialState === "ready_to_confirm"`
- `plannerMeta.isConfirmable === true`

### 9. Confirm

**POST** `/api/subscriptions/:id/days/:date/confirm`

### Confirm Response

```json
{
  "success": true,
  "plannerState": "confirmed",
  "commercialState": "confirmed"
}
```

---

## 17. Error Handling

### 17.1 أخطاء الـ Validation

| Code | المعنى |
|------|--------|
| INVALID_SLOT_INDEX | slotIndex غير صحيح |
| DUPLICATE_SLOT_INDEX | تكرار slotIndex |
| DUPLICATE_SLOT_KEY | تكرار slotKey |
| BEEF_LIMIT_EXCEEDED | أكثر من وجبة بقري في اليوم |
| INVALID_SANDWICH | سندوتش غير صالح |
| INVALID_PROTEIN | بروتين غير صالح |
| INVALID_CARB | كارب غير صالح |

### 17.2 أخطاء الـ Save/Confirm

| Code | المعنى |
|------|--------|
| PLANNING_INCOMPLETE | Selectionات ناقصة |
| PREMIUM_PAYMENT_REQUIRED | مطلوب دفع قبل confirm |
| PREMIUM_EXTRA_PAYMENT_NOT_REQUIRED | لا يحتاج دفع |
| PREMIUM_EXTRA_ALREADY_PAID | الدفع تم مسبقًا |
| PREMIUM_EXTRA_REVISION_MISMATCH | تغير الـ revision أثناء الدفع |
| LOCKED | اليوم مقفل |
| SUB_INACTIVE | الاشتراك غير نشط |
| SUB_EXPIRED | الاشتراك منتهي |
| NOT_FOUND | اليوم غير موجود |
| FORBIDDEN | لا يوجد صلاحية |

### 17.3 معالجة الأخطاء

```dart
void handleError(dynamic error) {
  switch (error.code) {
    case 'BEEF_LIMIT_EXCEEDED':
      // اعرض رسالة: وجبة بقري واحدة فقط في اليوم
      break;
    case 'PREMIUM_PAYMENT_REQUIRED':
      // اعرض زر للدفع
      break;
    case 'LOCKED':
      // اعرض رسالة: اليوم مقفل
      break;
    default:
      // اعرض رسالة عامة
  }
}
```

---

## 18. Do / Don't

### DO

✅ استخدم `mealSlots[]` من response
✅ استخدم الـ validate قبل الـ save
✅ اقرا كل الـ response من backend
✅ استخدم `paymentRequirement`
✅ استخدم `commercialState`
✅ أعد تحميل اليوم بعد verify
✅ افهم selectionType قبل البناء

### DON'T

❌ لا تستخدم `mealIds[]` (القديم)
❌ لا تستخدم `selections[]` (القديم)
❌ لا تحسب السعر محليًا
❌ لا تعمل confirm قبل دفع premium
❌ لا ترسل sandwich كـ proteinId فقط
❌ لا ترسل custom_premium_salad إلى endpoint تاني
❌ لا تتIgnore الأخطاء من validate

---

## 19. Flutter Notes

### 19.1 تحويل إلى JSON

لازم تحول request models إلى JSON قبل الإرسال:

```dart
final body = {
  'mealSlots': mealSlots.map((e) => e.toJson()).toList(),
};
```

### 19.2 مثال على Request Model

```dart
class MealSlotRequest {
  final int slotIndex;
  final String slotKey;
  final String selectionType;
  final String? proteinId;
  final String? carbId;
  final String? sandwichId;
  final CustomSaladRequest? customSalad;

  Map<String, dynamic> toJson() => {
    'slotIndex': slotIndex,
    'slotKey': slotKey,
    'selectionType': selectionType,
    if (proteinId != null) 'proteinId': proteinId,
    if (carbId != null) 'carbId': carbId,
    if (sandwichId != null) 'sandwichId': sandwichId,
    if (customSalad != null) 'customSalad': customSalad!.toJson(),
  };
}
```

### 19.3 Dio Request

```dart
final response = await dio.put(
  '/api/subscriptions/$id/days/$date/selection',
  data: body,
);
```

### 19.4 معالجة Response

```dart
final data = response.data['data'];
final paymentRequired = data['paymentRequirement']['requiresPayment'] as bool;
final commercialState = data['commercialState'] as String;
```

---

## 20. Final Checklist For Frontend

قبل ما تطلق الـ meal planner:

- [ ] هل حمّلت catalog؟
- [ ] هل حمّلت day؟
- [ ] هل بنيت slots من `mealSlots[]`؟
- [ ] هل تدعم selectionType الثلاثة (standard_combo, custom_premium_salad, sandwich)؟
- [ ] هل تدعم salad builder؟
- [ ] هل تدعم sandwich؟ (تختار sandwichId فقط)
- [ ] هل تستخدم validate قبل save؟
- [ ] هل تحفظ selection؟
- [ ] هل تتعامل مع payment؟
- [ ] هل تعمل verify بعد الدفع؟
- [ ] هل تمنع confirm قبل الجاهزية؟
- [ ] هل تعالج الأخطاء؟

---

## Last updated

**Last updated:** 2026-04-26

**Source of truth:** swagger.yaml + current backend code

---

## ملاحظة: Custom Premium Salad Rules (محدث)

الـ backend يدعم قواعد مرنة للسلطة:

- **protein**: 1 فقط (من slot)
- **sauce**: 1 فقط (إجباري)
- **vegetables**: اختيار حر (0 أو أكثر)
- **addons**: اختيار حر (0 أو المزيد)
- **fruits**: اختيار حر (0 أو الأكثر)
- **nuts**: اختيار حر (0 أو المزيد)
- **السعر**: ثابت 3000 halala

**ملاحظات مهمة:**
- البروتين يتم اختياره من مستوى الـ slot (proteinId) وليس داخل customSalad
- لا يمكن اختيار أكثر من بروتين واحد
- لا يمكن اختيار أكثر من صوص واحد

أي اختلاف بين هذا الملف والـ API الحقيقي، الرجوع فيه إلى:
1. swagger.yaml
2. الردود الفعلية من backend

هذا الملف للتوثيق فقط، ولا يعدل أي business logic.