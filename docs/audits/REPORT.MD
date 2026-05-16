> Status: Merge candidate. This document overlaps with newer documentation. Review `docs/DOCS_CLEANUP_RECOMMENDATIONS.md` before using it as source of truth.

أكيد. ده تقرير كامل ومنظم يلخص **إحنا عملنا إيه في خطة تحسين المشروع وتجهيزه لـ 10,000 مستخدم**، وإيه اتثبت، وإيه لسه ناقص قبل production الحقيقي.

---

# تقرير تحسين Backend وتجهيزه لـ 10,000 مستخدم

## 1. الهدف العام

كان الهدف من الخطة إننا نراجع ونقوي backend مشروع `basicdiet145` من ناحية:

```text
- صحة منطق الاشتراكات وخصم الوجبات
- منع race conditions
- تأمين الدفع والـ webhooks
- تثبيت one-time orders pickup-only
- تحسين الأداء والاستعداد لـ 10,000+ users
- إضافة indexes مهمة
- تقليل N+1 queries
- إضافة pagination غير كاسر
- تجهيز checklist للنشر production
```

النتيجة الحالية:

```text
Business logic الأساسي اتقفل بدرجة جيدة جدًا
Payment/order idempotency اتحسن
Subscription balance logic اتثبت
Performance Phase 2 بدأ واتنفذ منه أجزاء مهمة
لكن النظام لسه مش production-ready بالكامل إلا بعد DB/production env/load validation
```

---

# 2. أهم حاجة اتظبطت: منطق خصم الوجبات في الاشتراكات

## السياسة المطلوبة

اتأكدنا إن منطق الاشتراك هو:

```text
العميل عنده رصيد وجبات إجمالي داخل مدة الاشتراك
dailyMealsDefault مش hard cap
العميل يقدر يستهلك أكتر من وجبة في يوم واحد طالما remainingMeals يسمح
الخصم يحصل فقط عند التنفيذ الفعلي / fulfillment أو cashier/manual consumption
مفيش حرق وجبات بسبب مرور يوم
مفيش خصم مع skip / freeze / no_show / cancel / read endpoints
```

## اللي اتعمل

تم تثبيت سياسة:

```text
TOTAL_BALANCE_WITHIN_VALIDITY
```

بمعنى:

```text
remainingMeals هو مصدر الحقيقة
maxConsumableMealsNow هو الحد الحقيقي
dailyMealsDefault مجرد minimum/planning baseline وليس cap
```

## الملفات اللي اتعدلت أو اتراجعت

```text
src/services/subscription/subscriptionDayConsumptionService.js
src/services/subscription/subscriptionDayPlanningService.js
src/services/fulfillmentService.js
tests/subscriptionBalancePolicy.test.js
tests/subscriptionBalanceConcurrency.test.js
tests/subscriptionFulfillmentConcurrency.test.js
tests/mealPlanner.integration.test.js
```

## النتيجة

اتأكدنا إن:

```text
✅ مفيش calendar-day burn
✅ العميل يقدر يخطط أكتر من dailyMealsDefault طالما عنده رصيد
✅ الخصم بيتم بالعدد الفعلي للوجبات المنفذة
✅ repeated fulfillment بيخصم مرة واحدة فقط
✅ concurrent fulfillment آمن
✅ cashier/manual consumption آمن ضد concurrency
```

---

# 3. one-time orders: قفل delivery افتراضيًا

## المشكلة القديمة

كان فيه delivery في one-time orders رغم إن business requirement الحالي pickup-only.

## اللي اتعمل

اتضاف feature gate:

```env
ONE_TIME_ORDER_DELIVERY_ENABLED=false
```

والسلوك بقى:

```text
لو delivery disabled:
- quote delivery يترفض
- create delivery order يترفض
- delivery actions تتمنع
- delivery DTO يخفي actions
- legacy kitchen/courier delivery routes تترفض
```

لكن:

```text
pickup order flow شغال طبيعي
delivery code والـ fields محفوظين للمستقبل
subscription delivery لم يتأثر
```

## tests

```text
oneTimeOrders.test.js
oneTimeOrderOps.test.js
oneTimeOrderDeliveryGate.test.js
```

## النتيجة

```text
✅ pickup orders تعمل طبيعي
✅ one-time delivery مقفول by default
✅ subscription delivery شغال ومش متأثر
✅ dashboard order actions بقت تروح للخدمة الصح
```

---

# 4. Dashboard order actions اتظبطت

## المشكلة

بعض dashboard actions الخاصة بـ one-time orders كانت ممكن تعدي على generic subscription flow أو ترجع DTO غلط.

## اللي اتعمل

تم توجيه order actions إلى:

```text
orderDashboardService / orderOpsTransitionService
```

بدل generic subscription transition flow.

## النتيجة

```text
✅ order actions بترجع DTO صحيح
✅ source = one_time_order
✅ entityType = order
✅ مفيش SubscriptionDay بيتخلق بالغلط بسبب one-time order action
```

---

# 5. Canonical order statuses

## المشكلة

كان فيه aliases قديمة:

```text
preparing
canceled
```

مع إن canonical statuses هي:

```text
in_preparation
cancelled
```

## اللي اتعمل

```text
✅ legacy aliases لسه مقروءة للتوافق
✅ لكن الكتابة والـ DTO والـ policies تستخدم canonical values
✅ legacy preparing route بيرجع in_preparation
✅ cancel بيرجع cancelled
```

---

# 6. Webhook security

## المشكلة

كان webhook بيعتمد على secret token فقط.

## اللي اتعمل

اتضاف:

```text
MOYASAR_WEBHOOK_SECRET validation
MOYASAR_WEBHOOK_ALLOWED_IPS optional whitelist
strict payment/order/type/amount/currency matching
duplicate webhook idempotency
```

## tests

```text
webhookSecurity.test.js
```

## النتيجة

```text
✅ invalid secret rejected
✅ valid secret accepted when whitelist not configured
✅ invalid IP rejected when whitelist configured
✅ duplicate webhook idempotent
```

---

# 7. Payment and order idempotency hardening

## المشكلة

كان فيه فرق في السلوك بين manual verify و webhook لما order يكون expired/cancelled.

## اللي اتعمل

اتعمل hardening في one-time order payment flow:

```text
لو paid webhook وصل لـ expired/cancelled order:
- Payment يتسجل paid/applied لأن الفلوس اتدفعت
- order.paymentStatus يبقى paid
- order.status لا يرجع confirmed
- يتسجل ActivityLog: order_webhook_late_payment
```

وده يمنع إن late webhook يحيي order منتهي بالغلط.

## كمان

تم إزالة legacy unreachable one_time_order webhook block من controller عشان يبقى:

```text
orderPaymentService هو single source of truth
```

## tests

```text
orderPaymentIdempotency.test.js
```

## النتيجة

```text
✅ verify + webhook race آمن
✅ duplicate paid webhooks آمن
✅ expired/cancelled order لا يتم إحياؤه بالخطأ
✅ manual verify متوافق مع webhook behavior
```

---

# 8. Rate limiting

## اللي اتعمل

تم تطبيق rate limiting على endpoints حساسة مثل:

```text
quote
create order
checkout
verify payment
```

## النتيجة

```text
✅ تقليل abuse على payment/order endpoints
✅ حماية أفضل ضد spam/DoS
```

---

# 9. Phase 2.1 Performance: indexes + N+1 + search hardening

## 9.1 Indexes اتضافت

### User

```js
{ role: 1, createdAt: -1 }
```

الهدف:

```text
تحسين admin user list/filter
```

### SubscriptionDay

```js
{ date: 1, status: 1, updatedAt: -1 }
```

الهدف:

```text
تحسين kitchen/courier/pickup operational dashboard queries
```

### Order

```js
{
  fulfillmentDate: 1,
  paymentStatus: 1,
  status: 1,
  fulfillmentMethod: 1,
  updatedAt: -1
}
```

الهدف:

```text
تحسين order operational dashboard queries
```

### ActivityLog

```js
{ entityType: 1, createdAt: -1 }
```

الهدف:

```text
تحسين typed activity feeds
```

### NotificationLog

```js
{ userId: 1, createdAt: -1 }
```

الهدف:

```text
تحسين notification history per user
```

## tests

```text
indexDefinitions.test.js
```

---

## 9.2 N+1 fix

## المشكلة

`subscriptionTimelineService` كان ممكن يعمل query لكل premium protein داخل loop.

## اللي اتعمل

تم bulk-fetch لـ BuilderProtein مرة واحدة باستخدام `$in`.

## النتيجة

```text
✅ response shape لم يتغير
✅ عدد queries أقل
✅ timeline أسرع مع premium balance
```

## test

```text
subscriptionTimelinePerformance.test.js
```

---

## 9.3 Search hardening

## اللي اتعمل

في `opsSearchService.js`:

```text
✅ valid ObjectId lookup مباشر
✅ min query length = 3
✅ limits على subqueries
✅ تقليل regex-heavy searches
```

## test

```text
opsSearchService.test.js
```

---

# 10. Phase 2.2: Order date query strategy

## المشكلة

كان فيه query pattern قديم:

```js
$or: [
  { deliveryDate: date },
  { fulfillmentDate: date }
]
```

وده بيضعف index usage.

## اللي اتعمل

اتعملت خطة وتطبيق جزئي/كامل للـ strategy:

```text
standardize operational order queries على fulfillmentDate
```

مع الحفاظ على:

```text
deliveryDate
requestedDeliveryDate
requestedFulfillmentDate
```

للتوافق والعرض.

## Safety

تم عمل script:

```text
scripts/audits/auditOrderDateParity.js
```

الهدف منه:

```text
يتأكد إن deliveryDate و fulfillmentDate متزامنين قبل التحويل
```

## النتيجة عندك

انت شغلته على DB `basicdiet145` وكانت النتيجة:

```text
Total Orders: 0
SAFE_TO_SWITCH_TO_FULFILLMENT_DATE_ONLY: YES
```

## test

```text
orderQueryParity.test.js
```

---

# 11. Phase 2.3A: Optional pagination

## الهدف

نضيف pagination بدون ما نكسر الـ frontend.

## القاعدة

```text
لو page/limit مش موجودين:
يرجع نفس response القديم بالضبط بدون meta

لو page/limit موجودين:
يرجع data paginated + meta
```

## endpoints اللي اتطبقت عليها

```text
GET /api/admin/subscriptions/:id/days
GET /api/kitchen/orders/:date
GET /api/kitchen/pickups/:date
GET /api/kitchen/today-pickup
GET /api/courier/orders/today
GET /api/courier/deliveries/today
```

## اللي تم استبعاده عمدًا

```text
dashboard board queues
delivery schedule
mobile subscription timeline
admin subscription audit-log
```

## helper جديد

```text
src/utils/optionalPagination.js
```

## test

```text
optionalPagination.test.js
```

## النتيجة

```text
✅ backward compatible
✅ لا يكسر frontend الحالي
✅ يسمح بتقليل payload لو frontend استخدم page/limit
```

---

# 12. Logs retention/indexing audit

## اللي اتعمل

تمت مراجعة:

```text
ActivityLog
SubscriptionAuditLog
NotificationLog
```

## القرار

```text
لا TTL
لا حذف
لا archive jobs
```

لأن ده محتاج موافقة business/legal.

## اللي اتنفذ فقط

Indexes آمنة غير مدمرة:

```text
ActivityLog: { entityType: 1, createdAt: -1 }
NotificationLog: { userId: 1, createdAt: -1 }
```

## النتيجة

```text
✅ تحسين قراءة logs
✅ بدون أي deletion/retention risk
```

---

# 13. Production deployment checklist

تم تجهيز checklist كاملة للنشر تشمل:

```text
- env vars المطلوبة
- feature flags
- order date parity audit
- index rollout
- snapshot قبل deploy
- Moyasar webhook config
- required tests
- post-deploy smoke tests
- rollback plan
- monitoring alerts
```

## أهم production flags

```env
NODE_ENV=production
APP_URL=https://...
SUBSCRIPTION_AUTO_SETTLEMENT_ENABLED=false
ONE_TIME_ORDER_DELIVERY_ENABLED=false
OTP_TEST_MODE=false
ALLOW_TEST_AUTH=false
```

---

# 14. Railway deployment diagnostics

## المشكلة

عند محاولة تشغيل المشروع على Railway كان بيطلع:

```text
502 Application failed to respond
```

وبعدين:

```text
APP_URL must be set in production
```

## اللي اتعمل

تم ضبط:

```env
APP_URL=https://basicdiet145-production.up.railway.app
BASE_URL=https://basicdiet145-production.up.railway.app
BETTER_AUTH_BASE_URL=https://basicdiet145-production.up.railway.app
```

ثم أضفنا startup diagnostics في:

```text
src/index.js
src/db.js
```

## النتيجة

عرفنا السبب الحقيقي:

```text
MongoDB connected
Ensuring payment indexes
Failed:
available disk space ... less than required minimum of 524288000
```

يعني:

```text
الكود شغال
Railway Mongo اتصل
لكن Railway Mongo المجاني/الحالي مساحته قليلة ولا يستطيع createIndex
```

## القرار

حاليًا مش مهم لأن الإنتاج لاحقًا هيتدفع له أو يستخدم DB بمساحة مناسبة.

---

# 15. الاختبارات اللي اتشغلت ونجحت

تم تشغيل/تأكيد نجاح مجموعة كبيرة من الاختبارات، منها:

```text
oneTimeOrders.test.js
oneTimeOrderOps.test.js
oneTimeOrderDeliveryGate.test.js
webhookSecurity.test.js
orderPaymentIdempotency.test.js
subscriptionBalancePolicy.test.js
subscriptionBalanceConcurrency.test.js
subscriptionFulfillmentConcurrency.test.js
mealPlanner.integration.test.js
optionalPagination.test.js
orderQueryParity.test.js
indexDefinitions.test.js
subscriptionTimelinePerformance.test.js
opsSearchService.test.js
moyasar_retry.test.js
vatInclusivePricing.test.js
```

أهم النتائج التي ظهرت:

```text
oneTimeOrders: 45 passed
oneTimeOrderOps: 24 passed
oneTimeOrderDeliveryGate: 2 passed
mealPlanner.integration: 49 passed
webhookSecurity: 5 passed
subscriptionBalanceConcurrency: 1 passed
```

---

# 16. استفادة النظام من كل ده

## قبل التحسين

كان عندك مخاطر في:

```text
- خصم الوجبات تحت concurrency
- late payment webhook ممكن يحيي order expired/cancelled
- delivery one-time مفتوح رغم إنه مش جاهز
- بعض dashboard order actions بتعدي في flow غلط
- N+1 queries
- indexes ناقصة
- endpoints غير paginated
- logs collections هتكبر بدون indexes كفاية
- startup مشاكل غير واضحة
```

## بعد التحسين

النظام بقى:

```text
✅ أوضح في business rules
✅ أقوى ضد race conditions
✅ أدق في meal balance
✅ آمن أكتر في webhooks
✅ أأمن في payment idempotency
✅ جاهز أفضل للـ dashboard load
✅ عنده indexes مهمة
✅ عنده optional pagination بدون كسر frontend
✅ عنده diagnostics أوضح في deploy
✅ عنده production checklist واضحة
```

---

# 17. هل النظام جاهز لـ 10,000 users؟

## الإجابة المختصرة

```text
جزئيًا، لكن ليس بالكامل.
```

## اللي اتعمل فعلاً يخدم 10,000 users

```text
✅ indexes مهمة
✅ search hardening
✅ N+1 fix
✅ optional pagination
✅ order date query strategy
✅ log indexes
✅ payment/subscription concurrency safety
```

## اللي لسه ناقص قبل ما نقول جاهز 10,000 users بثقة

```text
1. Load testing حقيقي
2. production DB بمساحة كافية
3. مراقبة indexes و query explain plans
4. monitoring/alerts
5. حسم retention policy للـ logs
6. mobile timeline windowing لاحقًا لو الاشتراكات طويلة
7. dashboard board queue pagination لاحقًا بتنسيق مع frontend
8. تدوير كل الأسرار التي ظهرت أثناء التجربة
```

---

# 18. أخطر حاجات باقية

## 1. أسرار الإنتاج

ظهر في المحادثة:

```text
Mongo URI
Twilio token
Cloudinary secret
Moyasar test key
JWT local secrets
```

قبل production الحقيقي لازم:

```text
Rotate Mongo password
Rotate JWT secrets
Rotate Dashboard JWT secret
Rotate Twilio token لو اتكشف
Rotate Cloudinary secret لو اتكشف
استخدام live Moyasar keys
```

## 2. DB production

Railway Mongo الحالي مساحته قليلة، لذلك:

```text
إما Atlas production
أو Railway Mongo paid volume أكبر
```

## 3. Load testing

لسه محتاجين نثبت الأداء تحت load حقيقي.

---

# 19. الحالة الحالية النهائية

## ما تم إنجازه

```text
✅ Phase 1 business-critical fixes
✅ Subscription meal deduction policy hardening
✅ One-time order delivery gate
✅ Dashboard order routing
✅ Canonical statuses
✅ Webhook security
✅ Payment/order idempotency
✅ Phase 2.1 indexes + N+1 + search hardening
✅ Phase 2.2 order date strategy
✅ Phase 2.3A optional pagination
✅ Log index strategy
✅ Production deployment checklist
✅ Railway diagnostics
```

## ما لم يكتمل

```text
❌ Production DB final setup
❌ Real production load testing
❌ Final secret rotation
❌ Monitoring/alerts
❌ Full dashboard queue pagination
❌ Mobile timeline pagination/windowing
❌ Legal/business retention policy
```

---

# 20. الخلاصة التنفيذية

المشروع اتحسن جدًا من ناحية:

```text
- صحة منطق الاشتراكات
- أمان الدفع
- منع التكرار والـ race conditions
- أداء dashboard queries
- readiness للـ 10,000 users
```

لكن لسه قبل الإنتاج الحقيقي لازم:

```text
1. تستخدم DB production بمساحة كافية
2. تدوّر كل الأسرار
3. تشغل checklist كاملة
4. تعمل load testing
5. تراقب indexes/startup/logs
```

الحالة الحالية:

```text
Backend logic: جيد جدًا ومتحسن
Payment/subscription safety: قوي
Performance readiness: متقدم لكن غير مكتمل
Production readiness: ليس نهائيًا حتى يتم تجهيز DB/secrets/load testing
```
