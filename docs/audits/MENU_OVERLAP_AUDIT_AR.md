> Status: Historical / audit reference. Do not use this as the current frontend or API implementation source of truth. For current frontend handoff docs, see `docs/frontend-handoff/`.

# Menu Overlap Audit: One-Time vs Subscription

هذا التدقيق يوثق التداخل الحالي بين كتالوج طلبات one-time وكتالوج الاشتراكات/meal planner كما يظهر من الكود والوثائق والاختبارات. لم يتم تشغيل seeds أو migrations، ولم يتم تغيير أي كود.

## 1. Executive Summary

يوجد تكرار واضح بين النظامين في مفاهيم الطعام الأساسية: بروتينات، كارب، خضار، فواكه، صوصات، أجبان/مكسرات، ساندويتشات، عصائر/سناك/add-ons، أسماء مترجمة، صور، `isActive`، و`sortOrder`.

لكن التكرار ليس تطابقاً كاملاً. في one-time menu هذه المفاهيم تظهر غالباً كـ `MenuProduct` أو `MenuOption` داخل `MenuOptionGroup`، ويتم تسعيرها مباشرة عند إنشاء quote/order. في subscription/meal planner تظهر كـ `BuilderProtein`, `BuilderCarb`, `SaladIngredient`, `Addon`, و`Sandwich` داخل قواعد `mealSlots`, plan allowance, premium balance, وday payments.

الدمج الكامل الآن خطر لأنه قد يخلط:

- تسعير one-time بالوزن/الاختيارات مع تسعير subscription بالخطط.
- snapshots الخاصة بالطلبات مع planner state الخاصة بالأيام.
- دورة حياة `Order` مع دورة حياة `SubscriptionDay`.
- add-ons اليومية في الاشتراك مع products مباشرة في one-time.

الاتجاه الأكثر أماناً هو: shared base catalog أو shared identity layer، مع channel-specific rules/adapters. أي أن الهوية والاسم والصورة والتصنيف العام يمكن مشاركتها تدريجياً، لكن منطق التسعير والاختيار والدفع والـ lifecycle يبقى منفصلاً لكل قناة.

## 2. Current One-Time Menu Sources

### Models

- `src/models/MenuCategory.js`: يملك أقسام one-time مثل `custom_order`, `cold_sandwiches`, `sourdough`, `desserts`, `juices`, `drinks`, `ice_cream`. يحتوي localized `name/description`, `imageUrl`, flags `isActive/isVisible/isAvailable`, `sortOrder`, availability, و`publishedAt`.
- `src/models/MenuProduct.js`: يملك المنتجات المعروضة في one-time. يحتوي `categoryId`, `key`, `itemType`, `pricingModel` (`fixed` أو `per_100g`), `priceHalala`, حقول الوزن مثل `baseUnitGrams/defaultWeightGrams/minWeightGrams/maxWeightGrams/weightStepGrams`, flags، `branchAvailability`, `versionId`, و`publishedAt`.
- `src/models/MenuOptionGroup.js`: يملك مجموعات خيارات مثل `leafy_greens`, `vegetables_legumes`, `fruits`, `proteins`, `cheese_nuts`, `sauces`, `carbs`, `nuts`.
- `src/models/MenuOption.js`: يملك الخيار نفسه داخل group، مثل `دجاج مشوي`, `رز برياني`, `سيزر`. يحتوي `extraPriceHalala`, `extraWeightUnitGrams`, `extraWeightPriceHalala`.
- `src/models/ProductOptionGroup.js`: يربط product بـ option group ويملك rules: `minSelections`, `maxSelections`, `isRequired`, visibility/availability/sort.
- `src/models/ProductGroupOption.js`: يربط product + group + option، ويملك overrides مثل `extraPriceHalala` و`extraWeightPriceHalala` لكل product.
- `src/models/MenuVersion.js`: يحفظ publish snapshot وحالة version.
- `src/models/MenuAuditLog.js`: يسجل تغييرات الكتالوج: entity/action/before/after/actor/version/meta.

### Services

- `src/services/orders/menuCatalogService.js`: مصدر CRUD/publish/customer catalog الحالي. يملك إنشاء/تحديث/حذف/إعادة ترتيب categories/products/groups/options، علاقات product groups/options، visibility/availability، و`publishMenu`.
- `src/services/orders/menuPricingService.js`: يملك quote pricing لمنتجات one-time. يتحقق من product/category publication، rules، min/max، stale selections، الوزن، branch availability، ويحسب Halala/VAT included.
- `src/services/orders/orderMenuService.js`: يملك `getOneTimeOrderMenu`. إذا وجد published dynamic catalog يستخدم `getPublishedMenu`. إذا لم يوجد، يرجع fallback من `BuilderProtein/BuilderCarb/Sandwich/SaladIngredient/Addon`. هذا fallback مهم تاريخياً، لكنه ليس الكتالوج الديناميكي النهائي.

### Routes / Controllers

- `src/routes/orders.js`: يعرّف `GET /api/orders/menu`, `POST /api/orders/quote`, `POST /api/orders`, `POST /api/orders/checkout`, verify/payment/status/list/detail.
- `src/routes/dashboardMenu.js`: يعرّف CRUD Dashboard للـ one-time menu تحت `/api/dashboard/menu/*`.
- `src/controllers/orderController.js`: ينسق get menu, quote, create/checkout order, idempotency, payment init, verify.
- `src/controllers/dashboard/menuController.js`: wrapper حول `menuCatalogService` مع auth/role من route.

### Seed

- `scripts/seed-one-time-menu.js`: seed guarded للكتالوج الديناميكي. يعرّف:
  - categories مثل `custom_order`, `cold_sandwiches`, `sourdough`, `desserts`, `juices`, `drinks`.
  - option groups مثل `proteins`, `carbs`, `sauces`.
  - products مثل `basic_salad`, `basic_meal`, `fruit_salad`, `greek_yogurt`, `green_salad`, cold sandwiches, sourdough, desserts, juices, drinks, ice cream.
  - `proteinPricing()` الذي يعطي extra price/extra weight لبعض البروتينات داخل one-time.
  - `publishMenu()` في نهاية seed.

### Ownership Summary

- categories/products/options: `Menu*` models + `menuCatalogService`.
- pricing/weight pricing: `menuPricingService` + fields داخل `MenuProduct`, `MenuOption`, `ProductGroupOption`.
- snapshots: `Order.items.productSnapshot`, `Order.items.selectedOptions`, `Order.items.pricingSnapshot`, `menuVersionId` في `Order.js`.
- publish/audit: `MenuVersion`, `MenuAuditLog`, و`publishMenu`.
- dashboard CRUD: `dashboardMenu.js` + `dashboard/menuController.js`.

## 3. Current Subscription Menu Sources

### Models

- `src/models/BuilderProtein.js`: بروتينات planner، standard وpremium. يحتوي `key`, `displayCategoryKey`, `proteinFamilyKey`, `selectionType`, `isPremium`, `premiumKey`, `premiumCreditCost`, `extraFeeHalala`, `availableForSubscription`, `nutrition`.
- `src/models/BuilderCarb.js`: كارب planner. يحتوي `key`, `displayCategoryKey`, `availableForSubscription`, `nutrition`, وlegacy mapping.
- `src/models/BuilderCategory.js`: تصنيفات builder للبروتين والكارب مع rules مثل `dailyLimit`, `maxTypes`, `maxTotalGrams`.
- `src/models/SaladIngredient.js`: مكونات السلطة للـ premium large salad، مع `groupKey`, `price`, `calories`, `maxQuantity`, `isActive`, `sortOrder`.
- `src/models/Addon.js`: add-ons للاشتراك واليوم. يحتوي `kind` (`plan` أو `item`), `billingMode` (`flat_once`, `per_day`, `per_meal`), `category`, `priceHalala`, `type/pricingModel/billingUnit`.
- `src/models/Sandwich.js`: sandwich catalog للـ planner. يحتوي `selectionType = sandwich`, `pricingModel = included`, `priceHalala`, `proteinFamilyKey`, `isActive`.
- `src/models/Plan.js`: خطط الاشتراك، `daysCount`, `gramsOptions`, `mealsOptions`, skip/freeze policies.
- `src/models/Subscription.js`: حالة الاشتراك، plan, balances, premium/addon entitlements, delivery/pickup defaults.
- `src/models/SubscriptionDay.js`: source of truth اليومي للـ planner: `mealSlots`, `plannerMeta`, `premiumExtraPayment`, `materializedMeals`, status lifecycle, pickup/delivery fields.

### Services

- `src/services/subscription/*`: حزمة واسعة تملك checkout, quote, activation, timeline, day selection, day transition, skip/freeze, payments, fulfillment status.
- `src/services/subscription/mealPlannerCatalogService.js`: يبني `builderCatalog` من `BuilderCategory`, `BuilderProtein`, `BuilderCarb`, `SaladIngredient`, `Sandwich`, وبعض legacy `Meal`.
- `src/services/subscription/mealSlotPlannerService.js`: يملك validation وقواعد `mealSlots`: standard meal, premium meal, sandwich, premium large salad.
- `src/services/admin/mealPlannerMenu.service.js`: CRUD إداري لكتالوج planner: categories, standard proteins, premium proteins, sandwiches, carbs, item add-ons, salad ingredients.

### Controllers / Routes

- `src/controllers/subscriptionController.js`: quote/checkout/verify/activation/timeline/days/selection/payments/skip/freeze/pickup/delivery.
- `src/controllers/menuController.js`: `getSubscriptionMenu`, `getSubscriptionMealPlannerMenu`, و`getDeliveryOptions`.
- `src/controllers/admin/mealPlannerMenu.controller.js`: wrapper إداري حول `mealPlannerMenu.service`.
- `src/routes/subscriptions.js`: مسارات customer subscription والplanner.
- `src/routes/adminMealPlannerMenu.routes.js`: admin/dashboard routes للـ planner menu.

### Docs / Tests

- `docs/meal-planner/MEAL_PLANNER_CANONICAL_CONTRACT.md`: يحدد canonical `mealSlots`, selection types, salad groups, builderCatalog contract.
- `docs/product-flows/unified-selection-payment-flow.md`: يشرح unified day payment وmetadata snapshot.
- اختبارات مهمة: `tests/meal_planner_types.test.js`, `tests/mealPlanner.integration.test.js`, `tests/checkout.integration.test.js`, `tests/mealPlannerPaymentContract.test.js`, `tests/subscriptionBalancePolicy.test.js`, `tests/unified_day_payment_verify.test.js`.

### Ownership Summary

- subscription menu/planner menu: `mealPlannerCatalogService`, `menuController`.
- proteins/carbs/salads: `BuilderProtein`, `BuilderCarb`, `SaladIngredient`, `BuilderCategory`.
- add-ons: `Addon` مع `kind/billingMode`.
- meal slots: `SubscriptionDay.mealSlots` + `mealSlotPlannerService`.
- plan allowance: `Plan`, `subscriptionQuoteService`, `subscriptionCheckoutService`.
- premium balance: `Subscription.premiumBalance`, `premiumSelections`, وpayment services.
- subscription day lifecycle: `SubscriptionDay.status` وخدمات `subscriptionDay*`, `fulfillmentService`, kitchen/courier flows.

## 4. Concept Overlap Table

| Concept | One-Time Representation | Subscription Representation | Same / Different / Partial | Can Be Shared? | Notes / Risks |
| --- | --- | --- | --- | --- | --- |
| categories | `MenuCategory` مثل `custom_order`, `juices` | `BuilderCategory` للبروتين/الكارب، و`Addon.category`، و`Plan` ليس category | Partial | جزئياً | one-time categories للعرض التجاري، subscription categories لقواعد planner. |
| products | `MenuProduct` | لا يوجد product عام؛ يوجد `BuilderProtein/BuilderCarb/Sandwich/Addon` وselection types | Different | الهوية فقط | تحويل كل subscription item إلى product قد يكسر slot logic. |
| proteins | `MenuOption` داخل group `proteins` مع product-specific overrides | `BuilderProtein` مع `proteinFamilyKey`, premium flags, balance | Partial | نعم كهوية | التسعير والقواعد يجب أن تبقى منفصلة. |
| carbs | `MenuOption` داخل group `carbs` | `BuilderCarb` مع `displayCategoryKey=standard_carbs` | Partial | نعم كهوية | one-time قد يفرض min 3 في `basic_meal`; subscription يقبل 1-2 carbs بإجمالي <= 300g. |
| salad ingredients | `MenuOption` ضمن groups متعددة | `SaladIngredient` للمجموعات ingredient و`BuilderProtein` لمجموعة protein الافتراضية | Partial | نعم كهوية/اسم | أسماء groups تختلف: `vegetables_legumes` مقابل `vegetables`, `sauces` مقابل `sauce`. |
| vegetables | `vegetables_legumes` options | `SaladIngredient.groupKey=vegetables` | Partial | نعم مع alias | يحتاج mapping واضح لتجنب فقد legumes مثل حمص/فاصوليا. |
| fruits | `fruits` options | `SaladIngredient.groupKey=fruits` | Partial | نعم | one-time fruit salad يستخدم group rules مختلفة. |
| sauces | `sauces` group | `sauce` group في `SALAD_SELECTION_GROUPS` | Partial | نعم مع alias | اختلاف الجمع/المفرد خطر على migration. |
| cheese/nuts | `cheese_nuts` و`nuts` | `cheese_nuts` | Partial | نعم | one-time لديه `nuts` group مستقل لزبادي يوناني. |
| sandwiches | `MenuProduct` itemTypes `cold_sandwich`, `sourdough` | `Sandwich` selectionType `sandwich`, pricing included | Partial | الاسم/الصورة فقط | one-time sandwich مدفوع fixed؛ subscription sandwich included داخل plan. |
| add-ons | fixed products في drinks/desserts/juices و`Addon` fallback | `Addon` kind `plan` أو `item` | Partial | item identity فقط | plan add-on مختلف عن item add-on؛ لا تدمج billing. |
| images | `imageUrl` في `MenuCategory/MenuProduct/MenuOption` | `imageUrl` في `BuilderProtein/Sandwich/Addon` غالباً، ليس في كل carb/salad | Partial | نعم | بعض seed subscription images فارغة أو pexels/picsum؛ توحيدها يحتاج قرار content. |
| localized names | `{ ar, en }` في معظم models | `{ ar, en }` في معظم models | Same | نعم | آمن نسبياً مع aliases للأسماء المختلفة مثل جمبري/روبيان. |
| active flags | `isActive/isVisible/isAvailable` | غالباً `isActive`, و`availableForSubscription` لبعض models | Partial | بحذر | one-time visibility/availability أكثر تفصيلاً. |
| sort order | `sortOrder` في كل menu entities/relations | `sortOrder` في builder/addon/sandwich/salad | Same/Partial | channel override أفضل | ترتيب one-time UI قد لا يناسب planner. |
| price fields | `priceHalala`, `extraPriceHalala`, `extraWeightPriceHalala` | `extraFeeHalala`, `priceHalala`, plan prices, fixed premium salad price | Different | لا للمنطق، نعم للعرض | اختلاف semantics خطر جداً. |
| weight pricing | `pricingModel=per_100g` وweight fields | carb grams rules، ليس pricing per 100g | Different | لا | لا تدمج. |
| option group rules | `ProductOptionGroup.min/max/isRequired` | `mealSlotPlannerService` و`mealPlannerContract` | Different | لا، إلا identities | rules ليست نفس النوع. |
| branch availability | `MenuProduct.branchAvailability`, `MenuCategory.availability` | غير واضح كقاعدة عامة؛ subscription لديه pickup/delivery/zone | Different | غير مؤكد من الكود الحالي | سؤال مفتوح: هل الاشتراك يحتاج branch availability؟ |
| snapshots | `Order.items.*Snapshot` | `Subscription.contractSnapshot`, `SubscriptionDay.lockedSnapshot/fulfilledSnapshot/materializedMeals` | Different | لا | snapshots immutability يجب أن تبقى منفصلة. |
| audit logs | `MenuAuditLog` | `SubscriptionAuditLog`, `ActivityLog`, admin content logs | Partial | ربما نمط logging فقط | دمج audit domains قد يربك entityType. |

## 5. Item-Level Mapping From Seeds/Code

هذه أمثلة من `scripts/seed-one-time-menu.js`, `scripts/seedBuilderCatalogData.js`, `scripts/seedPremiumCatalog.js`, `scripts/seed-subscription-addons.js`, و`src/config/mealPlannerContract.js`. لم يتم فحص قاعدة البيانات الحية؛ أي اختلاف بيانات في MongoDB الحالي غير مؤكد من الكود الحالي.

| Item | Exists in One-Time? | Exists in Subscription? | Same Name? | Same Price Behavior? | Same Option Behavior? | Migration Risk |
| --- | --- | --- | --- | --- | --- | --- |
| دجاج مشوي | نعم، `MenuOption` ضمن `proteins`، وأيضاً cold/sourdough products | نعم، `BuilderProtein key=grilled_chicken` | نعم تقريباً | لا؛ one-time extra weight 50g/500 Halala، subscription standard included | لا؛ one-time خيار داخل product، subscription protein slot | متوسط |
| دجاج سبايسي | نعم، `MenuOption` ضمن `proteins` | نعم، `BuilderProtein key=spicy_chicken` | نعم | لا؛ one-time extra weight، subscription included | مختلف | متوسط |
| سالمون / سلمون | نعم، one-time option باسم `سالمون` مع extra price | نعم، premium `BuilderProtein premiumKey=salmon` باسم `سلمون` في seed premium | Partial: اختلاف إملائي | لا؛ one-time extraPrice 1600/2000 حسب product، subscription extraFee 2500 في seed | مختلف، premium balance في subscription | عال |
| ستيك / ستيك لحم | نعم، option `ستيك لحم` | نعم، premium `beef_steak` | نعم تقريباً | لا؛ one-time 1600/2000، subscription 2200 في seed | مختلف، beef daily limit في subscription | عال |
| جمبري / روبيان | نعم، option `جمبري` | نعم، premium `shrimp` باسم `روبيان` في seed premium، وaliases في `premiumIdentity.js` | Partial | لا؛ one-time 1600/2000، subscription 2000 في seed | مختلف | عال بسبب alias |
| رز أبيض / رز ابيض | نعم، option `رز ابيض` في `carbs` | نعم، `BuilderCarb key=white_rice` باسم `رز أبيض` | Partial: همزة | لا؛ one-time product option ضمن per_100g product، subscription grams selection | مختلف | متوسط |
| رز برياني | نعم، option `رز برياني` | نعم، `BuilderCarb key=biryani_rice` | نعم | لا | مختلف | منخفض/متوسط |
| كينوا | نعم، option `كينوا` | نعم، `BuilderCarb key=quinoa` | نعم | لا | مختلف | منخفض/متوسط |
| سلطة بيسك | نعم، `MenuProduct key=basic_salad`, `pricingModel=per_100g`, groups متعددة | ليس كمنتج مطابق؛ subscription لديه `premium_large_salad` وsalad ingredients | لا يوجد تطابق مباشر | لا | مختلف جذرياً | عال |
| وجبة بيسك | نعم، `MenuProduct key=basic_meal`, `per_100g`, carbs min/max 3 وprotein 1 | subscription standard meal composed from protein + 1/2 carbs داخل slot | مفهوم مشابه وليس item | لا | مختلف | عال |
| سلطة فواكه | نعم، `MenuProduct key=fruit_salad`, fixed 1700, fruits 9/9 | لا يظهر كـ planner item واضح؛ قد توجد fruits ingredients | غير مؤكد من الكود الحالي | لا | مختلف | عال |
| زبادي يوناني | نعم، `MenuProduct key=greek_yogurt`, fixed 1700, fruits/nuts | لا يظهر كـ planner item واضح | غير مؤكد من الكود الحالي | لا | مختلف | عال |
| sandwiches | نعم، `MenuProduct` cold/sourdough بأسعار fixed 900/1300/2300 | نعم، `Sandwich` وlegacy `Meal` selectionType `sandwich`, pricing included | أسماء ليست بالضرورة نفسها | لا؛ one-time مدفوع، subscription included | مختلف | عال |
| addons: عصائر | نعم كـ `MenuProduct` في category `juices` بأسعار fixed | نعم كـ `Addon kind=item category=juice`، ومع `Addon kind=plan` لاشتراك العصير | بعض الأسماء متطابقة وبعضها مختلف إملائياً مثل Berry Prot/Brute | item price قريب، plan billing مختلف | مختلف | متوسط/عال |
| addons: snacks/desserts | نعم كـ desserts products | نعم كـ `Addon kind=item category=snack` | Partial | لا دائماً؛ يوجد اختلاف واضح في `Protein Chocolate Cake`: one-time 1900، subscription seed 400 | مختلف | عال |

ملاحظة مهمة: one-time dynamic seed الحالي لم يعد يعتمد على `BuilderProtein/BuilderCarb` عند وجود published catalog. لكن `orderMenuService` ما زال يحتوي fallback يبني one-time order menu من subscription-like models إذا لم يوجد dynamic menu. هذا fallback يزيد أهمية عدم حذف/تغيير models بدون اختبارات رجوع.

## 6. What Should Be Shared

بيانات مرشحة للمشاركة بأمان نسبي:

- identity key canonical مثل `grilled_chicken`, `white_rice`, `salmon`.
- localized name `{ ar, en }`.
- description.
- image.
- base category/family مثل chicken/beef/fish/carb/juice/snack.
- active flag على مستوى الهوية، مع channel override.
- sort order كقيمة default، مع channel override.
- nutrition/allergens إذا أضيفت لاحقاً.
- option identity، مثل sauce/protein/carb identity.
- aliases للأسماء العربية المختلفة: `جمبري/روبيان`, `رز ابيض/رز أبيض`, `سالمون/سلمون`.

## 7. What Must Stay Separate

يجب أن يبقى منفصلاً:

- one-time fixed/per_100g pricing.
- one-time extra option/extra weight pricing.
- one-time `ProductOptionGroup` min/max rules.
- one-time order snapshots.
- one-time payment/order lifecycle.
- one-time pickup-only/delivery gate.
- subscription plan allowance.
- subscription meal slots.
- subscription day lifecycle.
- skip/freeze/cutoff rules.
- premium balance/overage.
- subscription day payments/unified day payment metadata.
- subscription fulfillment rules.
- `Subscription.contractSnapshot`, `SubscriptionDay.lockedSnapshot`, و`materializedMeals`.

## 8. Recommended Data Architecture

الاقتراح الآمن:

```text
SharedBaseCatalog
  CatalogItem
  CatalogOption
  CatalogCategory

ChannelRule
  channel: one_time | subscription
  itemId / optionId / categoryId
  enabled
  sortOrderOverride
  availability
  pricingOverride for one_time
  optionRules for one_time
  plan/mealSlot rules for subscription
  premium rules for subscription

Adapters
  OneTimeMenuAdapter
  SubscriptionMenuAdapter
```

يمكن تنفيذ shared base catalog كنماذج جديدة، أو إعادة استخدام `MenuProduct/MenuOption` كهوية مشتركة. لكن إعادة استخدام `MenuProduct` مباشرة ليست آمنة بدون دراسة، لأن `MenuProduct` حالياً يحمل one-time semantics مثل `pricingModel`, `priceHalala`, weight fields, `publishedAt`, و`branchAvailability`.

لماذا هذا أفضل من full merge:

- يسمح بتوحيد الاسم/الصورة/الهوية بدون تغيير response الحالي.
- يبقي `menuPricingService` مسؤولاً عن one-time.
- يبقي `mealSlotPlannerService` وsubscription services مسؤولة عن planner.
- يقلل خطر كسر Flutter وDashboard.
- يسمح بعمل read-only mapping قبل أي migration.

## 9. Migration Strategy

### Phase 0: Audit Only

- ما يتغير: توثيق mapping، إضافة reports، تحديد aliases.
- ما لا يتغير: endpoints/models/data.
- tests المطلوبة: لا يوجد تنفيذ، لكن يفضل تشغيل validation بعد أي تعديل توثيق فقط إذا رغبت.
- rollback: حذف ملفات audit.

### Phase 1: Add Channel-Rule Layer Without Changing Existing Endpoints

- ما يتغير: إضافة models/services جديدة أو read-only config للـ channel rules.
- ما لا يتغير: `/api/orders/menu`, `/api/subscriptions/meal-planner-menu`, quote/create/checkout responses.
- tests المطلوبة: unit tests للـ mapping، mobile contracts، one-time menu، meal planner catalog.
- rollback: تعطيل adapter flag والرجوع للمصادر الحالية.

### Phase 2: Read-Only Mapping Between Subscription Items and One-Time Catalog

- ما يتغير: mapping table يربط `MenuOption/MenuProduct` بـ `BuilderProtein/BuilderCarb/Addon/Sandwich`.
- ما لا يتغير: الكتابة والقراءة الفعلية للعميل.
- tests المطلوبة: duplicate key tests، alias tests، data integrity.
- rollback: تجاهل mapping table.

### Phase 3: Dashboard Shared Identity Management

- ما يتغير: Dashboard قد يعرض identity مشتركة وربط channel tabs.
- ما لا يتغير: channel-specific pricing/rules.
- tests المطلوبة: dashboard CRUD، role auth، audit logs.
- rollback: إخفاء shared identity UI والرجوع للشاشتين.

### Phase 4: Gradual Subscription Adapter

- ما يتغير: `SubscriptionMenuAdapter` يقرأ الهوية المشتركة مع قواعد subscription.
- ما لا يتغير: `SubscriptionDay`, `mealSlots`, payment metadata.
- tests المطلوبة: checkout, meal planner selection, day payment, timeline, fulfillment.
- rollback: feature flag يعيد `mealPlannerCatalogService` للمصادر القديمة.

### Phase 5: Data Migration Only After Tests and Staging Validation

- ما يتغير: نقل بيانات أو ربط IDs فعلياً.
- ما لا يتغير: snapshots التاريخية وresponse contracts.
- tests المطلوبة: full suite + staging validation + data integrity + payment/webhook/idempotency.
- rollback: backup/restore وخطة dual-read حتى التأكد.

## 10. Backward Compatibility Plan

- `/api/orders/menu` response must not change.
- `/api/orders/quote` و`/api/orders` و`/api/orders/checkout` responses must not change.
- subscription endpoints مثل `/api/subscriptions/menu`, `/api/subscriptions/meal-planner-menu`, `/days/:date/selection`, `/checkout` must not change.
- Flutter contracts تبقى صالحة؛ أي field جديد يكون additive فقط.
- Dashboard contracts تبقى صالحة؛ `dashboardMenu` و`adminMealPlannerMenu` لا يختلطان بدون versioning.
- snapshots تبقى immutable: order item snapshots وsubscription day snapshots لا يعاد تفسيرها من catalog live.
- IDs القديمة لا تتغير في responses بدون compatibility layer.

## 11. Test Plan Before Any Implementation

قبل أي implementation يجب تشغيل/إضافة:

- one-time full flow: `npm run test:one-time-full-flow`.
- mobile API contracts: `npm run test:mobile-contracts`.
- one-time menu catalog: `npm run test:one-time-menu`.
- subscription checkout: `npm run test:checkout`.
- meal planner selection: `npm run test:integration` و`npm test`.
- subscription day payment: `NODE_ENV=test node tests/unified_day_payment_verify.test.js` و`tests/mealPlannerPaymentContract.test.js`.
- dashboard menu CRUD: `tests/dashboardAdminEndpoints.test.js` وone-time menu dashboard coverage.
- dashboard ops transitions: `tests/oneTimeOrderOps.test.js`.
- payment/webhook/idempotency: `npm run test:payment-init-logging`, `NODE_ENV=test node tests/webhookSecurity.test.js`, `NODE_ENV=test node tests/orderPaymentIdempotency.test.js`, `NODE_ENV=test node tests/moyasar_retry.test.js`.
- new mapping tests: duplicate keys, alias resolution, one-time/subscription cross-reference.
- data integrity tests: `npm run validate:data` على test/staging، وcatalog health scripts.

## 12. Risks

- breaking subscription day logic: لأن `SubscriptionDay.mealSlots` و`plannerMeta` وpayment requirements حساسة.
- price mismatch: one-time `priceHalala/extraPriceHalala` لا يساوي subscription `extraFeeHalala/plan allowance`.
- duplicate keys: one-time keys قد لا تطابق builder keys.
- wrong item availability: `isVisible/isAvailable` في one-time لا يقابل `availableForSubscription` مباشرة.
- stale mobile IDs: Flutter قد يخزن IDs قديمة أو يعتمد على shape معين.
- snapshot regression: إعادة قراءة live catalog بدلاً من snapshot ستغير الطلبات التاريخية.
- dashboard confusion: شاشة واحدة بدون channel rules قد تجعل admin يعدل price في قناة ويتوقع أثره في قناة أخرى.
- production seed/migration risk: `seed-one-time-menu.js` وsubscription seeds تكتب بيانات؛ يجب عدم تشغيلها على production بدون guardrails.
- alias risk: `جمبري/روبيان`, `سالمون/سلمون`, `رز ابيض/رز أبيض` تحتاج canonical mapping.

## 13. Recommendation

لا تدمج النموذجين بالكامل الآن.

اعتمد shared identity/catalog تدريجياً، مع channel-specific rules/adapters، وابق business logic منفصلاً. ابدأ بـ read-only mapping واختبارات integrity قبل أي تغيير endpoints أو migration. one-time order flow وsubscription planner flow يجب أن يظلا مستقلين حتى تثبت الاختبارات وstaging أن الهوية المشتركة لا تكسر التسعير أو الدفع أو snapshots.

## 14. Open Questions

- هل shared catalog يجب أن يكون model جديداً، أم يمكن إعادة استخدام `MenuProduct/MenuOption` بأمان؟
- هل صور subscription items يجب أن تكون نفس صور one-time products؟
- هل اختلاف الأسعار بين one-time وsubscription مقصود تجارياً؟
- هل branch availability مطلوبة للاشتراكات، أم فقط one-time؟
- كيف يجب mapping عناصر premium مثل salmon/steak/shrimp إلى one-time extra price items؟
- هل Dashboard يجب أن يعرض catalog واحداً بتبويبات channels، أم يبقي شاشتين منفصلتين؟
- هل `orderMenuService` fallback من builder models ما زال مطلوباً بعد published dynamic menu؟
- هل يجب توحيد `sauces`/`sauce` و`vegetables_legumes`/`vegetables` كaliases رسمية؟
