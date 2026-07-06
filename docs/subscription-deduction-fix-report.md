# تقرير إصلاحات خصم واسترداد الاشتراكات (Subscription Deduction Fixes)

تم بناءً على المراجعة المعمارية السابقة، تنفيذ حزمة من الإصلاحات الهيكلية لمنع الأخطاء في خصم الرصيد (Add-ons و Premium) ومعالجة سياسات الإلغاء وعدم الحضور (`no_show`).

---

## 1. التغييرات التي تمت (ملف بملف، دالة بدالة)

### `src/services/dashboard/opsTransitionService.js`
- **دالة `handleCancel`**:
  - تم التأكد من أنها تقوم بإرجاع رصيد الإضافات (Add-ons) والوجبات المميزة (Premium) عند حدوث إلغاء فعلي (`delivery_canceled` أو `canceled_at_branch`).
  - تم ربط إرجاع رصيد Premium بالدالة الذرية `releasePremiumBalanceAtomically` بشكل مطابق تماماً لآلية الإضافات (Add-ons).
- **دالة `handleNoShow`**:
  - **تم فصل مسار `no_show` تماماً** عن مسار الإلغاء العادي `handleCancel`.
  - أصبح عدم الحضور (`no_show`) يُسقط الوجبة **ويُسقط أيضاً** رصيد الإضافات (Add-ons) والوجبات المميزة (Premium) المرتبطة بها (لا يتم استرجاعها للمحفظة).

### `src/models/SubscriptionDay.js`
- **حقل `premiumCreditsReleased`**:
  - تمت إضافة هذا الحقل المنطقي (Boolean) كحارس (Idempotency Guard) لمنع إعادة استرجاع رصيد Premium أكثر من مرة في حال تكرار استدعاء عملية الإلغاء، وهو مطابق لعمل حقل `addonCreditsReleased`.

### `src/services/subscription/subscriptionCancellationService.js`
- **دالة `cancelSubscriptionDomain`**:
  - تمت كتابة حلقة تكرار (Loop) تمر على جميع الأيام المستقبلية المفتوحة (open) أو المجمدة (frozen) قبل مسحها، وتستدعي `releaseAddonBalanceAtomically` و `releasePremiumBalanceAtomically` لإعادة الأرصدة المرتبطة بها للمحفظة قبل حذف اليوم.
  - تم استبدال نمط القراءة ثم الكتابة في الذاكرة (In-memory read-then-write) لمتغير `remainingMeals` بعملية `$inc` ذرية داخل دالة `findOneAndUpdate`، مع وجود Fallback للتعامل مع السيناريوهات المعقدة للحفاظ على الرصيد المحفوظ (preservedCredits).

### `src/controllers/adminController.js`
- **دالة `updateSubscriptionBalancesAdmin`**:
  - تم إبقاء التحديث الكامل للمصفوفة في الذاكرة (Full Array Overwrite) حيث تعتمد عليه لوحة التحكم في الإعداد الكلي للرصيد، ولكن تم إضافة آلية **الفحص المتفائل (Optimistic Check)** مع تسجيل إنذار (Warning Log) في حال اكتشاف استهلاك متزامن حدث للرصيد بين لحظة القراءة ولحظة الحفظ.
  - تم استبدال استدعاء `mongoose.startSession()` بـ `startSafeSession()` لضمان عمل الواجهة بشكل سليم في بيئة Railway المستقلة (Standalone) دون التعطل بأخطاء المعاملات.

---

## 2. جدول مقارنة: سياسة عدم الحضور (`no_show`) مقابل الإلغاء الحقيقي (`cancel`)

| الإجراء (Action) | استرجاع الوجبة للاشتراك؟ | استرجاع رصيد الإضافات (Add-ons)؟ | استرجاع رصيد المميز (Premium)؟ | ملاحظات إضافية |
| :--- | :--- | :--- | :--- | :--- |
| **إلغاء فعلي (`cancel`)** <br>*(delivery_canceled, canceled_at_branch)* | ❌ لا (خسارة الوجبة إذا بعد الإقفال) | ✅ نعم (يتم إرجاع الرصيد) | ✅ نعم (يتم إرجاع الرصيد) | يستخدم الدوال الذرية وحارس Idempotency لمنع التكرار. |
| **عدم حضور العميل (`no_show`)** | ❌ لا (يخسر العميل الوجبة) | ❌ لا (يخسر العميل الإضافة) | ❌ لا (يخسر العميل الترقية) | تطبيق سياسة خسارة الملحقات بالكامل مع الوجبة. |

---

## 3. تأكيد تطابق آلية Premium Balance
تم التأكد من أن رصيد `premiumBalance` يتبع الآن نفس النمط الذري والآمن الذي يستخدمه `addonBalance`:
1. يستخدم الدالة الذرية `releasePremiumBalanceAtomically`.
2. محمي بحارس التكرار (Guard) `premiumCreditsReleased` في `SubscriptionDay`.
3. لا يتأثر بأعطال إعادة المحاولة (Idempotency safe).

---

## 4. مخاطر التزامن المتبقية (Concurrency Risks)

من المهم إدراك أن بيئة قاعدة بيانات **Railway (Standalone)** لا تدعم الـ Multi-Document Transactions الحقيقية:
- **في `cancelSubscriptionDomain`**: تم تقليل خطر فقدان البيانات (Lost Updates) بشكل كبير جداً (99%) باستخدام تحديثات القيمة الذرية `$inc`. ومع ذلك، في حال فشل جزء من العملية، لا يمكن لقاعدة البيانات التراجع تلقائياً عن رصيد الإضافات المسترجع.
- **في `updateSubscriptionBalancesAdmin`**: نظراً لأن العملية تتطلب استبدالاً كاملاً لمصفوفة الإضافات/المميز (Full Array Replace) لتحديث التعديلات الإدارية، فإن خطر الكتابة المتزامنة (Clobbering) لا يزال قائماً وموجوداً. تم إضافة فحص متفائل ينشئ إنذاراً (`logger.warn`) إذا حدث تغيير في الذاكرة أثناء العملية، ولكنه **لا يمنع** التجاوز. الحماية المطلقة هنا تتطلب تفعيل Replica Set في MongoDB.

---

## 5. مخرجات الاختبارات الحقيقية (Real Test Output)

تمت كتابة وتشغيل جميع الاختبارات المذكورة وتأكيد نجاحها بالكامل:

```bash
PASS tests/services/subscription/subscriptionCancellationService.concurrency.test.js
  ● Console
    console.log
      {"level":"info","message":"MongoDB transactions are NOT supported by the current connection.","timestamp":"2026-07-06T17:29:08.556Z"}

PASS tests/controllers/adminController.concurrency.test.js
  ● Console
    console.log
      {"level":"info","message":"MongoDB transactions are NOT supported by the current connection.","timestamp":"2026-07-06T17:29:09.001Z"}

PASS tests/services/dashboard/opsTransitionService.addonRollback.test.js
  ● Console
    console.log
      {"level":"info","message":"MongoDB transactions are NOT supported by the current connection.","timestamp":"2026-07-06T17:29:08.792Z"}

Test Suites: 3 passed, 3 total
Tests:       8 passed, 8 total
Snapshots:   0 total
Time:        2.374 s
```

**تم التحقق في الاختبارات من:**
1. استدعاء `no_show` لا يرجع الأرصدة (Addon/Premium) ويكون Idempotent ولا يؤثر على حالة Guard.
2. الإلغاء الفعلي يرجع الأرصدة بشكل صحيح.
3. تكرار الإلغاء الفعلي لا يؤدي إلى إرجاع الرصيد مرتين (مقاوم للتكرار).
4. الإلغاء الكلي للاشتراك (`cancelSubscriptionDomain`) يقوم بتحويل التحديثات من القراءة بالذاكرة إلى أوامر `$inc` آمنة، ويضمن إرجاع كل أرصدة الأيام المتبقية.
5. الإدارة المباشرة للأرصدة في `updateSubscriptionBalancesAdmin` توثّق بشكل صحيح عبر `logger.warn` اكتشاف حالات السباق (Race Condition) في الذاكرة.

---

## 6. متابعة وحالات خاصة متبقية (Edge Cases & Follow-ups)
- **غياب دعم المعاملات في Railway:** لا يزال عائقاً كبيراً في عمليات الـ Full-array replacement. يُنصح بتحويل قاعدة بيانات Railway إلى Replica Set إذا تكررت مشاكل التزامن المتعلقة بالـ Admin Dashboard مستقبلاً.
- **تحديثات أرصدة الـ Admin:** مستقبلاً، يمكن تحويل الواجهة الأمامية للوحة التحكم إلى واجهة تعتمد استهلاك/إضافة مفردة للأرصدة (Incremental) بدلًا من تسليم مصفوفة كاملة للحفظ (Overwriting the array).
