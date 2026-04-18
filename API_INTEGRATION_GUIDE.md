# دليل تكامل Meal Planner API

> مرجع تنفيذي لمطور التطبيق (Frontend / Mobile)
> مبني على الكود الفعلي — لا افتراضات قديمة

---

## المحتويات

1. [الـ Data Model الأساسي](#1-الـ-data-model-الأساسي)
2. [قاموس الـ Status والـ Enums](#2-قاموس-الـ-status-والـ-enums)
3. [الـ Endpoints](#3-الـ-endpoints)
4. [الـ Flow الكامل خطوة بخطوة](#4-الـ-flow-الكامل-خطوة-بخطوة)
5. [Business Rules المستخرجة من الكود](#5-business-rules-المستخرجة-من-الكود)
6. [الـ Validation Rules](#6-الـ-validation-rules)
7. [قواعد التحكم في الـ UI](#7-قواعد-التحكم-في-الـ-ui)
8. [أخطاء يجب التعامل معها](#8-أخطاء-يجب-التعامل-معها)
9. [الميزات المتاحة حالياً](#9-الميزات-المتاحة-حالياً)
10. [تحذيرات حرجة للمطور]( #10-تحذيرات-حرجة-للمطور)

---

## 1. الـ Data Model الأساسي

### 1.1 `Subscription`

| الحقل | النوع | القيم المحتملة | المعنى | ملاحظات |
|-------|-------|----------------|--------|---------|
| `_id` | String | — | المعرف الفريد للاشتراك | **مصدر الحقيقة** للمعرفات |
| `status` | String | `pending_payment` `active` `expired` `canceled` | حالة الاشتراك | يحدد إمكانية التعديل |
| `remainingMeals` | Number | `>= 0` | عدد الوجبات المتبقية | |
| `premiumBalance` | Array | `[{ proteinId, remainingQty }]` | رصيد الوجبات المميزة المشتراة مسبقاً | |

> **حقول يجب تجاهلها (Legacy):**
> `premiumSelections`, `addonSelections` — النظام يعتمد على `premiumBalance` ومحرك `mealSlots` الداخلي فقط.

---

### 1.2 `SubscriptionDay`

هذا هو الـ Model الأهم بالنسبة للتطبيق.

| الحقل | النوع | المعنى | ملاحظات |
|-------|-------|--------|---------|
| `date` | `String (YYYY-MM-DD)` | تاريخ اليوم | |
| `status` | String | حالة اليوم التشغيلية | يحدد هل اليوم قابل للتعديل |
| `mealSlots` | `Array<MealSlot>` | الوجبات المكونة لهذا اليوم | ✅ **مصدر الحقيقة** للاختيارات |
| `plannerMeta` | Object | بيانات مساعدة لحالة الـ confirm | ✅ **مصدر الحقيقة** للـ UI |
| `paymentRequirement` | Object | متطلبات الدفع لهذا اليوم | يمنع الـ confirm إن كان `requiresPayment: true` |
| `plannerState` | String | `draft` / `confirmed` | حالة الـ planner للتحكم في التعديل |

> **حقول يجب تجاهلها (Legacy):**
> `selections`, `premiumUpgradeSelections`, `planningVersion`, `baseMealSlots` — لا تبن أي logic عليها.

---

### 1.3 `MealSlot`

| الحقل | النوع | المعنى |
|-------|-------|--------|
| `slotIndex` | Number | تتابع الوجبة داخل اليوم `(1, 2, 3...)` |
| `slotKey` | String | معرف نصي فريد للـ slot |
| `status` | String | `empty` / `partial` / `complete` |
| `proteinId` | String | معرف البروتين المختار |
| `carbId` | String | معرف الكارب المختار |
| `isPremium` | Boolean | هل البروتين مميز |
| `premiumSource` | String | مصدر تغطية الـ premium — انظر القاموس |
| `proteinFamilyKey` | String | تصنيف عائلة البروتين (مثل `beef`) |

---

### 1.4 `plannerMeta`

| الحقل | النوع | المعنى |
|-------|-------|--------|
| `requiredSlotCount` | Number | عدد الـ slots المطلوبة |
| `emptySlotCount` | Number | عدد الـ slots الفارغة |
| `partialSlotCount` | Number | عدد الـ slots الناقصة |
| `completeSlotCount` | Number | عدد الـ slots المكتملة |
| `premiumSlotCount` | Number | عدد الـ slots الـ premium |
| `premiumPendingPaymentCount` | Number | عدد الـ slots التي تحتاج دفع |
| `premiumTotalHalala` | Number | المبلغ الإجمالي للـ premium بالهللة |
| `isDraftValid` | Boolean | هل المسودة صالحة |
| `isConfirmable` | Boolean | ✅ **الشرط الرئيسي** لتفعيل زر Confirm |

---

### 1.5 `paymentRequirement`

| الحقل | النوع | المعنى |
|-------|-------|--------|
| `requiresPayment` | Boolean | ✅ **إذا كان `true` يمنع الـ confirm تماماً** |
| `premiumSelectedCount` | Number | عدد الـ premium slots المختارة |
| `premiumPendingPaymentCount` | Number | عدد الـ slots التي لم تُسدَّد |
| `amountHalala` | Number | المبلغ المطلوب بالهللة |
| `currency` | String | العملة |

---

## 2. قاموس الـ Status والـ Enums

### 2.1 `SubscriptionDay.status`

| القيمة | المعنى | متى تحدث | ماذا يفعل التطبيق |
|--------|--------|----------|-------------------|
| `open` | مفتوح للتعديل | الوضع الافتراضي للأيام غير المغلقة | السماح بالتعديل الكامل |
| `frozen` | مجمد | طلب المستخدم أو الإدارة | Read-only — يعرض اليوم كمجمد |
| `locked` | مقفل | مرور الـ cutoff time | Read-only — منع التعديل نهائياً |
| `in_preparation` | قيد التجهيز | المطبخ بدأ التحضير | منع التعديل — إظهار حالة الوجبة |
| `out_for_delivery` | خرج للتوصيل | تم تسليمه للمندوب | منع التعديل — تتبع التوصيل |
| `fulfilled` | مكتمل | تم التوصيل أو الاستلام | إنهاء دورة اليوم في الـ UI |

---

### 2.2 `MealSlot.status`

| القيمة | المعنى | ماذا يفعل التطبيق |
|--------|--------|-------------------|
| `empty` | لا يوجد بروتين ولا كارب | عرض placeholder لاختيار الوجبة |
| `partial` | بروتين فقط أو كارب فقط | تنبيه بأن الوجبة غير مكتملة |
| `complete` | بروتين وكارب مختاران | إظهار الوجبة كجاهزة |

---

### 2.3 `MealSlot.premiumSource`

| القيمة | المعنى |
|--------|--------|
| `none` | وجبة عادية — لا premium |
| `balance` | premium مغطى من رصيد مسبق |
| `pending_payment` | premium غير مسدد — **يمنع الـ confirm** |
| `paid_extra` | premium تم سداد زيادته بنجاح |
| `paid` | premium في حالة مسددة ومعاملة كمدفوعة |

---

## 3. الـ Endpoints

### `GET /subscriptions/current/overview`

**الغرض:** جلب الاشتراك الحالي والفعال للمستخدم.

**متى يُستدعى:** عند فتح التطبيق لمعرفة حالة الاشتراك (Active / Pending).

**Response — نجاح:**
```json
{
  "ok": true,
  "data": {
    "_id": "sub_id",
    "status": "active"
  }
}
```

---

### `GET /subscriptions/:id/days/:date`

**الغرض:** جلب حالة اليوم الحالي وتفاصيل بناء الوجبات.

**متى يُستدعى:**
- عند فتح شاشة التخطيط ليوم معين
- بعد `PUT /selection`
- بعد نجاح `verify` للـ premium payment
- بعد أي عملية backend تغيّر حالة اليوم

**Path params:** `id` (Subscription ID), `date` (YYYY-MM-DD)

**Response — نجاح:**
```json
{
  "data": {
    "date": "2026-04-10",
    "status": "open",
    "plannerState": "draft",
    "mealSlots": [
      {
        "slotIndex": 1,
        "slotKey": "slot_1",
        "status": "complete",
        "proteinId": "PROTEIN_ID",
        "carbId": "CARB_ID",
        "isPremium": false,
        "premiumSource": "none"
      }
    ],
    "plannerMeta": {
      "isConfirmable": false,
      "isDraftValid": true,
      "premiumPendingPaymentCount": 0
    },
    "paymentRequirement": {
      "requiresPayment": false,
      "amountHalala": 0
    }
  }
}
```

**Response — إذا رجع 404:**
اليوم غير موجود في قاعدة البيانات — لا تفترض يوماً جاهزاً.

---

### `GET /subscriptions/meal-planner-menu`

**الغرض:** جلب كتالوج البروتين والكارب لربط IDs في `mealSlots` بالبيانات المرئية (أسماء، صور، تصنيفات).

**متى يُستدعى:** بالتوازي مع `/days/:date` عند فتح شاشة التخطيط.

> بدون هذا الـ endpoint التطبيق يرى IDs فقط بدون أسماء أو صور.

---

### `POST /subscriptions/:id/days/:date/selection/validate`

**الغرض:** التحقق من صلاحية المسودة في الـ Backend دون حفظ فعلي.

**متى يُستدعى:** فور اختيار المستخدم بروتين أو كارب جديد، وقبل الحفظ.

**Request Body:**
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

**Response — نجاح:**
```json
{
  "valid": true,
  "mealSlots": [...],
  "plannerMeta": { "isConfirmable": false },
  "paymentRequirement": { "requiresPayment": false }
}
```

**Response — فشل:**
```json
{
  "valid": false,
  "slotErrors": [
    {
      "slotIndex": 1,
      "field": "proteinId",
      "code": "BEEF_LIMIT_EXCEEDED",
      "message": "..."
    }
  ]
}
```

**أخطاء شائعة:**

| HTTP | Error Code | السبب | ماذا يفعل التطبيق |
|------|------------|-------|-------------------|
| 422 | `BEEF_LIMIT_EXCEEDED` | وجبتين Regular Beef في نفس اليوم | عرض خطأ للمستخدم لتغيير اللحم |
| 422 | `VALIDATION_FAILED` | بيانات ناقصة في الـ payload | عرض `slotErrors[]` أسفل كل slot معني |

---

### `PUT /subscriptions/:id/days/:date/selection`

**الغرض:** حفظ المسودة الفعلية المكونة للوجبات.

**متى يُستدعى:** عند ضغط "حفظ" أو الانتقال لمرحلة التأكيد.

**Request Body:**
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

**Response — ما يجب قراءته بعد الحفظ:**
- `data.mealSlots`
- `data.plannerMeta`
- `data.paymentRequirement`
- `data.plannerState`
- `data.status`

> ⚠️ **مهم:** استبدل الـ local state بما عاد من backend تماماً — لا تحتفظ بمسودة قديمة بعد الحفظ.

---

### `POST /subscriptions/:id/days/:date/premium-extra/payments`

**الغرض:** بدء تسوية المبالغ الزائدة للوجبات الـ premium.

**متى يُستدعى:** بعد `PUT /selection` إذا كان `paymentRequirement.requiresPayment === true`.

**Response — نجاح:**
```json
{
  "paymentId": "pay_123",
  "paymentUrl": "https://payment-gateway.com/...",
  "amountHalala": 5000,
  "currency": "SAR",
  "reused": false
}
```

**بعد الرد:**
- افتح `paymentUrl` (WebView أو Browser)
- احتفظ بـ `paymentId`
- لا تستدعي `confirm` قبل خطوة `verify`

---

### `POST /subscriptions/:id/days/:date/premium-extra/payments/:paymentId/verify`

**الغرض:** التحقق من نجاح عملية الدفع المعلقة.

**متى يُستدعى:** بعد عودة المستخدم من شاشة الدفع الخارجية.

**بعد الرد:**
- إذا `paymentStatus === "paid"`: أعد جلب اليوم عبر `GET /days/:date`
- تأكد أن `paymentRequirement.requiresPayment === false`
- بعدها فقط فعّل زر Confirm

---

### `POST /subscriptions/:id/days/:date/confirm`

**الغرض:** تأكيد خطة اليوم وإقفال التعديل نهائياً.

**متى يُستدعى — الشروط الأربعة يجب أن تتحقق كلها:**
- `plannerMeta.isConfirmable === true`
- `paymentRequirement.requiresPayment === false`
- `status === "open"`
- `plannerState !== "confirmed"`

**Response — نجاح:**
```json
{
  "ok": true,
  "success": true,
  "plannerState": "confirmed"
}
```

**بعد الرد:** اقفل التفاعل وأظهر confirmed state — منع أي تعديل.

---

## 4. الـ Flow الكامل خطوة بخطوة

```
فتح الشاشة
    │
    ├──► GET /days/:date
    └──► GET /meal-planner-menu
              │
              ▼
        بناء الـ UI من mealSlots
              │
              ▼
        المستخدم يختار وجبة
              │
              ▼
        POST /selection/validate
              │
         ┌────┴────┐
       خطأ      صحيح
         │          │
    عرض slotErrors  │
                    ▼
            المستخدم يحفظ
                    │
                    ▼
            PUT /selection
                    │
         ┌──────────┴──────────┐
requiresPayment=false    requiresPayment=true
         │                      │
         │              POST /premium-extra/payments
         │                      │
         │                 فتح paymentUrl
         │                      │
         │              POST /verify
         │                      │
         │               GET /days/:date
         │                      │
         └──────────┬───────────┘
                    │
            isConfirmable=true ؟
                    │
                    ▼
            POST /confirm
                    │
                    ▼
              ✅ confirmed
```

### تفصيل الخطوات

1. **فتح الشاشة** → استدعاء `GET /days/:date` و `GET /meal-planner-menu` بالتوازي
2. **بناء الـ UI** → من `mealSlots` و `plannerMeta` و `paymentRequirement`
3. **المستخدم يغير وجبة** → تحديث local draft ثم `POST /selection/validate`
4. **عرض نتيجة validate** → إظهار `slotErrors` أسفل كل slot معني + تعطيل Save إن كان في أخطاء
5. **المستخدم ينتهي ويحفظ** → `PUT /selection`
6. **قراءة الرد:**
   - إذا `requiresPayment === false` → انتقل لـ confirm مباشرة
   - إذا `requiresPayment === true` → انتقل للخطوة 7
7. **إنشاء payment** → `POST /premium-extra/payments` ثم افتح `paymentUrl`
8. **بعد الدفع** → `POST /verify` ثم `GET /days/:date` للتأكد
9. **confirm** → `POST /confirm` ثم أقفل الشاشة وأظهر حالة confirmed

---

## 5. Business Rules المستخرجة من الكود

### Beef Rule — الحد الأقصى للحم البقري

| البند | التفاصيل |
|-------|----------|
| **الشرط** | أكثر من Regular Beef واحد (`proteinFamilyKey === "beef"` و `isPremium !== true`) |
| **النتيجة** | رفض الـ Draft |
| **كود الخطأ** | `BEEF_LIMIT_EXCEEDED` |
| **استثناء مهم** | يُسمح بجمع Regular Beef مع Premium Beef في نفس اليوم |
| **مثال صحيح** | Regular Beef + Premium Beef ✅ |
| **مثال مرفوض** | Regular Beef + Regular Beef ❌ |

---

### Confirm Rule — منع التأكيد مع مسودة ناقصة

| البند | التفاصيل |
|-------|----------|
| **الشرط** | التأكيد مسموح فقط إذا `isConfirmable === true` |
| **النتيجة** | يُمنع زر Confirm إذا كانت وجبات `partial` أو `empty` |
| **كود الخطأ** | `PLANNING_INCOMPLETE` |

---

### Premium Balance Rule

| البند | التفاصيل |
|-------|----------|
| **الشرط** | عند اختيار Premium Protein |
| **إذا وُجد رصيد** | `premiumSource = "balance"` — لا حاجة لدفع إضافي |
| **إذا لم يوجد رصيد** | `premiumSource = "pending_payment"` — يجب الدفع قبل confirm |

---

## 6. الـ Validation Rules

| الحقل / النطاق | الشرط | كود الخطأ |
|----------------|-------|-----------|
| `mealSlots` | لا يتجاوز العدد المسموح للاشتراك | `MEAL_SLOT_COUNT_EXCEEDED` |
| `mealSlots` | عدد الـ complete slots لا يتجاوز الحد | `COMPLETE_SLOT_COUNT_EXCEEDED` |
| `proteinFamilyKey` | ممنوع خيارين Regular Beef | `BEEF_LIMIT_EXCEEDED` |
| `slotIndex` | يجب أن يكون فريداً لكل slot | `DUPLICATE_SLOT_INDEX` |
| `slotKey` | يجب أن يكون فريداً لكل slot | `DUPLICATE_SLOT_KEY` |
| `slotIndex` | يجب أن يكون رقماً صحيحاً صالحاً | `INVALID_SLOT_INDEX` |
| `status` (لليوم) | يجب ألا يكون `locked` أو `frozen` للتعديل | `LOCKED` |
| `paymentRequirement` | `requiresPayment === false` شرط للـ confirm | — |
| التاريخ | لا يقبل أيام الماضي لـ save/validate | — |
| التاريخ | لا يقبل غداً إذا انتهى cutoff | — |

---

## 7. قواعد التحكم في الـ UI

```
IF status === "locked" OR status === "frozen"
   THEN تحويل الشاشة بالكامل لـ Read-only

IF paymentRequirement.requiresPayment === true
   THEN تعطيل زر Confirm + إظهار زر "شراء وإكمال 💳"

IF slotErrors[] في رد validate غير فارغة
   THEN إظهار أخطاء حمراء أسفل كل slot معني + تعطيل Save

IF plannerMeta.isConfirmable === false
   THEN زر Confirm يكون Disabled

IF plannerState === "confirmed"
   THEN منع أي تعديل — عرض حالة مقفولة

IF status !== "open"
   THEN منع Save و Confirm
```

### شروط تعطيل زر Confirm (أي شرط يكفي):

- `plannerMeta.isConfirmable === false`
- `paymentRequirement.requiresPayment === true`
- `plannerState === "confirmed"`
- `status !== "open"`

---

## 8. أخطاء يجب التعامل معها

| كود الخطأ | HTTP | السبب | المستوى | ماذا يفعل التطبيق |
|-----------|------|-------|---------|-------------------|
| `BEEF_LIMIT_EXCEEDED` | 422 | وجبتين Regular Beef | Slot | إبراز رسالة لتغيير اختيار اللحم |
| `PLANNING_INCOMPLETE` | 422 | وجبة empty أو partial عند confirm | Day | إرجاع المستخدم للتصحيح |
| `MEAL_SLOT_COUNT_EXCEEDED` | 422 | تجاوز عدد الـ slots المسموح | Day | منع الإضافة + رسالة خطأ |
| `COMPLETE_SLOT_COUNT_EXCEEDED` | 422 | تجاوز عدد الـ complete slots | Day | منع الإضافة |
| `INVALID_SLOT_INDEX` | 422 | slotIndex غير صالح | Slot | مراجعة الـ payload |
| `DUPLICATE_SLOT_INDEX` | 422 | نفس slotIndex مرتين | Day | مراجعة الـ payload قبل الإرسال |
| `DUPLICATE_SLOT_KEY` | 422 | نفس slotKey مرتين | Day | مراجعة الـ payload قبل الإرسال |
| `LOCKED` | 422 | التعديل بعد انتهاء Cutoff | Day | عرض "انتهى وقت التعديل المسموح به" |
| `PREMIUM_EXTRA_PAYMENT_NOT_REQUIRED` | 422 | طلب دفع ولا يوجد عجز | Day | إغلاق تدفق الدفع مباشرة |
| `PREMIUM_EXTRA_ALREADY_PAID` | 422 | الـ premium مدفوع مسبقاً | Day | تخطي الدفع وإعادة المزامنة |
| `PREMIUM_EXTRA_REVISION_MISMATCH` | 422 | تغيير الـ planner بعد إنشاء payment | Day | إعادة Save ثم إنشاء payment جديد |
| `NO_PENDING_PREMIUM_EXTRA` | 422 | لا يوجد premium pending | Day | تخطي الدفع وإعادة المزامنة |
| `CHECKOUT_IN_PROGRESS` | 422 | يوجد checkout نشط بالفعل | Day | انتظار أو إلغاء الـ checkout القديم |
| `SUB_INACTIVE` | 403 | الاشتراك غير نشط | Global | إعادة التوجيه لصفحة الاشتراك |
| `SUB_EXPIRED` | 403 | الاشتراك منتهٍ | Global | إعادة التوجيه لصفحة الاشتراك |
| `NOT_FOUND` | 404 | اليوم أو الاشتراك غير موجود | Global | عرض رسالة مناسبة |
| `FORBIDDEN` | 403 | المستخدم لا يملك صلاحية | Global | إعادة التوجيه |

---

## 9. الميزات المتاحة حالياً

| الميزة | الحالة | ملاحظة |
|--------|--------|--------|
| شراء Premium Meals داخل الـ Meal Planner | ✅ متاح | دعم تدفق الدفع المستقل على مستوى اليوم |
| إضافات لمرة واحدة (One-time Addons) | ✅ متاح | `one-time-addons/payments` و `verify` |
| Bulk Save لأيام متعددة | ✅ متاح | `PUT /subscriptions/:id/days/selections/bulk` |
| تجاوز الحد الأقصى للـ slots اليومية | ❌ غير متاح | مقيد بـ `MEAL_SLOT_COUNT_EXCEEDED` |

---

## 10. تحذيرات حرجة للمطور

### ❌ لا تفترض — ✅ الصح

---

❌ **لا تفترض:** أن كل بروتين Beef يُحتسب ضمن الـ Beef Limit.

✅ **الصح:** العداد يحسب فقط Regular Beef (`isPremium === false`). الـ Premium Beef لا يدخل في الحساب ولا يُمنع مع Regular Beef.

---

❌ **لا تفترض:** أن التطبيق يحسب حالة الـ confirmability ومتطلبات الدفع محلياً.

✅ **الصح:** اعتمد 100% على `paymentRequirement` و `plannerMeta` العائدين من الـ backend — لا تحسب validity محلياً.

---

❌ **لا تفترض:** أن أي يوم في المستقبل هو تلقائياً مقفل (Locked).

✅ **الصح:** اليوم المستقبلي يمكن أن يكون `open` وقابلاً للتعديل طالما لم يأتِ cutoff أو يؤكده المستخدم. راجع `status` و `plannerState` دائماً.

---

❌ **لا تفترض:** الاحتفاظ بمسودة محلية قديمة بعد استقبال رد `200` من `PUT /selection`.

✅ **الصح:** فرّغ الذاكرة المحلية واستبدل بمحتوى `data` العائد من الـ backend مباشرة — هو مصدر الحقيقة الوحيد.

---

❌ **لا تفترض:** إمكانية استدعاء `confirm` مباشرة بعد الحفظ دون التحقق من الدفع.

✅ **الصح:** `confirm` لا يُستدعى إلا بعد نجاح `verify` وأن `paymentRequirement.requiresPayment === false`.

---

❌ **لا تفترض:** أن `selections[]` أو `premiumUpgradeSelections[]` هي مصدر الحقيقة للاختيارات.

✅ **الصح:** المصدر الوحيد هو `mealSlots[]` العائد من الـ backend — الحقول الأخرى legacy فقط.

---

❌ **لا تبنِ** أي business rule من عندك (validation، beef limit، premium logic).

✅ **الصح:** كل هذه القواعد تعيشها في الـ backend — اعتمد على ردوده فقط.