# دليل تكامل Flutter مع Dashboard API

هذا الدليل الشامل مخصص لمطور Flutter لبناء لوحة التحكم (Dashboard) بالكامل. لا تعتمد على Postman بشكل مباشر كمرجع نهائي، بل اعتمد على هذا الدليل لبناء الشاشات الـ 29.

## 0. قواعد عامة لكل الشاشات

- **Base URL**: جميع الطلبات تبدأ من `{{baseUrl}}` (مثلاً: `/api` بعد النطاق الأساسي).
- **Authorization**: يجب إرسال `Authorization: Bearer {{dashboardToken}}`. توكن لوحة التحكم يختلف تماماً عن توكن تطبيق الهاتف.
- **اللغة**: يجب إرسال `Accept-Language: ar` لضمان عودة النصوص العربية. يمكن أيضاً استخدام `en`.
- **الأسعار**: كل حقول الأموال التي تنتهي بكلمة `Halala` مخزنة بالهللة (مثال: السعر 100 ريال يعود كـ 10000 هللة). للتحويل: `SAR = halala / 100`.
- **ضريبة القيمة المضافة (VAT)**: الأسعار شاملة الضريبة دائماً. **ممنوع بتاتاً** على Flutter إضافة الضريبة في الـ Frontend، فقط اعرض `vatHalala` والأسعار كما تأتي من الـ Backend.
- **الحذف السهل (Soft Delete)**: عملية الحذف `DELETE` للبيانات الأساسية تقوم بتعطيل العنصر (`isActive: false`).
- **الأسباب (Reasons)**: اطلب سبب التغيير دائماً عبر Modal من المستخدِم عند كل تغيير حالة (Status) للعمليات، وضمّنه في حقل `reason` في الطلب.
- **المنطق والحالة**: اِعتمد دائماً وحصراً على حالة Backend وما يُرجعه من `allowedActions` أو `uiState`. 

---

## 1. Login

**الهدف**: تسجيل دخول مسؤولي النظام للوحة التحكم.
**Roles**: الجميع (عام).

**Endpoints**:
- `POST /api/dashboard/auth/login`
- `GET /api/dashboard/auth/me`
- `POST /api/dashboard/auth/logout`

**Request Body (Login)**:
```json
{
  "email": "admin@example.com",
  "password": "password123"
}
```

**Fields To Show**:
- الـ Token الخاص بالمدير وصلاحياته (`role`, `name`, `email`).

**UI Behavior & Warnings**:
- **Token Storage**: احفظ `dashboardToken` بمعزل تماماً عن الـ Token الخاص بتطبيق الموبايل كي لا يحدث تداخل.
- عند انتهاء Session، وجه المستخدم فوراً لشاشة تسجيل الدخول وأخلِ التوكن.

---

## 2. Overview

**الهدف**: الشاشة الرئيسية التي يراها الإدارة للملخص والإحصائيات السريعة.
**Roles**: admin, superadmin

**Endpoints**:
- `GET /api/dashboard/overview?limit=5`
- `GET /api/dashboard/reports/today`
- `GET /api/dashboard/notifications/summary`
- `GET /api/dashboard/search?q=&limit=10`

**Query Params**: 
- لـ `/search`: `q` (كلمة البحث), `limit` (عدد النتائج).

**Fields To Show**:
- أرقام الدخل (revenue)، عدد الطلبات المكتملة، الإشعارات غير المقروءة.

**UI Behavior & Warnings**:
- اجعل البحث النصي متاحاً في التطبيق بالأعلى كـ (Global Search)، حيث يبدأ بالبحث عن `q` عند كتابة أكثر من حرفين.

---

## 3. Subscriptions List

**الهدف**: استعراض، بحث، وفلترة قائمة الاشتراكات.
**Roles**: admin, superadmin

**Endpoints**:
- `GET /api/dashboard/subscriptions`
- `GET /api/dashboard/subscriptions/summary`
- `GET /api/dashboard/subscriptions/export`

**Query Params**:
- `page`, `limit`, `status` (active, frozen, canceled, etc), `q` (رقم، اسم، هاتف), `from`, `to`.

**Fields To Show**:
- الجداول تعرض: حالة الاشتراك، الباقة، تاريخ البدء والانتهاء، وإجمالي المدفوع وقيم التنفيذ.

**UI Behavior & Warnings**:
- تأكد من إضافة زر Export لتحميل الملف واستدعاء مسار الـ `/export` بنفس الـ Filters المعروضة حالياً وتوجيهه للتنزيل.

---

## 4. Create Subscription

**الهدف**: إنشاء اشتراك جديد للعميل نيابة عنه بجميع تفاسيره، وتسعيره أولاً.
**Roles**: admin, superadmin

**Endpoints**:
- `GET /api/dashboard/users`, `GET /api/dashboard/plans`, `GET /api/dashboard/addon-plans`, `GET /api/dashboard/zones`, `GET /api/dashboard/meal-planner/premium-proteins`
- `POST /api/dashboard/subscriptions/quote` (تسعير وعرض فاتورة مبدئية)
- `POST /api/dashboard/subscriptions` (تكوين فعلي)

**Body - Create Subscription with Pickup**:
```json
{
  "userId": "64abcdef1234567890",
  "planId": "64abcdef0987654321",
  "startDate": "2026-05-10",
  "grams": 200,
  "mealsPerDay": 2,
  "deliveryMethod": "pickup",
  "addonPlans": ["64abcdef1111111111"],
  "premiumSelections": []
}
```

**Body - Create Subscription with Delivery**:
```json
{
  "userId": "64abcdef1234567890",
  "planId": "64abcdef0987654321",
  "startDate": "2026-05-10",
  "grams": 200,
  "mealsPerDay": 2,
  "deliveryMethod": "delivery",
  "zoneId": "64abcdef2222222222",
  "deliveryWindow": "16:00-18:00",
  "deliveryAddress": {
    "street": "Omar Bin Al Khattab Road",
    "building": "10A"
  },
  "addonPlans": [],
  "premiumSelections": []
}
```

**Body - Quote with PromoCode**:
```json
{
  "userId": "64abcdef1234567890",
  "planId": "64abcdef0987654321",
  "startDate": "2026-05-10",
  "grams": 200,
  "mealsPerDay": 2,
  "deliveryMethod": "pickup",
  "promoCode": "WELCOME10"
}
```

**UI Behavior & Warnings**:
- **ممنوع إنشاء الاشتراك مباشرة**. الواجهة يجب أولاً أن تقوم بإرسال الطلب للـ Quote. 
- عرض الفاتورة الناتجة من Quote، وفي حالة موافقة المشرف، يتم الضغط على زر "تأكيد" لاستدعاء نفس البايلود إلى مسار الإنشاء الرئيسي.

---

## 5. Subscription Detail

**الهدف**: إدارة حالة المشترك وقراءة الروزنامة، التخطي، التجميد، والأرصدة.
**Roles**: admin (معظم العمليات), superadmin (لتعديل الأرصدة).

**Endpoints**:
- `GET /api/dashboard/subscriptions/:id` 
- `GET /api/dashboard/subscriptions/:id/days`
- `GET /api/dashboard/subscriptions/:id/audit-log`
- `PUT /api/dashboard/subscriptions/:id/delivery`
- `PATCH /api/dashboard/subscriptions/:id/addon-entitlements`
- `PATCH /api/dashboard/subscriptions/:id/balances` (superadmin only)
- `POST /api/dashboard/subscriptions/:id/cancel`
- `PUT /api/dashboard/subscriptions/:id/extend`
- `POST /api/dashboard/subscriptions/:id/freeze`
- `POST /api/dashboard/subscriptions/:id/unfreeze`
- `POST /api/dashboard/subscriptions/:id/days/:date/skip`
- `POST /api/dashboard/subscriptions/:id/days/:date/unskip`

**Body Examples**:
*Cancel*:
```json
{ "reason": "Customer called and canceled due to travel" }
```
*Extend*:
```json
{ "days": 3, "reason": "Manual extension approved by support" }
```
*Freeze*:
```json
{ "from": "2026-05-12", "to": "2026-05-14", "reason": "Customer request" }
```

**UI Behavior & Warnings**:
- قسّم الشاشة لـ Tabs: `Overview, Days (الروزنامة), Delivery, Balances, Audit Log`.
- ممنوع عرض Action buttons لتغيير حالة يوم لـ اليوم السابق (باستثناء إجراءات مخصصة تظهر كأزرار متاحة من المخرجات).
- لا تغير الأرصدة المالية `balances` لأي حساب لا يحمل صلاحية الـ `superadmin`.

---

## 6. Plans

**الهدف**: إضافة وتعديل باقات الاشتراكات (عدد الأيام والخيارات).
**Roles**: admin, superadmin

**Endpoints**:
- `GET`, `POST` لـ `/api/dashboard/plans`
- `GET`, `PUT`, `DELETE` لـ `/api/dashboard/plans/:id`
- `PATCH /api/dashboard/plans/:id/toggle`

**Nested Endpoints**:
- `POST /api/dashboard/plans/:id/grams` ... إلخ.

**Body - Create/Update**:
```json
{
  "name": { "ar": "خطة شهرية", "en": "Monthly Plan" },
  "daysCount": 20,
  "currency": "SAR",
  "gramsOptions": [
    {
      "grams": 200,
      "mealsOptions": [ { "mealsPerDay": 2, "priceHalala": 120000, "compareAtHalala": 140000 } ]
    }
  ],
  "freezePolicy": { "enabled": true, "maxDays": 5, "maxTimes": 2 },
  "skipPolicy": { "enabled": true, "maxDays": 3 }
}
```

**UI Behavior & Warnings**:
- الحذف يتم عبر `isActive: false` ولا تحذف من قاعدة البيانات، بل تغيب عن واجهة المشتري في الهاتف.
- اعرض الحقول بـ SAR للموظف بينما يرسلها التطبيق كـ Halala.

---

## 7. Addon Plans

**الهدف**: إدارة الباقات الإضافية التي يستطيع العميل اختيارها عند دفع وتأكيد اشتراك كامل (مثل عصير يومي للمدة كاملة).
**Roles**: admin, superadmin

**Endpoints**: `GET`, `POST`, `PUT`, `DELETE`, `PATCH /:id/toggle` لـ `/api/dashboard/addon-plans`.

**Body**:
```json
{
  "name": { "ar": "عصير يومي", "en": "Daily Juice" },
  "kind": "plan",
  "category": "juice",
  "billingMode": "per_day",
  "priceHalala": 500,
  "currency": "SAR",
  "isActive": true,
  "sortOrder": 10
}
```

**UI Behavior & Warnings**: 
- **تحذير**: يجب التأكد أن `kind="plan"`.
- تُستخدم هذه الإضافات للشراء الجملي عند بداية الاشتراك ولا يمكن استخدام مسارات واختيارات الشراء اليومية المتقطعة لها.

---

## 8. Addon Items

**الهدف**: إدارة الإضافات الجزئية اليومية التي تستخدم ضمن المُخطط اليومي (Daily Meal-Planner).
**Roles**: admin, superadmin

**Endpoints**: `GET`, `POST`, `PUT`, `DELETE`, `PATCH /:id/toggle` لـ `/api/dashboard/addon-items`.

**Body**:
```json
{
  "name": { "ar": "Berry Blast", "en": "Berry Blast" },
  "kind": "item",
  "category": "juice",
  "billingMode": "flat_once",
  "priceHalala": 1300,
  "currency": "SAR",
  "isActive": true
}
```

**UI Behavior & Warnings**:
- يجب التأكد أن `kind="item"`.
- تُستخدم حصرياً لمخطط المنيو اليومي، ويُمنع عرضها للمدير كباقة اشتراك أولية.

---

## 9. Meal Planner Categories

**الهدف**: تصنيفات وجبات الطعام لعرضها كـ Tabs أو أقسام.
**Roles**: admin, superadmin

**Endpoints**: مسار `/api/dashboard/meal-planner/categories` بالتبعية (CRUD).

**Body**:
```json
{
  "key": "breakfast",
  "dimension": "protein",
  "name": { "ar": "فطور", "en": "Breakfast" },
  "description": { "ar": "", "en": "" },
  "rules": {},
  "isActive": true,
  "sortOrder": 10
}
```

---

## 10. Meal Planner Proteins

**الهدف**: إدارة البروتينات الأساسية (المجانية افتراضياً أو ضمن الحصة).
**Roles**: admin, superadmin

**Endpoints**: كباقي مكونات المنيو في `/api/dashboard/meal-planner/proteins`.

**Body**:
```json
{
  "key": "grilled_chicken",
  "name": { "ar": "دجاج مشوي", "en": "Grilled Chicken" },
  "description": { "ar": "", "en": "" },
  "proteinFamilyKey": "chicken",
  "extraFeeHalala": 0,
  "isActive": true
}
```

---

## 11. Meal Planner Premium Proteins

**الهدف**: إدارة تشكيلة البروتينات المدفوعة.
**Roles**: admin, superadmin

**Endpoints**: `/api/dashboard/meal-planner/premium-proteins`

**Body**:
```json
{
  "key": "premium_salmon",
  "premiumKey": "premium_salmon",
  "name": { "ar": "سلمون مميز", "en": "Premium Salmon" },
  "proteinFamilyKey": "fish",
  "extraFeeHalala": 2200,
  "isActive": true,
  "sortOrder": 10
}
```

---

## 12. Meal Planner Carbs

**الهدف**: التحكم بقوائم الكربوهيدرات المتاحة كأرز وبطاطس.
**Roles**: admin, superadmin

**Endpoints**: `/api/dashboard/meal-planner/carbs`

**Body**:
```json
{
  "key": "brown_rice",
  "name": { "ar": "أرز بني", "en": "Brown Rice" },
  "description": { "ar": "", "en": "" },
  "isActive": true,
  "sortOrder": 10
}
```

**UI Behavior**: واجهة شبيهة بباقي أصناف المنيو مع زر لتفعيل/إلغاء الصنف (Toggle).

---

## 13. Meal Planner Sandwiches

**الهدف**: إدارة سندويشات المنيو المعروضة كمكون رئيسي وتحديد السعرات فيها.
**Roles**: admin, superadmin

**Endpoints**: `/api/dashboard/meal-planner/sandwiches`

**Body**:
```json
{
  "name": { "ar": "ساندويتش دجاج", "en": "Chicken Sandwich" },
  "description": { "ar": "مشوي على الفحم", "en": "Charcoal grilled" },
  "imageUrl": "",
  "calories": 420,
  "proteinFamilyKey": "chicken",
  "isActive": true,
  "sortOrder": 10
}
```

**UI Behavior**: شاشة لعرض التفاصيل مع إمكانية رفع `imageUrl` وعرض `calories`.

---

## 14. Meal Planner Salad Ingredients

**الهدف**: تحكم تفصيلي في محتويات السلطة القابلة للتخصيص من قبل العميل، وتوزيعها بناءً على الـ Group.
**Roles**: admin, superadmin

**Endpoints**: `/api/dashboard/meal-planner/salad-ingredients`

**Body**:
```json
{
  "groupKey": "vegetables",
  "name": { "ar": "خيار", "en": "Cucumber" },
  "calories": 15,
  "price": 0,
  "maxQuantity": 3,
  "isActive": true,
  "sortOrder": 10
}
```

**UI Behavior & Warnings**:
- وفّر Select box أو مُدخل لـ `groupKey` (الخيارات عادة: `leafy_greens`, `vegetables`, `protein`, `cheese_nuts`, `fruits`, `sauce`).

---

## 15. App Users

**الهدف**: استعراض معلومات المتعاملين الفعليين (الـ Clients) في الهاتف الذكي وتعديل بيانتهم الأساسية.
**Roles**: admin, superadmin

**Endpoints**:
- `GET`, `POST`, `GET /:id`, `PUT /:id` لـ `/api/dashboard/users`
- `GET /api/dashboard/users/:id/subscriptions` لجلب سجلهم.

**Body**:
```json
{
  "phone": "+966500000000",
  "fullName": "Sara Ahmed",
  "email": "sara.ahmed@example.com",
  "isActive": true
}
```

**UI Behavior**: شاشة رئيسية بالجدول وشاشة تفاصيل تتضمن تبويب لاشتراكات هذا العميل.

---

## 16. Payments

**الهدف**: مشاهدة الدفعات المالية المنجزة والمرفوضة والتحقق منها.
**Roles**: admin, superadmin

**Endpoints**:
- `GET /api/dashboard/payments?page=1&limit=20`
- `GET /api/dashboard/payments/:id`
- `POST /api/dashboard/payments/:id/verify` (للتحقق وتأكيد فشل/نجاح بوابة الدفع).

**Query Params**: `status`, `type`, `provider`.

**Body/Payload لعمل Verify اليدوي**:
```json
{
  "reason": "Payment was stuck on Moyasar panel, forcing verification"
}
```

**UI Behavior & Warnings**: 
- **ممنوع إنشاء Payments أو تعديل حالة Payment يدوياً**. الفواتير تُحصّل من النظام. التحقق اليدوي هو فقط لعمل Ping لمنصة Moyasar بحال تعلقت الدفعة، ويوجه لـ `verify`.

---

## 17. Payment Breakdown

**الهدف**: عرض تفاصيل استلام الدفعة ومكوناتها الضريبية والفاتورة المحددة.
**Roles**: admin, superadmin

**Endpoints**: `GET /api/dashboard/payments/:id/breakdown`

**Returns**:
`subtotalHalala`, `discountHalala`, `vatHalala`, `totalHalala`, `paidHalala`, `currency`, `paymentProvider`, `status`, `lineItems`.

**UI Behavior & Warnings**: 
- **تحذير**: لا تضف أي حساب للضريبة `VAT` في الواجهة. السعر `totalHalala` هو السعر الكلي شامل التخفيضات والضرائب. 

---

## 18. Promo Codes

**الهدف**: إدارة أكواد التخفيض الترويجية وضبط حدودها.
**Roles**: admin, superadmin

**Endpoints**:
- `/api/dashboard/promo-codes` (عمليات CRUD كاملة مع مسار `validate`).

**Create / Update Body**:
```json
{
  "code": "WELCOME10",
  "name": { "ar": "خصم ترحيبي", "en": "Welcome Discount" },
  "discountType": "percentage",
  "discountValue": 10,
  "maxDiscountHalala": 10000,
  "minOrderHalala": 50000,
  "startsAt": "2026-05-01T00:00:00.000Z",
  "endsAt": "2026-06-01T00:00:00.000Z",
  "usageLimit": 100,
  "usageLimitPerUser": 1,
  "appliesTo": "subscriptions",
  "planIds": [],
  "addonPlanIds": [],
  "isActive": true
}
```

**Validate Body**:
```json
{
  "code": "WELCOME10",
  "userId": "64abcdef1234567890",
  "planId": "64abcdef0987654321",
  "subtotalHalala": 100000,
  "vatPercentage": 15
}
```

**UI Behavior & Warnings**:
- لا تقم ببرمجة دالة حساب التخفيض داخلياً وتطبيقها للاشتراك! الـ Validate يُرجع القيمة المخصومة، والخصم النهائي يرسى من الـ Backend أثناء الـ Quote!

---

## 19. Delivery Zones

**الهدف**: تعريف مناطق التوصيل المتاحة وتكلفة الدليفري لها.
**Roles**: admin, superadmin

**Endpoints**: `/api/dashboard/zones`

**Body - Create/Update**:
```json
{
  "name": { "ar": "شمال الرياض", "en": "North Riyadh" },
  "city": "Riyadh",
  "districts": ["Al Olaya", "Al Aqeeq"],
  "deliveryFeeHalala": 1000,
  "isActive": true,
  "sortOrder": 10
}
```

**UI Behavior & Warnings**:
- التعطيل (Toggle/Delete) يحجب المنطقة عن التسجيلات القادمة ويبقيها للأحياء الموجودة مسبقاً في الداتابيز.

---

## 20. Delivery Schedule

**الهدف**: عرض جدولة ومراقبة عمليات المندوبين ولوحة أوقات التوزيع.
**Roles**: admin, courier, superadmin

**Endpoints**: `GET /api/dashboard/delivery-schedule`

**Query Params**: `date`, `zoneId`, `status`, `courierId`, `deliveryWindow`, `q`.

**Returns**:
`summary`, `groupedByWindow`, `groupedByZone`, `items`.

**UI Behavior**:
- لا توفر أزرار للتعديل من هذه الشاشة. التدخل والتعديل يتم بمسارات المندوب Ops Actions. الجدول للعرض الإداري فقط.

---

## 21. Kitchen Board

**الهدف**: المهام اليومية للمطبخ والتعامل مع تحضير طلبات الاستلام أو التوصيل.
**Roles**: admin, kitchen, superadmin

**Endpoints**:
- `GET /api/dashboard/kitchen/queue`
- `GET /api/dashboard/kitchen/queue/:dayId`
- `POST /api/dashboard/kitchen/actions/:action`

**Actions**: `prepare`, `ready_for_pickup`, `cancel`, `reopen`.

**Action Body Example**:
```json
{
  "entityId": "64abcdef...",
  "entityType": "subscription_day",
  "payload": {
    "reason": "تجهيز الوجبة لتسليمها بالفرع",
    "notes": "العميل يرغب بعصيرين"
  }
}
```

**UI Behavior & Warnings**: 
- ركّز على تقديم شاشة بـ Tabs للطبخ المجدول (`locked/planned`) وقيد الإنشاء. 
- يمنع عرض أزرار للأيام القديمة التي مضى تاريخها.

---

## 22. Courier Board

**الهدف**: حركة طلبات التوصيل وسيارات المندوبين.
**Roles**: admin, courier, superadmin

**Endpoints**:
- `GET /api/dashboard/courier/queue`
- `GET /api/dashboard/courier/queue/:dayId`
- `POST /api/dashboard/courier/actions/:action`

**Actions**: `dispatch`, `notify_arrival`, `fulfill`, `cancel`, `reopen`.

**Action Body Example**:
```json
{
  "entityId": "64abcdef...",
  "entityType": "subscription_day",
  "payload": {
    "reason": "تم تسليم الطلب للعميل بنجاح"
  }
}
```

**UI Behavior & Warnings**: 
- **تحذير**: لا تطلب أو تطبق أزرار Courier/Delivery لمنتجات نوعها `pickup` (استلام محلي). إذا فعلتها ستعيد سيرفرات التطبيق 400.

---

## 23. Branch Pickup Board

**الهدف**: تتبع تسلّم العميل المباشر للوجبة من الفرع.
**Roles**: admin, kitchen, superadmin

**Endpoints**:
- `GET /api/dashboard/pickup/queue`
- `GET /api/dashboard/pickup/queue/:dayId`
- `POST /api/dashboard/pickup/actions/:action`

**Actions**: `ready_for_pickup`, `fulfill`, `cancel`, `reopen`.

**Action Body Example**:
```json
{
  "entityId": "64abcdef...",
  "entityType": "subscription_day",
  "payload": {
    "reason": "تم استلام الطلب من قِبل العميل بالفرع"
  }
}
```

**UI Behavior & Warnings**: 
- `fulfill` للـ Pickup يعني أن الكاونتر بالمطعم أعطى الطلب للعميل، وهو بمثابة إغلاق الوجبة بنجاح.

---

## 24. Settings

**الهدف**: التحكم بإعدادات النواة والنسب ومتغيرات التطبيق الشاملة.
**Roles**: admin, superadmin

**Endpoints**:
- `GET /api/dashboard/settings`
- `GET /api/dashboard/settings/:key`
- `PUT /api/dashboard/settings/:key`
- `PATCH /api/dashboard/settings`

**Body - Patch Canonical Settings**:
```json
{
  "vat_percentage": 15,
  "delivery_windows": ["16:00-18:00", "18:00-20:00"],
  "cutoff_time": "12:00",
  "restaurant_open_time": "10:00",
  "restaurant_close_time": "23:00",
  "restaurant_is_open": true,
  "subscription_delivery_fee_halala": 1200,
  "reason": "Dashboard settings update"
}
```

**Body - Update Sub-Entity (e.g. VAT)**:
```json
{ "percentage": 15 }
```

**UI Behavior & Warnings**: 
- **تحذير**: تعامل مع المفاتيح (`Keys`) الواردة من السيرفر كمعيار. لا تقم باصطناع أو اختلاق Keys إعدادات غير موجودة.

---

## 25. Restaurant Hours

**الهدف**: ضبط أوقات العمل الفعلية للمطعم وقفل الاستلام وتأثير أوقات الفروع التشغيلية.
**Roles**: admin, superadmin

**Endpoints**: `GET`, `PUT`, `PATCH /toggle-open` لـ `/api/dashboard/restaurant-hours`.

**Body**:
```json
{
  "restaurant_open_time": "10:00",
  "restaurant_close_time": "23:00",
  "isOpen": true,
  "weeklySchedule": [ { "dayOfWeek": 0, "openTime": "10:00", "closeTime": "23:00", "isClosed": false } ],
  "temporaryClosure": { "enabled": false, "reason": "", "startsAt": null, "endsAt": null },
  "deliveryWindows": ["16:00-18:00", "18:00-20:00"],
  "cutoffTime": "12:00",
  "timezone": "Asia/Riyadh"
}
```

---

## 26. Content Terms

**الهدف**: إدارة نصوص وشروط اشتراك الباقات القانونية المعروضة للعميل والموافقة عليها عند الشراء.
**Roles**: admin, superadmin

**Endpoints**: `GET`, `PUT` لـ `/api/dashboard/content/terms/subscription`.

**Body (PUT)**:
```json
{
  "title": "شروط وأحكام اشتراك الباقات الشهرية",
  "locale": "ar",
  "content": {
    "format": "structured_document",
    "sections": [
      {
        "id": "packages-and-meals",
        "heading": "شروط الباقات والوجبات",
        "paragraphs": [
          "يجب على المشترك اختيار الباقة المناسبة قبل إتمام الاشتراك."
        ]
      }
    ]
  }
}
```

**UI Behavior**: شاشة لعرض وتحرير كتل النصوص (Paragraphs/Sections) بدل المحتوى المعروض برمجياً.

---

## 27. Dashboard Users

**الهدف**: استعراض، إنشاء وتحديد صلاحيات مديري ومشرفي النظام (عكس الـ App Users للعملاء).
**Roles**: admin (جزئيات), superadmin (التحكم الكلي).

**Endpoints**: `/api/dashboard/dashboard-users` إضافة لـ `/reset-password`.

**Body - Create User**:
```json
{
  "email": "ops.manager@example.com",
  "password": "Password123!",
  "role": "admin",
  "isActive": true
}
```

**Body - Reset Password**:
```json
{
  "password": "NewPassword123!"
}
```

**UI Behavior**: جدول للإداريين، مع Modal لتغيير الباسورد أو إيقاف موظف من الدخول.

---

## 28. Ops Board

**الهدف**: لوحة القيادة الشاملة الاستطلاعية للتدخل في كل عمليات النظام التشغيلية الموجهة للإدارة العليا.
**Roles**: admin, superadmin

**Endpoints**: `/api/dashboard/ops/list`, `/api/dashboard/ops/search`, مسارات أزرار العمليات الافتراضية `/api/dashboard/ops/actions/:action`.

**UI Behavior**: 
- لوحة مراقبة فقط. شاشات Delivery/Kitchen مخصصة كـ Aliases لتجريد التركيز لكل موظف. هنا يتاح العرض والبحث الشامل للجميع.

---

## 29. Health

**الهدف**: صفحة تشخيص أعطال وتنبيهات لملفات الفهرسة للمطور والمشرف التقني لتنبيهات النظام الآلية.
**Roles**: admin, superadmin

**Endpoints**:
- `GET /api/dashboard/health/catalog`
- `GET /api/dashboard/health/subscription-menu`
- `GET /api/dashboard/health/meal-planner`
- `GET /api/dashboard/health/indexes`

**UI Behavior**: قراءة فقط. الشاشة تعرض الأخطاء. لا تصمم أزرار Mutation استرجاعية (ولا تحاول تعديل القواعد منها).

---

## 30. Roles and Screen Visibility

| Role | Screens Enabled | Permissions Details |
|---|---|---|
| **superadmin** | كل الشاشات بدون استثناء | له مطلق الدخول وتعديل Balance للمشترك وتغيير الحسابات الائتمانية. |
| **admin** | إعدادات النظام، التسعير، الاشتراكات ولوحة التشغيل | صلاحية واسعة ما عدا `balances` المالية. |
| **kitchen** | Kitchen Board وشاشة متابعة المنيو | إمكانية الوصول لقوائم الطبخ وبدائل الـ Pickup (الـ `prepare`, `ready_for_pickup`). |
| **courier** | Courier Board وجداول التوصيل حصراً | يملك تولي إجراءات النقل (`dispatch`, `fulfill`). |

---

## 31. Important Status Reference

**شرح مبسط ومباشر لحالات لوحة العميل (Timeline Status Rules):**

- **`planned`**: حالة مشتقة وليست مخزنة حرفياً في قاعدة البيانات بهذه الكلمة. تُستنتج بالواجهة عندما يكون اليوم `open` ولكن العميل اختار وجباته.
- **`consumed_without_preparation`**: يعني أن يومك مر زمنياً (حُسب كأي يوم بتمارين الـ Gym) دون التمكن من استلام أو تصنيع طلب.
- **`no_show`**: اليوم صُنع وأصبح `ready_for_pickup` بالفرع ولكن العميل أهمل الدخول وأخذ وجبته. يُعتبر يوماً محسوباً (مستهلكاً).
- **`skipped`** و **`frozen`**: هذه وتلك **لا تُسقط عدد الأيام من رصيد وجبات المشترك**. يُرّحل يومك لأسبوع قادم.
- **القاعدة الذهبية لتطبيق الفلتر**: ممنوع بتاتاً على تطبيق الـ Flutter القيام بمصادرة يوم كـ `consumed` من تلقاء نفسه، يجب الاعتماد حصرياً على استجابات السيرفر وتسوية الـ Backend Management!

**جدول مرجع الحالات السريع المدمج (Compact Status Reference Table):**

| الحالة (Status) | الوصف المختصر | نهائية (Final)? | حالة الأزرار (Actions)? |
|---|---|:---:|:---:|
| `open` | مفتوح للتعديل أو الانتظار | ❌ لا | ✅ يعتمد على الجاهزية |
| `planned` | حالة قراءة ليوم مفتوح + توجد اختيارات | ❌ لا | ✅ يُعطى للتحضير |
| `locked` | مقفول لليوم (وقت الـ Cutoff) | ❌ لا | ✅ للتحضير |
| `in_preparation`| قيد التجهيز بالمطبخ | ❌ لا | ✅ للنقل أو الاستلام |
| `ready_for_pickup`| جاهز للعميل في الفرع | ❌ لا | ✅ للتسليم أو الإلغاء |
| `out_for_delivery`| مع المندوب للتوصيل | ❌ لا | ✅ وصول المندوب/تسليم |
| `fulfilled` | اكتمل وسلم بنجاح | ✅ نعم | ❌ مخفية |
| `consumed_without_preparation`| استنفذ وقته ولم يصنع | ✅ نعم | ❌ مخفية |
| `no_show` | العميل لم يحضر للاستلام | ✅ نعم | ❌ مخفية |
| `delivery_canceled` | ألغيت بمسار التوصيل | ✅ نعم | ❌ مخفية |
| `canceled_at_branch`| ألغيت داخلياً بالفرع | ✅ نعم | ❌ مخفية |
| `skipped` | تخطي رصيدي من العميل/المشرف | ✅ نعم | ❌ مخفية |
| `frozen` | تجميد مؤقت للرصيد | ✅ نعم | ❌ مخفية |

---

## 32. استخدم هذا بدلاً من هذا (Use this vs Not this)

لقد صممنا لوحات الـ Dashboard لفصل الحالات منعاً للتشابك التشغيلي، كالتالي المطروح:

1. **Addon Plans** بدلاً من **Addon Items**:
   استخدم `Addon Plans` للإضافات المصاحبة للاشتراك طيلة فترته (كطلب ديتوكس يومي بجانب الاشتراك كاملاً). بينما استخدم `Addon Items` للإضافات المخصصة كجزء من أكلة يوم واحد تُباع فردياً.
2. **Dashboard Users** بدلاً من **App Users**:
   الأولى للموظفين ومدراء النظام. الثانية هي زبائن وجبات مطعمك الفعليين التي يسجلون بالموبايل.
3. **لـ Meal-Planner routes**: استخدم دوماً `/api/dashboard/meal-planner/*` المستحدثة، ولا تستدعِ أبداً الملفات من المسارات القديمة `/api/admin/meal-planner-menu/*` حتى لو ظهرت مصادفة ببيئة أخرى.
4. **Payment Breakdown** بدلاً من **Payments list**:
   حينما ينظر المدير لتفاصيل الدفعة وضرائبها، اسحب البيانات من Breakdown Endpoint للحصول على تسعيرة دقيقة.
5. **Kitchen/Courier/Pickup boards** في واجهات التطبيق المخصصة بدلاً من إعطائهم **Ops Board**:
   يجب استخدام لوحات Kitchen وCourier وPickup للموظفين المختصين كلا حسب دوره. بينما لوحة **Ops Board** مخصصة فقط للقيادة الإدارية الشاملة (Search/Overview/Intervention) ولا ينبغي استخدامها لكامل مهام الموظفين اليومية المحصورة.

---

## 33. مسار تنفيذ واختبار للمطورين (Testing Order for Flutter Developer)

عند بنائك وبرمجتك لواجهات لوحة التحكم هذه، اتّبِع المسار التالي بالتسلسل لاختبار وظائف التطبيق مع الـ API بنجاح تام وسلاسة:
1. صمم Login وجرب أخذ توكنك وعرضه.
2. اختبر الشاشة الأم Overview وارسم مقاييس الدخل فيها.
3. توجه تبويب المنيو: ابنِ Create Plan.
4. ابنِ Create Addon Plan وعيّن الصنف.
5. توجّه لتبويب Users، وأنشئ App User كعميل تيست.
6. اذهب لشاشة Create Subscription وتوقف، أنشئ أولاً **Quote Subscription** للمستخدم، أرسل السعر، وبعد استجابة التسعيرة اضغط موافقة وارسال **Create Subscription** الفعلي!
7. توجّه إلى Subscription Details وافتح الروزنامة، وانظر إلى Timeline.
8. اختبر انتقال الحالة Kitchen Prepare (غيّره من locked/planned إلى in_preparation).
9. اختبر الـ Pickup Fulfill (كاستلام محلي)، **أو** اختبر Courier Dispatch ثم Fulfill لمندوب.
10. اختبر اضافة كود الخصم (Promo validation).
11. اختبر عرض الفواتير وعملياتها (Payment Breakdown) لتأكيد الضرائب والخصومات المعروضة بنهاية خط الفاتورة.

---

*ملحوظة للمبرمج: تذكر دوماً بأن لا تضمن أي مفاتيح أو Passwords حساسة من الـ Postman بداخل تطبيق Flutter بصلابة بالكود.*
