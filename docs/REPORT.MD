# Gap Analysis — Flutter ↔ Backend Contract

> تقرير الفجوات بين Flutter والـ Backend، مرتّب حسب الأولوية والتأثير

---

## فهرس المحتويات

1. [الفجوات الحرجة (Critical)](#الفجوات-الحرجة)
2. [الفجوات العالية الأولوية (High)](#الفجوات-العالية-الأولوية)
3. [الفجوات المتوسطة (Medium)](#الفجوات-المتوسطة)
4. [خطة الإصلاح المقترحة](#خطة-الإصلاح-المقترحة)

---

## الفجوات الحرجة

### 🔴 C-1 — mealSlots: عدم توافق الـ Parsing بين الطرفين
**النطاق:** Cross-stack (Backend + Flutter)

**المشكلة:**
التطبيق لا يقرأ شكل `mealSlots` الحالي بشكل صحيح.

| الطرف | الشكل المُرسَل / المتوقّع |
|-------|--------------------------|
| Backend | `carbs[]` + `salad` (الشكل Canonical) |
| Flutter | يتوقع `carbId` + `customSalad` فقط |

**الملفات المتأثرة:**
- Backend: `normalizeCanonicalMealSlots`
- Flutter: `subscription_day_response.dart`, `timeline_response.dart`

**النتيجة:**
اليوم المحفوظ يُرجَع من الـ API لكن التطبيق لن يُعيد بناء الـ Carb أو السلطة بشكل صحيح، خصوصًا في حالة **split carbs** و **custom salad**.

**الإصلاح المطلوب:**
> عدّل موديلات Flutter لتقرأ `carbs[]`, `salad`, `premiumExtraFeeHalala`, `premiumKey` وتحوّلها محليًا بدل الاعتماد على `carbId` فقط.

---

### 🔴 C-2 — Custom Premium Salad: عدم توافق الـ Request Payload
**النطاق:** Cross-stack (Backend + Flutter)

**المشكلة:**
طلب الـ Custom Premium Salad الخارج من Flutter لا يطابق ما يتوقعه الـ Backend.

| الطرف | الشكل |
|-------|-------|
| Flutter يُرسل | `selectionType: custom_premium_salad` + قوائم مسطحة (`vegetables / addons / nuts / sauce`) |
| Backend يتوقع | `selectionType: premium_large_salad` + `salad.groups.protein / sauce` (بدون carbs) |

**الملفات المتأثرة:**
- Flutter: `day_selection_request.dart`, `custom_premium_meal_builder_screen.dart`
- Backend: `mealTypeMapper.js`, `mealSlotPlannerService.js`

**النتيجة:**
هذا الفلو مرشح بقوة لإرجاع خطأ `422` مع أحد الرسائل التالية:
- `SALAD_STRUCTURE_REQUIRED`
- `SALAD_PROTEIN_REQUIRED`

**الإصلاح المطلوب:**
> اجعل Flutter يُرسل الشكل Canonical الكامل للسلطة كما يتوقعه الـ Backend، **أو** أضف طبقة تحويل (transformation layer) في الـ Frontend قبل الإرسال.

---

## الفجوات العالية الأولوية

### 🟠 H-1 — دورة الحفظ مكسورة مقارنةً بالعقد الجديد
**النطاق:** Frontend

**المشكلة:**
الـ Flutter لا يُطبّق دورة الحفظ الصحيحة:

| الواقع الحالي في Flutter | ما يدعمه الـ Backend |
|--------------------------|---------------------|
| لا يستخدم `validate` أصلًا | يدعم `draft / save / idempotency` |
| يمنع الحفظ إلا إذا اكتملت كل الوجبات | يسمح بحفظ Draft جزئي |
| يُرسل فقط الـ Complete Slots | يتوقع إرسال جميع الـ Slots كما هي |
| يعمل `confirm` تلقائيًا بعد الحفظ | يعتبر `confirm` خطوة مستقلة |

**الملفات المتأثرة:**
- `meal_planner_bloc.dart`
- `meal_planner_bottom_action.dart`

**النتيجة:**
- لا يمكن حفظ Draft جزئي
- لا يمكن مسح Slot محفوظ وإرساله كـ `empty/refund` بشكل سليم
- التطبيق يختصر الـ Cycle ويفقد معنى "تأكيد" اليوم

**الإصلاح المطلوب:**
> نفّذ الـ Cycle الحقيقي:
> 1. `validate`
> 2. `save` لكل الـ Slots كما هي
> 3. زر `confirm` مستقل — يظهر **فقط** عندما يُعلن الـ Backend أن اليوم `confirmable`

---

### 🟠 H-2 — موديل استجابة Validate غير مطابق
**النطاق:** Frontend

**المشكلة:**
حتى لو استُخدم endpoint الـ `validate`، موديل الاستجابة لن يُفسَّر بشكل صحيح.

| الطرف | الشكل |
|-------|-------|
| Backend يُرجع | `{ ok: true, data: { valid, plannerMeta, paymentRequirement, ... } }` |
| Flutter يتوقع | `valid`, `plannerMeta`, `paymentRequirement` في **الجذر مباشرة** |

**الملفات المتأثرة:**
- `validation_response.dart`

**النتيجة:**
الـ Endpoint جاهز في الـ Backend لكنه عمليًا غير قابل للاستهلاك من Flutter بالشكل الحالي.

**الإصلاح المطلوب:**
> ابنِ Response Wrapper مشابه لـ `SubscriptionDayResponse`، أو غيّر الـ Parser ليقرأ `data.valid`, `data.plannerMeta`, إلخ.

---

### 🟠 H-3 — حساب مدفوعات Premium محليًا بدل الاعتماد على الـ Backend
**النطاق:** Cross-stack

**المشكلة:**
التطبيق يحسب `pending premium / add-on payments` محليًا بدل الاعتماد على `paymentRequirement` من الـ Backend.

**الملفات المتأثرة:**
- `meal_planner_state.dart`
- `meal_planner_bottom_action.dart`

**النتيجة:**
CTA الدفع والمبلغ وحالة Readiness قد تنحرف عن الحقيقة، خصوصًا في حالات:
- Wallet Credits
- Refunds
- Custom Premium Salad
- One-time Add-ons

**الإصلاح المطلوب:**
> اجعل الـ UI يعتمد **أولًا** على:
> - `paymentRequirement`
> - `premiumExtraPayment`
> - `commercialState`
>
> واستخدم الحساب المحلي **فقط كـ Fallback مؤقت** أثناء التعديل قبل أول Roundtrip.

---

## الفجوات المتوسطة

### 🟡 M-1 — حقول مفقودة في نماذج اليوم والـ Timeline
**النطاق:** Frontend

**المشكلة:**
موديلات Flutter لا تحفظ حقولًا مهمة يُضيفها الـ Backend صراحةً.

**الحقول المفقودة:**

| الحقل | الغرض |
|-------|-------|
| `commercialState` | حالة اليوم التجارية |
| `commercialStateLabel` | نص العرض للحالة |
| `isFulfillable` | هل يمكن تحضير اليوم |
| `plannerRevisionHash` | Idempotency وتتبع التغييرات |
| `premiumExtraPayment` | مبلغ دفع إضافي |
| `premiumSummary` | ملخص الـ Premium |
| `rules` | قواعد التحقق |

**الملفات المتأثرة:**
- `SubscriptionDayModel`
- `TimelineDayModel`

**النتيجة:**
التطبيق لا يملك الـ "Source of Truth" الكافي لاتخاذ قرارات صحيحة حول Readiness والتحضير والدفع.

**الإصلاح المطلوب:**
> وسّع `SubscriptionDayModel` و `TimelineDayModel` لاحتواء هذه الحقول، واعرض الـ UI بناءً عليها بدل الاستدلالات القديمة.

---

### 🟡 M-2 — الاعتماد على `status` وحده لتحديد قابلية التعديل
**النطاق:** Frontend

**المشكلة:**
الـ Timeline والـ Meal Planner ما زالا يتعاملان مع `status` كأنها الحقيقة النهائية.

**المشكلة التحديدية:**
شاشة الـ Timeline تجعل اليوم الـ `planned` قراءة فقط (read-only)، بينما العقد الجديد يعتمد على `commercialState` و `plannerState` — والتقرير نفسه يوضح أن `confirmed` **لا يعني locked**.

**الملفات المتأثرة:**
- `time_line_screen.dart`

**النتيجة:**
منع المستخدم من تعديل أيام قابلة للتعديل فعلًا، أو السماح بتعديل أيام مقفلة.

**الإصلاح المطلوب:**
> استخدم `status` فقط كحالة تشغيلية لليوم، واجعل قابلية التعديل والجاهزية مبنية على:
> - `commercialState`
> - `plannerState`
> - `paymentRequirement`
> - `canBePrepared`

---

## خطة الإصلاح المقترحة

```
المرحلة 1 — Contract Parsing & Request Payloads         [الأعلى أولوية]
├── C-1: إصلاح parsing mealSlots (carbs[], salad)
└── C-2: إصلاح payload الـ custom premium salad

المرحلة 2 — إصلاح Flow الشاشة                          [بعد المرحلة 1]
├── H-1: تطبيق الـ Cycle الحقيقي (validate → save draft → pay → confirm)
└── H-2: إصلاح موديل استجابة validate

المرحلة 3 — نقل قرارات الـ UI إلى الـ Backend           [بعد المرحلة 2]
├── H-3: الاعتماد على paymentRequirement بدل الحساب المحلي
├── M-1: إضافة الحقول المفقودة للموديلات
└── M-2: استبدال status بـ commercialState / plannerState
```

---

> **ملاحظة:** الإصلاحات في المرحلة 1 شرط أساسي لكل ما يليها — لا تبدأ المرحلة 2 قبل اكتمالها.