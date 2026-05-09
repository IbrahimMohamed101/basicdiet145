# استراتيجية التحقق من Backend في BasicDiet

## 1. لماذا نحتاج تحقق Backend؟

الهدف من التحقق ليس تغيير منطق العمل، بل إثبات أن المنظومة الحالية تعمل كما هو متوقع قبل التسليم أو النشر. Backend في BasicDiet يحتوي على تدفقات حساسة: طلبات مرة واحدة، اشتراكات، دفع Moyasar، Webhooks، Dashboard، كتالوج الوجبات، وسلامة البيانات. أي خلل في هذه المناطق قد يؤدي إلى سعر خاطئ، طلب غير مكتمل، دفع غير مطبق، أو صلاحيات Dashboard غير مضبوطة.

التحقق الجيد يجب أن يكون قابلا للتشغيل محليا وفي staging، لا يحتاج قاعدة بيانات إنتاج، لا يكشف أسرارا، ولا يستدعي مزود الدفع الحي إلا في بيئة اختبار واضحة.

## 2. طبقات التحقق

### أ. فحوصات الصياغة والفحوصات الثابتة

تتحقق من أن ملفات JavaScript قابلة للتحميل وأن الاختبارات الأساسية تعمل بدون أخطاء صياغة أو imports مكسورة. في المشروع الحالي لا يوجد lint script مخصص، لذلك تكون البداية من أوامر الاختبار الموجودة.

ما الذي تتحقق منه:

- عدم وجود أخطاء syntax تمنع تشغيل Node.js.
- أن المسارات والـ imports المستخدمة في الاختبارات ما زالت صحيحة.
- أن helpers المركزية مثل التحقق من ObjectId، التسعير، وتطبيع روابط الدفع قابلة للتشغيل.

الأوامر الحالية:

```bash
npm test
npm run test:payment-init-logging
NODE_ENV=test node tests/moyasar_retry.test.js
```

### ب. اختبارات الوحدة والتكامل

تغطي أجزاء محددة من منطق العمل بدون الاعتماد على قاعدة إنتاج. بعض الاختبارات تستخدم mocks أو MongoDB in-memory، وبعضها يحتاج MongoDB محلي أو MONGO_URI اختبار.

ما الذي تتحقق منه:

- قواعد meal planner وأنواع الاختيارات.
- سلامة كتالوج one-time menu والتسعير والاختيارات.
- عدم كشف أسرار عند فشل إنشاء الدفع.
- retry الآمن في استعلامات Moyasar GET وعدم تكرار POST تلقائيا.
- idempotency في تطبيق دفعات الطلبات عند توفر MongoDB اختبار.
- حماية webhook عند توفر MongoDB اختبار.

الأوامر الحالية:

```bash
npm run test:one-time-menu
npm run test:payment-init-logging
NODE_ENV=test node tests/webhookSecurity.test.js
NODE_ENV=test node tests/orderPaymentIdempotency.test.js
NODE_ENV=test node tests/moyasar_retry.test.js
```

ملاحظة: `tests/webhookSecurity.test.js` و `tests/orderPaymentIdempotency.test.js` يتصلان بـ MongoDB محلي أو `MONGO_URI`. لذلك يجب تشغيلهما فقط على قاعدة اختبار غير إنتاجية.

### ج. فحوصات عقد API

هذه الفحوصات تتأكد أن الاستجابات والمسارات لا تنكسر من منظور العميل أو Dashboard. إذا كانت Postman/Newman collection موجودة، يوصى بتشغيلها على staging أو على خادم محلي بقاعدة اختبار.

ما الذي تتحقق منه:

- endpoints الأساسية ترجع status codes صحيحة.
- شكل response لم يتغير بطريقة تكسر التطبيق.
- auth مطلوب في مسارات Dashboard والعمليات الحساسة.
- عمليات الطلب والدفع والاشتراك تستخدم payloads متوقعة.

الموجود حاليا:

- `basicdiet145_postman_collection_v2.json`
- `docs/dashboard-api/postman.dashboard_collection.json`
- `docs/dashboard-api/postman.dashboard_full_collection.json`

التشغيل المقترح إذا كان Newman مثبتا:

```bash
newman run basicdiet145_postman_collection_v2.json --environment <staging-env.json>
newman run docs/dashboard-api/postman.dashboard_full_collection.json --environment <staging-env.json>
```

يجب ألا تحتوي ملفات البيئة على أسرار حقيقية داخل Git.

### د. تدفقات العمل E2E

تتحقق من أن منطق العمل الكامل متصل من أول API إلى آخر أثر محفوظ في قاعدة البيانات. هذه الفحوصات يجب أن تعمل على staging أو قاعدة اختبار محلية، وليس production.

One-Time Order E2E يجب أن يغطي:

- جلب menu.
- حساب quote من server.
- إنشاء order.
- إنشاء `paymentUrl` في test mode أو mock.
- التحقق من الدفع.
- حفظ snapshot للطلب والأسعار.
- ظهور الطلب في Dashboard.
- انتقالات prepare / ready / fulfill.

Subscription E2E يجب أن يغطي:

- quote.
- checkout.
- توليد days.
- قواعد skip/freeze.
- تطبيق الدفع على الاشتراك.
- ظهور الأيام والعمليات في Dashboard.

### هـ. فحوصات سلامة البيانات

هذه scripts تقرأ البيانات وتبحث عن مشاكل في الكتالوج أو الاتساق. يجب تشغيلها على قاعدة اختبار أو staging فقط.

الموجود حاليا:

```bash
node scripts/checkCatalogHealth.js
```

ما الذي يتحقق منه:

- صحة plan catalog.
- وجود anomalies في الخطط.
- ghost payments.
- orphaned subscriptions.

هذا script يقرأ من MongoDB ويجب تشغيله فقط عند ضبط:

```bash
VALIDATE_BACKEND_CATALOG_DB=true
MONGO_URI=<test-or-staging-mongo-uri>
```

### و. فحوصات جاهزية الإنتاج

تتحقق من أن الإعدادات والتشغيل مناسبين قبل النشر.

ما الذي تتحقق منه:

- `NODE_ENV=production` في بيئة الإنتاج فقط.
- `APP_URL` مضبوط ويستخدم HTTPS.
- `MONGO_URI` مضبوط ولا يشير إلى قاعدة محلية في الإنتاج.
- مفاتيح Moyasar و webhook secret موجودة في secret manager أو env آمن.
- rate limits و helmet مفعلة.
- لا يتم تسجيل secrets أو payment tokens في logs.
- smoke test نجح بعد النشر على staging.

## 3. ما الذي تتحقق منه كل طبقة؟

- static/syntax: يمنع كسر التشغيل الأساسي.
- tests: يحمي قواعد التسعير، الاختيارات، الدفع، idempotency، وحماية webhook.
- API contracts: يحمي توافق mobile app و Dashboard.
- E2E business flows: يثبت أن التدفقات الفعلية تنتهي بحالة صحيحة.
- data integrity: يكشف مشاكل الكتالوج والبيانات التاريخية قبل أن تظهر للمستخدم.
- production readiness: يمنع النشر بإعدادات ناقصة أو خطرة.

## 4. الاختبارات والـ scripts الموجودة التي يجب استخدامها

تشغيل محلي آمن افتراضيا:

```bash
npm run validate:backend
```

الأوامر التي يشغلها validator افتراضيا:

```bash
npm test
npm run test:one-time-menu
npm run test:payment-init-logging
NODE_ENV=test node tests/moyasar_retry.test.js
```

أوامر اختيارية تحتاج MongoDB اختبار:

```bash
VALIDATE_BACKEND_WITH_LOCAL_DB=true npm run validate:backend
```

وتشمل:

```bash
NODE_ENV=test node tests/webhookSecurity.test.js
NODE_ENV=test node tests/orderPaymentIdempotency.test.js
```

فحص كتالوج وقاعدة بيانات اختياري:

```bash
VALIDATE_BACKEND_CATALOG_DB=true MONGO_URI=<test-or-staging-uri> npm run validate:backend
```

## 5. الفجوات التي تحتاج اختبارات مستقبلية

- E2E كامل لإنشاء one-time order من menu إلى fulfilment باستخدام mock Moyasar.
- E2E كامل للاشتراك من quote إلى checkout ثم تطبيق الدفع وتوليد الأيام.
- اختبارات Dashboard أوسع للصلاحيات حسب الدور.
- اختبارات API contract آلية من Postman/Newman في CI.
- فحص env variables رسمي يفشل عند نقص متغير مهم في staging.
- اختبارات database consistency أكثر تفصيلا للـ menu option groups و per_100g products.
- اختبار idempotency شامل لكل webhook type وليس invoice.paid فقط.

## 6. التشغيل المحلي

التشغيل الافتراضي لا يحتاج production DB ولا يستدعي Moyasar الحقيقي:

```bash
npm install
npm run validate:backend
```

لتشغيل الاختبارات التي تحتاج MongoDB محلي:

```bash
export MONGO_URI=mongodb://localhost:27017/basicdiet_test
export VALIDATE_BACKEND_WITH_LOCAL_DB=true
npm run validate:backend
```

لتشغيل فحص catalog health على قاعدة اختبار فقط:

```bash
export MONGO_URI=mongodb://localhost:27017/basicdiet_test
export VALIDATE_BACKEND_CATALOG_DB=true
npm run validate:backend
```

لا تشغل seed scripts الإنتاجية، ولا تستخدم قاعدة production في هذه الأوامر.

## 7. التشغيل في staging

في staging يجب استخدام قاعدة staging وبيئة دفع test mode أو mocks فقط:

```bash
NODE_ENV=test \
MONGO_URI=<staging-test-mongo-uri> \
VALIDATE_BACKEND_WITH_LOCAL_DB=true \
VALIDATE_BACKEND_CATALOG_DB=true \
npm run validate:backend
```

بعد تشغيل الخادم على staging، شغل Postman/Newman إذا كانت collection والـ environment جاهزة:

```bash
newman run basicdiet145_postman_collection_v2.json --environment staging.postman_environment.json
newman run docs/dashboard-api/postman.dashboard_full_collection.json --environment staging.postman_environment.json
```

يجب تخزين أسرار staging خارج المستودع.

## 8. ما الذي يجب أن يمنع النشر؟

يجب منع النشر إذا حدث أي مما يلي:

- فشل `npm run validate:backend` في الفحوصات الإلزامية.
- فشل اختبار دفع أو webhook أو idempotency في staging.
- `APP_URL` غير HTTPS في بيئة production.
- `MONGO_URI` غير مضبوط أو يشير إلى قاعدة خاطئة.
- وجود secrets في logs.
- فشل one-time order flow أو subscription checkout flow.
- وجود ghost payments أو anomalies حرجة في catalog health.
- فشل auth أو role enforcement في Dashboard.
- وجود اعتماد على سعر مرسل من العميل بدلا من سعر server-side.
