# دليل Postman الشامل — نظام Pickup Preparation
## Subscription Pickup API — توثيق كامل لكل Endpoint وكل حالة

---

## فهرس المحتويات

1. [متغيرات البيئة (Environment Variables)](#environment)
2. [مسار المستخدم الكامل (Full User Journey)](#journey)
3. [Endpoint 1 — Overview (حالة الزرار)](#overview)
4. [Endpoint 2 — POST Prepare (تجهيز الطلب)](#prepare)
5. [Endpoint 3 — GET Status (متابعة الحالة)](#status)
6. [جدول الحالات الكامل](#states)
7. [سيناريوهات الخطأ الكاملة](#errors)
8. [Flow الـ Polling](#polling)

---

<a name="environment"></a>
## 1. متغيرات البيئة

قبل ما تبدأ، اعمل Environment في Postman بالمتغيرات دي:

```
base          = http://localhost:3000      (أو staging URL)
token         = eyJhbGciOiJIUzI1...       (JWT بعد login)
id            = 69db8dc20eab4a470d8cea8d  (subscription ID)
today         = 2026-05-18                (تاريخ اليوم بصيغة YYYY-MM-DD)
yesterday     = 2026-05-17
tomorrow      = 2026-05-19
```

**Authorization Header (على كل Request):**
```
Key:   Authorization
Value: Bearer {{token}}
```

---

<a name="journey"></a>
## 2. مسار المستخدم الكامل

قبل ما تبدأ تتيست، افهم الـ flow ده:

```
يوم 17 (أمس):   المستخدم اختار وجباته ليوم 18
                 ↓
يوم 18 صبح:     يفتح الأبلكيشن → Overview يقوله "available"
                 ↓
واقف قدام الفرع: يضغط "تجهيز الطلب" → POST prepare
                 ↓
اليوم مـ locked: يعمل Polling على GET status كل 30 ثانية
                 ↓
المطبخ بيجهز:   status → in_preparation
                 ↓
الأكل جاهز:     status → ready_for_pickup + pickupCode ظهر
                 ↓
استلم الأكل:    status → fulfilled + fulfilledAt
                 ↓
يوم 19 صبح:     Overview يعمل reset تلقائي ليوم 19
```

---

<a name="overview"></a>
## 3. Endpoint 1 — GET Overview (حالة الزرار)

```
GET {{base}}/api/subscriptions/current/overview
```

**الهدف:** يجيب حالة الزرار قبل ما المستخدم يضغط أي حاجة. الـ Frontend بيستخدمه عشان يقرر يعرض الزرار إزاي.

**Headers:**
```
Authorization: Bearer {{token}}
```

---

### حالات الـ `pickupPreparation.flowStatus`

#### الحالة A — `hidden`
**امتى بتحصل:** لما الاشتراك نوعه توصيل (Courier) مش استلام (Pickup).

**الـ Response:**
```json
{
  "pickupPreparation": {
    "flowStatus": "hidden",
    "reason": null,
    "buttonLabel": null,
    "message": null
  }
}
```

**الـ UI بيعمل إيه:** مش بيعرض زرار التجهيز خالص. لأن العميل ده مش بييجي للفرع.

---

#### الحالة B — `disabled` بسبب `SUBSCRIPTION_INACTIVE`
**امتى بتحصل:** الاشتراك مش في حالة `active` — يعني إما `on_hold` أو `canceled` أو انتهت صلاحيته.

**الـ Response:**
```json
{
  "pickupPreparation": {
    "flowStatus": "disabled",
    "reason": "SUBSCRIPTION_INACTIVE",
    "buttonLabel": "تجهيز الطلب",
    "message": "اشتراكك غير نشط أو انتهت صلاحيته"
  }
}
```

**الـ UI بيعمل إيه:** الزرار موجود بس greyed out ومش قابل للضغط، وبيعرض رسالة الـ `message`.

---

#### الحالة C — `disabled` بسبب `PLANNING_INCOMPLETE`
**امتى بتحصل:** في حالتين:
- اليوم الحالي مفيش له `SubscriptionDay` record أصلاً (المستخدم معملش اختيارات)
- اليوم موجود لكن عدد الوجبات المختارة أقل من المطلوب

**الـ Response:**
```json
{
  "pickupPreparation": {
    "flowStatus": "disabled",
    "reason": "PLANNING_INCOMPLETE",
    "buttonLabel": "تجهيز الطلب",
    "message": "يرجى اختيار وجباتك أولاً"
  }
}
```

**الـ UI بيعمل إيه:** الزرار greyed out، وبيوجه المستخدم لصفحة اختيار الوجبات.

---

#### الحالة D — `disabled` بسبب `PAYMENT_REQUIRED`
**امتى بتحصل:** المستخدم اختار وجبة Premium أو Addon ومدفعتش الفرق.

**الـ Response:**
```json
{
  "pickupPreparation": {
    "flowStatus": "disabled",
    "reason": "PAYMENT_REQUIRED",
    "buttonLabel": "تجهيز الطلب",
    "message": "يوجد مبالغ معلقة، يرجى إتمام الدفع"
  }
}
```

**الـ UI بيعمل إيه:** الزرار greyed out، وبيعرض رابط للـ payment screen.

---

#### الحالة E — `disabled` بسبب `INSUFFICIENT_CREDITS`
**امتى بتحصل:** `remainingMeals` في الاشتراك أقل من عدد الوجبات المطلوبة لليوم.

**مثال:** اشتراك يوميه وجبتين، لكن الرصيد المتبقي = 1 وجبة فقط.

**الـ Response:**
```json
{
  "pickupPreparation": {
    "flowStatus": "disabled",
    "reason": "INSUFFICIENT_CREDITS",
    "buttonLabel": "تجهيز الطلب",
    "message": "رصيد وجباتك غير كافٍ"
  }
}
```

**الـ UI بيعمل إيه:** الزرار greyed out، وبيعرض رسالة تجديد الاشتراك.

---

#### الحالة F — `disabled` بسبب `DAY_SKIPPED`
**امتى بتحصل:** اليوم اتعلّق أو اتجمّد (`status = skipped` أو `frozen`). ممكن المستخدم طلب تأجيل ليوم معين.

**الـ Response:**
```json
{
  "pickupPreparation": {
    "flowStatus": "disabled",
    "reason": "DAY_SKIPPED",
    "buttonLabel": "تجهيز الطلب",
    "message": "هذا اليوم موقوف أو مجمّد"
  }
}
```

**الـ UI بيعمل إيه:** الزرار greyed out مع أيقونة pause.

---

#### الحالة G — `available`
**امتى بتحصل:** كل الشروط اتحققت:
- الاشتراك active
- اليوم موجود وحالته `open`
- التخطيط مكتمل
- مفيش مدفوعات معلقة
- الرصيد كافي

**الـ Response:**
```json
{
  "pickupPreparation": {
    "flowStatus": "available",
    "reason": null,
    "buttonLabel": "تجهيز الطلب",
    "message": null
  }
}
```

**الـ UI بيعمل إيه:** الزرار شغال وجاهز للضغط. ده اللحظة اللي المستخدم واقف قدام الفرع وعايز يطلب.

---

#### الحالة H — `in_progress`
**امتى بتحصل:** المستخدم ضغط تجهيز من قبل، أو النظام قفل اليوم تلقائياً. الحالة بتيجي لما:
- `todayDay.status = locked`
- `todayDay.status = in_preparation`
- `todayDay.status = ready_for_pickup`
- `todayDay.pickupRequested = true`

**الـ Response:**
```json
{
  "pickupPreparation": {
    "flowStatus": "in_progress",
    "reason": null,
    "buttonLabel": "تجهيز الطلب",
    "message": null
  }
}
```

**الـ UI بيعمل إيه:** يعرض Progress Indicator وينقل المستخدم لصفحة متابعة الحالة (Polling screen).

---

#### الحالة I — `completed`
**امتى بتحصل:** المستخدم استلم طلبه والحالة بقت `fulfilled`.

**الـ Response:**
```json
{
  "pickupPreparation": {
    "flowStatus": "completed",
    "reason": null,
    "buttonLabel": "تجهيز الطلب",
    "message": null
  }
}
```

**الـ UI بيعمل إيه:** مش بيعرض الزرار. بيعرض رسالة "تم الاستلام بنجاح" مع checkmark.

**ملاحظة مهمة:** النهارده لو كان يوم 18 ومكتمل، بكرة يوم 19 الـ Overview هيجيب `todayDay` ليوم 19 تلقائي، يعني الـ flowStatus هيبدأ من أول لليوم الجديد.

---

<a name="prepare"></a>
## 4. Endpoint 2 — POST Prepare (تجهيز الطلب)

```
POST {{base}}/api/subscriptions/{{id}}/days/{{today}}/pickup/prepare
```

**الهدف:** تنفيذ الأكشن الفعلي — قفل اليوم وإدخاله مسار المطبخ.

**Headers:**
```
Authorization: Bearer {{token}}
Content-Type:  application/json
```

**Body:** مفيش Body مطلوب.

---

### الـ Success Response

```json
{
  "status": true,
  "data": {
    "subscriptionId": "69db8dc20eab4a470d8cea8d",
    "date": "2026-05-18",
    "currentStep": 2,
    "status": "locked",
    "statusLabel": "Your order is locked",
    "message": "Modification period has ended. Waiting for kitchen.",
    "pickupRequested": true,
    "nextAction": "poll_pickup_status"
  }
}
```

**شرح كل field:**

| Field | القيمة | المعنى |
|---|---|---|
| `currentStep` | `2` | دايماً 2 لأن اليوم انتقل للخطوة الثانية |
| `status` | `"locked"` | اليوم اتقفل |
| `nextAction` | `"poll_pickup_status"` | الـ UI يبدأ Polling على الـ GET endpoint |
| `pickupRequested` | `true` | تأكيد إن الطلب اتسجل |

**اللي بيحصل في الـ Backend:**
1. يتحقق إن `date = today` (KSA time) — لو مش اليوم بيرفض
2. يتحقق إن الاشتراك `active`
3. يتحقق إن `deliveryMode = pickup`
4. يعمل Idempotency check — لو الطلب اتعمل قبل كده بيرجع نجاح مباشرة
5. يشغّل `validateDayBeforeLockOrPrepare` (planning + payments)
6. يغير `status → locked` و `pickupRequested → true` بشكل Atomic
7. يخصم الوجبات من `remainingMeals`
8. يعمل `lockDaySnapshot` لتجميد الاختيارات

---

### حالات الرفض (Error Cases)

#### رفض 1 — تاريخ غلط
**السبب:** المستخدم بعت تاريخ مش اليوم (أمس أو بكره أو أي تاريخ تاني).

**Request:**
```
POST {{base}}/api/subscriptions/{{id}}/days/{{tomorrow}}/pickup/prepare
```

**Response:**
```json
{
  "status": false,
  "error": {
    "code": "INVALID_DATE",
    "message": "يمكن تجهيز الطلب ليوم الاستلام الحالي فقط"
  }
}
```
**HTTP Status:** `400 Bad Request`

**ليه بيحصل ده:** المنطق بيقبل فقط `date = getTodayKSADate()`. أي تاريخ تاني مرفوض.

---

#### رفض 2 — الاشتراك مش active
**السبب:** حالة الاشتراك `on_hold` أو `canceled`.

**Response:**
```json
{
  "status": false,
  "error": {
    "code": "SUB_INACTIVE",
    "message": "Subscription is not active"
  }
}
```
**HTTP Status:** `422 Unprocessable Entity`

---

#### رفض 3 — التخطيط غير مكتمل
**السبب:** المستخدم معملش كل اختيارات الوجبات.

**Response:**
```json
{
  "status": false,
  "error": {
    "code": "PLANNING_INCOMPLETE",
    "message": "Please complete your meal selections first"
  }
}
```
**HTTP Status:** `422 Unprocessable Entity`

---

#### رفض 4 — مدفوعات معلقة
**السبب:** وجبة Premium أو Addon لم تدفع.

**Response:**
```json
{
  "status": false,
  "error": {
    "code": "PREMIUM_OVERAGE",
    "message": "Payment required for premium selections"
  }
}
```
**HTTP Status:** `422 Unprocessable Entity`

---

#### رفض 5 — رصيد غير كافي
**السبب:** `remainingMeals < mealsPerDay`.

**Response:**
```json
{
  "status": false,
  "error": {
    "code": "INSUFFICIENT_CREDITS",
    "message": "Not enough meal credits"
  }
}
```
**HTTP Status:** `400 Bad Request`

---

#### رفض 6 — اليوم مقفول بالفعل
**السبب:** المستخدم ضغط مرتين، أو النظام قفل اليوم تلقائياً.

**Response:**
```json
{
  "status": false,
  "error": {
    "code": "LOCKED",
    "message": "Day is already locked"
  }
}
```
**HTTP Status:** `409 Conflict`

**ملاحظة:** لو الـ `pickupRequested` كان `true` بالفعل، النظام بيتعامل مع الطلب كـ Idempotent ويرجع نجاح مش error.

---

#### رفض 7 — نمط التوصيل مش pickup
**السبب:** الاشتراك ده Courier مش Pickup.

**Response:**
```json
{
  "status": false,
  "error": {
    "code": "INVALID_DELIVERY_MODE",
    "message": "This endpoint is for pickup subscriptions only"
  }
}
```
**HTTP Status:** `400 Bad Request`

---

<a name="status"></a>
## 5. Endpoint 3 — GET Status (متابعة الحالة)

```
GET {{base}}/api/subscriptions/{{id}}/days/{{today}}/pickup/status
```

**الهدف:** يجيب الحالة الحالية للطلب. الـ UI بيستخدمه للـ Polling كل 30 ثانية بعد ما المستخدم يضغط "تجهيز".

**Headers:**
```
Authorization: Bearer {{token}}
```

---

### الحالة 1 — `open` (لسه مجهزتش)

**امتى:** قبل ما المستخدم يضغط تجهيز. أو لو دخل على الصفحة مباشرة من غير ما يضغط.

```json
{
  "status": true,
  "data": {
    "subscriptionId": "69db8dc20eab4a470d8cea8d",
    "date": "2026-05-18",
    "currentStep": 1,
    "status": "open",
    "statusLabel": "Your meals are not prepared yet",
    "message": "Review your selection to start preparation.",
    "canModify": true,
    "isReady": false,
    "isCompleted": false,
    "pickupCode": null,
    "pickupCodeIssuedAt": null,
    "fulfilledAt": null
  }
}
```

**شرح:** `canModify: true` يعني المستخدم لسه يقدر يغير اختياراته. `pickupCode: null` لأن الطلب مش مقفول لسه.

---

### الحالة 2 — `locked` (الطلب اتقفل)

**امتى:** بعد ما المستخدم يضغط "تجهيز" وتنجح العملية. أو بعد وقت الـ cutoff التلقائي.

```json
{
  "status": true,
  "data": {
    "subscriptionId": "69db8dc20eab4a470d8cea8d",
    "date": "2026-05-18",
    "currentStep": 2,
    "status": "locked",
    "statusLabel": "Your order is locked",
    "message": "Modification period has ended. Waiting for kitchen.",
    "canModify": false,
    "isReady": false,
    "isCompleted": false,
    "pickupCode": null,
    "pickupCodeIssuedAt": null,
    "fulfilledAt": null
  }
}
```

**شرح:** `canModify: false` — مفيش تعديل تاني. `pickupCode: null` — المطبخ لسه مبدأش. الـ UI بيعرض "في انتظار المطبخ".

---

### الحالة 3 — `in_preparation` (المطبخ بيجهز)

**امتى:** موظف المطبخ ضغط "بدء التحضير" من لوحة التحكم.

```json
{
  "status": true,
  "data": {
    "subscriptionId": "69db8dc20eab4a470d8cea8d",
    "date": "2026-05-18",
    "currentStep": 3,
    "status": "in_preparation",
    "statusLabel": "Kitchen is preparing your meals",
    "message": "Chef is hand-picking ingredients for your order.",
    "canModify": false,
    "isReady": false,
    "isCompleted": false,
    "pickupCode": null,
    "pickupCodeIssuedAt": null,
    "fulfilledAt": null
  }
}
```

**شرح:** `currentStep: 3` — وصلنا للخطوة التالتة. `pickupCode: null` — الكود بييجي بس لما يبقى جاهز خالص. الـ UI بيعرض animation للتحضير.

---

### الحالة 4 — `ready_for_pickup` (جاهز للاستلام)

**امتى:** المطبخ خلص التجهيز وعلّم الطلب كـ ready.

```json
{
  "status": true,
  "data": {
    "subscriptionId": "69db8dc20eab4a470d8cea8d",
    "date": "2026-05-18",
    "currentStep": 4,
    "status": "ready_for_pickup",
    "statusLabel": "Your order is ready",
    "message": "Use this pickup code at the branch.",
    "canModify": false,
    "isReady": true,
    "isCompleted": false,
    "pickupCode": "A-502",
    "pickupCodeIssuedAt": "2026-05-18T11:20:00.000Z",
    "fulfilledAt": null
  }
}
```

**شرح:** `isReady: true` — هنا لأول مرة الكود بيظهر. `pickupCode: "A-502"` هو الكود اللي المستخدم بيقوله للموظف عند الاستلام. `fulfilledAt: null` لأن الاستلام الفعلي لسه مصلحش.

---

### الحالة 5 — `fulfilled` (تم الاستلام)

**امتى:** موظف الفرع سجّل استلام الطلب من لوحة التحكم.

```json
{
  "status": true,
  "data": {
    "subscriptionId": "69db8dc20eab4a470d8cea8d",
    "date": "2026-05-18",
    "currentStep": 4,
    "status": "fulfilled",
    "statusLabel": "Completed",
    "message": "Order picked up successfully.",
    "canModify": false,
    "isReady": true,
    "isCompleted": true,
    "pickupCode": "A-502",
    "pickupCodeIssuedAt": "2026-05-18T11:20:00.000Z",
    "fulfilledAt": "2026-05-18T12:45:00.000Z"
  }
}
```

**شرح:** `currentStep: 4` — نفس الـ step لأن في الـ UI هي نفس الشاشة الأخيرة. `isCompleted: true` — العملية خلصت. `fulfilledAt` — وقت الاستلام الفعلي. الكود لسه ظاهر لأن المستخدم ممكن يحتاجه كـ proof.

---

### حالة الخطأ — يوم مش موجود (404)

**امتى:** لو المستخدم بعت تاريخ مفيش له `SubscriptionDay` أصلاً.

```json
{
  "status": false,
  "error": {
    "code": "DAY_NOT_FOUND",
    "message": "No subscription day found for this date"
  }
}
```
**HTTP Status:** `404 Not Found`

---

<a name="states"></a>
## 6. جدول الحالات الكامل

### ربط الحالات بين الـ Endpoints الثلاثة

| `todayDay.status` | Overview `flowStatus` | GET Status `currentStep` | `pickupCode` يظهر؟ | `canModify` |
|---|---|---|---|---|
| null (مش موجود) | disabled / PLANNING_INCOMPLETE | — (404) | لأ | — |
| open | available | 1 | لأ | آه |
| open (+ مشاكل) | disabled (سبب متنوع) | 1 | لأ | آه |
| locked | in_progress | 2 | لأ | لأ |
| in_preparation | in_progress | 3 | لأ | لأ |
| ready_for_pickup | in_progress | 4 | **آه** | لأ |
| fulfilled | completed | 4 | **آه** | لأ |
| skipped | disabled / DAY_SKIPPED | — | لأ | لأ |
| frozen | disabled / DAY_SKIPPED | — | لأ | لأ |

---

### ربط `currentStep` بالـ UI

| Step | الـ Status | الـ UI بيعرض إيه |
|---|---|---|
| 1 | open | "لسه مجهزتش" + زرار "تجهيز" |
| 2 | locked | "طلبك اتقفل، في انتظار المطبخ" + spinner |
| 3 | in_preparation | "المطبخ بيجهز طلبك" + animation |
| 4 | ready_for_pickup | "طلبك جاهز!" + الكود بخط كبير |
| 4 | fulfilled | "تم الاستلام بنجاح" + checkmark |

---

<a name="errors"></a>
## 7. سيناريوهات الخطأ الكاملة

### جدول كل الـ Error Codes

| الـ Code | الـ HTTP Status | السبب | الـ Endpoint |
|---|---|---|---|
| `INVALID_DATE` | 400 | التاريخ مش اليوم | POST prepare |
| `INVALID_DELIVERY_MODE` | 400 | الاشتراك courier مش pickup | POST prepare |
| `INSUFFICIENT_CREDITS` | 400 | الرصيد أقل من الوجبات | POST prepare |
| `SUB_INACTIVE` | 422 | الاشتراك مش active | POST prepare |
| `PLANNING_INCOMPLETE` | 422 | الاختيارات ناقصة | POST prepare |
| `PREMIUM_OVERAGE` | 422 | مدفوعات معلقة | POST prepare |
| `LOCKED` | 409 | اليوم مقفول بالفعل | POST prepare |
| `DAY_NOT_FOUND` | 404 | التاريخ مفيش له record | GET status |
| `FORBIDDEN` | 403 | الاشتراك مش بتاع المستخدم ده | كل الـ endpoints |
| `UNAUTHORIZED` | 401 | Token منتهي أو مش موجود | كل الـ endpoints |

---

<a name="polling"></a>
## 8. Flow الـ Polling

### المنطق الكامل للـ Frontend

```
بعد ما POST /prepare ينجح:
  nextAction = "poll_pickup_status"

  ابدأ polling:
    كل 30 ثانية → GET /pickup/status
    
    لو status = locked:       عرض "في انتظار المطبخ"
    لو status = in_preparation: عرض "المطبخ بيجهز"
    لو status = ready_for_pickup:
        وقّف الـ polling
        عرض pickupCode بشكل واضح
        اعزم المستخدم يروح الكاونتر
    لو status = fulfilled:
        وقّف الـ polling
        عرض "تم الاستلام بنجاح"
```

### متى توقف الـ Polling

| الحالة | توقف؟ |
|---|---|
| locked | لأ — استمر |
| in_preparation | لأ — استمر |
| ready_for_pickup | **آه** — عرض الكود |
| fulfilled | **آه** — تم |
| أي error 4xx | **آه** — عرض رسالة |

---

## ملاحظات مهمة للـ Frontend

**1. الـ Idempotency في POST:**
لو المستخدم ضغط "تجهيز" مرتين (double tap)، الـ API بترجع نجاح في المرتين. مش بتعمل خطأ. الـ UI مش محتاج حماية خاصة من ده.

**2. الـ Auto-reset اليومي:**
الـ Overview بيجيب `todayDay` بتاريخ اليوم الحالي دايماً. لو اليوم اتغير (منتصف الليل)، الـ `flowStatus` بيبدأ من أول تلقائياً ليوم جديد. مفيش حاجة في الـ Frontend يعملها.

**3. الـ pickupCode:**
الكود بيظهر بس في حالتين: `ready_for_pickup` و `fulfilled`. في باقي الحالات الـ API بيرجع `null` حتى لو الـ DB فيه قيمة.

**4. وقت KSA:**
كل مقارنات التاريخ بتتم بوقت المملكة (Asia/Riyadh). لو بتتيست من timezone مختلف، تأكد إن الـ `today` في الـ Environment بيوافق وقت KSA مش وقتك المحلي.