# خطة تطوير Dashboard الاشتراكات

## 1. ملخص عام

المشروع الحالي داخل هذا الريبو هو Backend فقط باسم `basicdiet145-backend` مبني على Node.js وExpress وMongoDB/Mongoose. ملف `DOCKER_RESTORE_NOTES.md` يؤكد أن Flutter frontend منفصل عن هذا الريبو، ولا يوجد داخل المسار الحالي تطبيق Dashboard بواجهة React/Flutter/Web كاملة؛ الموجود هو APIs خاصة بالداشبورد والإدارة.

الهدف المطلوب هو تحويل إدارة الداتا من Scripts إلى Dashboard كاملة تتحكم في كتالوج الاشتراكات، الخطط، الأسعار، الإضافات، المستخدمين، الاشتراكات، أيام الاشتراك، الإعدادات، ومتابعة التشغيل. جزء كبير من APIs موجود بالفعل، لكن توجد فجوات مهمة في واجهة الداشبورد نفسها، وفي بعض APIs الخاصة بكتالوج الإضافات وخطط الإضافات، وفي إدارة مناطق التوصيل وبعض عمليات الاشتراك الدقيقة.

## 2. بنية المشروع الحالية

الملفات والفولدرات المهمة:

| المسار | الدور |
|---|---|
| `src/app.js` | إعداد Express، CORS، Swagger، health، وربط `/api` بالـ routes. |
| `src/index.js` | نقطة تشغيل السيرفر. |
| `src/db.js` | الاتصال بقاعدة MongoDB. |
| `src/routes/index.js` | تجميع routes الرئيسية تحت `/api`. |
| `src/routes/admin.js` | أغلب Dashboard/Admin APIs: خطط، إضافات، مستخدمون، اشتراكات، مدفوعات، إعدادات، وجبات. |
| `src/routes/dashboardAuth.js` | تسجيل دخول/خروج Dashboard. |
| `src/routes/dashboardOps.js` | Unified Dashboard Ops API للمطبخ/الكوريير/الأدمن. |
| `src/routes/adminMealPlannerMenu.routes.js` | CRUD لكتالوج meal planner: proteins, premium-proteins, sandwiches, carbs, addons, salad ingredients. |
| `src/routes/subscriptions.js` | APIs التطبيق الخاصة بالاشتراكات، checkout، renewal، timeline، meal planner، freeze/skip/cancel. |
| `src/controllers/adminController.js` | منطق Admin/Dashboard الرئيسي. |
| `src/controllers/subscriptionController.js` | منطق اشتراكات التطبيق والـ planner. |
| `src/controllers/addonController.js` | CRUD إضافات Dashboard العام. |
| `src/controllers/admin/mealPlannerMenu.controller.js` | Controller بديل لإدارة كتالوج meal planner. |
| `src/services/admin/mealPlannerMenu.service.js` | Validation/CRUD لكتالوج meal planner. |
| `src/models/Plan.js` | خطط الاشتراك الأساسية. |
| `src/models/Addon.js` | إضافات الاشتراك وإضافات اليوم. |
| `src/models/Subscription.js` | الاشتراك الرئيسي. |
| `src/models/SubscriptionDay.js` | أيام الاشتراك وحالة التخطيط/التنفيذ. |
| `src/models/CheckoutDraft.js` | مسودة الدفع قبل تفعيل الاشتراك. |
| `src/models/Payment.js` | المدفوعات. |
| `src/models/User.js` و`src/models/AppUser.js` | مستخدمو التطبيق. |
| `src/models/DashboardUser.js` | مستخدمو الداشبورد وأدوارهم. |
| `src/models/BuilderProtein.js`, `BuilderCarb.js`, `BuilderCategory.js`, `SaladIngredient.js`, `Sandwich.js` | كتالوج Meal Planner. |
| `src/models/Setting.js`, `Zone.js`, `AppContent.js` | إعدادات عامة، مناطق التوصيل، محتوى قانوني. |
| `scripts/` | سكريبتات seed/migrate/backfill/diagnose. يجب نقل وظائف الإدارة اليومية منها إلى Dashboard. |

ملاحظة مهمة: لا يوجد مجلد UI ظاهر مثل `dashboard/`, `frontend/`, `web/`, `client/` داخل الريبو. لذلك "الداشبورد الحالية" هنا تعني Backend APIs جاهزة للداشبورد، وليس واجهة مستخدم كاملة.

## 3. نظام الاشتراكات الحالي

النظام الحالي يعتمد على هذه المكونات:

| الجزء | الملف | الوصف |
|---|---|---|
| خطط الاشتراك | `src/models/Plan.js` | الخطة لها `daysCount`, `currency`, خيارات جرامات `gramsOptions`, وتحت كل جرام خيارات `mealsOptions` بسعر `priceHalala` و`compareAtHalala`. |
| سعر الخطة | `Plan.gramsOptions[].mealsOptions[]` | السعر حسب الجرام وعدد الوجبات في اليوم. الأسعار Halala والعملة SAR. |
| سياسة التجميد | `Plan.freezePolicy` | `enabled`, `maxDays`, `maxTimes`. |
| سياسة التخطي | `Plan.skipPolicy` | `enabled`, `maxDays`. |
| الاشتراك | `src/models/Subscription.js` | يربط `userId` مع `planId` ويخزن status, start/end, meals, pricing, delivery, premium/addon balances. |
| حالات الاشتراك | `Subscription.status` | `pending_payment`, `active`, `frozen`, `expired`, `canceled`, `completed`. |
| أيام الاشتراك | `src/models/SubscriptionDay.js` | كل يوم له status، mealSlots، addonSelections، premiumUpgradeSelections، pickup/delivery workflow. |
| حالات اليوم | `SubscriptionDay.status` | `open`, `frozen`, `locked`, `in_preparation`, `out_for_delivery`, `ready_for_pickup`, `fulfilled`, `consumed_without_preparation`, `delivery_canceled`, `canceled_at_branch`, `no_show`, `skipped`. |
| إضافات الاشتراك | `src/models/Addon.js` | `kind=plan` للشراء مع الاشتراك، و`kind=item` لاختيار منتج يومي في meal planner. |
| فئات الإضافات | `Addon.category` | `juice`, `snack`, `small_salad`. |
| طريقة حساب الإضافات | `Addon.billingMode` | `per_day` لخطط الإضافات، `flat_once` لعناصر اليوم، و`per_meal` مدعومة في الموديل. |
| Premium balance | `Subscription.premiumBalance` | أرصدة وجبات/بروتينات premium مرتبطة بـ `premiumKey` و`proteinId`. |
| Addon entitlements | `Subscription.addonSubscriptions` | اشتراك المستخدم في فئة إضافة معينة مثل juice. الربط بين plan/item يتم بالـ `category` فقط. |
| الدفع | `Payment`, `CheckoutDraft` | الدفع يتم عبر Moyasar، والاشتراك لا يتفعل إلا بعد draft/payment أو admin create. |
| VAT | `docs/vat-inclusive-subscription-pricing.md` | الأسعار المعروضة شاملة الضريبة، والBackend يستخرج VAT من الإجمالي. |

أهم flows موجودة:

- التطبيق يجلب كتالوج الاشتراك من `GET /api/subscriptions/menu`.
- التطبيق يعمل quote من `POST /api/subscriptions/quote`.
- التطبيق يعمل checkout من `POST /api/subscriptions/checkout`.
- الدفع قبل التفعيل محفوظ في `CheckoutDraft`.
- التفعيل ينتج `Subscription` و`SubscriptionDay`.
- التخطيط اليومي يستخدم canonical `mealSlots`.
- المدفوعات اليومية الموحدة موجودة في `/days/:date/payments`.
- التجديد موجود في `POST /api/subscriptions/:id/renew`.
- الإلغاء/التجميد/التخطي موجود للتطبيق، وموجود جزء منه للداشبورد.

## 4. الموجود حاليًا

Dashboard/Auth:

- `POST /api/dashboard/auth/login`
- `GET /api/dashboard/auth/me`
- `POST /api/dashboard/auth/logout`
- JWT خاص بالداشبورد في `src/middleware/dashboardAuth.js`.
- أدوار Dashboard في `DashboardUser`: `superadmin`, `admin`, `kitchen`, `courier`.
- `dashboardRoleMiddleware` يسمح لـ `superadmin` بكل شيء، وباقي الأدوار حسب route.

Dashboard APIs موجودة:

- Overview/Search/Reports:
  - `GET /api/dashboard/overview`
  - `GET /api/dashboard/search`
  - `GET /api/dashboard/notifications/summary`
  - `GET /api/dashboard/reports/today`
- Plans:
  - CRUD كامل تقريبًا في `/api/dashboard/plans`.
  - إدارة grams وmeals options داخل الخطة.
  - clone/toggle/sort.
- Addons:
  - CRUD عام في `/api/dashboard/addons`.
  - CRUD لعناصر meal planner addons في `/api/admin/meal-planner-menu/addons`.
- Subscriptions:
  - `GET /api/dashboard/subscriptions`
  - `GET /api/dashboard/subscriptions/summary`
  - `GET /api/dashboard/subscriptions/export`
  - `POST /api/dashboard/subscriptions`
  - `GET /api/dashboard/subscriptions/:id`
  - `GET /api/dashboard/subscriptions/:id/days`
  - `POST /api/dashboard/subscriptions/:id/cancel`
  - `PUT /api/dashboard/subscriptions/:id/extend`
  - `POST /api/dashboard/subscriptions/:id/freeze`
  - `POST /api/dashboard/subscriptions/:id/unfreeze`
  - `POST /api/dashboard/subscriptions/:id/days/:date/skip`
  - `POST /api/dashboard/subscriptions/:id/days/:date/unskip`
- Users:
  - list/create/get/update app users.
  - list subscriptions for user.
- Dashboard users:
  - list/create/get/update/delete/reset password.
- Payments:
  - list/get/verify admin.
- Catalog:
  - meals, meal categories, salad ingredients, meal ingredients.
  - meal planner proteins/premium/carbs/sandwiches/addons/salad ingredients via `adminMealPlannerMenu.routes.js`.
- Settings:
  - cutoff, delivery windows, skip allowance, premium price, subscription delivery fee, VAT percentage, restaurant hours, custom salad/meal base price.
- Content:
  - subscription terms get/upsert.
- Ops:
  - `/api/dashboard/ops/list`
  - `/api/dashboard/ops/search`
  - `/api/dashboard/ops/actions/:action`

اختبارات وتوثيق موجود:

- اختبارات اشتراك وcheckout وVAT وmeal planner في `tests/`.
- توثيق مهم في `docs/frontend-subscription-addons.md`, `docs/vat-inclusive-subscription-pricing.md`, `docs/unified-selection-payment-flow.md`, `docs/FRONTEND_FLUTTER_REMOVAL_REPORT.md`.

## 5. الناقص والمطلوب تنفيذه

أعلى الأولويات:

1. بناء واجهة Dashboard فعلية؛ الريبو الحالي لا يحتوي UI Dashboard.
2. توحيد إدارة الإضافات:
   - `/api/dashboard/addons` لا يمرر `category` ولا `kind` في `validateAddonPayloadOrThrow` داخل `src/controllers/addonController.js`.
   - `src/models/Addon.js` يتطلب `category`، ويميز `kind=plan/item`.
   - النتيجة: إدارة خطط إضافات checkout من الداشبورد غير مكتملة أو معرضة للفشل.
3. صفحة اشتراكات متقدمة:
   - الموجود list/detail/create/cancel/extend/freeze/skip.
   - ناقص تعديل بيانات اشتراك قائمة بشكل مضبوط: تغيير خطة، تغيير start/end، تعديل delivery، تعديل addon entitlements، تعديل premium/addon balance مع audit.
4. صفحة إنشاء اشتراك Admin يجب أن تستخدم نفس quote validation:
   - API موجود `POST /api/dashboard/subscriptions`.
   - تحتاج UI غني لاختيار user, plan, grams, mealsPerDay, startDate, delivery/pickup, premium, addon plans, promo إن كان مدعومًا.
5. إدارة مناطق التوصيل `Zone`:
   - يوجد موديل `src/models/Zone.js`.
   - يوجد read للتطبيق ضمن `GET /api/subscriptions/delivery-options`.
   - لا يوجد CRUD Dashboard واضح لمناطق التوصيل.
6. تحويل السكريبتات اليومية إلى شاشات:
   - خصوصًا `seed-subscription-addons.js`, `seedStandardBuilderData.js`, `seedPremiumCatalog.js`, `seedBuilderCatalogData.js`, `seed-legal-content.js`, `create-dashboard-user.js`.
7. صلاحيات أدق:
   - حاليًا route `/api/dashboard` كله يتطلب `admin` أو `superadmin`.
   - لا توجد permissions granular مثل `subscriptions.write`, `catalog.write`, `payments.verify`.
8. Audit log إلزامي:
   - يوجد `SubscriptionAuditLog` و`ActivityLog`، لكن يجب التأكد أن كل عمليات Dashboard الحساسة تسجل actor وbefore/after.
9. UX للإحصائيات:
   - APIs summary/overview موجودة، لكنها تحتاج صفحات KPIs تفصيلية للاشتراكات، الإيرادات، التجديد، الانتهاء، الإضافات، المدفوعات المعلقة.

## 6. السكريبتات الحالية وتحويلها للداش بورد

| اسم السكريبت | وظيفته | الداتا التي يعدلها | الشاشة المطلوبة بدله في الداش بورد | الـ API المطلوب |
|---|---|---|---|---|
| `scripts/seed-subscription-addons.js` | إنشاء خطط إضافات checkout وعناصر meal planner لفئات juice/snack/small_salad، مع حذف مستهدف قبل الإدخال. | `Addon` | صفحة إدارة الإضافات بفصل واضح بين Addon Plans وAddon Items. | توسيع `/api/dashboard/addons` ليدعم `kind`, `category`, `billingMode` أو إضافة `/api/dashboard/addon-plans`. |
| `scripts/seedStandardBuilderData.js` | إنشاء كتالوج البروتينات والكارب القياسية وBuilderCategory. | `BuilderCategory`, `BuilderCarb`, `BuilderProtein` | صفحة Meal Planner Catalog: Proteins/Carbs/Categories. | موجود جزئيًا: `/api/admin/meal-planner-menu/proteins`, `/carbs`. ناقص categories UI/API إن احتجنا إدارتها يدويًا. |
| `scripts/seedBuilderCatalogData.js` | Seed قياسي مشابه وموسع لكتالوج builder. | `BuilderCategory`, `BuilderCarb`, `BuilderProtein` | نفس صفحة Meal Planner Catalog. | استخدام APIs الموجودة مع إضافة import/bulk upsert اختياري. |
| `scripts/seedPremiumCatalog.js` | إنشاء premium proteins ومكونات premium salad. | `BuilderCategory`, `BuilderProtein`, `SaladIngredient` | صفحة Premium Catalog وPremium Salad Ingredients. | موجود جزئيًا: `/api/admin/meal-planner-menu/premium-proteins`, `/salad-ingredients`. |
| `scripts/seed-demo-data.js` | إنشاء بيانات Demo شاملة: users, dashboard users, settings, zones, plans, meals, addons, subscriptions, days, payments, drafts. | أغلب Collections | لا يتحول كله لإدارة إنتاج. المطلوب صفحات لكل entity + زر Demo seed فقط في بيئة dev إن لزم. | APIs موجودة متفرقة، ناقص CRUD zones وبعض bulk/import dev-only. |
| `scripts/create-dashboard-user.js` | إنشاء أو تحديث مستخدم Dashboard من CLI. | `DashboardUser` | صفحة Dashboard Users. | موجود: `/api/dashboard/dashboard-users` وreset password. |
| `scripts/seed-dashboard-users.js` | upsert لمستخدمي Dashboard من env. | `DashboardUser` | صفحة Dashboard Users + إعداد أول مستخدم bootstrap. | موجود للإدارة بعد الدخول. يلزم bootstrap آمن لأول superadmin فقط. |
| `scripts/seed-legal-content.js` | إنشاء/تحديث شروط الاشتراك الافتراضية. | `AppContent` | صفحة Content/Subscription Terms. | موجود: `GET/PUT /api/dashboard/content/terms/subscription`. |
| `scripts/backfill-meal-categories.js` | إنشاء MealCategory من حقول قديمة في Meal. | `Meal`, `MealCategory` | صفحة Meal Categories مع أداة migration/diagnostic. | CRUD موجود: `/api/dashboard/meal-categories`. Migration يبقى admin maintenance. |
| `scripts/migrate-multilang-names.js` | تحويل أسماء قديمة إلى `{ar,en}`. | `Plan`, `Addon`, `Meal`, `SaladIngredient` | ليس شاشة يومية؛ صفحة Data Health/Migrations للعرض والتنفيذ المحكوم. | API جديد dev/superadmin-only: `/api/dashboard/maintenance/migrations/multilang-names`. |
| `scripts/migrate-salad-ingredient-groups.js` | تصحيح groupKey لمكونات السلطة. | `SaladIngredient` | صفحة Salad Ingredients مع validation للـ group. | موجود جزئيًا في `/api/admin/meal-planner-menu/salad-ingredients`. |
| `scripts/migrate-builder-protein-groups.js` | ربط البروتينات بفئات canonical وتصحيح family/category. | `BuilderCategory`, `BuilderProtein` | صفحة Data Health للـ Builder Catalog. | API diagnostic/fix جديد أو إبقاؤه migration فقط. |
| `scripts/migrateCarbSelectionsFromCarbId.js` | تحويل أيام قديمة من `carbId` إلى `carbSelections`. | `SubscriptionDay` | Maintenance فقط، لا شاشة CRUD عادية. | API migration محمي أو runbook. |
| `scripts/backfill-premium-balance-key.js`, `scripts/backfill_premium_key.js`, `src/scripts/migrations/backfillPremiumKeys.js` | ملء `premiumBalance.premiumKey` في اشتراكات قديمة. | `Subscription`, `BuilderProtein` | Data Health: Premium Balance Repair. | API جديد superadmin-only للتشخيص والإصلاح. |
| `scripts/clean-premium-catalog.js` | تنظيف premium catalog القديم وتصحيح balances. | `BuilderProtein`, `Subscription` | Data Health / Catalog Cleanup مع dry-run. | API جديد superadmin-only مع dryRun/confirm. |
| `scripts/cleanup-meal-planner-canonical-data.js` | تنظيف canonical meal planner data. | `BuilderCategory`, `BuilderCarb`, `BuilderProtein`, `SaladIngredient`, `Subscription`, `SubscriptionDay` | Data Health / Canonical Cleanup. | API جديد superadmin-only أو يبقى migration runbook. |
| `scripts/repairBuilderData.js` | حذف/تصحيح بيانات builder غير سليمة. | `BuilderProtein`, `BuilderCarb` | Data Health. | API جديد dry-run/fix. |
| `scripts/create-production-indexes.js` | إنشاء indexes إنتاجية. | Indexes على `Payment`, `User`, `Addon`, `BuilderProtein` | صفحة System Health للعرض فقط، والتنفيذ عبر deployment. | يفضل عدم تحويله لشاشة عادية؛ API health يعرض missing indexes. |
| `scripts/fix-payment-indexes.js` | فحص indexes المدفوعات. | لا يعدل حاليًا، يعرض indexes. | System Health. | API read-only: `/api/dashboard/health/indexes`. |
| `scripts/checkCatalogHealth.js` | فحص صحة كتالوج الخطط وسلامة الاشتراكات. | قراءة فقط. | صفحة Catalog Health. | موجود service؛ أضف route `/api/dashboard/health/catalog`. |
| `scripts/diagnose-subscription-menu-data.js` | تشخيص خطط وإضافات menu. | قراءة فقط. | صفحة Subscription Menu Health. | API read-only جديد. |
| `scripts/diagnose-meal-planner-canonical-data.js` | تشخيص بيانات meal planner. | قراءة فقط. | صفحة Meal Planner Health. | API read-only جديد. |
| `scripts/get-test-data.js` | استخراج IDs للاختبار. | قراءة فقط. | Dev Tools فقط. | ليس مطلوبًا في Production Dashboard. |
| `scripts/verifyBuilderIntegrity.js`, `verifyCarbSelectionRules.js`, `verify-zone-fees.js` | تحقق/اختبار. بعضها ينشئ بيانات اختبار. | قراءة أو test writes | لا تتحول لشاشة إنتاج. | تبقى tests أو dev-only diagnostics. |

ملاحظة: `package.json` يحتوي commands تشير لملفات غير موجودة في الريبو الحالي: `scripts/diagnose-mongo.js`, `seedPickupTestData.js`, `seedSubscriptionCycles.js`, `backfill-meal-category-ids.js`, `seed-meal-builder-data.js`. يجب تنظيفها أو إضافة الملفات/استبدالها.

## 7. صفحات Dashboard المطلوبة

| اسم الصفحة | الهدف منها | العمليات المتاحة | الـ APIs المطلوبة | الأولوية |
|---|---|---|---|---|
| Login | دخول Dashboard. | login/logout/me. | `/api/dashboard/auth/*` | P0 |
| Overview | ملخص سريع للتشغيل والاشتراكات. | KPIs، recent subscriptions/orders. | `GET /api/dashboard/overview`, `GET /api/dashboard/reports/today` | P0 |
| Subscriptions List | بحث/فلترة/تصدير الاشتراكات. | list, filter, export, open detail. | `GET /api/dashboard/subscriptions`, `/summary`, `/export` | P0 |
| Subscription Detail | إدارة اشتراك واحد. | عرض الخطة، المستخدم، السعر، الأيام، المدفوعات، freeze/unfreeze/cancel/extend/skip. | APIs الاشتراكات الحالية + API جديد audit/timeline admin. | P0 |
| Create Subscription | إنشاء اشتراك من Dashboard. | اختيار user/plan/options/addons/premium/delivery/startDate. | `POST /api/dashboard/subscriptions`, ويفضل `POST /api/dashboard/subscriptions/quote` جديد. | P0 |
| Subscription Days | إدارة أيام الاشتراك. | عرض calendar/table، skip/unskip، freeze، حالات التشغيل، تفاصيل mealSlots. | `GET /api/dashboard/subscriptions/:id/days`, day actions. | P0 |
| Plans | إدارة خطط الاشتراك. | CRUD، grams، meals options، prices، active، sort، clone. | `/api/dashboard/plans/*` | P0 |
| Addon Plans | إدارة إضافات checkout اليومية. | CRUD، category، price per day، active، sort. | جديد أو إصلاح `/api/dashboard/addons`. | P0 |
| Addon Items | إدارة منتجات اليوم في meal planner. | CRUD، category، flat price، active، sort. | `/api/admin/meal-planner-menu/addons` أو unified endpoint. | P0 |
| App Users | إدارة مستخدمي التطبيق. | list/create/get/activate/deactivate/subscriptions. | `/api/dashboard/users/*` | P1 |
| Payments | متابعة المدفوعات. | list/get/verify، فلترة status/type. | `/api/dashboard/payments/*` | P1 |
| Meal Planner Catalog | إدارة proteins/carbs/sandwiches/premium/salad. | CRUD وتفعيل وتعطيل. | `/api/admin/meal-planner-menu/*` | P1 |
| Meals & Categories | إدارة وجبات الطلبات/القوائم. | CRUD meals/categories. | `/api/dashboard/meals`, `/meal-categories` | P1 |
| Settings | إعدادات VAT، delivery windows، cutoff، premium price، restaurant hours. | read/update. | `/api/dashboard/settings/*` | P1 |
| Delivery Zones | إدارة مناطق التوصيل ورسومها. | CRUD، active، sort. | API جديد `/api/dashboard/zones` | P1 |
| Content Terms | إدارة شروط الاشتراك. | get/update. | `/api/dashboard/content/terms/subscription` | P2 |
| Dashboard Users | إدارة موظفي الداشبورد. | CRUD/reset password/roles. | `/api/dashboard/dashboard-users/*` | P2 |
| Ops Board | تشغيل يومي للمطبخ والكوريير. | list/search/actions. | `/api/dashboard/ops/*` | P2 |
| Data Health | بديل آمن للسكريبتات التشخيصية. | diagnostics, dry-run repair, migration status. | APIs جديدة تحت `/api/dashboard/health` و`/maintenance` | P2 |

## 8. APIs المطلوبة

| Method | Endpoint | الوظيفة | الصلاحيات المطلوبة | هل موجود أم جديد |
|---|---|---|---|---|
| POST | `/api/dashboard/auth/login` | دخول الداشبورد | public + rate limit | موجود |
| GET | `/api/dashboard/overview` | ملخص Dashboard | admin/superadmin | موجود |
| GET | `/api/dashboard/subscriptions` | قائمة الاشتراكات | admin/superadmin | موجود |
| GET | `/api/dashboard/subscriptions/summary` | إحصائيات اشتراكات | admin/superadmin | موجود |
| GET | `/api/dashboard/subscriptions/export` | تصدير اشتراكات JSON | admin/superadmin | موجود |
| POST | `/api/dashboard/subscriptions` | إنشاء اشتراك من الداشبورد | admin/superadmin | موجود |
| POST | `/api/dashboard/subscriptions/quote` | حساب quote قبل إنشاء اشتراك Admin | admin/superadmin | جديد مقترح |
| GET | `/api/dashboard/subscriptions/:id` | تفاصيل اشتراك | admin/superadmin | موجود |
| GET | `/api/dashboard/subscriptions/:id/days` | أيام الاشتراك | admin/superadmin | موجود |
| POST | `/api/dashboard/subscriptions/:id/cancel` | إلغاء اشتراك | admin/superadmin | موجود |
| PUT | `/api/dashboard/subscriptions/:id/extend` | تمديد اشتراك | admin/superadmin | موجود |
| POST | `/api/dashboard/subscriptions/:id/freeze` | تجميد اشتراك | admin/superadmin | موجود |
| POST | `/api/dashboard/subscriptions/:id/unfreeze` | إلغاء تجميد | admin/superadmin | موجود |
| POST | `/api/dashboard/subscriptions/:id/days/:date/skip` | تخطي يوم | admin/superadmin | موجود |
| POST | `/api/dashboard/subscriptions/:id/days/:date/unskip` | إلغاء تخطي يوم | admin/superadmin | موجود |
| PUT | `/api/dashboard/subscriptions/:id/delivery` | تعديل بيانات توصيل الاشتراك من الداشبورد | admin/superadmin | جديد مقترح أو إعادة استخدام service موجود |
| PATCH | `/api/dashboard/subscriptions/:id/balances` | تعديل premium/addon balances بشكل audited | superadmin/admin محدود | جديد |
| PATCH | `/api/dashboard/subscriptions/:id/addon-entitlements` | إضافة/حذف/تعديل addonSubscriptions | admin/superadmin | جديد |
| GET | `/api/dashboard/subscriptions/:id/audit-log` | سجل تغييرات الاشتراك | admin/superadmin | جديد |
| GET | `/api/dashboard/plans` | قائمة الخطط | admin/superadmin | موجود |
| POST | `/api/dashboard/plans` | إنشاء خطة | admin/superadmin | موجود |
| PUT | `/api/dashboard/plans/:id` | تعديل خطة | admin/superadmin | موجود |
| DELETE | `/api/dashboard/plans/:id` | حذف خطة | admin/superadmin | موجود، يفضل soft delete/guard |
| PATCH | `/api/dashboard/plans/:id/toggle` | تفعيل/تعطيل خطة | admin/superadmin | موجود |
| POST | `/api/dashboard/addon-plans` | إنشاء Addon Plan للـ checkout | admin/superadmin | جديد أو إصلاح `/addons` |
| GET | `/api/dashboard/addon-plans` | عرض Addon Plans | admin/superadmin | جديد |
| PUT | `/api/dashboard/addon-plans/:id` | تعديل Addon Plan | admin/superadmin | جديد |
| GET | `/api/admin/meal-planner-menu/addons` | عرض Addon Items | admin/superadmin | موجود |
| POST | `/api/admin/meal-planner-menu/addons` | إنشاء Addon Item | admin/superadmin | موجود |
| PUT | `/api/admin/meal-planner-menu/addons/:id` | تعديل Addon Item | admin/superadmin | موجود |
| DELETE | `/api/admin/meal-planner-menu/addons/:id` | soft delete Addon Item | admin/superadmin | موجود |
| GET | `/api/dashboard/users` | مستخدمو التطبيق | admin/superadmin | موجود |
| POST | `/api/dashboard/users` | إنشاء مستخدم تطبيق | admin/superadmin | موجود |
| PUT | `/api/dashboard/users/:id` | تفعيل/تعطيل مستخدم | admin/superadmin | موجود |
| GET | `/api/dashboard/payments` | المدفوعات | admin/superadmin | موجود |
| POST | `/api/dashboard/payments/:id/verify` | تحقق يدوي من الدفع | admin/superadmin | موجود |
| GET | `/api/dashboard/zones` | مناطق التوصيل | admin/superadmin | جديد |
| POST | `/api/dashboard/zones` | إنشاء منطقة | admin/superadmin | جديد |
| PUT | `/api/dashboard/zones/:id` | تعديل منطقة | admin/superadmin | جديد |
| PATCH | `/api/dashboard/zones/:id/toggle` | تفعيل/تعطيل منطقة | admin/superadmin | جديد |
| GET | `/api/dashboard/health/catalog` | تشخيص كتالوج الخطط والاشتراكات | superadmin/admin read | جديد |
| POST | `/api/dashboard/maintenance/:migration/dry-run` | تشغيل migration كـ dry-run | superadmin | جديد |
| POST | `/api/dashboard/maintenance/:migration/apply` | تنفيذ migration مصرح | superadmin + confirm | جديد |

## 9. Database / Models المطلوبة

الموجود كافٍ كبداية، لكن توجد تعديلات/حماية مقترحة:

- `Plan.js`:
  - لا يحتاج schema جديد لإدارة الخطط الأساسية.
  - يفضل منع hard delete إذا توجد اشتراكات مرتبطة بالخطة، واستبداله بتعطيل `isActive`.
- `Addon.js`:
  - الموديل جيد ويدعم `kind`, `category`, `billingMode`.
  - المشكلة في `src/controllers/addonController.js` لا في الموديل: لا يطبع/يفلتر حقول `kind` و`category` من request.
  - مطلوب validation واحد واضح:
    - `kind=plan` يسمح `billingMode=per_day/per_meal`.
    - `kind=item` يسمح غالبًا `billingMode=flat_once`.
    - `category` إجباري.
- `Subscription.js`:
  - يدعم معظم المطلوب.
  - مطلوب audit أقوى لأي تعديل يدوي في `addonSubscriptions`, `premiumBalance`, `addonBalance`, `delivery`, `status`.
  - يفضل إضافة حقول اختيارية مثل `createdByDashboardUserId`, `lastAdminActionAt` أو الاعتماد على `ActivityLog/SubscriptionAuditLog`.
- `SubscriptionDay.js`:
  - يدعم حالات التشغيل والتخطيط.
  - تحتاج Dashboard detail view يقرأ `mealSlots`, `plannerMeta`, `addonSelections`, `premiumUpgradeSelections`.
- `Zone.js`:
  - موجود، لكن Dashboard CRUD ناقص.
- `DashboardUser.js`:
  - يدعم roles عامة، لكن لا يدعم permissions تفصيلية.
  - إما إضافة `permissions: [String]` أو إنشاء Role policy ثابتة في الكود.
- `Setting.js`:
  - موجود ويغطي إعدادات عامة.
  - يجب توثيق keys المعتمدة في صفحة Settings.

## 10. Permissions & Roles

الوضع الحالي:

- `superadmin` يتجاوز كل role checks.
- `/api/dashboard` في `src/routes/admin.js` يتطلب `dashboardRoleMiddleware(["admin"])`، وبالتالي `admin` و`superadmin` فقط.
- `/api/dashboard/ops` يسمح لـ `admin`, `kitchen`, `courier`.
- لا توجد صلاحيات دقيقة لكل عملية.

المطلوب:

| الدور | الصلاحيات المقترحة |
|---|---|
| superadmin | كل شيء، migrations، إدارة dashboard users، verify payments، حذف/تعطيل حساس. |
| admin | إدارة الاشتراكات، الخطط، الإضافات، المستخدمين، الإعدادات، المحتوى، التقارير. |
| kitchen | Ops فقط: رؤية أيام التحضير، تغيير حالات المطبخ، pickup verify حسب policy. |
| courier | Ops delivery فقط: رؤية التسليم وتحديث حالاته. |
| finance أو accountant مستقبلاً | قراءة المدفوعات والتقارير والتحقق اليدوي بدون تعديل الكتالوج. |

اقتراح عملي:

- إضافة middleware permissions فوق role:
  - `subscriptions.read`
  - `subscriptions.write`
  - `subscriptions.cancel`
  - `subscriptions.balance.adjust`
  - `catalog.read`
  - `catalog.write`
  - `payments.read`
  - `payments.verify`
  - `settings.write`
  - `users.write`
  - `maintenance.run`
- تسجيل كل write action في `ActivityLog` أو `SubscriptionAuditLog`.

## 11. خطة التنفيذ بالترتيب

### المرحلة 1: Dashboard Core للاشتراكات

- بناء واجهة login وربط JWT.
- بناء layout أساسي للداشبورد.
- صفحة Overview.
- صفحة Subscriptions list/detail.
- صفحة Create Subscription تعتمد على API الحالي.
- إضافة API quote للداشبورد قبل الإنشاء.
- ربط cancel/extend/freeze/unfreeze/skip/unskip.

### المرحلة 2: Catalog Management بدل السكريبتات

- صفحة Plans كاملة.
- إصلاح/توحيد Addons APIs.
- صفحة Addon Plans للـ checkout.
- صفحة Addon Items للـ meal planner.
- صفحة Meal Planner Catalog للبروتينات والكارب والسندوتشات وpremium.
- صفحة Content Terms.
- صفحة Settings.

### المرحلة 3: Data Administration

- صفحة Users.
- صفحة Payments.
- صفحة Delivery Zones مع API جديد.
- صفحة Dashboard Users.
- تحسين filters/export.
- إضافة audit log views.

### المرحلة 4: Data Health & Script Replacement

- صفحة Catalog Health مبنية على `catalogHealthService`.
- Diagnostics للـ subscription menu والـ meal planner canonical data.
- تحويل backfill/cleanup scripts إلى maintenance actions محمية بـ dry-run وconfirm.
- تنظيف `package.json` من scripts التي تشير لملفات غير موجودة.

### المرحلة 5: Hardening

- صلاحيات granular.
- منع hard delete للكيانات المستخدمة.
- اختبارات integration للـ Dashboard APIs.
- توثيق Swagger للـ endpoints الجديدة.
- مراجعة production safety للـ migrations.

## 12. Checklist تنفيذ

- [ ] تأكيد مكان مشروع Dashboard UI أو إنشاء مشروع جديد داخل/خارج الريبو.
- [ ] بناء صفحة login وربط `/api/dashboard/auth/login`.
- [ ] بناء App Shell للداشبورد.
- [ ] بناء Overview من `/api/dashboard/overview`.
- [ ] بناء Subscriptions list مع filters وpagination.
- [ ] بناء Subscription detail.
- [ ] ربط cancel/extend/freeze/unfreeze/skip/unskip.
- [ ] إضافة `POST /api/dashboard/subscriptions/quote`.
- [ ] بناء Create Subscription form.
- [ ] بناء Plans CRUD.
- [ ] تعديل `src/controllers/addonController.js` ليدعم `kind` و`category`.
- [ ] بناء Addon Plans page.
- [ ] بناء Addon Items page.
- [ ] بناء Meal Planner Catalog pages.
- [ ] إضافة Zones CRUD APIs.
- [ ] بناء Zones page.
- [ ] بناء Users page.
- [ ] بناء Payments page.
- [ ] بناء Settings page.
- [ ] بناء Content Terms page.
- [ ] بناء Dashboard Users page.
- [ ] إضافة Audit Log لكل عمليات الاشتراك الحساسة.
- [ ] إضافة Data Health APIs.
- [ ] تحويل scripts المهمة إلى maintenance tools أو صفحات.
- [ ] تنظيف scripts غير الموجودة في `package.json`.
- [ ] إضافة اختبارات Dashboard APIs.
- [ ] تحديث Swagger/docs.

## 13. ملاحظات مهمة

- لا يوجد Dashboard UI داخل الريبو الحالي؛ الموجود Backend APIs فقط.
- Flutter frontend منفصل حسب `DOCKER_RESTORE_NOTES.md`.
- يجب عدم الاعتماد على scripts لإدارة production data اليومية.
- أخطر Gap حاليًا هو إدارة `Addon` لأن موديل `Addon` يتطلب `category` ويميز `kind`، لكن `/api/dashboard/addons` لا يعالج هذه الحقول في `addonController`.
- لا تستخدم hard delete للخطط أو الإضافات أو الكتالوج إذا كانت مرتبطة باشتراكات أو أيام سابقة؛ استخدم `isActive=false`.
- أسعار الاشتراك شاملة VAT حسب `docs/vat-inclusive-subscription-pricing.md`، فلا تعرض للعميل سعرًا زائد VAT مرة أخرى.
- `Addon Plans` و`Addon Items` مرتبطان بالـ `category` فقط، ولا توجد علاقة parent-child في الداتا حسب `docs/frontend-subscription-addons.md`.
- أي تعديل يدوي في اشتراك نشط يجب أن يكتب audit: من نفذ، متى، السبب، قبل/بعد.
- عمليات backfill/cleanup يجب أن تكون superadmin-only ويفضل dry-run أولًا.
- أوامر `package.json` التي تشير لملفات غير موجودة يجب تنظيفها قبل الاعتماد على scripts في التشغيل.

## تحديث التنفيذ - Backend Endpoints

تم تنفيذ مرحلة Backend-only بدون إضافة أي UI أو Frontend. لم يتم إنشاء React/Vue/Angular/Flutter أو أي مجلد dashboard UI. التغييرات تركزت على APIs وخدمات Backend واختبارات وتوثيق.

### Endpoints تمت إضافتها

- `GET /api/dashboard/addon-plans`
- `POST /api/dashboard/addon-plans`
- `GET /api/dashboard/addon-plans/:id`
- `PUT /api/dashboard/addon-plans/:id`
- `PATCH /api/dashboard/addon-plans/:id/toggle`
- `POST /api/dashboard/subscriptions/quote`
- `PUT /api/dashboard/subscriptions/:id/delivery`
- `PATCH /api/dashboard/subscriptions/:id/addon-entitlements`
- `PATCH /api/dashboard/subscriptions/:id/balances`
- `GET /api/dashboard/subscriptions/:id/audit-log`
- `GET /api/dashboard/zones`
- `POST /api/dashboard/zones`
- `GET /api/dashboard/zones/:id`
- `PUT /api/dashboard/zones/:id`
- `PATCH /api/dashboard/zones/:id/toggle`
- `DELETE /api/dashboard/zones/:id`
- `GET /api/dashboard/health/catalog`
- `GET /api/dashboard/health/subscription-menu`
- `GET /api/dashboard/health/meal-planner`
- `GET /api/dashboard/health/indexes`

### Endpoints تم تعديلها

- `GET /api/dashboard/addons`
  - يدعم filters: `kind`, `category`, `isActive`, `billingMode`.
- `POST /api/dashboard/addons`
  - يدعم الآن `kind`, `category`, `billingMode` مع validation واضح.
- `PUT /api/dashboard/addons/:id`
  - يدعم نفس حقول وvalidation إنشاء الإضافة.
- `DELETE /api/dashboard/addons/:id`
  - أصبح soft delete عبر `isActive=false`.
- `DELETE /api/dashboard/plans/:id`
  - أصبح تعطيل آمن للخطة عبر `isActive=false` بدل hard delete.
- `POST /api/dashboard/subscriptions`
  - يدعم aliases الخاصة بالداشبورد مثل `addonPlans`, `premiumSelections`, `deliveryMethod`, `zoneId`.

### الملفات التي تم تعديلها أو إضافتها

| الملف | التغيير |
|---|---|
| `src/controllers/addonController.js` | دعم `kind/category/billingMode`، filters، soft delete، aliases للـ addon plans، activity log. |
| `src/controllers/adminController.js` | إضافة quote/admin subscription management/audit log، audit للعمليات الحساسة، soft delete للخطط. |
| `src/routes/admin.js` | إضافة routes الجديدة للـ addon plans، subscription admin، zones، health. |
| `src/controllers/zoneController.js` | Controller جديد لإدارة مناطق التوصيل. |
| `src/controllers/dashboardHealthController.js` | Controller جديد لـ health diagnostics read-only. |
| `src/services/dashboardHealthService.js` | Service جديد لتجميع diagnostics بدون writes. |
| `tests/dashboardAdminEndpoints.test.js` | اختبار تكاملي جديد للـ Dashboard backend endpoints. |
| `DASHBOARD_SUBSCRIPTIONS_PLAN_AR.md` | تحديث التنفيذ والجدول النهائي. |

### Tests التي تمت إضافتها أو تشغيلها

| الاختبار | النتيجة |
|---|---|
| `NODE_ENV=test node tests/dashboardAdminEndpoints.test.js` | نجح. يغطي Addons، Addon Plans، Quote، Subscription admin updates، Zones، Health read-only. |
| `npm test` | نجح. 49 اختبار passed. |
| `npm run smoke:integrity` | لم يكتمل بسبب safety guard: قاعدة البيانات الحالية اسمها `basicdiet145` ولا تنتهي بـ `_test`. لم يتم استخدام bypass حفاظًا على الأمان. |

### Endpoints مؤجلة

- لم يتم تنفيذ cleanup/maintenance action في هذه المرحلة لأن التنفيذ لم يحتج cleanup لتوحيد النظام.
- Health endpoints بقيت read-only فقط كما هو مطلوب.
- لم يتم حذف Dashboard Users أو App Users.

### ملاحظات مهمة بعد التنفيذ

- `PATCH /api/dashboard/subscriptions/:id/addon-entitlements` يتطلب `reason` إجباري.
- `PATCH /api/dashboard/subscriptions/:id/balances` يتطلب `reason` إجباري ومقيد بـ `superadmin` فقط.
- تعديل balances وaddon entitlements يسجل في `SubscriptionAuditLog` و`ActivityLog`.
- Addon Plans تستخدم نفس `Addon` model مع `kind=plan`.
- عناصر الإضافات اليومية تستخدم `kind=item`.
- حذف Addons وZones وPlans لم يعد hard delete من endpoints الجديدة/المعدلة.

## Backend Endpoints النهائية للداشبورد

| Method | Endpoint | الوظيفة | Status | Notes |
|---|---|---|---|---|
| GET | `/api/dashboard/addons` | عرض الإضافات مع filters | معدل | يدعم `kind/category/isActive/billingMode`. |
| POST | `/api/dashboard/addons` | إنشاء إضافة plan أو item | معدل | validation على `kind/category/billingMode`. |
| GET | `/api/dashboard/addons/:id` | تفاصيل إضافة | موجود | يرجع كل حقول Addon. |
| PUT | `/api/dashboard/addons/:id` | تعديل إضافة | معدل | نفس validation الإنشاء. |
| PATCH | `/api/dashboard/addons/:id/toggle` | تفعيل/تعطيل إضافة | موجود/معدل | يسجل activity log. |
| DELETE | `/api/dashboard/addons/:id` | حذف آمن لإضافة | معدل | soft delete عبر `isActive=false`. |
| GET | `/api/dashboard/addon-plans` | عرض خطط الإضافات | جديد | يفرض `kind=plan`. |
| POST | `/api/dashboard/addon-plans` | إنشاء خطة إضافة | جديد | يرفض `kind=item`. |
| GET | `/api/dashboard/addon-plans/:id` | تفاصيل خطة إضافة | جديد | يبحث فقط في `kind=plan`. |
| PUT | `/api/dashboard/addon-plans/:id` | تعديل خطة إضافة | جديد | يفرض `kind=plan`. |
| PATCH | `/api/dashboard/addon-plans/:id/toggle` | تفعيل/تعطيل خطة إضافة | جديد | يفرض `kind=plan`. |
| POST | `/api/dashboard/subscriptions/quote` | حساب quote قبل إنشاء اشتراك | جديد | يعيد استخدام pricing logic الحالي. |
| POST | `/api/dashboard/subscriptions` | إنشاء اشتراك من الداشبورد | معدل | يدعم aliases الجديدة ويسجل audit. |
| GET | `/api/dashboard/subscriptions` | قائمة الاشتراكات | موجود | لم يتغير. |
| GET | `/api/dashboard/subscriptions/summary` | إحصائيات الاشتراكات | موجود | لم يتغير. |
| GET | `/api/dashboard/subscriptions/export` | تصدير الاشتراكات | موجود | لم يتغير. |
| GET | `/api/dashboard/subscriptions/:id` | تفاصيل اشتراك | موجود | لم يتغير. |
| GET | `/api/dashboard/subscriptions/:id/days` | أيام الاشتراك | موجود | لم يتغير. |
| PUT | `/api/dashboard/subscriptions/:id/delivery` | تعديل بيانات التوصيل | جديد | يسجل audit/activity. |
| PATCH | `/api/dashboard/subscriptions/:id/addon-entitlements` | تعديل addon subscriptions | جديد | يتطلب `reason`. |
| PATCH | `/api/dashboard/subscriptions/:id/balances` | تعديل premium/addon balances | جديد | superadmin فقط ويتطلب `reason`. |
| GET | `/api/dashboard/subscriptions/:id/audit-log` | سجل audit/activity للاشتراك | جديد | يشمل subscription وsubscription days. |
| POST | `/api/dashboard/subscriptions/:id/cancel` | إلغاء اشتراك | موجود/معدل | أضيف audit log. |
| PUT | `/api/dashboard/subscriptions/:id/extend` | تمديد اشتراك | موجود/معدل | أضيف audit log. |
| POST | `/api/dashboard/subscriptions/:id/freeze` | تجميد اشتراك | موجود/معدل | أضيف audit log. |
| POST | `/api/dashboard/subscriptions/:id/unfreeze` | فك تجميد | موجود/معدل | أضيف audit log. |
| POST | `/api/dashboard/subscriptions/:id/days/:date/skip` | تخطي يوم | موجود/معدل | أضيف audit log. |
| POST | `/api/dashboard/subscriptions/:id/days/:date/unskip` | إلغاء تخطي يوم | موجود/معدل | أضيف audit log. |
| GET | `/api/dashboard/zones` | عرض مناطق التوصيل | جديد | يدعم `q` و`isActive`. |
| POST | `/api/dashboard/zones` | إنشاء منطقة توصيل | جديد | يسجل activity log. |
| GET | `/api/dashboard/zones/:id` | تفاصيل منطقة | جديد | - |
| PUT | `/api/dashboard/zones/:id` | تعديل منطقة | جديد | يسجل activity log. |
| PATCH | `/api/dashboard/zones/:id/toggle` | تفعيل/تعطيل منطقة | جديد | - |
| DELETE | `/api/dashboard/zones/:id` | حذف آمن لمنطقة | جديد | soft delete عبر `isActive=false`. |
| GET | `/api/dashboard/health/catalog` | صحة الخطط وسلامة الاشتراكات | جديد | read-only. |
| GET | `/api/dashboard/health/subscription-menu` | تشخيص كتالوج menu | جديد | read-only. |
| GET | `/api/dashboard/health/meal-planner` | تشخيص meal planner catalog | جديد | read-only. |
| GET | `/api/dashboard/health/indexes` | فحص indexes المهمة | جديد | read-only. |
