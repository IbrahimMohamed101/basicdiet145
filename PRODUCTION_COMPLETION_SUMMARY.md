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

**نهايات إضافية موجودة في السيستم الحالي:**
- لو الطلب اتجهز لكن العميل ما استلمش: الحالة النهائية ممكن تبقى `no_show`
- لو اليوم عدى بدون ما المستخدم يضغط prepare: الـ automation بتحوله إلى `consumed_without_preparation`

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

**مهم:** الـ endpoint نفسه بيرجع payload أكبر في شكل:
```json
{
  "ok": true,
  "data": {
    "...subscriptionFields": "...",
    "pickupPreparation": {
      "...": "..."
    }
  }
}
```
الأمثلة اللي تحت مركزة فقط على جزء `data.pickupPreparation`.

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

#### الحالة D — `disabled` بسبب `PLANNING_UNCONFIRMED`
**امتى بتحصل:** اليوم متخطط لكن المستخدم لسه ما عملش confirm لخطة اليوم.

**الـ Response:**
```json
{
  "pickupPreparation": {
    "flowStatus": "disabled",
    "reason": "PLANNING_UNCONFIRMED",
    "buttonLabel": "تجهيز الطلب",
    "message": "يرجى تأكيد خطة اليوم أولاً"
  }
}
```

**الـ UI بيعمل إيه:** يعرض الزرار disabled ويوجّه المستخدم يكمل تأكيد الـ planner قبل التحضير.

---

#### الحالة E — `disabled` بسبب `PAYMENT_REQUIRED`
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

#### الحالة F — `disabled` بسبب `INSUFFICIENT_CREDITS`
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

#### الحالة G — `disabled` بسبب `DAY_SKIPPED`
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

#### الحالة H — `available`
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

#### الحالة I — `in_progress`
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

#### الحالة J — `completed`
**امتى بتحصل:** في السيستم الحالي مش بس مع `fulfilled`، لكن كمان مع:
- `fulfilled`
- `no_show`
- `consumed_without_preparation`

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

**الـ UI بيعمل إيه:** مش بيعرض الزرار. لو `fulfilled` يعرض نجاح الاستلام، ولو `no_show` أو `consumed_without_preparation` يعرض الرسالة المناسبة حسب `reason`.

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

**مهم:** ده هو الـ payload الخاص بالنجاح الطبيعي لما اليوم كان `open` وتحول إلى `locked`.
في حالة الـ idempotency (مثلاً ضغطتين ورا بعض بعد ما `pickupRequested=true`) الـ endpoint بيرجع `200` برضه، لكن `data` بتكون day payload كامل localized، مش لازم نفس الشكل المختصر أعلاه.

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
5. يشغّل `validateDayBeforeLockOrPrepare` (planning + payments فقط)
6. يغير `status → locked` و `pickupRequested → true` بشكل Atomic
7. يعمل `lockDaySnapshot` لتجميد الاختيارات
8. **مهم:** خصم `remainingMeals` لا يحصل هنا في الـ controller الحالي. الخصم الفعلي يحصل لاحقًا عند `fulfilled` أو عند cutoff لو اليوم انتهى بدون prepare عبر `consumeSubscriptionDayCredits`

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
  "ok": false,
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
  "ok": false,
  "error": {
    "code": "SUB_INACTIVE",
    "message": "Subscription is not active"
  }
}
```
**HTTP Status:** `422 Unprocessable Entity`

**ملاحظة:** لو المشكلة إن صلاحية الاشتراك انتهت، الكود الفعلي بيكون `SUB_EXPIRED` برضه بنفس HTTP status `422`.

---

#### رفض 3 — التخطيط غير مكتمل
**السبب:** المستخدم معملش كل اختيارات الوجبات.

**Response:**
```json
{
  "ok": false,
  "error": {
    "code": "PLANNING_INCOMPLETE",
    "message": "Day must contain exactly mealsPerDay total meal selections before confirmation"
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
  "ok": false,
  "error": {
    "code": "PREMIUM_OVERAGE_PAYMENT_REQUIRED",
    "message": "Payment required for premium selections"
  }
}
```
**HTTP Status:** `422 Unprocessable Entity`

**ملاحظة مهمة:** في الكود الحالي ممكن كمان يظهر:
- `PREMIUM_PAYMENT_REQUIRED`
- `ONE_TIME_ADDON_PAYMENT_REQUIRED`
- `PLANNER_UNCONFIRMED`

---

#### رفض 5 — رصيد غير كافي
**الوضع الحالي في السيستم:** الـ Overview يعمل gating على `INSUFFICIENT_CREDITS`، لكن `POST /pickup/prepare` نفسه لا يعيد تنفيذ هذا التحقق حاليًا داخل الـ controller.

**المعنى العملي:** الـ Frontend لازم يعتمد على `overview` قبل إظهار زرار التحضير. أما خصم الرصيد والتحقق النهائي من الاستهلاك فيتم لاحقًا وقت الاستهلاك الفعلي.

---

#### رفض 6 — اليوم مقفول بالفعل
**السبب:** المستخدم ضغط مرتين، أو النظام قفل اليوم تلقائياً.

**Response:**
```json
{
  "ok": false,
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
  "ok": false,
  "error": {
    "code": "INVALID",
    "message": "Delivery mode is not pickup"
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

**مهم:** الـ payload الفعلي فيه fields إضافية غير الأساسية المذكورة تحت، منها:
- `pickupRequested`
- `pickupPrepared`
- `pickupPreparationFlowStatus`
- `consumptionState`
- `fulfillmentMode`
- `dayEndConsumptionReason`

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
    "pickupCode": "123456",
    "pickupCodeIssuedAt": "2026-05-18T11:20:00.000Z",
    "fulfilledAt": null
  }
}
```

**شرح:** `isReady: true` — هنا لأول مرة الكود بيظهر. في السيستم الحالي الكود بيتولد 6 أرقام رقمية مثل `"123456"`. `fulfilledAt: null` لأن الاستلام الفعلي لسه مصلحش.

---

### الحالة 5 — `fulfilled` (تم الاستلام)

**امتى:** موظف الفرع أو المطبخ أكد الاستلام من لوحة التحكم، غالبًا عبر verify pickup flow.

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
    "pickupCode": "123456",
    "pickupCodeIssuedAt": "2026-05-18T11:20:00.000Z",
    "fulfilledAt": "2026-05-18T12:45:00.000Z"
  }
}
```

**شرح:** `currentStep: 4` — نفس الـ step لأن في الـ UI هي نفس الشاشة الأخيرة. `isCompleted: true` — العملية خلصت. `fulfilledAt` — وقت الاستلام الفعلي. الكود لسه ظاهر لأن المستخدم ممكن يحتاجه كـ proof.

---

### الحالة 6 — `no_show`

**امتى:** الطلب اتجهز لكن العميل ما حضرش يستلمه، وتم تسجيله من لوحة التحكم كـ no-show.

```json
{
  "status": true,
  "data": {
    "subscriptionId": "69db8dc20eab4a470d8cea8d",
    "date": "2026-05-18",
    "currentStep": 4,
    "status": "no_show",
    "statusLabel": "Pickup window ended without collection",
    "message": "Your prepared pickup was not collected.",
    "canModify": false,
    "isReady": false,
    "isCompleted": true,
    "pickupCode": null,
    "pickupCodeIssuedAt": null,
    "fulfilledAt": null
  }
}
```

---

### الحالة 7 — `consumed_without_preparation`

**امتى:** اليوم انتهى بدون prepare request، والـ automation استهلك اليوم حسب السياسة.

```json
{
  "status": true,
  "data": {
    "subscriptionId": "69db8dc20eab4a470d8cea8d",
    "date": "2026-05-18",
    "currentStep": 1,
    "status": "consumed_without_preparation",
    "statusLabel": "Pickup window ended",
    "message": "This pickup day ended without a prepare request and was consumed by policy.",
    "canModify": false,
    "isReady": false,
    "isCompleted": true,
    "pickupCode": null,
    "pickupCodeIssuedAt": null,
    "fulfilledAt": null
  }
}
```

---

### حالة الخطأ — يوم مش موجود (404)

**امتى:** لو المستخدم بعت تاريخ مفيش له `SubscriptionDay` أصلاً.

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Day not found"
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
| no_show | completed | 4 | لأ | لأ |
| consumed_without_preparation | completed | 1 | لأ | لأ |
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
| 4 | no_show | "انتهت نافذة الاستلام بدون استلام" |
| 1 | consumed_without_preparation | "انتهى اليوم بدون طلب تجهيز" |

---

<a name="errors"></a>
## 7. سيناريوهات الخطأ الكاملة

### جدول كل الـ Error Codes

| الـ Code | الـ HTTP Status | السبب | الـ Endpoint |
|---|---|---|---|
| `INVALID_DATE` | 400 | التاريخ مش اليوم | POST prepare |
| `INVALID` | 400 | الاشتراك courier مش pickup | POST prepare |
| `SUB_INACTIVE` | 422 | الاشتراك مش active | POST prepare |
| `SUB_EXPIRED` | 422 | صلاحية الاشتراك انتهت | POST prepare / GET status |
| `PLANNING_INCOMPLETE` | 422 | الاختيارات ناقصة | POST prepare |
| `PLANNING_UNCONFIRMED` | 422 | الخطة لم يتم تأكيدها | POST prepare |
| `PREMIUM_OVERAGE_PAYMENT_REQUIRED` | 422 | مدفوعات premium overage معلقة | POST prepare |
| `PREMIUM_PAYMENT_REQUIRED` | 422 | مدفوعات premium معلقة | POST prepare |
| `ONE_TIME_ADDON_PAYMENT_REQUIRED` | 422 | مدفوعات add-on معلقة | POST prepare |
| `LOCKED` | 409 | اليوم مقفول بالفعل | POST prepare |
| `NOT_FOUND` | 404 | الاشتراك أو اليوم غير موجود | POST prepare / GET status |
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
    لو status = no_show:
        وقّف الـ polling
        عرض رسالة إن نافذة الاستلام انتهت بدون استلام
    لو status = consumed_without_preparation:
        وقّف الـ polling
        عرض إن اليوم انتهى بدون prepare وتم استهلاكه حسب السياسة
```

### متى توقف الـ Polling

| الحالة | توقف؟ |
|---|---|
| locked | لأ — استمر |
| in_preparation | لأ — استمر |
| ready_for_pickup | **آه** — عرض الكود |
| fulfilled | **آه** — تم |
| no_show | **آه** — تم إغلاق الحالة |
| consumed_without_preparation | **آه** — اليوم انتهى |
| أي error 4xx | **آه** — عرض رسالة |

---

## ملاحظات مهمة للـ Frontend

**1. الـ Idempotency في POST:**
لو المستخدم ضغط "تجهيز" مرتين (double tap)، الـ API بترجع نجاح في المرتين. مش بتعمل خطأ. لكن في الضغطة التانية ممكن شكل `data` يختلف ويكون day payload كامل بدل الـ success payload المختصر.

**2. الـ Auto-reset اليومي:**
الـ Overview بيجيب `todayDay` بتاريخ اليوم الحالي دايماً. لو اليوم اتغير (منتصف الليل)، الـ `flowStatus` بيبدأ من أول تلقائياً ليوم جديد. مفيش حاجة في الـ Frontend يعملها.

**3. الـ pickupCode:**
الكود بيظهر بس في حالتين: `ready_for_pickup` و `fulfilled`. في باقي الحالات الـ API بيرجع `null` حتى لو الـ DB فيه قيمة.

**4. وقت KSA:**
كل مقارنات التاريخ بتتم بوقت المملكة (Asia/Riyadh). لو بتتيست من timezone مختلف، تأكد إن الـ `today` في الـ Environment بيوافق وقت KSA مش وقتك المحلي.

**5. الرصيد والخصم:**
الـ Overview يمنع المستخدم من الضغط لو `remainingMeals` غير كافي. لكن الـ `prepare` endpoint نفسه لا يخصم الرصيد حاليًا ولا يعيد تنفيذ check الرصيد داخل نفس الـ controller. الخصم يحصل لاحقًا عند fulfillment أو cutoff.
