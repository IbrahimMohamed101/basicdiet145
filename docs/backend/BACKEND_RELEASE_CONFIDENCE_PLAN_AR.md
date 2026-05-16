# خطة رفع الثقة قبل إصدار Backend في BasicDiet

## الفكرة الأساسية

لا يوجد نظام يمكن ضمان أنه خال من الأخطاء بنسبة 100%. حتى مع اختبارات كثيرة، قد تظهر حالات حافة بسبب بيانات قديمة، إعدادات بيئة مختلفة، تكامل خارجي، أو استخدام فعلي غير متوقع.

الهدف العملي هو رفع الثقة إلى أعلى مستوى ممكن قبل النشر عبر طبقات تحقق مستقلة وآمنة:

- تحقق محلي سريع.
- تحقق يعتمد على قاعدة بيانات اختبار.
- تحقق API على staging.
- فحوصات سلامة بيانات read-only.
- قائمة جاهزية إنتاج.
- smoke tests بعد النشر.

كل طبقة تكشف نوعا مختلفا من المخاطر. نجاح طبقة واحدة لا يكفي وحده، لكن نجاح الطبقات كلها يعطي ثقة عالية ومناسبة للتسليم أو النشر.

## 1. التحقق المحلي

يشغل الاختبارات الذاتية التي لا تحتاج production DB ولا تستدعي مزود دفع حي.

الأمر الأساسي:

```bash
npm run validate:backend
```

ما يغطيه:

- قواعد meal planner الأساسية.
- one-time menu catalog.
- one-time pickup order full flow باستخدام MongoDB in-memory.
- mobile API contracts.
- redirect URL normalization.
- logging الآمن عند فشل الدفع.
- Moyasar retry behavior باستخدام mocks.

متى يمنع النشر:

- أي فشل في `validate:backend`.
- أي test يكشف تغيرا في response shape يعتمد عليه Flutter.
- أي test دفع يكشف تسريب أسرار أو retry غير آمن.

## 2. تحقق DB-backed على بيئة اختبار

هذه طبقة اختيارية تستخدم MongoDB محلي أو staging database، ولا يجب أن تستخدم production DB.

أمثلة:

```bash
VALIDATE_BACKEND_WITH_LOCAL_DB=true MONGO_URI=<test-or-staging-uri> npm run validate:backend
```

ما يغطيه:

- webhook security.
- order payment idempotency.
- سلوك يحتاج transactions أو قاعدة بيانات حقيقية.

قواعد السلامة:

- لا تستخدم production DB.
- لا تستخدم live payment provider.
- لا تشغل seed production.

## 3. تحقق API على staging

يتم عبر:

```bash
STAGING_BASE_URL=https://staging.example.com \
STAGING_CLIENT_TOKEN=<test-client-token> \
STAGING_PAYMENT_MODE=test \
STAGING_ALLOW_ORDER_CREATE=true \
npm run validate:staging
```

ما يغطيه:

- `GET /api/orders/menu`
- `POST /api/orders/quote`
- `POST /api/orders`
- `GET /api/orders/:id`

الغرض:

- التأكد أن staging يعمل من منظور HTTP حقيقي.
- حماية Flutter من تغيرات response shape.
- التأكد أن order creation في staging لا يستدعي دفع live.

قواعد السلامة:

- لا يعمل بدون `STAGING_BASE_URL`.
- لا ينفذ إنشاء الطلب إلا إذا تم ضبط `STAGING_PAYMENT_MODE=test` أو `mock` ومعه `STAGING_ALLOW_ORDER_CREATE=true`.
- يجب استخدام test client token أو test login credentials.
- لا تطبع tokens أو secrets.

## 4. فحوصات سلامة البيانات

يتم عبر script read-only:

```bash
VALIDATE_DATA_INTEGRITY=true MONGO_URI=<staging-uri> npm run validate:data
```

ما يغطيه:

- duplicate keys في categories/products/groups/options.
- سلامة علاقات product-option groups.
- سلامة علاقات product-group-options.
- أسعار Halala أعداد صحيحة.
- حقول `per_100g`.
- اتساق active/published.
- اتساق orders/payments بشكل read-only.

قواعد السلامة:

- لا يكتب أي بيانات.
- يرفض التشغيل بدون `VALIDATE_DATA_INTEGRITY=true`.
- يرفض `NODE_ENV=production` إلا إذا تم ضبط `READ_ONLY_PRODUCTION_AUDIT=true`.
- لا يطبع `MONGO_URI`.

## 5. قائمة جاهزية الإنتاج

قبل النشر يجب التأكد من:

- `APP_URL` مضبوط على HTTPS.
- `MONGO_URI` يشير إلى البيئة الصحيحة.
- `NODE_ENV=production` في الإنتاج فقط.
- الأسرار في Secret Manager أو env آمن وليست في Git.
- rate limits مفعلة.
- webhook secret مضبوط.
- logs لا تحتوي secrets.
- rollback plan جاهز.

## 6. Smoke tests بعد النشر

بعد النشر، نفذ smoke test محدود لا يغير بيانات خطرة:

- health endpoint.
- تحميل menu.
- login test account إن وجد.
- قراءة order/test resource إن وجد.
- مراجعة logs في Render أو منصة التشغيل.
- التحقق من عدم وجود errors متكررة أو payment failures غير متوقعة.

## 7. بوابة القرار قبل النشر

النشر يجب أن يتوقف إذا فشل أي مما يلي:

- `npm run validate:backend`
- `npm run validate:data` على staging
- `npm run validate:staging`
- Flutter full flow على staging
- Dashboard full flow على staging
- مراجعة logs
- Moyasar test payment أو mock payment verification

إذا فشل بند واحد، يتم تصنيف الفشل:

- Blocker: يمنع النشر.
- Major: يمنع النشر إلا بقرار واع وخطة rollback.
- Minor: يمكن قبوله إذا كان موثقا ولا يؤثر على الدفع أو الطلبات أو الصلاحيات.

## الخلاصة

هذه الخطة لا تعد بانعدام الأخطاء، لكنها تحول النشر من قرار مبني على الانطباع إلى قرار مبني على أدلة: اختبارات محلية، API staging، سلامة بيانات، وsmoke tests بعد النشر.
