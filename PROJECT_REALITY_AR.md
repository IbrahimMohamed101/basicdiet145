# واقع المشروع

هذا الملف يصف الكود الذي يعمل فعليًا من جذر المستودع في هذه البيئة. التطبيق النشط يبدأ من `src/index.js` عبر ملف `package.json` الموجود في الجذر؛ أما المجلد الداخلي `basicdiet145/` فيبدو كنسخة أقدم متروكة، وليس التطبيق الذي يشغله `npm start` هنا.

## 1. ما هو هذا المشروع

هذا مشروع Backend مبني بـ Node.js وExpress وMongoDB لنشاط وجبات يبيع اشتراكات وجبات وطلبات فردية لمرة واحدة. المستخدم النهائي يسجل الدخول عبر OTP على واتساب، ثم يستعرض الباقات والوجبات، ويدفع عبر روابط فواتير Moyasar، وبعدها يدير التوصيل أو الاستلام واختيار الوجبات يومًا بيوم. نفس الـ Backend يشغل أيضًا لوحة داخلية يستخدمها الأدمن والمطبخ والمندوب لإدارة الكتالوج والاشتراكات والطلبات والمدفوعات والتوصيل والإشعارات.

### من يستخدمه

- `client`: يشتري اشتراكًا أو طلبًا فرديًا، ويدير الملف الشخصي، ويختار الوجبات، ويشحن الرصيد، ويتابع حالة الاشتراك أو الطلب.
- `admin` و`superadmin`: يديرون الباقات، والوجبات، والوجبات البريميوم، والإضافات، والمستخدمين، والاشتراكات، والطلبات، والمدفوعات، والإعدادات، والصور، والسجلات، والتقارير.
- `kitchen`: يوزع الوجبات، ويقفل أيام التحضير، وينقل أيام الاشتراك والطلبات الفردية بين حالات التشغيل.
- `courier`: يرى توصيلات اليوم ويحدد أنها اقتربت أو تم تسليمها أو ألغيت.

### المسار الرئيسي من البداية للنهاية

1. المستخدم يسجل الدخول عبر OTP، ثم يفتح القائمة ويختار إما اشتراكًا أو طلبًا فرديًا.
2. الـ Backend يتحقق من الطلب، وينشئ فاتورة Moyasar وسجل `Payment` محلي، ثم ينتظر تأكيد الدفع عبر Webhook أو عبر نقطة تحقق مباشرة.
3. بعد تطبيق الدفع، ينشئ الـ Backend أو يحدّث السجل التجاري الحقيقي (`Subscription` أو `SubscriptionDay` أو `Order` أو أرصدة المحفظة أو إضافات اليوم)، ثم تكمل مسارات المطبخ والمندوب التنفيذ، وترسل المهام الخلفية التذكيرات.

### حقائق صريحة في الكود

- وسائل الدفع المحفوظة غير موجودة. الدالة `getSubscriptionPaymentMethods` في `src/controllers/subscriptionController.js` ترجع `supported: false` و`canManage: false` و`mode: "invoice_only"`.
- تغيير وضع التوصيل للاشتراك بعد الإنشاء غير مدعوم. الدالة `buildSubscriptionOperationsMeta` في `src/services/subscriptionOperationsReadService.js` ترجع `modeChangeSupported: false`.
- تخطي الأيام لا ينشئ أيام تعويضية. نفس الدالة `buildSubscriptionOperationsMeta` في `src/services/subscriptionOperationsReadService.js` ترجع `compensationMode: "none"`، ومسار التخطي يعلّم الأيام فقط على أنها skipped.
- `POST /api/subscriptions/:id/activate` في `src/routes/subscriptions.js` و`POST /api/orders/:id/confirm` في `src/routes/orders.js` عبارة عن نقاط Mock موجودة فقط خارج بيئة الإنتاج.
- الدالتان `transitionDay` و`fulfillDay` موجودتان في `src/controllers/subscriptionController.js` لكنهما معلمتان بـ `@unwired` وغير موصولتين بأي Route.
- بعض سلوك الاشتراكات يتغير حسب متغيرات البيئة في `src/utils/featureFlags.js`. الكود يستطيع التبديل بين سلوك قديم وسلوك canonical في الـ checkout وتخطيط الأيام، ويستطيع أيضًا التبديل بين وضع محفظة بريميوم قديم ووضع generic أحدث.

## 2. الدورة الكاملة

### المسار A: دخول العميل والتسجيل والملف الشخصي

1. يبدأ المسار من `POST /api/app/login` أو `POST /api/app/register` أو المسار العام `POST /api/auth/otp/request` في `src/routes/appAuth.js` و`src/routes/auth.js`.
2. الدالتان `login` و`register` في `src/controllers/appAuthController.js` تتحققان من الهاتف والاسم والإيميل، ثم تستدعيان `requestOtpForPhone` في `src/services/otpService.js`.
3. خدمة `otpService` تنشئ أو تحدّث مستند `Otp` في `src/models/Otp.js` ثم ترسل الكود عبر `sendOtpWhatsapp` في `src/services/twilioWhatsappService.js`.
4. المستخدم يرسل الكود إلى `POST /api/app/verify` أو `POST /api/auth/otp/verify`، وكلاهما يصل إلى `verifyOtp` في `src/controllers/authController.js`.
5. الدالة `verifyOtp` تتحقق من `Otp`، وتنشئ أو تربط سجلات `AppUser` و`User`، وتطبق بيانات التسجيل المؤقتة إن وُجدت، ثم تصدر JWT عبر `issueAppAccessToken` في `src/services/appTokenService.js`.
6. إذا كان لدى `AppUser` رموز FCM محفوظة قبل وجود المستخدم الأساسي، تنقلها `verifyOtp` إلى سجل `User`.
7. ينتهي المسار بصدور Bearer Token يفتح المسارات المحمية مثل `GET /api/app/profile` و`PUT /api/app/profile` و`GET /api/app/subscriptions`.

### المسار B: شراء الاشتراك وتفعيله

1. غالبًا يبدأ المستخدم بقراءة `GET /api/subscriptions/menu` و`GET /api/plans` و`GET /api/popular_packages` و`GET /api/premium-meals` و`GET /api/addons` من `src/routes/subscriptions.js` و`src/routes/plans.js` و`src/routes/popularPackages.js` و`src/routes/premiumMeals.js` و`src/routes/addons.js`.
2. يبدأ التسعير عند `POST /api/subscriptions/quote` في `src/routes/subscriptions.js`، والذي يستدعي `quoteSubscription` في `src/controllers/subscriptionController.js`.
3. تستخدم `quoteSubscription` الدالة `resolveCheckoutQuoteOrThrow` في نفس الملف للتحقق من الباقة، وخيار الجرامات، وعدد الوجبات يوميًا، وخيار التوصيل، وتاريخ البداية، والوجبات البريميوم، والإضافات، ومنطقة التوصيل، والأسعار القادمة من الإعدادات.
4. يبدأ الـ Checkout عند `POST /api/subscriptions/checkout` الذي يستدعي `checkoutSubscription` في `src/controllers/subscriptionController.js`.
5. الدالة `checkoutSubscription` تتطلب عميلًا مسجل الدخول، وتطلب idempotency key، ثم تعيد بناء السعر، وتنشئ أو تعيد استخدام `CheckoutDraft` في `src/models/CheckoutDraft.js`، وتنشئ `Payment` في `src/models/Payment.js`، ثم تنشئ فاتورة Moyasar عبر `createInvoice` في `src/services/moyasarService.js`.
6. العميل يدفع على صفحة الفاتورة الخارجية الخاصة بـ Moyasar.
7. يعود الدفع إلى النظام بطريقتين: `POST /api/webhooks/moyasar` في `src/routes/webhooks.js` أو `POST /api/subscriptions/checkout-drafts/:draftId/verify-payment` في `src/routes/subscriptions.js`.
8. كلا المسارين ينتهيان بالتحقق من الدفع ثم استدعاء `applyPaymentSideEffects` في `src/services/paymentApplicationService.js`.
9. في حالة تفعيل الاشتراك، تستدعي الآثار الجانبية للدفع `applySubscriptionActivationPayment` و`src/services/subscriptionActivationService.js`، وهما ينشئان `Subscription` الحقيقي في `src/models/Subscription.js` وأيامه `SubscriptionDay` في `src/models/SubscriptionDay.js`.
10. تُعلَّم المسودة على أنها مكتملة، ويُعلَّم الدفع على أنه applied، وبعد ذلك تعيد مسارات مثل `GET /api/subscriptions` و`GET /api/subscriptions/:id` و`GET /api/subscriptions/:id/days` الاشتراك الحي.

### المسار C: تجديد الاشتراك

1. يبدأ مسار التجديد عند `GET /api/subscriptions/:id/renewal-seed` في `src/routes/subscriptions.js`.
2. الدالة `getSubscriptionRenewalSeed` في `src/controllers/subscriptionController.js` تقرأ الاشتراك الحالي وتعيد نسخة قابلة لإعادة الاستخدام من إعدادات الباقة والتوصيل والبريميوم والإضافات السابقة.
3. يرسل المستخدم `POST /api/subscriptions/:id/renew`، والذي يستدعي `renewSubscription` في نفس الـ Controller.
4. تقوم `renewSubscription` ببناء سعر جديد من الاشتراك السابق، ثم تنشئ `CheckoutDraft` للتجديد، وتنشئ `Payment`، ثم تنشئ فاتورة Moyasar.
5. بعد ذلك يُنهى الدفع بنفس مسارات الـ Webhook والتحقق المستخدمة في شراء الاشتراك لأول مرة.
6. ينتهي المسار عندما تنشئ الآثار الجانبية للدفع بيانات الاشتراك المجدد، ويظهر الاشتراك الجديد في مسارات قراءة الاشتراكات المعتادة.

### المسار D: تخطيط يوم الاشتراك والتجميد والتخطي والاستلام والإضافات

1. يقرأ العميل `GET /api/subscriptions/:id/days` أو `GET /api/subscriptions/:id/days/:date` أو `GET /api/subscriptions/:id/today` من `src/routes/subscriptions.js`.
2. يتم حفظ اختيار الوجبات اليومية عبر `PUT /api/subscriptions/:id/days/:date/selection` الذي يستدعي `updateDaySelection` في `src/controllers/subscriptionController.js`.
3. تتحقق `updateDaySelection` من أن اليوم يخص المستخدم، وما زال قابلًا للتعديل، ولم يتجاوز cutoff، ثم تحفظ اختيارات الوجبات العادية والبريميوم، وتعيد حساب استخدام المحفظة، وتعيد حساب ما إذا كانت هناك دفعة إضافية لازمة.
4. إذا كانت تكلفة الوجبات البريميوم المختارة أعلى من تغطية المحفظة، فإن `POST /api/subscriptions/:id/days/:date/premium-overage/payments` ينشئ دفعة، و`POST /api/subscriptions/:id/days/:date/premium-overage/payments/:paymentId/verify` يتحقق منها.
5. إذا أضيفت One-time Add-ons أثناء التخطيط، فإن `POST /api/subscriptions/:id/days/:date/one-time-addons/payments` ينشئ دفعة، و`POST /api/subscriptions/:id/days/:date/one-time-addons/payments/:paymentId/verify` يتحقق منها.
6. إذا كان canonical day planning مفعلًا، فإن `POST /api/subscriptions/:id/days/:date/confirm` يستدعي `confirmDayPlanning`، والتي تشترط تطابق عدد الوجبات مع الباقة، وأن تكون كل دفعات البريميوم والإضافات المدفوعة لمرة واحدة مسددة.
7. يمكن تعديل نفس اليوم أيضًا عبر `POST /api/subscriptions/:id/days/:date/skip` و`POST /api/subscriptions/:id/days/:date/unskip` و`POST /api/subscriptions/:id/skip-range` و`POST /api/subscriptions/:id/freeze` و`POST /api/subscriptions/:id/unfreeze` و`POST /api/subscriptions/:id/days/:date/pickup/prepare` و`PUT /api/subscriptions/:id/delivery` و`PUT /api/subscriptions/:id/days/:date/delivery`.
8. تبدأ الإضافات المخصصة ليوم الاشتراك عند `POST /api/subscriptions/:id/days/:date/custom-salad` و`POST /api/subscriptions/:id/days/:date/custom-meal`، وهما ينشئان دفعات إضافية لهذه العناصر الخاصة على مستوى اليوم.
9. ينتهي المسار عندما يصبح اليوم مجمدًا، أو متخطيًا، أو مؤكد التخطيط، أو مجهزًا للاستلام، أو تم تنفيذه عبر المطبخ أو المندوب، أو بقي يومًا مستقبليًا قابلًا للتعديل.

### المسار E: شحن محفظة الاشتراك واستهلاكها

1. يبدأ مسار المحفظة عند `GET /api/subscriptions/:id/wallet` أو `GET /api/subscriptions/:id/wallet/history`.
2. يبدأ الشحن عند `POST /api/subscriptions/:id/premium/topup` أو `POST /api/subscriptions/:id/premium-credits/topup` أو `POST /api/subscriptions/:id/addon-credits/topup`.
3. ينشئ الـ Controller سجل `Payment` وينشئ فاتورة Moyasar ثم يرجع رابط الدفع.
4. تُنهى الفاتورة عبر `POST /api/subscriptions/:id/wallet/topups/:paymentId/verify` أو عبر Webhook العام `POST /api/webhooks/moyasar`.
5. تضيف الآثار الجانبية للدفع رصيد بريميوم أو رصيد إضافات إلى بيانات المحفظة المخزنة على الاشتراك وسجل تاريخ المحفظة.
6. تُستهلك المحفظة لاحقًا عبر `POST /api/subscriptions/:id/premium-selections` و`DELETE /api/subscriptions/:id/premium-selections` و`POST /api/subscriptions/:id/addon-selections` و`DELETE /api/subscriptions/:id/addon-selections`، أو بشكل غير مباشر داخل `updateDaySelection`.
7. ينتهي المسار عندما يتغير رصيد المحفظة وتظهر القيمة الجديدة في قراءات التخطيط وتاريخ المحفظة.

### المسار F: شراء طلب فردي لمرة واحدة

1. يبدأ مسار الطلب عند `GET /api/orders/menu` في `src/routes/orders.js`، والذي يعيد قائمة الطلب من `getOrderMenu` في `src/controllers/menuController.js`.
2. يبدأ الـ Checkout عند `POST /api/orders/checkout` الذي يستدعي `checkoutOrder` في `src/controllers/orderController.js`.
3. تتحقق `checkoutOrder` من الوجبات المختارة، والعناصر المخصصة، ووضع التوصيل، والتاريخ، والمنطقة، والفترة الزمنية، والأسعار القادمة من الإعدادات.
4. إذا طلب العميل الغد بعد cutoff، فإن `checkoutOrder` يؤخر تاريخ التوصيل لليوم التالي له ويخزن هذا التاريخ المعدل على الطلب.
5. ينشئ الـ Controller سجل `Order` في `src/models/Order.js`، ثم `Payment`، ثم فاتورة Moyasar، ثم يرجع رابط الدفع.
6. طالما الطلب ما زال مفتوحًا وغير مدفوع، يمكن لـ `POST /api/orders/:id/items/custom-salad` و`POST /api/orders/:id/items/custom-meal` إضافة عناصر مخصصة وزيادة السعر المعلق.
7. يُنهى الدفع عبر `POST /api/orders/:id/verify-payment` أو عبر Webhook Moyasar العام.
8. بعد الدفع يصبح الطلب بيانات تشغيلية لمسارات المطبخ والمندوب. ويمكن للمستخدم أيضًا قراءة `GET /api/orders` و`GET /api/orders/:id` و`GET /api/orders/:id/payment-status` و`POST /api/orders/:id/reject-adjusted-date` و`DELETE /api/orders/:id` طالما أن الطلب ما زال قابلًا للإلغاء.
9. ينتهي المسار عندما يكمل المطبخ والمندوب تنفيذ الطلب أو عندما يُلغى الطلب.

### المسار G: دخول لوحة التحكم وعمل الأدمن

1. يبدأ مسار الأدمن عند `POST /api/dashboard/auth/login` في `src/routes/dashboardAuth.js`.
2. تتحقق `login` في `src/controllers/dashboardAuthController.js` من البريد وكلمة المرور مقابل `DashboardUser` في `src/models/DashboardUser.js`، وتطبق قواعد قفل تسجيل الدخول، ثم تصدر Dashboard JWT عبر `src/services/dashboardTokenService.js`.
3. يفتح هذا الـ Token مسارات `/api/admin/*` و`/api/dashboard/*` لأن كلا المسارين يستخدم نفس الـ Router الموجود في `src/routes/admin.js`.
4. بعد ذلك يستطيع الأدمن إدارة الباقات، والوجبات، والوجبات البريميوم، والإضافات، والتصنيفات، والمكونات، والإعدادات، والمستخدمين، والاشتراكات، والطلبات، والمدفوعات، ومستخدمي لوحة التحكم، والصور، والسجلات، والتقارير، وقطع اليومية يدويًا، عبر الدوال الموجودة في `src/controllers/adminController.js` وباقي Controllers الكتالوج الموصولين معه.
5. ينتهي المسار كلما قامت إحدى هذه الدوال بكتابة المستند المحدَّث وإرجاعه إلى لوحة التحكم.

### المسار H: تشغيل المطبخ

1. يبدأ هذا المسار بعد أن يسجل مستخدم المطبخ أو الأدمن الدخول عبر Dashboard Auth ويستدعي مسارات `src/routes/kitchen.js`.
2. يستدعي `GET /api/kitchen/days/:date` الدالة `listDailyOrders` في `src/controllers/kitchenController.js` ويعيد عبء العمل الخاص بأيام الاشتراكات لذلك التاريخ.
3. يستدعي `PUT /api/kitchen/subscriptions/:id/days/:date/assign` الدالة `assignMeals` لحفظ توزيع الوجبات على ذلك اليوم.
4. يقوم `POST /api/kitchen/days/:date/lock` بقفل كل أيام الاشتراك المفتوحة لذلك التاريخ ويحفظ Snapshot مقفولًا.
5. تنقل `POST /api/kitchen/subscriptions/:id/days/:date/lock` و`/reopen` و`/in-preparation` و`/out-for-delivery` و`/ready-for-pickup` و`/fulfill-pickup` أيام الاشتراك بين حالات المطبخ.
6. نفس الـ Router يدير أيضًا الطلبات الفردية عبر `GET /api/kitchen/orders/:date` ومسارات نقل حالة الطلب في `src/controllers/orderKitchenController.js`.
7. ينتهي المسار عندما تصبح أيام الاشتراك أو الطلبات الفردية مقفولة أو تحت التحضير أو جاهزة أو منفذة.

### المسار I: تشغيل المندوب

1. يبدأ هذا المسار بعد أن يسجل المندوب أو الأدمن الدخول عبر Dashboard Auth ويستدعي مسارات `src/routes/courier.js`.
2. يستدعي `GET /api/courier/deliveries/today` الدالة `listTodayDeliveries` في `src/controllers/courierController.js` ويعيد توصيلات الاشتراك الخاصة بهذا المندوب في ذلك اليوم.
3. تنقل `PUT /api/courier/deliveries/:id/arriving-soon` و`/delivered` و`/cancel` حالة التوصيل الخاص بالاشتراك وتحافظ على تزامن حالة `Delivery` و`SubscriptionDay`.
4. كما يعرض نفس الـ Router أيضًا `GET /api/courier/orders/today` ومسارات توصيل الطلبات الفردية في `src/controllers/orderCourierController.js`.
5. ينتهي المسار عندما يحدد المندوب أن التوصيل تم أو ألغي، وتتحدث حالة اليوم أو الطلب.

### المسار J: Webhook Moyasar والتحقق المباشر من الدفع

1. يبدأ هذا المسار إما من `POST /api/webhooks/moyasar` في `src/routes/webhooks.js` أو من إحدى نقاط التحقق المباشر المرتبطة بالاشتراكات أو شحن المحفظة أو زيادة البريميوم أو الإضافات أو الطلبات.
2. تتحقق `handleMoyasarWebhook` في `src/controllers/webhookController.js` من سر الـ Webhook، ثم تبحث عن `Payment` الموجود مسبقًا، وترفض المراجع غير المعروفة، وتتحقق من المبلغ والعملة.
3. يقوم الـ Controller بتحديث حالة `Payment` المحلية ويمنع تنفيذ الآثار الجانبية مرتين إذا كان الدفع قد طُبق بالفعل.
4. إذا كانت الحالة مدفوعة، يستدعي `applyPaymentSideEffects` في `src/services/paymentApplicationService.js`.
5. تقوم الآثار الجانبية للدفع بتفعيل الاشتراكات، أو شحن المحفظة، أو ربط الإضافات المخصصة، أو تسوية زيادة البريميوم، أو تحديث الطلبات الفردية حسب `payment.type`.
6. إذا كانت الحالة failed أو canceled أو expired، يقوم الـ Webhook أيضًا بتعليم المسودات أو الطلبات المرتبطة على أنها فشلت أو ألغيت.
7. ينتهي المسار عندما تصبح حالة الدفع نهائية، ويتم تحديث السجل التجاري المستهدف.

### المسار K: الأتمتة الخلفية والإشعارات

1. هذا المسار لا يبدأ من HTTP Request. بل يبدأ في `startJobs` داخل `src/jobs/index.js` عند تشغيل السيرفر.
2. كل دقيقة، تشغّل الحلقة الخلفية `processDueDeliveryArrivingSoon`، ثم تتحقق مما إذا كان وقت cutoff قد وصل، ثم تتحقق مما إذا كانت أوقات التذكير اليومية قد وصلت.
3. تقوم `processDailyCutoff` في `src/services/automationService.js` بالتنفيذ مرة واحدة يوميًا بتوقيت السعودية بعد وقت cutoff المعرّف.
4. تنشئ `processDailyMealSelectionReminders` و`processSubscriptionExpiryReminders` في `src/services/notificationSchedulerService.js` تذكيرات لاختيار وجبات الغد وتذكيرات قرب انتهاء الاشتراك.
5. تُرسل الإشعارات عبر Firebase في `src/utils/notify.js`، ويجري منع التكرار في `src/services/notificationService.js`، وتُسجل في `src/models/NotificationLog.js`.
6. ينتهي المسار عندما تُكتب الإشعارات وتُرسل، أو عندما تنتهي عملية cutoff اليومية.

## 3. كل Feature موجودة فعليًا الآن

القائمة التالية تغطي سطح المزايا المنفذة فعليًا في الـ Backend النشط.

### مزايا المنصة والـ API المشتركة

| الميزة | ماذا تفعل | مكانها | ما الذي يشغلها | ماذا تنتج أو تغيّر |
| --- | --- | --- | --- | --- |
| نقطة الجذر | تعيد استجابة بسيطة تفيد أن الـ Backend يعمل | `src/app.js -> createApp` | `GET /` | استجابة JSON للفحص السريع |
| فحص الصحة | يفحص اتصال Mongo ويعمل ping على قاعدة البيانات | `src/app.js -> createApp` | `GET /health` | استجابة 200 أو 503 |
| Swagger docs | يعرض واجهتي Swagger وملفات YAML الخام | `src/app.js -> mountSwaggerUi` | `GET /api-docs`, `GET /subscriptions-api-docs` | صفحات توثيق API |
| تحديد اللغة | يختار العربية أو الإنجليزية في الردود | `src/middleware/requestLanguage.js` | أي طلب `/api/*` | اختيار نصوص مترجمة في كثير من الردود |
| Rate limiting | يحد من OTP والتحقق والـ checkout ودخول لوحة التحكم | `src/middleware/rateLimit.js` | المسارات المطابقة | رفض الطلبات الزائدة |
| التحقق من البيئة عند التشغيل | يوقف التشغيل إذا كانت متغيرات البيئة المطلوبة ناقصة | `src/utils/validateEnv.js`, `src/index.js` | تشغيل السيرفر | خروج السيرفر عند نقص البيئة |
| بدء Mongo وفحص فهارس الدفع | يصل بـ Mongo ويتأكد من فهارس `Payment` | `src/db.js -> connectDb` | تشغيل السيرفر | اتصال قاعدة البيانات وفهارس الدفع |
| Seed لمستخدمي لوحة التحكم الافتراضيين | يتأكد من وجود مستخدمي Dashboard الافتراضيين | `src/services/dashboardDefaultUsersService.js` | تشغيل السيرفر | إنشاء أو تحديث حسابات Dashboard |

### مزايا دخول العميل والملف الشخصي

| الميزة | ماذا تفعل | مكانها | ما الذي يشغلها | ماذا تنتج أو تغيّر |
| --- | --- | --- | --- | --- |
| طلب OTP للدخول من التطبيق | يرسل OTP لرقم موجود أو جديد | `src/controllers/appAuthController.js -> login` | `POST /api/app/login` | سجل `Otp` ورسالة واتساب |
| طلب OTP للتسجيل من التطبيق | يرسل OTP ويحفظ الاسم والإيميل مؤقتًا | `src/controllers/appAuthController.js -> register` | `POST /api/app/register` | سجل `Otp` مع بيانات مؤقتة |
| طلب OTP العام | يرسل OTP بدون تغليف خاص بالتطبيق | `src/controllers/authController.js -> requestOtp` | `POST /api/auth/otp/request` | سجل `Otp` ورسالة واتساب |
| التحقق من OTP | يتحقق من الكود وينشئ أو يربط المستخدم الحقيقي | `src/controllers/authController.js -> verifyOtp` | `POST /api/app/verify`, `POST /api/auth/otp/verify` | `User` و`AppUser` وJWT |
| قراءة الملف الشخصي للعميل | يعيد ملف العميل المسجل | `src/controllers/appAuthController.js -> getProfile` | `GET /api/app/profile` | بيانات `User` مبسطة |
| تحديث الملف الشخصي للعميل | يحدّث الاسم أو الإيميل أو كليهما | `src/controllers/appAuthController.js -> updateProfile` | `PUT /api/app/profile` | تحديث `User` و`AppUser` المرتبط |
| إضافة Device Token | يحفظ FCM token للإشعارات | `src/controllers/authController.js -> updateDeviceToken` | `POST /api/auth/device-token` | تحديث `User.fcmTokens` |
| حذف Device Token | يزيل FCM token | `src/controllers/authController.js -> deleteDeviceToken` | `DELETE /api/auth/device-token` | تنظيف التوكن من `User` و`AppUser` |
| Middleware حماية العميل | يحمي المسارات الخاصة بالعميل | `src/middleware/auth.js -> authMiddleware` | أي Route عميل محمي | يملأ `req.userId` ودور العميل |

### مزايا الكتالوج والقوائم العامة

| الميزة | ماذا تفعل | مكانها | ما الذي يشغلها | ماذا تنتج أو تغيّر |
| --- | --- | --- | --- | --- |
| قائمة الاشتراكات | تعيد الباقات والوجبات والوجبات البريميوم والإضافات وخيارات التوصيل وإشارات الـ checkout | `src/controllers/menuController.js -> getSubscriptionMenu` | `GET /api/subscriptions/menu` | Payload موحد لقائمة الاشتراكات |
| قائمة الطلب الفردي | تعيد الوجبات القابلة للطلب ودعم العناصر المخصصة | `src/controllers/menuController.js -> getOrderMenu` | `GET /api/orders/menu` | Payload موحد لقائمة الطلب |
| خيارات التوصيل | تعيد المناطق والفترات ونقاط الاستلام | `src/controllers/menuController.js -> getDeliveryOptions` | `GET /api/subscriptions/delivery-options` | كتالوج التوصيل |
| قائمة الباقات وتفاصيلها | تعيد الباقات النشطة | `src/controllers/planController.js` | `GET /api/plans`, `GET /api/plans/:id` | بيانات الباقات |
| الباقات الشائعة | تعيد أول 3 باقات نشطة باستخدام أول خيار جرامات/وجبات نشط | `src/controllers/popularPackageController.js -> listPopularPackages` | `GET /api/popular_packages` | بطاقات باقات مبسطة |
| كتالوج الوجبات | يعيد الوجبات العادية النشطة | `src/controllers/mealController.js` | `GET /api/meals` | قائمة وجبات |
| كتالوج الوجبات البريميوم | يعيد الوجبات البريميوم النشطة | `src/controllers/premiumMealController.js` | `GET /api/premium-meals` | قائمة بريميوم |
| كتالوج الإضافات | يعيد الإضافات النشطة | `src/controllers/addonController.js` | `GET /api/addons` | قائمة إضافات |
| كتالوج مكونات السلطة | يعيد مكونات السلطة النشطة | `src/controllers/saladIngredientController.js` | `GET /api/salad-ingredients` | قائمة مكونات |
| كتالوج مكونات الوجبة المخصصة | يعيد مكونات الوجبة المخصصة النشطة | `src/controllers/mealIngredientController.js` | `GET /api/meal-ingredients` | قائمة مكونات |
| معاينة سعر السلطة المخصصة | يحسب سعر سلطة مخصصة لعميل مسجل | `src/controllers/customSaladController.js -> previewCustomSaladPrice` | `POST /api/custom-salads/price` | سعر وSnapshot للعناصر |
| معاينة سعر الوجبة المخصصة | يحسب سعر وجبة مخصصة لعميل مسجل | `src/controllers/customMealController.js -> previewCustomMealPrice` | `POST /api/custom-meals/price` | سعر وSnapshot للعناصر |
| قراءة الإعدادات العامة | تعيد الإعدادات الحالية مع القيم الافتراضية | `src/controllers/settingsController.js -> getSettings` | `GET /api/settings` | Payload الإعدادات |

### مزايا الاشتراك

| الميزة | ماذا تفعل | مكانها | ما الذي يشغلها | ماذا تنتج أو تغيّر |
| --- | --- | --- | --- | --- |
| تسعير الاشتراك | يحسب سعر الاشتراك قبل الـ checkout | `src/controllers/subscriptionController.js -> quoteSubscription` | `POST /api/subscriptions/quote` | تفصيل الأسعار |
| Checkout الاشتراك | ينشئ مسودة checkout والدفع والفاتورة | `src/controllers/subscriptionController.js -> checkoutSubscription` | `POST /api/subscriptions/checkout` | `CheckoutDraft` و`Payment` ورابط فاتورة |
| قراءة مسودة checkout | يعيد حالة checkout المعلق | `src/controllers/subscriptionController.js -> getCheckoutDraftStatus` | `GET /api/subscriptions/checkout-drafts/:draftId` | حالة المسودة |
| التحقق من دفع مسودة الاشتراك | يتحقق من دفع الاشتراك مباشرة من Moyasar | `src/controllers/subscriptionController.js -> verifyCheckoutDraftPayment` | `POST /api/subscriptions/checkout-drafts/:draftId/verify-payment` | يطبق آثار الدفع إذا نجح |
| تفعيل اشتراك Mock في غير الإنتاج | يعلّم الاشتراك active بدون دفع حقيقي خارج الإنتاج | `src/controllers/subscriptionController.js -> activateSubscription` | `POST /api/subscriptions/:id/activate` خارج الإنتاج | نتيجة تفعيل تجريبية |
| قائمة اشتراكات العميل | تعيد اشتراكات المستخدم الحالي | `src/controllers/subscriptionController.js -> listCurrentUserSubscriptions` | `GET /api/subscriptions`, `GET /api/app/subscriptions` | قائمة اشتراكات |
| تفاصيل الاشتراك | يعيد اشتراكًا واحدًا | `src/controllers/subscriptionController.js -> getSubscription` | `GET /api/subscriptions/:id` | بيانات الاشتراك |
| نظرة عامة على الاشتراك الحالي | تعيد أحدث اشتراك active أو pending | `src/controllers/subscriptionController.js -> getCurrentSubscriptionOverview` | `GET /api/subscriptions/current/overview` | Payload مختصر أو `null` |
| Seed للتجديد | يعيد إعدادات قابلة لإعادة الاستخدام من الاشتراك القديم | `src/controllers/subscriptionController.js -> getSubscriptionRenewalSeed` | `GET /api/subscriptions/:id/renewal-seed` | Payload للتجديد |
| Checkout تجديد الاشتراك | ينشئ مسار دفع للتجديد | `src/controllers/subscriptionController.js -> renewSubscription` | `POST /api/subscriptions/:id/renew` | `CheckoutDraft` و`Payment` وفاتورة |
| Metadata لعمليات الاشتراك | يخبر التطبيق بما هو مسموح الآن | `src/controllers/subscriptionController.js -> getSubscriptionOperationsMeta` | `GET /api/subscriptions/:id/operations-meta` | بيانات السماح أو المنع للإلغاء والتجميد والتخطي والتوصيل ووسائل الدفع |
| معاينة التجميد | يوضح ما الذي سيحدث قبل تنفيذ التجميد | `src/controllers/subscriptionController.js -> getSubscriptionFreezePreview` | `GET /api/subscriptions/:id/freeze-preview` | Payload معاينة |
| إلغاء الاشتراك | يلغي اشتراكًا active أو pending_payment | `src/controllers/subscriptionController.js -> cancelSubscription` | `POST /api/subscriptions/:id/cancel` | تحديث حالة الاشتراك |
| Timeline الاشتراك | يعيد خطًا زمنيًا يوميًا يشمل الامتدادات الناتجة من التجميد | `src/controllers/subscriptionController.js -> getSubscriptionTimeline` | `GET /api/subscriptions/:id/timeline` | Payload خط زمني |
| نقطة وسائل الدفع | تعلن صراحة أن وسائل الدفع المحفوظة غير مدعومة | `src/controllers/subscriptionController.js -> getSubscriptionPaymentMethods` | `GET /api/subscriptions/payment-methods` | Payload ثابت بعدم الدعم |
| قراءة المحفظة | تعيد أرصدة محفظة الاشتراك | `src/controllers/subscriptionController.js -> getSubscriptionWallet` | `GET /api/subscriptions/:id/wallet` | Payload المحفظة |
| قراءة تاريخ المحفظة | تعيد سجل عمليات المحفظة | `src/controllers/subscriptionController.js -> getSubscriptionWalletHistory` | `GET /api/subscriptions/:id/wallet/history` | Payload التاريخ |
| قراءة حالة شحن المحفظة | تعيد حالة دفعة شحن المحفظة | `src/controllers/subscriptionController.js -> getWalletTopupPaymentStatus` | `GET /api/subscriptions/:id/wallet/topups/:paymentId/status` | حالة الدفع |
| التحقق من شحن المحفظة | يتحقق من شحن المحفظة مباشرة | `src/controllers/subscriptionController.js -> verifyWalletTopupPayment` | `POST /api/subscriptions/:id/wallet/topups/:paymentId/verify` | يضيف الرصيد إذا نجح الدفع |
| شحن بريميوم قديم | يشحن رصيد البريميوم القديم القائم على العدد | `src/controllers/subscriptionController.js -> topupPremium` | `POST /api/subscriptions/:id/premium/topup` | `Payment` + رصيد بريميوم قديم |
| شحن رصيد بريميوم | يشحن رصيد محفظة البريميوم | `src/controllers/subscriptionController.js -> topupPremiumCredits` | `POST /api/subscriptions/:id/premium-credits/topup` | `Payment` + رصيد بريميوم |
| شحن رصيد إضافات | يشحن رصيد محفظة الإضافات | `src/controllers/subscriptionController.js -> topupAddonCredits` | `POST /api/subscriptions/:id/addon-credits/topup` | `Payment` + رصيد إضافات |
| قائمة أيام الاشتراك | تعيد كل أيام الاشتراك | `src/controllers/subscriptionController.js -> getSubscriptionDays` | `GET /api/subscriptions/:id/days` | قائمة الأيام |
| تفاصيل يوم اشتراك | يعيد يومًا واحدًا | `src/controllers/subscriptionController.js -> getSubscriptionDay` | `GET /api/subscriptions/:id/days/:date` | بيانات اليوم |
| عرض اليوم الحالي | يعيد بيانات يوم اليوم | `src/controllers/subscriptionController.js -> getSubscriptionToday` | `GET /api/subscriptions/:id/today` | Payload اليوم |
| تحديث اختيار اليوم | يحفظ الوجبات العادية والبريميوم ليوم معين | `src/controllers/subscriptionController.js -> updateDaySelection` | `PUT /api/subscriptions/:id/days/:date/selection` | تحديث `SubscriptionDay` واستخدام المحفظة وحالة الدفع |
| تأكيد تخطيط اليوم | يثبت تخطيط اليوم في وضع canonical | `src/controllers/subscriptionController.js -> confirmDayPlanning` | `POST /api/subscriptions/:id/days/:date/confirm` | حالة تأكيد التخطيط |
| إنشاء دفعة زيادة بريميوم لليوم | ينشئ دفعة لفرق سعر البريميوم في يوم واحد | `src/controllers/subscriptionController.js -> createPremiumOverageDayPayment` | `POST /api/subscriptions/:id/days/:date/premium-overage/payments` | `Payment` + فاتورة |
| التحقق من دفعة زيادة بريميوم | يتحقق من دفعة فرق البريميوم | `src/controllers/subscriptionController.js -> verifyPremiumOverageDayPayment` | `POST /api/subscriptions/:id/days/:date/premium-overage/payments/:paymentId/verify` | يعلّم الزيادة على أنها مدفوعة |
| إنشاء دفعة إضافات لمرة واحدة أثناء التخطيط | ينشئ دفعة للإضافات المؤقتة أثناء التخطيط | `src/controllers/subscriptionController.js -> createOneTimeAddonDayPlanningPayment` | `POST /api/subscriptions/:id/days/:date/one-time-addons/payments` | `Payment` + فاتورة |
| التحقق من دفعة إضافات اليوم | يتحقق من دفعة الإضافات المؤقتة | `src/controllers/subscriptionController.js -> verifyOneTimeAddonDayPlanningPayment` | `POST /api/subscriptions/:id/days/:date/one-time-addons/payments/:paymentId/verify` | يعلّم دفعة الإضافات على أنها مدفوعة |
| تخطي يوم واحد | يعلّم يومًا على أنه skipped | `src/controllers/subscriptionController.js -> skipDay` | `POST /api/subscriptions/:id/days/:date/skip` | تحديث حالة `SubscriptionDay` |
| إلغاء تخطي يوم | يعيد فتح يوم skipped إذا كان مسموحًا | `src/controllers/subscriptionController.js -> unskipDay` | `POST /api/subscriptions/:id/days/:date/unskip` | إعادة فتح `SubscriptionDay` |
| تخطي مجموعة أيام | يتخطى عدة أيام بدءًا من تاريخ واحد | `src/controllers/subscriptionController.js -> skipRange` | `POST /api/subscriptions/:id/skip-range` | تحديث عدة أيام |
| تجميد الاشتراك | يعلّم أيامًا على أنها frozen ويمد `validityEndDate` | `src/controllers/subscriptionController.js -> freezeSubscription` | `POST /api/subscriptions/:id/freeze` | أيام مجمدة ونهاية صلاحية جديدة |
| فك تجميد الاشتراك | يعيد الأيام المجمدة إذا كان ذلك مسموحًا | `src/controllers/subscriptionController.js -> unfreezeSubscription` | `POST /api/subscriptions/:id/unfreeze` | أيام مفكوكة التجميد ومزامنة الصلاحية |
| تجهيز الاستلام | يقفل يوم الاستلام ويستهلك الرصيد فورًا | `src/controllers/subscriptionController.js -> preparePickup` | `POST /api/subscriptions/:id/days/:date/pickup/prepare` | حالة يوم جاهز للاستلام |
| تحديث توصيل الاشتراك الافتراضي | يحدّث عنوان أو فترة التوصيل الافتراضية | `src/controllers/subscriptionController.js -> updateDeliveryDetails` | `PUT /api/subscriptions/:id/delivery` | بيانات التوصيل الافتراضية |
| Override لتوصيل يوم واحد | يحدّث تفاصيل التوصيل ليوم محدد | `src/controllers/subscriptionController.js -> updateDeliveryDetailsForDate` | `PUT /api/subscriptions/:id/days/:date/delivery` | Override على مستوى اليوم |
| استهلاك اختيار بريميوم مباشرة | يستهلك رصيد بريميوم لاختيار يوم | `src/controllers/subscriptionController.js -> consumePremiumSelection` | `POST /api/subscriptions/:id/premium-selections` | استخدام محفظة + تحديث اليوم |
| إزالة اختيار بريميوم مباشرة | يرد رصيد اختيار بريميوم تم استهلاكه سابقًا | `src/controllers/subscriptionController.js -> removePremiumSelection` | `DELETE /api/subscriptions/:id/premium-selections` | استرجاع محفظة + تحديث اليوم |
| استهلاك اختيار إضافة مباشرة | يستهلك رصيد إضافة لاختيار يوم | `src/controllers/subscriptionController.js -> consumeAddonSelection` | `POST /api/subscriptions/:id/addon-selections` | استخدام محفظة + تحديث اليوم |
| إزالة اختيار إضافة مباشرة | يرد رصيد إضافة تم استهلاكه سابقًا | `src/controllers/subscriptionController.js -> removeAddonSelection` | `DELETE /api/subscriptions/:id/addon-selections` | استرجاع محفظة + تحديث اليوم |
| شراء إضافة لمرة واحدة ليوم | ينشئ دفعة مستقلة لإضافة في يوم مستقبلي | `src/controllers/subscriptionController.js -> addOneTimeAddon` | `POST /api/subscriptions/:id/addons/one-time` | `Payment` + نية إضافة ليوم مستقبلي |
| شراء سلطة مخصصة ليوم اشتراك | ينشئ سلطة مخصصة مرتبطة بدفعة ليوم واحد | `src/controllers/customSaladController.js -> addCustomSaladToSubscriptionDay` | `POST /api/subscriptions/:id/days/:date/custom-salad` | `Payment` + Snapshot سلطة مخصصة |
| شراء وجبة مخصصة ليوم اشتراك | ينشئ وجبة مخصصة مرتبطة بدفعة ليوم واحد | `src/controllers/customMealController.js -> addCustomMealToSubscriptionDay` | `POST /api/subscriptions/:id/days/:date/custom-meal` | `Payment` + Snapshot وجبة مخصصة |

### مزايا الطلبات الفردية

| الميزة | ماذا تفعل | مكانها | ما الذي يشغلها | ماذا تنتج أو تغيّر |
| --- | --- | --- | --- | --- |
| Checkout الطلب الفردي | ينشئ الطلب والدفع والفاتورة | `src/controllers/orderController.js -> checkoutOrder` | `POST /api/orders/checkout` | `Order` و`Payment` ورابط الفاتورة |
| تأكيد طلب Mock في غير الإنتاج | يعلّم الطلب مدفوعًا بدون مزود دفع خارج الإنتاج | `src/controllers/orderController.js -> confirmOrder` | `POST /api/orders/:id/confirm` خارج الإنتاج | تأكيد تجريبي |
| قراءة حالة دفع الطلب | تعيد حالة الدفع المسجلة على الطلب | `src/controllers/orderController.js -> getOrderPaymentStatus` | `GET /api/orders/:id/payment-status` | Payload حالة الدفع |
| التحقق من دفع الطلب | يتحقق من دفع الطلب مباشرة من Moyasar | `src/controllers/orderController.js -> verifyOrderPayment` | `POST /api/orders/:id/verify-payment` | يعلّم الطلب مدفوعًا إذا نجح |
| رفض التاريخ المعدل | يلغي طلبًا غير مدفوع تم تأجيله بعد cutoff | `src/controllers/orderController.js -> rejectAdjustedDeliveryDate` | `POST /api/orders/:id/reject-adjusted-date` | إلغاء الطلب |
| إضافة سلطة مخصصة إلى الطلب | تضيف سلطة مخصصة إلى طلب مفتوح وغير مدفوع | `src/controllers/customSaladController.js -> addCustomSaladToOrder` | `POST /api/orders/:id/items/custom-salad` | تحديث عناصر الطلب ومبلغه |
| إضافة وجبة مخصصة إلى الطلب | تضيف وجبة مخصصة إلى طلب مفتوح وغير مدفوع | `src/controllers/customMealController.js -> addCustomMealToOrder` | `POST /api/orders/:id/items/custom-meal` | تحديث عناصر الطلب ومبلغه |
| قائمة طلبات العميل | تعيد طلبات المستخدم الحالية | `src/controllers/orderController.js -> listOrders` | `GET /api/orders` | قائمة طلبات |
| تفاصيل طلب واحد | يعيد طلبًا واحدًا | `src/controllers/orderController.js -> getOrder` | `GET /api/orders/:id` | بيانات الطلب |
| إلغاء الطلب من العميل | يلغي الطلب قبل بدء التحضير | `src/controllers/orderController.js -> cancelOrder` | `DELETE /api/orders/:id` | تحديث حالة الطلب |

### مزايا دخول لوحة التحكم والأدمن

| الميزة | ماذا تفعل | مكانها | ما الذي يشغلها | ماذا تنتج أو تغيّر |
| --- | --- | --- | --- | --- |
| دخول لوحة التحكم | يصادق موظفًا عبر الإيميل وكلمة المرور | `src/controllers/dashboardAuthController.js -> login` | `POST /api/dashboard/auth/login` | Dashboard JWT وتحديثات lockout |
| قراءة المستخدم الحالي للوحة | تعيد بيانات مستخدم اللوحة إذا كان مسجلًا | `src/controllers/dashboardAuthController.js -> me` | `GET /api/dashboard/auth/me` | Payload مستخدم اللوحة |
| تسجيل خروج اللوحة | Route خروج بدون حالة محفوظة | `src/controllers/dashboardAuthController.js -> logout` | `POST /api/dashboard/auth/logout` | استجابة نجاح بسيطة |
| نظرة عامة للوحة | تعيد إحصاءات عامة للوحة | `src/controllers/adminController.js -> getDashboardOverview` | `GET /api/admin/overview` | Payload النظرة العامة |
| بحث اللوحة | يبحث عبر بيانات اللوحة | `src/controllers/adminController.js -> searchDashboard` | `GET /api/admin/search` | نتائج بحث |
| ملخص الإشعارات | يعيد إحصاءات إشعارات للوحة | `src/controllers/adminController.js -> getDashboardNotificationSummary` | `GET /api/admin/notifications/summary` | Payload ملخص |
| تقرير اليوم | يعيد بيانات تقرير اليوم | `src/controllers/adminController.js -> getTodayReport` | `GET /api/admin/reports/today` | Payload تقرير |
| رفع صورة للأدمن | يرفع الصور إلى Cloudinary | `src/controllers/uploadController.js -> uploadAdminImage` | `POST /api/admin/uploads/image` | بيانات الرابط المرفوع |
| CRUD الباقات للأدمن | ينشئ ويقرأ ويحدث ويحذف الباقات | `src/controllers/adminController.js` | مسارات `/api/admin/plans*` | تغيير مستندات `Plan` |
| إدارة صفوف الجرامات داخل الباقة | ينشئ ويستنسخ ويحذف ويفعل ويرتب صفوف الجرامات | `src/controllers/adminController.js` | مسارات `/api/admin/plans/:id/grams*` | تعديل تسعير الباقة المتداخل |
| إدارة خيارات الوجبات داخل الجرامات | ينشئ ويستنسخ ويحذف ويفعل ويرتب خيارات الوجبات | `src/controllers/adminController.js` | مسارات `/api/admin/plans/:id/grams/:grams/meals*` | تعديل تسعير الباقة المتداخل |
| CRUD الوجبات البريميوم للأدمن | يدير كتالوج الوجبات البريميوم | `src/controllers/premiumMealController.js` | مسارات `/api/admin/premium-meals*` | تغيير مستندات `PremiumMeal` |
| CRUD الإضافات للأدمن | يدير كتالوج الإضافات | `src/controllers/addonController.js` | مسارات `/api/admin/addons*` | تغيير مستندات `Addon` |
| CRUD تصنيفات الوجبات للأدمن | يدير تصنيفات الوجبات | `src/controllers/mealCategoryController.js` | مسارات `/api/admin/meal-categories*` | تغيير مستندات `MealCategory` |
| CRUD الوجبات للأدمن | يدير الوجبات العادية | `src/controllers/mealController.js` | مسارات `/api/admin/meals*` | تغيير مستندات `Meal` |
| CRUD مكونات السلطة للأدمن | يدير مكونات السلطة | `src/controllers/saladIngredientController.js` | مسارات `/api/admin/salad-ingredients*` | تغيير مستندات `SaladIngredient` |
| CRUD مكونات الوجبة المخصصة للأدمن | يدير مكونات الوجبات المخصصة | `src/controllers/mealIngredientController.js` | مسارات `/api/admin/meal-ingredients*` | تغيير مستندات `MealIngredient` |
| Patch عام للإعدادات | يحدّث عدة إعدادات في طلب واحد | `src/controllers/adminController.js -> patchSettings` | `PATCH /api/admin/settings` | تغيير مستندات `Setting` |
| تحديث cutoff | يحدّث وقت cutoff | `src/controllers/adminController.js -> updateCutoff` | `PUT /api/admin/settings/cutoff` | تغيير `Setting` |
| تحديث فترات التوصيل | يحدّث delivery windows | `src/controllers/adminController.js -> updateDeliveryWindows` | `PUT /api/admin/settings/delivery-windows` | تغيير `Setting` |
| تحديث سماحية التخطي | يحدّث عدد الأيام المسموح بتخطيها | `src/controllers/adminController.js -> updateSkipAllowance` | `PUT /api/admin/settings/skip-allowance` | تغيير `Setting` |
| تحديث سعر البريميوم | يحدّث إعداد سعر البريميوم | `src/controllers/adminController.js -> updatePremiumPrice` | `PUT /api/admin/settings/premium-price` | تغيير `Setting` |
| تحديث رسوم توصيل الاشتراك | يحدّث رسوم توصيل الاشتراك | `src/controllers/adminController.js -> updateSubscriptionDeliveryFee` | `PUT /api/admin/settings/subscription-delivery-fee` | تغيير `Setting` |
| تحديث نسبة الضريبة | يحدّث VAT | `src/controllers/adminController.js -> updateVatPercentage` | `PUT /api/admin/settings/vat-percentage` | تغيير `Setting` |
| تحديث السعر الأساسي للسلطة المخصصة | يحدّث base price الخاص بالسلطة المخصصة | `src/controllers/adminController.js -> updateCustomSaladBasePrice` | `PUT /api/admin/settings/custom-salad-base-price` | تغيير `Setting` |
| تحديث السعر الأساسي للوجبة المخصصة | يحدّث base price الخاص بالوجبة المخصصة | `src/controllers/adminController.js -> updateCustomMealBasePrice` | `PUT /api/admin/settings/custom-meal-base-price` | تغيير `Setting` |
| إدارة مستخدمي التطبيق من الأدمن | يعرض وينشئ ويقرأ ويحدث مستخدمي العميل | `src/controllers/adminController.js` | مسارات `/api/admin/users*` | تغيير `User` وبيانات العميل المرتبطة |
| عرض اشتراكات مستخدم معين | يقرأ اشتراكات مستخدم واحد | `src/controllers/adminController.js -> listAppUserSubscriptions` | `GET /api/admin/users/:id/subscriptions` | قائمة اشتراكات |
| عرض أو تصدير الاشتراكات للأدمن | يقرأ البيانات التشغيلية للاشتراكات | `src/controllers/adminController.js` | مسارات القراءة `/api/admin/subscriptions*` | Payload أو Export للاشتراكات |
| إنشاء اشتراك من الأدمن | ينشئ اشتراكًا مباشرة من لوحة التحكم بدون دفع العميل | `src/controllers/adminController.js -> createSubscriptionAdmin` | `POST /api/admin/subscriptions` | بيانات `Subscription` و`SubscriptionDay` |
| عمليات الأدمن على الاشتراك | ينفذ الإلغاء والتمديد والتجميد وفك التجميد والتخطي وإلغاء التخطي | `src/controllers/adminController.js` | مسارات `/api/admin/subscriptions/*` المطابقة | تغيير حالة الاشتراك أو اليوم |
| عرض الطلبات للأدمن | يقرأ الطلبات الفردية من اللوحة | `src/controllers/adminController.js` | مسارات `/api/admin/orders*` | Payload الطلبات |
| عرض والتحقق من المدفوعات للأدمن | يقرأ المدفوعات ويتحقق منها | `src/controllers/adminController.js` | مسارات `/api/admin/payments*` | حالة الدفع وآثاره |
| CRUD مستخدمي لوحة التحكم | يدير حسابات اللوحة | `src/controllers/adminController.js` | مسارات `/api/admin/dashboard-users*` | تغيير مستندات `DashboardUser` |
| إعادة ضبط كلمة مرور مستخدم لوحة | يعيد ضبط كلمة مرور مستخدم Dashboard | `src/controllers/adminController.js -> resetDashboardUserPassword` | `POST /api/admin/dashboard-users/:id/reset-password` | تحديث بيانات الدخول |
| قراءة سجل النشاط | يعرض Activity Logs | `src/controllers/adminController.js -> listActivityLogs` | `GET /api/admin/logs` | Payload السجل |
| قراءة سجل الإشعارات | يعرض Notification Logs | `src/controllers/adminController.js -> listNotificationLogs` | `GET /api/admin/notification-logs` | Payload السجل |
| تشغيل cutoff يدويًا | يشغّل عملية cutoff اليومية يدويًا | `src/controllers/adminController.js -> triggerDailyCutoff` | `POST /api/admin/trigger-cutoff` | تشغيل الأتمتة اليومية |

### مزايا المطبخ والمندوب

| الميزة | ماذا تفعل | مكانها | ما الذي يشغلها | ماذا تنتج أو تغيّر |
| --- | --- | --- | --- | --- |
| عبء عمل الاشتراكات اليومي للمطبخ | يعرض أيام الاشتراك الخاصة بتاريخ إنتاج معين | `src/controllers/kitchenController.js -> listDailyOrders` | `GET /api/kitchen/days/:date` | Payload عبء العمل |
| القفل الجماعي للمطبخ | يقفل كل الأيام المفتوحة لتاريخ معين | `src/controllers/kitchenController.js -> bulkLockDaysByDate` | `POST /api/kitchen/days/:date/lock` | Snapshots مقفولة للأيام |
| توزيع الوجبات للمطبخ | يحفظ الوجبات المعينة ليوم معين | `src/controllers/kitchenController.js -> assignMeals` | `PUT /api/kitchen/subscriptions/:id/days/:date/assign` | بيانات توزيع اليوم |
| نقل حالات يوم الاشتراك في المطبخ | ينقل يوم الاشتراك بين lock وreopen والتحضير والتوصيل والاستلام | `src/controllers/kitchenController.js` | مسارات `/api/kitchen/subscriptions/:id/days/:date/*` المطابقة | تغييرات في حالة اليوم |
| تنفيذ الاستلام في المطبخ | يكمل يوم استلام | `src/controllers/kitchenController.js -> fulfillPickup` | `POST /api/kitchen/subscriptions/:id/days/:date/fulfill-pickup` | `SubscriptionDay` منفذ |
| قائمة الطلبات الفردية للمطبخ | تعرض الطلبات الفردية حسب التاريخ | `src/controllers/orderKitchenController.js -> listOrdersByDate` | `GET /api/kitchen/orders/:date` | Payload عبء الطلبات |
| نقل حالات الطلب الفردي في المطبخ | ينقل الطلبات الفردية بين حالات المطبخ | `src/controllers/orderKitchenController.js -> transitionOrder` | مسارات `/api/kitchen/orders/:id/*` المطابقة | تغييرات في حالة الطلب |
| توصيلات الاشتراك اليومية للمندوب | تعرض توصيلات اليوم الخاصة بالمندوب الحالي | `src/controllers/courierController.js -> listTodayDeliveries` | `GET /api/courier/deliveries/today` | قائمة توصيلات |
| تحديث arriving-soon للمندوب | يحدد أن توصيل الاشتراك اقترب | `src/controllers/courierController.js -> markArrivingSoon` | `PUT /api/courier/deliveries/:id/arriving-soon` | تحديث `Delivery` وحالة الإشعار |
| تحديث delivered للمندوب | يحدد أن توصيل الاشتراك تم | `src/controllers/courierController.js -> markDelivered` | `PUT /api/courier/deliveries/:id/delivered` | تنفيذ `Delivery` و`SubscriptionDay` |
| تحديث cancel للمندوب | يلغي توصيل اشتراك | `src/controllers/courierController.js -> markCancelled` | `PUT /api/courier/deliveries/:id/cancel` | إلغاء `Delivery` وتعديل اليوم |
| طلبات التوصيل اليومية للمندوب | تعرض طلبات التوصيل الفردية لليوم | `src/controllers/orderCourierController.js -> listTodayOrders` | `GET /api/courier/orders/today` | قائمة توصيل الطلبات |
| نقل حالات الطلب الفردي للمندوب | يحدد أن الطلب اقترب أو تم أو ألغي | `src/controllers/orderCourierController.js` | مسارات `/api/courier/orders/:id/*` المطابقة | تغيير حالة `Order` و`Delivery` |

### مزايا الدفع والإشعارات والتكاملات

| الميزة | ماذا تفعل | مكانها | ما الذي يشغلها | ماذا تنتج أو تغيّر |
| --- | --- | --- | --- | --- |
| إنشاء فاتورة Moyasar | ينشئ روابط دفع قائمة على الفاتورة | `src/services/moyasarService.js -> createInvoice` | مسارات checkout والشحن | فاتورة خارجية + بيانات دفع محلية |
| جلب فاتورة Moyasar | يقرأ حالة الفاتورة من Moyasar | `src/services/moyasarService.js -> fetchInvoice` | مسارات التحقق | حالة الدفع عند المزود |
| معالجة Webhook Moyasar | يطبق حالات paid وfailed وcanceled وexpired | `src/controllers/webhookController.js -> handleMoyasarWebhook` | `POST /api/webhooks/moyasar` | تحديث `Payment` أو المسودة أو الطلب أو المحفظة أو الاشتراك |
| Dispatcher موحد لآثار الدفع | يوجه الدفع المدفوع إلى منطق العمل الصحيح | `src/services/paymentApplicationService.js -> applyPaymentSideEffects` | الـ Webhook ونقاط التحقق | تفعيل أو شحن أو إضافة أو تحديث طلب |
| OTP عبر واتساب | يرسل أكواد OTP عبر Twilio WhatsApp | `src/services/twilioWhatsappService.js` | مسارات طلب OTP | رسالة واتساب خارجة |
| إرسال Push Notifications | يرسل إشعارات إلى FCM tokens المحفوظة | `src/utils/notify.js` | الطلبات والتوصيل والتذكيرات الخلفية | إرسال Firebase |
| منع تكرار الإشعارات وتسجيلها | يمنع تكرار الإرسال ويحفظ سجلات الإشعارات | `src/services/notificationService.js`, `src/models/NotificationLog.js` | مسارات الإشعارات | سجلات `NotificationLog` |
| إشعارات دورة حياة الطلب | يرسل رسائل Push مرتبطة بالطلبات | `src/services/orderNotificationService.js` | checkout والتحقق والتوصيل للطلبات | إشعارات للمستخدم |
| Scheduler لتذكير arriving-soon | يرسل تذكيرًا قبل الوصول بساعة للتوصيلات المستحقة | `src/services/notificationSchedulerService.js -> processDueDeliveryArrivingSoon` | حلقة الوظائف الخلفية | إشعارات تذكير |
| Scheduler لتذكير اختيار الوجبات | يذكر العميل باختيار وجبات الغد | `src/services/notificationSchedulerService.js -> processDailyMealSelectionReminders` | حلقة الوظائف الخلفية بعد 22:00 KSA | إشعارات تذكير |
| Scheduler لتذكير انتهاء الاشتراك | يذكر العميل بقرب انتهاء الاشتراك | `src/services/notificationSchedulerService.js -> processSubscriptionExpiryReminders` | حلقة الوظائف الخلفية بعد 09:00 KSA | إشعارات تذكير |
| أتمتة cutoff اليومية | تشغّل cutoff مرة واحدة يوميًا بتوقيت السعودية | `src/services/automationService.js -> processDailyCutoff` | حلقة الوظائف الخلفية بعد cutoff أو تشغيل يدوي من الأدمن | تغييرات يومية مرتبطة بالـ cutoff |
| رفع الصور إلى Cloudinary | يرفع صور الأدمن إلى Cloudinary | `src/services/cloudinaryUploadService.js` | رفع الصور وعمليات CRUD التي تحتاج صورة | ملف مرفوع ورابط صورة |

## 4. البيانات

### ما الذي يخزنه النظام وما معناه في الواقع

| البيانات | معناها في الواقع | نقاط الكتابة الأساسية | نقاط القراءة الأساسية |
| --- | --- | --- | --- |
| `User` في `src/models/User.js` | حساب العميل الحقيقي المستخدم في الدخول والملف الشخصي وPush Tokens | التحقق من OTP وتحديث الملف الشخصي وإدارة المستخدم من الأدمن | الملف الشخصي وملكية الاشتراك أو الطلب والإشعارات |
| `AppUser` في `src/models/AppUser.js` | نسخة تطبيق مرتبطة بالهاتف وتستخدم أثناء OTP وربط الملف الشخصي | التحقق من OTP ومزامنة الملف الشخصي وإنشاء مستخدم من الأدمن | فحوصات التسجيل وربط مستخدم التطبيق |
| `DashboardUser` في `src/models/DashboardUser.js` | حساب دخول داخلي لـ `superadmin` أو `admin` أو `kitchen` أو `courier` | دخول لوحة التحكم وSeed البداية وCRUD الأدمن | Dashboard auth وشاشات حسابات اللوحة |
| `Otp` في `src/models/Otp.js` | محاولة OTP معلقة لرقم هاتف | مسارات طلب OTP | مسار التحقق من OTP |
| `Plan` في `src/models/Plan.js` | باقة اشتراك قابلة للبيع وبها عدد أيام ومصفوفة أسعار الجرامات والوجبات | CRUD الباقات من الأدمن | القوائم والتسعير والـ checkout والتجديد وقراءات الأدمن |
| `MealCategory` في `src/models/MealCategory.js` | تصنيف للوجبات العادية | CRUD التصنيفات من الأدمن | قراءات الوجبات العامة وقراءات الأدمن |
| `Meal` في `src/models/Meal.js` | وجبة عادية يمكن بيعها | CRUD الوجبات من الأدمن | القوائم وCheckout الطلب وتخطيط الأيام |
| `PremiumMeal` في `src/models/PremiumMeal.js` | وجبة بريميوم تكلفتها أعلى | CRUD الوجبات البريميوم من الأدمن | قائمة الاشتراكات والتسعير وتخطيط اليوم والمحفظة |
| `Addon` في `src/models/Addon.js` | عنصر إضافي قد يكون recurring أو one-time | CRUD الإضافات من الأدمن | قائمة الاشتراكات والتسعير وتخطيط اليوم والمحفظة |
| `SaladIngredient` في `src/models/SaladIngredient.js` | مكون يمكن استخدامه في السلطة المخصصة | CRUD المكونات من الأدمن | معاينة وشراء السلطة المخصصة |
| `MealIngredient` في `src/models/MealIngredient.js` | مكون يمكن استخدامه في الوجبة المخصصة | CRUD المكونات من الأدمن | معاينة وشراء الوجبة المخصصة |
| `Zone` في `src/models/Zone.js` | منطقة توصيل برسومها الخاصة | بيانات Seed أو إدارة مساعدة | خيارات التوصيل وتسعير الـ checkout |
| `Setting` في `src/models/Setting.js` | قواعد العمل مثل cutoff والفترات ونقاط الاستلام والأسعار والضريبة والسماحيات | تحديثات الإعدادات من الأدمن | القوائم والـ checkout والمهام الخلفية وعمليات الاشتراك والتسعير |
| `CheckoutDraft` في `src/models/CheckoutDraft.js` | مسودة checkout للاشتراك أو التجديد قبل اكتمال الدفع | Checkout الاشتراك والتجديد | حالة المسودة والتحقق من الدفع والتفعيل |
| `Subscription` في `src/models/Subscription.js` | العقد الحقيقي لاشتراك العميل مع بيانات المحفظة | التفعيل والتجديد والإنشاء من الأدمن والتجميد والتخطي وتحديث التوصيل وشحن المحفظة | التطبيق واللوحة والمطبخ والمندوب والتذكيرات |
| `SubscriptionDay` في `src/models/SubscriptionDay.js` | يوم واحد داخل الاشتراك يتضمن الوجبات والحالة وOverride التوصيل والعناصر المخصصة وحالة الدفع | التفعيل وتخطيط الأيام والتجميد والتخطي والاستلام ونقل الحالات في المطبخ والمندوب | التطبيق والمطبخ والمندوب والتذكيرات |
| `Payment` في `src/models/Payment.js` | أي حدث مالي قائم على الفاتورة في النظام | checkout والتجديد والشحن وإضافات الأيام وطلبات المرة الواحدة | الـ Webhook ونقاط التحقق وواجهة الأدمن للمدفوعات |
| `Order` في `src/models/Order.js` | طلب فردي خارج نظام الاشتراكات | Checkout الطلب وإضافة العناصر المخصصة والتحقق من الدفع ونقل الحالات في المطبخ والمندوب | قراءات العميل وطلبات الأدمن والمطبخ والمندوب |
| `Delivery` في `src/models/Delivery.js` | مهمة توصيل مرتبطة بيوم اشتراك أو طلب فردي | مسارات التنفيذ والتوصيل | شاشات المندوب وتغييرات حالة التوصيل |
| `ActivityLog` في `src/models/ActivityLog.js` | سجل داخلي للأحداث الإدارية أو التشغيلية | نقاط كتابة مختلفة في النظام | شاشة السجلات عند الأدمن |
| `NotificationLog` في `src/models/NotificationLog.js` | سجل الإشعارات المرسلة أو الممنوعة من التكرار | خدمات الإشعار والمهام الخلفية | شاشة سجلات الإشعارات ومنع التكرار |

### كيف تتحرك البيانات داخل النظام

1. يدخل طلب HTTP إلى Route داخل `src/routes/*.js`.
2. يحول الـ Route التنفيذ إلى Controller داخل `src/controllers/*.js`.
3. يتحقق الـ Controller من المدخلات، ومن صلاحية المستخدم، ومن الـ Middleware الخاص بالدخول أو الدور، ثم يستدعي Service إذا كان المنطق مشتركًا أو متعلقًا بالدفع.
4. تقرأ وتكتب الـ Services والـ Controllers مستندات Mongo عبر Models الموجودة في `src/models/*.js`.
5. عندما يكون هناك مال، ينشئ الـ Controller أولًا سجل `Payment` ثم يستدعي Moyasar عبر `src/services/moyasarService.js`.
6. عندما تؤكد الجهة الخارجية أن الدفع تم، يحدث الـ Webhook أو Route التحقق نفس `Payment` ثم يكتب السجل التجاري الحقيقي الذي كان هذا الدفع من أجله.
7. بعد ذلك تعيد مسارات القراءة بناء ردود التطبيق أو لوحة التحكم من هذه المستندات المخزنة مع الإعدادات الحية والنصوص المترجمة.
8. تستخدم الوظائف الخلفية نفس بيانات الاشتراكات والأيام والتوصيلات والمستخدمين لإرسال التذكيرات وتنفيذ cutoff اليومي.

## 5. ما الذي يعتمد على ماذا

### خريطة الاعتماد بين المزايا

| الميزة أو الجزء | يعتمد على | ماذا يتعطل لو أزلناه |
| --- | --- | --- |
| دخول العميل | `Otp` و`User` و`AppUser` و`otpService` و`appTokenService` | لن يستطيع العميل الدخول أو التحقق أو الوصول لمسارات التطبيق المحمية |
| الباقات والكتالوج | `Plan` وموديلات الوجبات والبريميوم والإضافات والتصنيفات والمكونات و`Setting` | ستتعطل القوائم والتسعير والـ checkout وشاشات إدارة الكتالوج |
| الإعدادات | قيم `Setting` مثل cutoff والفترات والرسوم والضريبة والأسعار | سيصبح حساب الـ checkout وخيارات التوصيل وسماحية التخطي والتذكيرات والـ cutoff غير صحيح أو ناقص |
| Checkout الاشتراك | `Plan` والكتالوج و`Setting` و`CheckoutDraft` و`Payment` و`moyasarService` | لن يبدأ شراء اشتراكات جديدة أو تجديدات |
| نظام الدفع | `Payment` وإنشاء فواتير Moyasar وكود الـ Webhook والتحقق وDispatcher آثار الدفع | سيتوقف تفعيل الاشتراكات وشحن المحافظ وإضافات الأيام ودفع الطلبات الفردية |
| مسودات الـ checkout | `CheckoutDraft` ومنطق التحقق من الدفع | ستنكسر خاصية idempotency وتتبع واستكمال checkout الاشتراكات |
| تفعيل الاشتراك | `subscriptionActivationService` و`Subscription` و`SubscriptionDay` | ستبقى الاشتراكات المدفوعة دون أن تتحول إلى أيام قابلة للاستخدام |
| أيام الاشتراك | `SubscriptionDay` ومنطق خدمات الاشتراك | سيتعطل تخطيط اليوم والتجميد والتخطي والاستلام وقوائم المطبخ وتوصيل المندوب والتذكيرات |
| منطق المحفظة | `Subscription` وخدمات محفظة البريميوم والإضافات و`Payment` | ستتوقف اختيارات البريميوم والإضافات وزيادة البريميوم وشحن الرصيد |
| الطلبات الفردية | `Order` و`Payment` وتسعير القائمة والتحقق من الدفع وControllers المطبخ والمندوب | سيتوقف مسار الشراء خارج الاشتراكات |
| سجلات التوصيل | `Delivery` وControllers المطبخ والمندوب وخدمات التنفيذ | ستتعطل شاشات المندوب وتتبع حالات التوصيل بشكل صحيح |
| دخول لوحة التحكم | `DashboardUser` و`dashboardTokenService` وMiddleware `dashboardAuth` | ستصبح مسارات الأدمن والمطبخ والمندوب غير قابلة للوصول |
| مسارات إدارة الأدمن | Dashboard auth والـ Models التي تديرها | لن توجد طريقة داخلية لإدارة الكتالوج والإعدادات والمستخدمين والمدفوعات والتقارير |
| الإشعارات Push | `User.fcmTokens` وكود Firebase و`NotificationLog` | ستتوقف إشعارات الوصول والتذكيرات وإشعارات الطلبات ولن يُمنع التكرار |
| الوظائف الخلفية | `startJobs` والإعدادات والاشتراكات والأيام والتوصيلات والإشعارات | سيتوقف cutoff التلقائي وتذكير اختيار الوجبات وتذكيرات الوصول والانتهاء |

### ترابط المزايا على مستوى العمل

- شراء الاشتراك يعتمد على أن يكون الكتالوج موجودًا وأن تكون الإعدادات قابلة للقراءة. إذا غابت الباقات أو الوجبات البريميوم أو الإضافات أو المناطق أو الإعدادات، فلن يستطيع النظام بناء سعر صحيح.
- تخطيط أيام الاشتراك يعتمد على أن تفعيل الاشتراك قد أنشأ `SubscriptionDay` مسبقًا. بدون ذلك لا يوجد شيء يمكن تخطيطه.
- دفعات زيادة البريميوم والإضافات المؤقتة لليوم تعتمد على نظام الدفع العام. بدون `Payment` ودعم الـ Webhook أو الـ verify ستبقى هذه الحالات unpaid وقد يمنع ذلك تأكيد التخطيط.
- التجميد والتخطي يعتمدان معًا على حالة `SubscriptionDay` وعلى القواعد الموجودة في `subscriptionService` و`subscriptionOperationsReadService`. إذا أزلت هذه القواعد فلن يعرف التطبيق ما الذي يُسمح به.
- مسارات المطبخ تعتمد على وجود أيام اشتراك وطلبات مسبقًا. Routes المطبخ لا تنشئ الاشتراكات أو الطلبات؛ هي فقط تتعامل مع الموجود.
- مسارات المندوب تعتمد على سجلات التوصيل وخدمات التنفيذ. إذا حذفت `Delivery` أو منطق التنفيذ فلن تحدّث إجراءات المندوب حالة العمل بشكل صحيح.
- إنشاء الاشتراك من الأدمن يعتمد على نفس مسار تفعيل الاشتراك المستخدم بعد الدفع، لكن بدون خطوة دفع العميل.
- الإشعارات تعتمد على الأحداث الناتجة من الطلبات وأيام الاشتراك والتوصيلات والمهام الخلفية. إذا أزلت هذه السجلات المصدر فلن يبقى شيء ذو معنى لإرسال إشعارات عنه.

### أجزاء غير مكتملة أو مشروطة في الوضع الحالي

- إدارة البطاقات أو وسائل الدفع المحفوظة غير موجودة في الكود الحي. الـ API يعرض Route قراءة يصرّح صراحة بأنها غير مدعومة.
- وضع التوصيل يمكن تحديده عند الـ checkout، لكن تغيير وضع التوصيل بعد ذلك غير مدعوم صراحة في operations metadata.
- نقاط التفعيل التجريبية Mock موجودة فقط خارج الإنتاج.
- بعض الأجزاء الداخلية للاشتراك مشروطة بمتغيرات بيئة:
- `PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE` و`PHASE1_CANONICAL_DRAFT_ACTIVATION` و`PHASE1_CANONICAL_ADMIN_CREATE` و`PHASE1_SHARED_PAYMENT_DISPATCHER` و`PHASE1_SNAPSHOT_FIRST_READS` و`PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY` تغيّر سلوك الـ checkout وتطبيق الدفع.
- `PHASE2_CANONICAL_DAY_PLANNING` تغيّر ما إذا كان مسار تأكيد تخطيط اليوم يعمل بصورته canonical.
- `PHASE2_GENERIC_PREMIUM_WALLET` تغيّر ما إذا كان رصيد البريميوم يدار بالوضع generic الأحدث أو بالوضع legacy الأقدم.
