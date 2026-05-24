# هندسة مخزن المنيو (Menu Catalog Architecture)

هذا المستند يوضح الهيكلية الحالية لنظام المنيو والمخزن المشترك (Shared Catalog) في المشروع، وكيفية استهلاكه من قبل طلبات المرة الواحدة (One-Time Orders) والاشتراكات (Subscriptions).

## 1. المخزن المشترك (Shared Catalog)

تعتمد البنية التحتية للمنيو على مجموعة من الـ Collections المترابطة في MongoDB لتوفير مرونة عالية في تخصيص المنتجات والخيارات.

### الـ Collections ومسؤولياتها:
*   **MenuCategory**: تمثل التصنيفات الرئيسية (مثل: الحلويات، العصائر، اطلب على مزاجك).
*   **MenuProduct**: تمثل المنتجات الأساسية (مثل: وجبة بيسك، سلطة فواكه، ساندويتش تركي).
*   **MenuOptionGroup**: مجموعات الخيارات (مثل: البروتينات، الكارب، الصوصات، الورقيات).
*   **MenuOption**: الخيارات الفردية داخل المجموعات (مثل: دجاج مشوي، أرز أبيض، خس).
*   **ProductOptionGroup**: تربط المنتج بمجموعات الخيارات المتاحة له، وتحدد قواعد الاختيار (min/max selections).
*   **ProductGroupOption**: تربط المنتج بخيار محدد داخل مجموعة، وتسمح بزيادة السعر (extraPrice) أو الوزن خصيصاً لهذا المنتج.

### العلاقات بين الـ Collections:

```text
MenuCategory (1) 
      ▼
MenuProduct (1) ───► ProductOptionGroup (N) ───► MenuOptionGroup (1)
      │                                                │
      │                                                ▼
      └───────────► ProductGroupOption (N) ───► MenuOption (N)
```

### الـ availableFor flag:
يتم استخدامه للتحكم في ظهور الكيانات (Products/Options) في القنوات المختلفة:
*   `["one_time"]`: يظهر فقط في طلبات المرة الواحدة.
*   `["subscription"]`: يظهر فقط في مخطط الوجبات للاشتراكات.
*   `["one_time", "subscription"]`: (الافتراضي) يظهر في الاثنين.
*   يتم استخدامه في الـ Services عبر `availableForChannelQuery`.

---

## 2. دورة حياة المنيو (Menu Lifecycle)

تمر البيانات بعدة مراحل حتى تصل للمستخدم النهائي:

1.  **الـ Seed**:
    *   الملف: `scripts/seed-one-time-menu.js`
    *   الوظيفة: `seedOneTimeMenu()`
    *   تقوم بإنشاء كافة البيانات الأساسية (Categories, Products, Groups, Options) وربطها، ثم استدعاء الـ Publish.

2.  **الداشبورد (Dashboard)**:
    *   الملف: `src/controllers/dashboard/menuController.js`
    *   يسمح للمسؤولين بتعديل الأسعار، التوافر (Availability)، الرؤية (Visibility)، وترتيب العرض (Sort Order).

3.  **الـ Publish**:
    *   الملف: `src/services/orders/menuCatalogService.js`
    *   الوظيفة: `publishMenu()`
    *   تقوم بتحديث `publishedAt` لكل الكيانات النشطة، وتأخذ نسخة احتياطية (Snapshot) كاملة من المنيو الحالي وتحفظها في الـ `MenuVersion`.

4.  **الـ API**:
    *   يتم جلب البيانات من خلال الـ Services المخصصة لكل قناة (One-time vs Subscription) مع فلترة الكيانات التي لم يتم نشرها (`publishedAt === null`) أو غير النشطة.

---

## 3. One-Time Order Catalog

مخصص للطلب المباشر من المتجر (Pickup/Delivery).

*   **الـ Endpoint**: `GET /api/orders/menu`
*   **الـ Service**: `src/services/orders/menuCatalogService.js` -> `getPublishedMenu()`
*   **قواعد الفلترة**:
    *   `isActive: true`, `isVisible: true`, `isAvailable: true`
    *   `publishedAt: { $ne: null }` (يجب أن يكون قد تم نشره).
    *   `availableFor`: يجب أن يحتوي على `one_time`.

### Response Shape (JSON Example):
```json
{
  "status": true,
  "data": {
    "source": "one_time_order",
    "currency": "SAR",
    "vatPercentage": 15,
    "categories": [
      {
        "id": "6650...",
        "key": "custom_order",
        "name": "اطلب على مزاجك",
        "products": [
          {
            "id": "6650...",
            "key": "basic_salad",
            "name": "سلطة بيسك",
            "itemType": "basic_salad",
            "pricingModel": "per_100g",
            "priceHalala": 2900,
            "requiresBuilder": true,
            "optionGroups": [
              {
                "id": "6650...",
                "key": "leafy_greens",
                "minSelections": 2,
                "maxSelections": 2,
                "options": [
                  {
                    "id": "6650...",
                    "name": "خس",
                    "extraPriceHalala": 0
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}
```

---

## 4. Subscription Catalog (Meal Planner)

مخصص لمخطط الوجبات داخل الاشتراكات، حيث يتم تجميع الخيارات بشكل مسطح (Flat) ليسهل على المستخدم بناء وجباته.

*   **الـ Endpoint**: `GET /api/subscriptions/meal-planner-menu`
*   **الـ Service**: `src/services/catalog/CatalogService.js` -> `getSubscriptionBuilderCatalog()`
*   **قواعد الفلترة**:
    *   `isActive: true`, `isVisible: true`, `isAvailable: true`
    *   `availableFor`: يجب أن يحتوي على `subscription`.
    *   `availableForSubscription: true` (خاص بالـ Options).

### الـ Mapping Logic:
*   **proteins**: يتم جلب خيارات `MenuOption` من مجموعة الـ `proteins` بشرط `extraFeeHalala === 0`.
*   **premiumProteins**: نفس المصدر السابق ولكن بشرط `extraFeeHalala > 0`.
*   **carbs**: خيارات `MenuOption` من مجموعة الـ `carbs` باستثناء الخيار الذي يحمل مفتاح `large_salad`.
*   **sandwiches**: منتجات `MenuProduct` التي يكون نوعها (`itemType`) إما `cold_sandwich` أو `sourdough`.
*   **premiumLargeSalad**: يعتمد على منتج `MenuProduct` يحمل المفتاح `basic_salad` (كقالب للخيارات والمكونات).

### Response Shape (JSON Example):
```json
{
  "status": true,
  "data": {
    "builderCatalog": {
      "categories": [...],
      "proteins": [
        {
          "id": "...",
          "name": "دجاج مشوي",
          "proteinFamilyKey": "chicken",
          "selectionType": "standard_meal",
          "isPremium": false
        }
      ],
      "premiumProteins": [
        {
          "id": "...",
          "name": "ستيك لحم",
          "premiumKey": "beef_steak",
          "extraFeeHalala": 1600,
          "isPremium": true
        }
      ],
      "carbs": [...],
      "sandwiches": [...],
      "premiumLargeSalad": {
        "enabled": true,
        "name": "سلطة كبيرة مميزة",
        "extraFeeHalala": 1500,
        "ingredients": [...]
      }
    }
  }
}
```

---

## 5. الفرق بين One-Time و Subscription

| الجانب | One-Time Order | Subscription (Meal Planner) |
| :--- | :--- | :--- |
| **الـ Endpoint** | `/api/orders/menu` | `/api/subscriptions/meal-planner-menu` |
| **الـ Service** | `menuCatalogService.getPublishedMenu` | `CatalogService.getSubscriptionBuilderCatalog` |
| **هيكلية البيانات** | هرمية (برودكت داخل كاتيجوري) | مسطحة (مجموعات بروتينات وكارب مجمعة) |
| **البروتينات** | تظهر كخيارات داخل كل منتج على حدة | تظهر كقائمة عامة يختار منها المستخدم لوجبته |
| **الفلترة** | `publishedAt`, `isActive`, `availableFor: one_time` | `publishedAt`, `isActive`, `availableFor: subscription` |
| **الأسعار الإضافية** | `extraPriceHalala` | `extraFeeHalala` (يرجع تلقائياً لـ `extraPriceHalala` لو مش متحدد) |

---

## 6. الداشبورد (Dashboard)

### Endpoints المتاحة:

*   **Categories**:
    *   `GET /api/dashboard/menu/categories` - قائمة التصنيفات
    *   `POST /api/dashboard/menu/categories` - إنشاء تصنيف
    *   `PATCH /api/dashboard/menu/categories/:id` - تعديل (الاسم، الوصف، الرؤية)
    *   `PATCH /api/dashboard/menu/categories/reorder` - إعادة ترتيب

*   **Products**:
    *   `GET /api/dashboard/menu/products` - قائمة المنتجات
    *   `POST /api/dashboard/menu/products` - إنشاء منتج
    *   `PATCH /api/dashboard/menu/products/:id` - تعديل السعر، `availableFor`

*   **Options & Groups**:
    *   `GET /api/dashboard/menu/option-groups` - قائمة مجموعات الخيارات
    *   `POST /api/dashboard/menu/options` - إنشاء خيار جديد

*   **Publishing**:
    *   `POST /api/dashboard/menu/publish` - اعتماد المنيو للعملاء

### التأثير على القنوات:
*   **يؤثر على One-time فقط**: تغيير `extraPriceHalala` في `ProductGroupOption`.
*   **يؤثر على Subscription فقط**: تغيير `proteinFamilyKey`, `premiumKey`, `selectionType`.
*   **يؤثر على الاثنين**: تغيير `extraPriceHalala` أو `extraFeeHalala` (الداشبورد يحدث الاتنين تلقائياً في نفس الوقت).
*   **عوامل مشتركة**: تغيير `name`, `description`, `isActive`, `isVisible`, أو تعديل الـ `availableFor`.

---

## 7. المشاكل المعروفة (Known Issues)

### ✅ تم الحل — Resolved Issues

1. **Pricing Field Unification** — تم الحل
   - `extraFeeHalala` دلوقتي virtual getter على `MenuOption` يرجع `extraPriceHalala` تلقائياً لو مش متحدد.
   - الداشبورد بيحدث الاتنين مع بعض عند كل save.
   - شغّل `npm run sync:option-prices` للتحقق من تزامن الأسعار في أي وقت.

2. **Subscription Publish Gate** — تم الحل
   - الـ subscription catalog دلوقتي بيشترط `publishedAt` زي الـ one-time.
   - أي تغيير من الداشبورد مش هيظهر إلا بعد الضغط على Publish.

3. **premium_large_salad vs basic_salad** — تم الحل
   - الـ subscription دلوقتي بيقرأ من `premium_large_salad` كمصدر أساسي.
   - fallback تلقائي لـ `basic_salad` مع warning في الـ logs لو مش موجود.
   - البروتينات في `premium_large_salad` محصورة في: Steak, Shrimp, Salmon.

4. **Dynamic pricingModel للساندويتشات** — تم الحل
   - الساندويتشات في الـ subscriptioncatalog دلوقتي بتقرأ الـ `pricingModel` مباشرة من `MenuProduct`.
   - ده بيسمح بالتحكم الكامل في نوع التسعير لكل ساندويتش من الداشبورد.

### ⚠️ مشاكل قائمة — Active Issues

(لا توجد مشاكل معلقة حالياً في هيكلية الكتالوج)


---

## 8. Scripts

| الـ script | الغرض | متى تشغله | تحذيرات |
| :--- | :--- | :--- | :--- |
| `seed-one-time-menu.js` | إنشاء المنيو الموحد الأساسي | عند إعداد البيئة لأول مرة | يمسح الروابط القديمة (Relations) للمنتجات ويعيد إنشائها |
| `migrate-builder-to-menu.js` | نقل بيانات البروتينات والكارب القديمة للموديلات الجديدة | عند الترقية من إصدار قديم للمشروع | يجب تشغيله بعد `seed-one-time-menu` لضمان وجود المجموعات |
| `clear-menu-catalog.js` | تهيئة (تفريغ) كافة بيانات المنيو | للتنظيف الكامل للداتابيز | **خطير جداً**، يمسح كل شيء بلا استرجاع |
| `diagnose-subscription-menu-data.js` | فحص صحة بيانات المنيو للاشتراكات | عند ملاحظة اختفاء بروتينات أو أخطاء في المخطط | لا يعدل البيانات، مجرد تقرير |
| `sync-option-prices.js` | فحص وتزامن حقلي السعر `extraPriceHalala` و `extraFeeHalala` | دورياً أو بعد أي تعديل على الأسعار | يطبع تقرير بالـ conflicts بدون تعديل تلقائي |
| `validate-menu-identity-links.js` | فحص الروابط بين المنيو والـ MenuIdentity | لضمان عمل التقارير والعمليات بشكل صحيح | مهم لضمان عدم وجود "أيتام" في الداتابيز |
| `seed-subscription-addons.js` | إنشاء إضافات الاشتراكات (عصائر، سناك، سلطة صغيرة) | عند إعداد بيئة الاشتراكات | يمسح الإضافات القديمة في الفئات المستهدفة |

---

## 9. الوجبات والمنتجات المميزة (Premium Items Analysis)

### 9.1 البروتينات المميزة (Premium Proteins)

بناءً على ملف `scripts/seed-one-time-menu.js` وحالة الموديل `MenuOption`:

| العنصر | موجود في MenuOption؟ | extraFeeHalala | premiumKey | proteinFamilyKey | availableFor | publishedAt موجود؟ | يظهر في subscription catalog؟ |
|--------|---------------------|----------------|------------|-----------------|--------------|-------------------|-------------------------------|
| Steak (ستيك لحم) | ✅ موجود | 1600 | `beef_steak` | `beef` | `["one_time", "subscription"]` | ✅ نعم | ✅ نعم |
| Shrimp (جمبري) | ✅ موجود | 1600 | `shrimp` | `fish` | `["one_time", "subscription"]` | ✅ نعم | ✅ نعم |
| Salmon (سالمون) | ✅ موجود | 1600 | `salmon` | `fish` | `["one_time", "subscription"]` | ✅ نعم | ✅ نعم |

> [!NOTE]
> يتم تحويل `seafood` إلى `fish` برمجياً في `CatalogService` لضمان التوافق مع عقود الـ Meal Planner.

### 9.2 سلطة كبيرة + بروتين مميز (Premium Large Salad)

الوضع الحالي لمنتج السلطة المميزة في الكتالوج الموحد:
- **هل منتج `premium_large_salad` موجود في seed؟** ✅ نعم (في `seed-one-time-menu.js`).
- **هل موجود في MenuProduct بالداتابيز؟** ✅ نعم (ItemType: `basic_salad`).
- **availableFor القيمة؟** `["subscription"]`.
- **البروتينات المرتبطة بيه؟** ستيك لحم، جمبري، سالمون.
- **extraFeeHalala القيمة؟** السعر الكلي 2900 هللة (Fixed).
- **هل CatalogService بيقرأه صح؟** ✅ نعم (كمصدر أساسي).
- **هل في fallback لـ basic_salad؟** ✅ نعم.

### 9.3 نظام الإضافات للاشتراكات (Subscription Addons)

تقرير حالة الإضافات بناءً على `Addon.js` و `seed-subscription-addons.js`:
- **هل يوجد SubscriptionAddon model؟** ❌ لا (يستخدم موديل `Addon` الموحد).
- **هل يوجد seed script للـ addons؟** ✅ نعم (`scripts/seed-subscription-addons.js`).
- **الـ addons الموجودة حالياً:**
    *   **عصائر (Juice):** بيري بلاست، بيري بروت، كلاسيك جرين، إلخ.
    *   **سناك/حلى (Snack):** تشيز كيك، براونيز، مافن، بروتين بار.
    *   **سلطات صغيرة (Small Salad):** سلطة صغيرة.
- **هل العصير موجود كـ addon؟** ✅ نعم.
- **هل الحلى موجود كـ addon؟** ✅ نعم (تحت فئة `snack`).
- **هل البروتين موجود كـ addon؟** ✅ نعم (Protein Drink & Protein Bar).
- **الـ endpoint الخاص بالـ addons؟** `/api/subscriptions/meal-planner-menu` (حقل `addonCatalog`).

### 9.4 تقرير التوافق (Compatibility Report)

#### ✅ متوافق — Working Correctly
- **توحيد الأسعار:** حقل `extraFeeHalala` يعمل بشكل صحيح كـ Fallback.
- **بوابة النشر:** الكتالوج يحترم `publishedAt`.
- **البروتينات المميزة:** تظهر بأسعار صحيحة (1600 هللة).
- **فصيلة البروتين:** تم توحيد `fish` في السيدر والـ Service.
- **نظام الإضافات:** التلقيم (Seed) والـ API متصلان بشكل سليم.

#### ❌ مشاكل — Issues Found
(لا توجد مشاكل معلقة حالياً)

#### 🔧 إجراءات تمت — Actions Taken
1. **تحديث السيدر:** تم تغيير `seafood` إلى `fish` في `seed-one-time-menu.js` للاتساق الكامل.
2. **تنظيف الكود:** تم حذف كافة السكريبتات المهجورة (`seedPremiumCatalog`, `seedPremiumSalad`) وتنظيف `package.json`.

---

## 10. أمان وتناسق العمليات (Operations Security & Safety)

تم تطبيق مجموعة من القواعد البرمجية لضمان عدم فقدان البيانات (Data Loss Prevention) وحماية العمليات الحساسة في الداشبورد. هذا القسم يعتبر مرجعاً لمطوري الـ Frontend لضمان توافق الواجهات مع منطق الـ Backend.

### 10.1 دورة الاسترجاع الآمن (Safe Rollback Cycle)
عند الرغبة في العودة لإصدار قديم من المنيو (Rollback)، يتم اتباع الخطوات التالية برمجياً لضمان عدم ضياع التعديلات الحالية:

*   **الـ Endpoint**: `POST /api/dashboard/menu/rollback/:versionId`
*   **المتطلبات**: يجب إرسال `{ "confirm": true }` في الـ Body.
*   **خطوات العملية (The Pipeline)**:
    1.  **Backup Current State**: يقوم النظام تلقائياً بعمل `Publish` وحفظ Snapshot للحالة الحالية قبل الاسترجاع (باسم Auto-snapshot).
    2.  **Restore Data**: يتم استبدال البيانات الحالية ببيانات الـ Version المطلوبة.
    3.  **Set New Head**: يقوم النظام بعمل `Publish` جديد ليكون الإصدار المسترجع هو الإصدار الحالي المعتمد للعملاء.
*   **النتيجة**: يرجع الـ JSON يحتوي على `restoredVersion` و `backupVersion` لسهولة التتبع.

### 10.2 عزل أسعار الخيارات (Option Price Isolation)
تم فصل منطق تعديل "الأسعار العامة" عن "الأسعار المخصصة لمنتج معين":

1.  **تعديلات عامة (Global)**:
    *   **الـ Endpoint**: `PATCH /api/dashboard/menu/options/:optionId`
    *   **الاستخدام**: لتعديل الاسم، الصورة، أو السعر الافتراضي الذي يطبق على كل المنتجات.
    *   **محظور**: لا يمكن استخدامه لتغيير سعر منتج واحد فقط.
2.  **تعديلات مخصصة للمنتج (Product-Specific)**:
    *   **الـ Endpoint**: `PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId`
    *   **الاستخدام**: مخصص فقط لزيادة السعر (`extraPriceHalala`) أو الوزن لمنتج محدد دون التأثير على الآخرين.
    *   **القواعد**: يرفض النظام تعديل الحقول العامة (مثل `premiumKey` أو `proteinFamilyKey`) من هذا الـ Endpoint (يرجع 400 Bad Request).

### 10.3 تكرار المنتجات (Safe Duplication)
عند استخدام خاصية "نسخ منتج" (Duplicate)، يضمن النظام عدم حدوث تصادم في الـ Keys:
*   **تنسيق المفتاح الجديد**: `{original_key}_copy_{Timestamp}_$random`
*   **الحالة الافتراضية**: أي منتج منسوخ يكون `isActive: false` (مخفي) حتى يقوم المسؤول بتعديله وتفعيله يدوياً.
*   **معالجة الأخطاء**: في حالة حدوث تصادم نادر جداً، يرجع النظام `409 Conflict`.

### 10.4 صلاحيات الوصول (RBAC Policy)
تم تشديد الرقابة على العمليات "المدمرة" أو الحساسة:

| العملية | الـ Role المطلوب | الـ Middleware |
| :--- | :--- | :--- |
| استرجاع منيو (Rollback) | `admin`, `superadmin` | `dashboardRoleMiddleware` |
| حذف تصنيف (Delete Category) | `admin`, `superadmin` | `dashboardRoleMiddleware` |
| حذف منتج (Delete Product) | `admin`, `superadmin` | `dashboardRoleMiddleware` |
| تفعيل/تعطيل عام | `any staff` | `dashboardAuth` |



