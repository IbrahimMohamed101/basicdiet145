# قائمة فحص QA للـ Backend في BasicDiet

استخدم هذه القائمة قبل التسليم أو النشر. كل بند يجب اختباره على local test DB أو staging، وليس على production.

## A. عام

- [ ] التطبيق يبدأ بدون أخطاء.
- [ ] الاتصال بقاعدة البيانات يعمل على قاعدة اختبار أو staging.
- [ ] متغيرات البيئة الأساسية موجودة: `APP_URL`, `MONGO_URI`, `JWT_SECRET`, `DASHBOARD_JWT_SECRET`.
- [ ] لا يتم تسجيل secrets أو مفاتيح Moyasar أو JWT في logs.
- [ ] rate limits مفعلة على المسارات الحساسة.
- [ ] `helmet` و CORS مضبوطين حسب البيئة.
- [ ] `npm run validate:backend` ينجح.

## B. طلبات One-Time Orders

- [ ] `GET menu` يعمل ويرجع categories/products نشطة فقط للعميل.
- [ ] quote يعمل ويتم حساب السعر في backend.
- [ ] create order يعمل ببيانات صحيحة.
- [ ] يتم إنشاء `paymentUrl` عند الحاجة إلى الدفع.
- [ ] payment verify يعمل في test mode أو mock.
- [ ] يتم تخزين order snapshot للأسعار والاختيارات.
- [ ] Dashboard يرى الطلب بعد إنشائه.
- [ ] انتقال الحالة إلى prepare يعمل للصلاحيات المناسبة.
- [ ] انتقال الحالة إلى ready يعمل للصلاحيات المناسبة.
- [ ] انتقال الحالة إلى fulfill/delivered يعمل للصلاحيات المناسبة.
- [ ] الطلب pickup-only لا يسرب حقول delivery غير مستخدمة.

## C. كتالوج Menu

- [ ] categories النشطة تظهر للعميل فقط.
- [ ] products النشطة تظهر للعميل فقط.
- [ ] option groups مربوطة بالمنتجات الصحيحة.
- [ ] min/max selections صحيحة لكل group.
- [ ] الخيارات مربوطة بالـ groups الصحيحة.
- [ ] لا توجد duplicate keys في categories أو products أو options.
- [ ] الأسعار محفوظة بالهللة وليس بالريال.
- [ ] منتجات `per_100g` تحتوي بيانات وزن وتسعير صحيحة.
- [ ] المنتجات التي تحتاج builder لا يمكن إضافتها مباشرة إذا كان ذلك ممنوعا.
- [ ] snapshot الطلب لا يتغير بعد تعديل الكتالوج.

## D. الدفع

- [ ] مفتاح Moyasar موجود في بيئة الاختبار أو staging.
- [ ] لا يتم استخدام مفتاح live في local validation.
- [ ] redirect URLs يتم تطبيعها إلى HTTPS.
- [ ] webhook signature أو secret token يتم التحقق منه.
- [ ] webhook من IP غير مسموح يتم رفضه إذا كان allowlist مفعلا.
- [ ] webhook المكرر لا يكرر تطبيق الدفع.
- [ ] idempotency يعمل للطلب المدفوع مسبقا.
- [ ] فشل إنشاء الدفع لا يكشف أسرارا للعميل.
- [ ] عمليات GET من Moyasar يمكن retry عند transient failures.
- [ ] عمليات POST لا يتم retry تلقائيا بدون idempotency واضح.

## E. الاشتراكات

- [ ] quote يعمل ويرجع السعر النهائي من backend.
- [ ] checkout يعمل في test mode أو mock.
- [ ] days يتم توليدها بعد التفعيل.
- [ ] قواعد skip تعمل حسب حدود الخطة.
- [ ] قواعد freeze/unfreeze تعمل حسب الحالة والصلاحيات.
- [ ] payment application يطبق الدفع مرة واحدة فقط.
- [ ] premium extras و addons تظهر في snapshot أو contract بشكل صحيح.
- [ ] renewal لا يكسر الاشتراك الحالي.
- [ ] إلغاء الاشتراك يحفظ audit trail مناسب.

## F. Dashboard

- [ ] تسجيل دخول Dashboard يعمل.
- [ ] roles enforced لكل عملية حساسة.
- [ ] menu CRUD محمي ولا يسمح لغير المصرح.
- [ ] order operations محمية حسب الدور.
- [ ] subscription operations محمية حسب الدور.
- [ ] audit logs يتم إنشاؤها عند العمليات المهمة.
- [ ] البحث والفلترة والصفحات لا تكشف بيانات غير مصرح بها.
- [ ] أخطاء Dashboard لا تكشف stack traces أو secrets في production.

## G. الأمان

- [ ] auth مطلوب لكل مسار عميل حساس.
- [ ] dashboard auth مطلوب لكل مسارات الإدارة.
- [ ] backend لا يثق بأسعار مرسلة من العميل.
- [ ] pickup-only flow لا يسرب أو يطلب بيانات delivery.
- [ ] invalid IDs يتم رفضها برسائل آمنة.
- [ ] role escalation غير ممكن عبر payload.
- [ ] webhook لا يقبل secret ناقص أو خاطئ.
- [ ] logs لا تحتوي payment secrets أو JWT أو Mongo URI كامل.

## H. النشر

- [ ] `APP_URL` مضبوط ويستخدم HTTPS.
- [ ] `MONGO_URI` مضبوط ويشير إلى قاعدة البيئة الصحيحة.
- [ ] `NODE_ENV=production` في production.
- [ ] مفاتيح البيئة مخزنة في secret manager وليس داخل Git.
- [ ] logs تمت مراجعتها بعد smoke test.
- [ ] smoke test نجح بعد النشر.
- [ ] Postman/Newman نجح إذا كانت collection محدثة.
- [ ] لم يتم تشغيل production seeds أثناء التحقق.
- [ ] لا توجد migrations أو scripts تعدل البيانات بدون خطة rollback.
