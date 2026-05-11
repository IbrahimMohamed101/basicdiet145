
اعتمدت فيه على النسخة اللي عندك، وعلى قواعد المنيو الأسبوعي: الأربع منتجات custom هي `سلطة بيسك`، `وجبة بيسك`، `سلطة فواكه`، و`زبادي يوناني`، والباقي منتجات fixed price زي الساندويتشات والعصائر والمشروبات والحلويات والآيس كريم. 
وكمان حافظت على قواعد README الحالية: الأسعار بالهللة، `isAvailable` للتوفر المؤقت، `isActive` للحذف المنطقي، وثبات عقود الموبايل. 

---

# الدليل المرجعي الكامل لواجهات برمجة تطبيقات لوحة التحكم

# BasicDiet Dashboard API README

هذا المستند مخصص لفريق تطوير لوحة التحكم في BasicDiet.
جميع المسارات المذكورة أدناه مكتوبة **بعد `/api`**.

مثال:

```http
/dashboard/menu/products
```

يعني المسار الكامل:

```http
/api/dashboard/menu/products
```

---

## 1. قواعد عامة مهمة

### 1.1 العملة

كل الأسعار في الـ API تكون بالهللة وليس بالريال.

|    ريال | Halala |
| ------: | -----: |
|  2 ريال |    200 |
|  7 ريال |    700 |
| 11 ريال |   1100 |
| 15 ريال |   1500 |
| 17 ريال |   1700 |
| 19 ريال |   1900 |
| 23 ريال |   2300 |
| 29 ريال |   2900 |

---

### 1.2 الفرق بين `isAvailable` و `isActive`

| الحقل         | الاستخدام                                                  |
| ------------- | ---------------------------------------------------------- |
| `isAvailable` | نفاد مؤقت أو تعطيل أسبوعي. مثال: السالمون خلص هذا الأسبوع. |
| `isActive`    | حذف منطقي أو إزالة طويلة الأمد من المنيو.                  |

قاعدة مهمة:

```text
لو العنصر ممكن يرجع الأسبوع الجاي → استخدم isAvailable=false
لو العنصر خرج من المنيو لفترة طويلة → استخدم isActive=false
```

---

### 1.3 عقود تطبيق الموبايل

يمنع تغيير شكل الردود الخاصة بالموبايل، خصوصًا:

```http
GET /api/orders/menu
POST /api/orders/quote
POST /api/orders
GET /api/orders/:id
```

لو الداشبورد عدّل المنيو، تطبيق الموبايل يظل يقرأ نفس الشكل من `/api/orders/menu`.

---

### 1.4 الطلبات القديمة

عند إنشاء الطلب، النظام يحفظ `snapshot` للمنتج والسعر والاختيارات.
أي تعديل لاحق في المنيو لا يغير الطلبات القديمة.

---

## 2. المصادقة والصلاحيات

### 2.1 Headers المطلوبة

```http
Authorization: Bearer <dashboard_token>
Content-Type: application/json
Accept: application/json
Accept-Language: ar
```

---

### 2.2 الأدوار

| Role         | الوصف                                      |
| ------------ | ------------------------------------------ |
| `superadmin` | صلاحيات كاملة                              |
| `admin`      | إدارة المنيو والطلبات والعمليات            |
| `kitchen`    | تجهيز الطلبات                              |
| `courier`    | التوصيل                                    |
| `cashier`    | التحقق أو التسليم من الفرع إذا كان مدعومًا |

---

### 2.3 مصفوفة الصلاحيات العامة

| المنطقة          | superadmin | admin |   kitchen  |   courier  |   cashier  |
| ---------------- | :--------: | :---: | :--------: | :--------: | :--------: |
| تعديل المنيو     |      ✅     |   ✅   |      ❌     |      ❌     |      ❌     |
| التحقق من المنيو |      ✅     |   ✅   |      ❌     |      ❌     |      ❌     |
| نشر المنيو       |      ✅     |   ✅   |      ❌     |      ❌     |      ❌     |
| استعراض الطلبات  |      ✅     |   ✅   |      ✅     |      ✅     | حسب النظام |
| تجهيز الطلب      |      ✅     |   ✅   |      ✅     |      ❌     |      ❌     |
| تجهيز للاستلام   |      ✅     |   ✅   |      ✅     |      ❌     |      ❌     |
| تسليم الطلب      |      ✅     |   ✅   | حسب النظام | حسب النظام | حسب النظام |
| Identity Mapping |      ✅     |   ✅   |      ❌     |      ❌     |      ❌     |

---

## 3. تنسيق الاستجابة

### 3.1 نجاح

```json
{
  "status": true,
  "data": {}
}
```

### 3.2 خطأ عام

```json
{
  "status": false,
  "message": "رسالة الخطأ"
}
```

### 3.3 خطأ بنمط `ok/error`

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "وصف الخطأ"
  }
}
```

---

# 4. Dashboard Auth

## 4.1 تسجيل الدخول

```http
POST /dashboard/auth/login
```

### Body

```json
{
  "phone": "+966500000000",
  "password": "your_password"
}
```

### Response

```json
{
  "status": true,
  "data": {
    "token": "dashboard_jwt_token",
    "user": {
      "id": "user_id",
      "name": "Admin User",
      "role": "admin"
    }
  }
}
```

---

## 4.2 بيانات المستخدم الحالي

```http
GET /dashboard/auth/me
```

### Auth

مطلوب Dashboard token.

### Response

```json
{
  "status": true,
  "data": {
    "id": "user_id",
    "name": "Admin User",
    "role": "admin"
  }
}
```

---

# 5. نظرة عامة على إدارة المنيو

المنيو في الداشبورد ينقسم إلى نوعين:

## 5.1 Custom Products

هذه المنتجات تحتوي على مجموعات خيارات وقواعد اختيار:

```text
basic_salad    = سلطة بيسك
basic_meal     = وجبة بيسك
fruit_salad    = سلطة فواكه
greek_yogurt   = زبادي يوناني
```

هذه المنتجات تحتاج إدارة:

```text
السعر
نوع التسعير fixed/per_100g
مجموعات الخيارات
الخيارات
maxSelections
extraPriceHalala
extraWeightUnitGrams
extraWeightPriceHalala
التوفر الأسبوعي
```

---

## 5.2 Fixed Products

هذه منتجات بسيطة بسعر ثابت:

```text
Cold Sandwich
Sourdough
Desserts
Juices
Drinks
Ice Cream
```

إدارتها تكون غالبًا:

```text
الاسم
القسم
السعر
الصورة
isAvailable
isActive
sortOrder
```

---

# 6. Categories Endpoints

## 6.1 عرض الأصناف

```http
GET /dashboard/menu/categories
```

### Query Params

| Param         | الوصف                  |
| ------------- | ---------------------- |
| `page`        | رقم الصفحة             |
| `limit`       | عدد العناصر            |
| `q`           | بحث نصي إن كان مدعومًا |
| `isActive`    | فلترة حسب التفعيل      |
| `isAvailable` | فلترة حسب التوفر       |

### Response Example

```json
{
  "status": true,
  "data": {
    "items": [
      {
        "id": "category_id",
        "key": "drinks",
        "name": {
          "ar": "المشروبات",
          "en": "Drinks"
        },
        "isActive": true,
        "isAvailable": true,
        "sortOrder": 10
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 25,
      "total": 1,
      "pages": 1
    }
  }
}
```

---

## 6.2 إنشاء صنف

```http
POST /dashboard/menu/categories
```

### Body

```json
{
  "key": "drinks",
  "name": {
    "ar": "المشروبات",
    "en": "Drinks"
  },
  "description": {
    "ar": "",
    "en": ""
  },
  "imageUrl": "",
  "isActive": true,
  "isAvailable": true,
  "isVisible": true,
  "sortOrder": 10
}
```

---

## 6.3 تحديث صنف

```http
PATCH /dashboard/menu/categories/:id
```

### Body

```json
{
  "name": {
    "ar": "مشروبات",
    "en": "Beverages"
  },
  "isAvailable": true,
  "sortOrder": 20
}
```

---

## 6.4 حذف منطقي لصنف

```http
DELETE /dashboard/menu/categories/:id
```

> ملاحظة: الحذف يجب أن يكون Soft Delete ويحوّل `isActive=false` إذا كان هذا هو سلوك الباك إند الحالي.

---

## 6.5 إعادة ترتيب الأصناف

```http
PATCH /dashboard/menu/categories/reorder
```

### Body

```json
{
  "items": [
    {
      "id": "category_id_1",
      "sortOrder": 1
    },
    {
      "id": "category_id_2",
      "sortOrder": 2
    }
  ]
}
```

---

# 7. Products Endpoints

## 7.1 عرض المنتجات

```http
GET /dashboard/menu/products
```

### Query Params

| Param          | الوصف                      |
| -------------- | -------------------------- |
| `page`         | رقم الصفحة                 |
| `limit`        | عدد العناصر                |
| `q`            | بحث                        |
| `categoryId`   | فلترة حسب الصنف            |
| `pricingModel` | `fixed` أو `per_100g`      |
| `itemType`     | مثل `basic_salad`, `drink` |
| `isActive`     | فلترة حسب التفعيل          |
| `isAvailable`  | فلترة حسب التوفر           |

### Example

```http
GET /dashboard/menu/products?page=1&limit=25&categoryId=...&isAvailable=true
```

### Response Example

```json
{
  "status": true,
  "data": {
    "items": [
      {
        "id": "product_id",
        "key": "basic_salad",
        "itemType": "basic_salad",
        "name": {
          "ar": "سلطة بيسك",
          "en": "Basic Salad"
        },
        "pricingModel": "per_100g",
        "priceHalala": 2900,
        "baseUnitGrams": 100,
        "isActive": true,
        "isAvailable": true,
        "sortOrder": 1
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 25,
      "total": 1,
      "pages": 1
    }
  }
}
```

---

## 7.2 إنشاء منتج ثابت

```http
POST /dashboard/menu/products
```

### Body

```json
{
  "categoryId": "category_id",
  "key": "water",
  "itemType": "drink",
  "name": {
    "ar": "مياه عادية",
    "en": "Water"
  },
  "description": {
    "ar": "",
    "en": ""
  },
  "imageUrl": "",
  "pricingModel": "fixed",
  "priceHalala": 200,
  "isActive": true,
  "isAvailable": true,
  "isVisible": true,
  "sortOrder": 1
}
```

---

## 7.3 إنشاء منتج Custom بالوزن

```http
POST /dashboard/menu/products
```

### Body

```json
{
  "categoryId": "category_id",
  "key": "basic_salad",
  "itemType": "basic_salad",
  "name": {
    "ar": "سلطة بيسك",
    "en": "Basic Salad"
  },
  "description": {
    "ar": "",
    "en": ""
  },
  "imageUrl": "",
  "pricingModel": "per_100g",
  "priceHalala": 2900,
  "baseUnitGrams": 100,
  "defaultWeightGrams": 100,
  "minWeightGrams": 100,
  "maxWeightGrams": 1000,
  "weightStepGrams": 50,
  "isActive": true,
  "isAvailable": true,
  "isVisible": true,
  "sortOrder": 1
}
```

---

## 7.4 تحديث منتج

```http
PATCH /dashboard/menu/products/:id
```

### تحديث سعر منتج ثابت

```json
{
  "priceHalala": 300
}
```

يعني 3 ريال.

### تحديث سعر منتج بالوزن

```json
{
  "priceHalala": 3100,
  "baseUnitGrams": 100
}
```

يعني 31 ريال لكل 100 جرام.

---

## 7.5 تحديث توفر منتج

```http
PATCH /dashboard/menu/products/:id/availability
```

### Body

```json
{
  "isAvailable": false
}
```

---

## 7.6 حذف منطقي لمنتج

```http
DELETE /dashboard/menu/products/:id
```

> استخدم هذا فقط للمنتجات التي لن تعود قريبًا.
> لو المنتج نفد مؤقتًا، استخدم `isAvailable=false`.

---

## 7.7 إعادة ترتيب المنتجات

```http
PATCH /dashboard/menu/products/reorder
```

### Body

```json
{
  "items": [
    {
      "id": "product_id_1",
      "sortOrder": 1
    },
    {
      "id": "product_id_2",
      "sortOrder": 2
    }
  ]
}
```

---

# 8. Option Groups Endpoints

## 8.1 عرض مجموعات الخيارات

```http
GET /dashboard/menu/option-groups
```

### Query Params

| Param         | الوصف       |
| ------------- | ----------- |
| `page`        | رقم الصفحة  |
| `limit`       | عدد العناصر |
| `q`           | بحث         |
| `isActive`    | فلترة       |
| `isAvailable` | فلترة       |

---

## 8.2 إنشاء مجموعة خيارات

```http
POST /dashboard/menu/option-groups
```

### Body

```json
{
  "key": "proteins",
  "name": {
    "ar": "بروتينات",
    "en": "Proteins"
  },
  "description": {
    "ar": "",
    "en": ""
  },
  "isActive": true,
  "isAvailable": true,
  "isVisible": true,
  "sortOrder": 10
}
```

---

## 8.3 تحديث مجموعة خيارات

```http
PATCH /dashboard/menu/option-groups/:id
```

### Body

```json
{
  "name": {
    "ar": "البروتينات",
    "en": "Proteins"
  },
  "sortOrder": 20,
  "isAvailable": true
}
```

---

## 8.4 حذف منطقي لمجموعة خيارات

```http
DELETE /dashboard/menu/option-groups/:id
```

---

# 9. Options Endpoints

## 9.1 عرض الخيارات

```http
GET /dashboard/menu/options
```

### Query Params

| Param         | الوصف              |
| ------------- | ------------------ |
| `page`        | رقم الصفحة         |
| `limit`       | عدد العناصر        |
| `q`           | بحث                |
| `groupId`     | فلترة حسب المجموعة |
| `isActive`    | فلترة              |
| `isAvailable` | فلترة              |

### Example

```http
GET /dashboard/menu/options?groupId=proteins_group_id&q=salmon&isAvailable=true
```

---

## 9.2 إنشاء خيار

```http
POST /dashboard/menu/options
```

### Body

```json
{
  "groupId": "proteins_group_id",
  "key": "salmon",
  "name": {
    "ar": "سالمون",
    "en": "Salmon"
  },
  "description": {
    "ar": "",
    "en": ""
  },
  "imageUrl": "",
  "extraPriceHalala": 1600,
  "extraWeightUnitGrams": 50,
  "extraWeightPriceHalala": 1000,
  "isActive": true,
  "isAvailable": true,
  "isVisible": true,
  "sortOrder": 1
}
```

---

## 9.3 تحديث خيار

```http
PATCH /dashboard/menu/options/:id
```

### Body

```json
{
  "name": {
    "ar": "سالمون",
    "en": "Salmon"
  },
  "extraPriceHalala": 1600,
  "extraWeightUnitGrams": 50,
  "extraWeightPriceHalala": 1000,
  "isAvailable": true
}
```

---

## 9.4 حذف منطقي لخيار

```http
DELETE /dashboard/menu/options/:id
```

> لو الخيار خلص مؤقتًا فقط، لا تستخدم delete.
> استخدم `isAvailable=false`.

---

# 10. Product Option Group Rules

هذه الواجهات تتحكم في ربط مجموعات الخيارات بالمنتج، مثل:

```text
سلطة بيسك -> بروتينات -> maxSelections = 1
زبادي يوناني -> فواكه -> maxSelections = 5
```

---

## 10.1 ربط مجموعات بمنتج

```http
PUT /dashboard/menu/products/:productId/groups
```

### Body

```json
{
  "groups": [
    {
      "groupId": "leafy_group_id",
      "minSelections": 0,
      "maxSelections": 2,
      "isRequired": false,
      "sortOrder": 1,
      "isActive": true,
      "isAvailable": true,
      "isVisible": true
    },
    {
      "groupId": "proteins_group_id",
      "minSelections": 1,
      "maxSelections": 1,
      "isRequired": true,
      "sortOrder": 2,
      "isActive": true,
      "isAvailable": true,
      "isVisible": true
    }
  ]
}
```

> تنبيه: إذا كان هذا endpoint يستبدل كل المجموعات المرتبطة بالمنتج، يجب على الداشبورد إرسال القائمة الكاملة، وليس المجموعة الجديدة فقط.

---

## 10.2 تحديث قواعد الاختيار لمجموعة داخل منتج

```http
PATCH /dashboard/menu/products/:productId/option-groups/:groupId/selection-rules
```

### Body

```json
{
  "minSelections": 0,
  "maxSelections": 4,
  "isRequired": false
}
```

---

# 11. Product Group Options / Overrides

هذه الواجهات تتحكم في الخيارات الموجودة داخل مجموعة معينة داخل منتج معين.

مثال:

```text
سلطة بيسك -> بروتينات -> سالمون
```

يمكن تخصيص سالمون داخل سلطة بيسك بسعر مختلف عن سالمون داخل وجبة بيسك.

---

## 11.1 ربط خيارات بمجموعة داخل منتج

```http
PUT /dashboard/menu/products/:productId/groups/:groupId/options
```

### Body

```json
{
  "options": [
    {
      "optionId": "salmon_option_id",
      "extraPriceHalala": 1600,
      "extraWeightUnitGrams": 50,
      "extraWeightPriceHalala": 1000,
      "isActive": true,
      "isAvailable": true,
      "isVisible": true,
      "sortOrder": 1
    },
    {
      "optionId": "chicken_option_id",
      "extraPriceHalala": 0,
      "isActive": true,
      "isAvailable": true,
      "isVisible": true,
      "sortOrder": 2
    }
  ]
}
```

### تنبيه مهم

غالبًا هذا endpoint يقوم باستبدال قائمة الخيارات المرتبطة بهذه المجموعة داخل المنتج.
لذلك عند إضافة خيار جديد، يجب على الداشبورد:

1. جلب الخيارات الحالية.
2. إضافة الخيار الجديد محليًا.
3. إرسال القائمة الكاملة من جديد.

---

## 11.2 تحديث Override لخيار واحد

```http
PATCH /dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId
```

### Body

```json
{
  "extraPriceHalala": 1600,
  "extraWeightUnitGrams": 50,
  "extraWeightPriceHalala": 1000,
  "isAvailable": true,
  "sortOrder": 1
}
```

### سلوك `extraWeightUnitGrams`

لو `extraWeightUnitGrams` موجود على relation، يستخدمه النظام لهذا المنتج.
لو غير موجود أو `null`، يستخدم القيمة العامة من `MenuOption`.

مثال:

```text
MenuOption.extraWeightUnitGrams = 50
ProductGroupOption.extraWeightUnitGrams = 100

النتيجة داخل هذا المنتج = 100
```

---

## 11.3 تعطيل خيار داخل منتج

```http
PATCH /dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId/availability
```

### Body

```json
{
  "isAvailable": false
}
```

استخدم هذا لو العنصر خلص لهذا الأسبوع فقط.

---

# 12. Weekly Custom Menu Workflows

## 12.1 تعطيل السالمون في سلطة بيسك

### الخطوات

1. ابحث عن المنتج `basic_salad`.
2. ابحث عن مجموعة `proteins`.
3. ابحث عن خيار `salmon`.
4. أرسل:

```http
PATCH /dashboard/menu/products/:basicSaladId/option-groups/:proteinsGroupId/options/:salmonOptionId/availability
```

### Body

```json
{
  "isAvailable": false
}
```

5. شغّل validation.
6. انشر المنيو.

---

## 12.2 إرجاع السالمون مرة أخرى

```http
PATCH /dashboard/menu/products/:basicSaladId/option-groups/:proteinsGroupId/options/:salmonOptionId/availability
```

### Body

```json
{
  "isAvailable": true
}
```

---

## 12.3 إضافة أفوكادو إلى سلطة بيسك

### الخطوة 1: إنشاء الخيار العام إذا لم يكن موجودًا

```http
POST /dashboard/menu/options
```

### Body

```json
{
  "groupId": "vegetables_group_id",
  "key": "avocado",
  "name": {
    "ar": "أفوكادو",
    "en": "Avocado"
  },
  "extraPriceHalala": 500,
  "isActive": true,
  "isAvailable": true,
  "sortOrder": 30
}
```

### الخطوة 2: ربطه بسلطة بيسك

استخدم:

```http
PUT /dashboard/menu/products/:basicSaladId/groups/:vegetablesGroupId/options
```

### Body

> أرسل القائمة الكاملة للخيارات الحالية + الأفوكادو.

```json
{
  "options": [
    {
      "optionId": "existing_option_id_1",
      "isAvailable": true,
      "sortOrder": 1
    },
    {
      "optionId": "avocado_option_id",
      "extraPriceHalala": 500,
      "isAvailable": true,
      "sortOrder": 30
    }
  ]
}
```

---

## 12.4 تعديل الحد الأقصى للفواكه في زبادي يوناني

```http
PATCH /dashboard/menu/products/:greekYogurtId/option-groups/:fruitsGroupId/selection-rules
```

### Body

```json
{
  "maxSelections": 4
}
```

---

## 12.5 تعديل سعر مياه عادية

```http
PATCH /dashboard/menu/products/:waterProductId
```

### Body

```json
{
  "priceHalala": 300
}
```

يعني 3 ريال.

---

## 12.6 تعديل سعر ووزن السالمون في وجبة بيسك

```http
PATCH /dashboard/menu/products/:basicMealId/option-groups/:proteinsGroupId/options/:salmonOptionId
```

### Body

```json
{
  "extraPriceHalala": 2000,
  "extraWeightUnitGrams": 50,
  "extraWeightPriceHalala": 1000
}
```

يعني:

```text
+20 ريال
+10 ريال لكل 50 جرام
```

---

# 13. Menu Validation

## 13.1 التحقق من المنيو

```http
POST /dashboard/menu/validate
```

### Body

لا يوجد body مطلوب.

### Response Valid

```json
{
  "status": true,
  "data": {
    "ok": true,
    "errors": [],
    "warnings": [],
    "summary": {
      "categories": 8,
      "products": 37,
      "groups": 8,
      "options": 120,
      "activeProducts": 37
    }
  }
}
```

### Response Invalid

```json
{
  "status": true,
  "data": {
    "ok": false,
    "errors": [
      {
        "code": "CUSTOM_PRODUCT_MISSING",
        "message": "basic_salad is missing"
      }
    ],
    "warnings": []
  }
}
```

### قواعد مهمة

* `errors` تمنع النشر.
* `warnings` تحتاج مراجعة.
* لا تنشر المنيو قبل معالجة الأخطاء.

---

# 14. Menu Publish

## 14.1 نشر المنيو

```http
POST /dashboard/menu/publish
```

### Body

```json
{
  "notes": "تعديلات منيو الأسبوع الثاني من مايو"
}
```

### Response Example

```json
{
  "status": true,
  "data": {
    "versionId": "menu_version_id",
    "status": "published",
    "publishedAt": "2026-05-09T12:00:00.000Z"
  }
}
```

### ملاحظات

* ينشئ `MenuVersion`.
* يأخذ snapshot من المنيو الحالي.
* تطبيق الموبايل يقرأ النسخة المنشورة.
* الطلبات القديمة لا تتأثر.

---

# 15. Menu Audit Logs

## 15.1 عرض سجل تغييرات المنيو

```http
GET /dashboard/menu/audit-logs
```

### Query Params

| Param        | الوصف                             |
| ------------ | --------------------------------- |
| `page`       | رقم الصفحة                        |
| `limit`      | عدد العناصر                       |
| `action`     | مثل `create`, `update`, `publish` |
| `entityType` | غير مؤكد من الكود الحالي          |
| `entityId`   | غير مؤكد من الكود الحالي          |

### Response Example

```json
{
  "status": true,
  "data": {
    "items": [
      {
        "id": "audit_id",
        "action": "update",
        "entityType": "MenuProduct",
        "entityId": "product_id",
        "before": {
          "priceHalala": 200
        },
        "after": {
          "priceHalala": 300
        },
        "actorId": "admin_id",
        "createdAt": "2026-05-09T12:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 25,
      "total": 1
    }
  }
}
```

---

# 16. Shared Menu Identity Mapping

هذه الواجهات مخصصة لفهم الربط بين منيو الطلب لمرة واحدة ومنيو الاشتراكات.
هذه الواجهات إدارية فقط ولا تغير منيو الموبايل الحالي.

---

## 16.1 عرض الهويات المشتركة

```http
GET /dashboard/menu-identities
```

### Query Params

| Param      | الوصف        |
| ---------- | ------------ |
| `page`     | رقم الصفحة   |
| `limit`    | عدد العناصر  |
| `key`      | بحث بالمفتاح |
| `type`     | نوع الهوية   |
| `isActive` | فلترة        |

---

## 16.2 تفاصيل هوية مشتركة

```http
GET /dashboard/menu-identities/:id
```

---

## 16.3 روابط هوية مشتركة

```http
GET /dashboard/menu-identities/:id/links
```

---

## 16.4 كل روابط الهويات

```http
GET /dashboard/menu-identity-links
```

### Query Params

| Param         | الوصف                              |
| ------------- | ---------------------------------- |
| `channel`     | `one_time` أو `subscription`       |
| `sourceModel` | مثل `MenuOption`, `BuilderProtein` |
| `confidence`  | `exact`, `alias`, `manual`         |
| `status`      | `pending`, `confirmed`, `rejected` |
| `isActive`    | فلترة                              |

---

# 17. Menu Identity Suggestions

هذه الواجهات خاصة بمراجعة المقترحات الآلية لربط عناصر المنيو بين one-time والاشتراكات.

الموافقة على suggestion لا تغير منيو الموبايل ولا منطق التسعير.
هي فقط تنشئ mapping داخلي.

---

## 17.1 عرض المقترحات

```http
GET /dashboard/menu-identity-suggestions
```

### Query Params

| Param        | الوصف                             |
| ------------ | --------------------------------- |
| `page`       | رقم الصفحة                        |
| `limit`      | عدد العناصر                       |
| `status`     | `pending`, `approved`, `rejected` |
| `confidence` | `exact`, `alias`, `manual`        |
| `type`       | نوع الهوية                        |

---

## 17.2 تفاصيل مقترح

```http
GET /dashboard/menu-identity-suggestions/:id
```

---

## 17.3 الموافقة على مقترح

```http
POST /dashboard/menu-identity-suggestions/:id/approve
```

### Body

```json
{
  "notes": "تم التأكد من أن جمبري وروبيان نفس العنصر"
}
```

### Result

* ينشئ أو يستخدم `SharedMenuIdentity`.
* ينشئ `MenuIdentityLink`.
* يسجل ActivityLog.
* لا يغير `/api/orders/menu`.

---

## 17.4 رفض مقترح

```http
POST /dashboard/menu-identity-suggestions/:id/reject
```

### Body

```json
{
  "notes": "ليست نفس المادة"
}
```

---

# 18. Dashboard Orders

## 18.1 قائمة الطلبات

```http
GET /dashboard/orders
```

### Query Params

| Param               | الوصف                          |
| ------------------- | ------------------------------ |
| `status`            | مثل `confirmed,in_preparation` |
| `paymentStatus`     | مثل `paid`, `pending`          |
| `fulfillmentMethod` | مثل `pickup`                   |
| `from`              | بداية التاريخ                  |
| `to`                | نهاية التاريخ                  |
| `q`                 | بحث بالعميل أو رقم الطلب       |
| `page`              | رقم الصفحة                     |
| `limit`             | عدد العناصر                    |

### Response Example

```json
{
  "status": true,
  "data": {
    "items": [
      {
        "source": "one_time_order",
        "entityType": "order",
        "orderId": "order_id",
        "orderNumber": "ORD-709834E2",
        "status": "confirmed",
        "paymentStatus": "paid",
        "fulfillmentMethod": "pickup",
        "customer": {
          "id": "customer_id",
          "name": "كريم",
          "phone": "+201000000000"
        },
        "pricing": {
          "totalHalala": 400,
          "currency": "SAR"
        },
        "allowedActions": ["prepare", "cancel"]
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 25,
      "total": 1,
      "pages": 1
    }
  }
}
```

---

## 18.2 تفاصيل الطلب

```http
GET /dashboard/orders/:orderId
```

### Response Includes

```text
order data
customer
items
pricing
payment
pickup
delivery if applicable
activity
allowedActions
```

---

## 18.3 تنفيذ إجراء على طلب

```http
POST /dashboard/orders/:orderId/actions/:action
```

### Actions

| Action             | من                 | إلى                |
| ------------------ | ------------------ | ------------------ |
| `prepare`          | `confirmed`        | `in_preparation`   |
| `ready_for_pickup` | `in_preparation`   | `ready_for_pickup` |
| `fulfill`          | `ready_for_pickup` | `fulfilled`        |
| `cancel`           | حالات متعددة       | `canceled`         |

### Body

```json
{
  "notes": "جاهز للاستلام",
  "reason": "Order is ready"
}
```

### ملاحظة

استخدم `allowedActions` من تفاصيل الطلب لتحديد الأزرار المتاحة في UI.

---

# 19. Dashboard Boards / Operations

## 19.1 Kitchen Queue

```http
GET /dashboard/boards/kitchen/queue
```

### Query Params

| Param    | الوصف        |
| -------- | ------------ |
| `date`   | `YYYY-MM-DD` |
| `status` | حالة الطلب   |
| `page`   | رقم الصفحة   |
| `limit`  | عدد العناصر  |

---

## 19.2 Pickup Queue

```http
GET /dashboard/boards/pickup/queue
```

### Query Params

| Param    | الوصف        |
| -------- | ------------ |
| `date`   | `YYYY-MM-DD` |
| `status` | حالة الطلب   |
| `page`   | رقم الصفحة   |
| `limit`  | عدد العناصر  |

---

# 20. Subscription / Meal Planner Admin

هذه الواجهات تدير منيو الاشتراكات، وهي منفصلة عن One-Time Menu.

> غير مؤكد من الكود الحالي: كل المسارات النهائية والتفاصيل الدقيقة لهذه الواجهات.
> المسارات المتداولة في المشروع تبدأ غالبًا بـ:
>
> ```http
> /dashboard/meal-planner
> /admin/meal-planner-menu
> ```

## أقسام متوقعة

```text
categories
proteins
carbs
sandwiches
salad-ingredients
addons
```

### مثال عام لإنشاء Protein

```json
{
  "key": "grilled_chicken",
  "name": {
    "ar": "دجاج مشوي",
    "en": "Grilled Chicken"
  },
  "isActive": true,
  "isAvailable": true,
  "sortOrder": 1
}
```

---

# 21. Uploads / Images

## 21.1 رفع صورة

```http
POST /dashboard/uploads/image
```

### Content-Type

```http
multipart/form-data
```

### Field

```text
image
```

### Response Example

```json
{
  "status": true,
  "data": {
    "url": "https://..."
  }
}
```

بعد رفع الصورة، استخدم `url` في:

```json
{
  "imageUrl": "https://..."
}
```

داخل product أو option.

> غير مؤكد من الكود الحالي: اسم endpoint النهائي لرفع الصور إذا كان مختلفًا.

---

# 22. Settings / Misc

> غير مؤكد من الكود الحالي: كل endpoints الخاصة بالإعدادات.

أمثلة متوقعة:

```http
GET /dashboard/settings
PATCH /dashboard/settings
GET /dashboard/settings/restaurant-hours
PUT /dashboard/settings/restaurant-hours
```

---

# 23. Workflow كامل لتحديث المنيو الأسبوعي

## 23.1 الخطوات

1. افتح شاشة المنيو في الداشبورد.
2. عدّل المنتجات أو الخيارات.
3. استخدم `isAvailable=false` للعناصر التي نفدت مؤقتًا.
4. أضف الخيارات الجديدة لو ظهرت هذا الأسبوع.
5. عدّل maxSelections لو تغيرت القواعد.
6. عدّل أسعار fixed products أو custom products.
7. شغّل:

```http
POST /dashboard/menu/validate
```

8. لو `ok=false`، اعرض الأخطاء ولا تسمح بالنشر.
9. لو `ok=true`، شغّل:

```http
POST /dashboard/menu/publish
```

10. تطبيق الموبايل يقرأ المنيو الجديد من:

```http
GET /api/orders/menu
```

---

# 24. قواعد السلامة قبل النشر

* لا تستخدم `delete` للعناصر التي قد تعود.
* لا تستخدم `isActive=false` لنفاد مؤقت.
* كل الأسعار بالهللة.
* لا تنشر قبل validate.
* لا تعدّل endpoints الخاصة بالموبايل.
* لا تعتمد على السعر القادم من العميل.
* الطلبات القديمة محفوظة بـ snapshots.
* Mapping approval لا يغير runtime menu حاليًا.

---

# 25. أوامر اختبار مهمة للباك إند

```bash
npm run validate:backend
npm run test:weekly-menu-dashboard
npm run test:one-time-menu
npm run test:mobile-contracts
npm run test:one-time-full-flow
npm run test:menu-identity
npm run test:menu-identity-suggestions
```

---

# 26. Glossary

| المصطلح                | المعنى                               |
| ---------------------- | ------------------------------------ |
| Halala                 | أصغر وحدة للعملة. 100 هللة = 1 ريال  |
| fixed                  | منتج بسعر ثابت                       |
| per_100g               | منتج سعره لكل 100 جرام               |
| Option Group           | مجموعة خيارات مثل بروتينات أو فواكه  |
| Option                 | عنصر داخل مجموعة مثل سالمون أو مانجا |
| ProductGroupOption     | ربط option بمنتج معين مع overrides   |
| extraPriceHalala       | سعر إضافي ثابت                       |
| extraWeightUnitGrams   | وحدة الوزن الإضافية                  |
| extraWeightPriceHalala | سعر كل وحدة وزن إضافية               |
| MenuVersion            | نسخة منشورة من المنيو                |
| Snapshot               | نسخة محفوظة من المنتج وقت الطلب      |
| SharedMenuIdentity     | هوية مشتركة بين one-time والاشتراكات |
| MenuIdentitySuggestion | مقترح ربط بين عناصر متشابهة          |
| Publish                | نشر التغييرات لتظهر في التطبيق       |
