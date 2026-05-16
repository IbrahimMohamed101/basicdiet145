> Status: Merge candidate. This document overlaps with newer documentation. Review `docs/DOCS_CLEANUP_RECOMMENDATIONS.md` before using it as source of truth.

# تقرير توافق تصميم واجهة الطلبات مع الباك إند

## 1. الهدف من التقرير

هذا الملف يلخص الشكل النهائي المقترح للـ UI الخاص بتطبيق **Basic Diet / بسك دايت**، ويوضح كيف يجب أن يتوافق مع الباك إند الحالي الخاص بـ **One-Time Orders** و **Dynamic Menu Catalog**.

الهدف من التقرير أن يكون مرجعًا عند تعديل الباك إند أو ربط الواجهة، بحيث يكون واضحًا:

- ما الذي يظهر في شاشة الهوم.
- ما الذي يظهر في شاشة المنيو.
- ما الذي يفتح شاشة تخصيص Builder.
- ما الذي يضاف للسلة مباشرة.
- ما الذي يجب أن يأتي من الباك إند بدل ما يكون hardcoded.
- الفروقات بين التصميم الحالي ومتطلبات الباك إند.
- التعديلات المطلوبة في الداتا أو الـ API حتى يتماشى النظام مع تجربة المستخدم.

---

## 2. ملخص مهم جدًا

التصميم الجديد قائم على فكرة واضحة:

> **الهوم للعرض والتوجيه السريع فقط، المنيو للتصفح، والـ Builder للتخصيص، والباك إند هو مصدر السعر النهائي.**

يعني:

- شاشة **Home** لا تضيف منتجات للسلة مباشرة.
- قسم **مقترح لك** في الهوم مجرد shortcuts.
- المنتجات القابلة للتخصيص لا يتم إضافتها للسلة مباشرة.
- المنتجات القابلة للتخصيص تفتح شاشة Builder.
- المنتجات الثابتة فقط مثل الساندوتشات أو العصائر يمكن أن تُضاف للسلة من المنيو.
- السعر النهائي لا يتم حسابه في الواجهة.
- الواجهة ترسل IDs والاختيارات والوزن فقط.
- الباك إند يحسب السعر النهائي من خلال quote.

---

## 3. نظرة عامة على الباك إند الحالي

الباك إند الحالي يدعم Dynamic Menu Catalog من خلال:

```http
GET /api/orders/menu
```

الـ response يحتوي على:

- `categories`
- `products`
- `optionGroups`
- `options`
- `pricingModel`
- `priceHalala`
- `baseUnitGrams`
- `weightGrams`
- `minSelections`
- `maxSelections`
- IDs لكل product / group / option

وهذا مناسب جدًا لفكرة الـ UI الجديدة، بشرط أن يتم ربط الواجهة بطريقة dynamic بدل الاعتماد على أسماء ثابتة.

---

## 4. القاعدة العامة للـ UI

### 4.1 Home Screen

الهوم هو شاشة جذب وتوجيه، وليس شاشة بناء طلب أو checkout.

يحتوي على:

1. بوستر الاشتراكات.
2. كارد "طلب سريع اليوم".
3. قسم "مقترح لك".
4. روابط سريعة تفتح المنيو أو الـ Builder.

### 4.2 Menu Screen

المنيو هو شاشة عرض الأصناف والتصنيفات.

يحتوي على:

1. بحث.
2. فلترات / Category chips.
3. قسم "اطلب على مزاجك".
4. قسم "اختيارات خفيفة".
5. الساندوتش البارد.
6. الساوردو.
7. العصائر.
8. أي تصنيفات أخرى من الباك إند.

### 4.3 Builder Screen

الـ Builder هو شاشة تخصيص المنتج.

يظهر فيها:

- مجموعات الاختيارات.
- قواعد الاختيار.
- عدد المختار من كل مجموعة.
- وزن المنتج لو المنتج per_100g.
- اختيار البروتينات والكارب والصوصات.
- ملخص السعر من quote.
- زر إضافة للسلة أو تأكيد الطلب.

---

## 5. تقسيم أنواع المنتجات في التصميم

## 5.1 منتجات قابلة للتخصيص

هذه المنتجات لا تُضاف مباشرة للسلة. يجب أن تفتح شاشة Builder:

- سلطة بيسك
- وجبة بيسك
- سلطة فواكه
- زبادي يوناني

### السلوك

عند الضغط:

```text
builder.html?productId=<id>
```

أو مؤقتًا:

```text
builder.html?key=basic_salad
builder.html?key=basic_meal
builder.html?key=fruit_salad
builder.html?key=greek_yogurt
```

الأفضل في الربط الحقيقي استخدام `productId`.

---

## 5.2 منتجات ثابتة السعر

هذه المنتجات يمكن إضافتها للسلة مباشرة إذا كانت:

- `pricingModel = fixed`
- لا تحتاج `optionGroups` إلزامية
- لا تحتاج Builder

أمثلة:

- ساندوتش بارد
- ساوردو
- عصائر
- مياه
- بعض المنتجات الجاهزة

### السلوك

زر `+` في المنيو يضيف المنتج للسلة مباشرة:

```json
{
  "productId": "<product_id>",
  "qty": 1
}
```

---

## 5.3 اختصارات تصنيف

بعض كروت الهوم ليست منتجات، بل روابط لتصنيفات:

- ساندوتش ساوردو
- عصائر

### السلوك

عند الضغط:

```text
menu.html?section=sourdough
menu.html?section=juices
```

ثم يقوم المنيو بالـ scroll للقسم المطلوب.

---

# 6. تصميم Home Screen

## 6.1 بوستر الاشتراكات

### الوظيفة

- عرض تسويقي.
- يفتح صفحة الخطط أو الاشتراكات.

### التصميم

- صورة أكل premium.
- خلفية خضراء داكنة.
- النصوص من الـ UI وليس داخل الصورة.
- زر "عرض الخطط".

### ملاحظات ربط

هذا القسم غالبًا خارج One-Time Orders لأنه خاص بالاشتراكات، والباك إند الحالي في ملف One-Time Orders لا يغطي الاشتراكات.

---

## 6.2 كارد "طلب سريع اليوم"

### الوظيفة

مدخل عام لاختيار نوع طلب مخصص.

### النص النهائي

```text
اصنع طلبك على مزاجك
اختار النوع وابدأ تخصيص طلبك
يبدأ من 19 ريال / 100 جم
اختار النوع
```

### السلوك

عند الضغط على الكارد أو زر "اختار النوع":

```text
menu.html?section=custom-order
```

ثم يتم scroll لقسم "اطلب على مزاجك" في المنيو.

### مهم

لا يفتح سلطة مباشرة.
لا يفتح وجبة مباشرة.
لا يضيف للسلة.
هو فقط مدخل عام لاختيار النوع.

---

## 6.3 الاختصارات الصغيرة أسفل كارد طلب سريع اليوم

### العناصر

- سلطة بيسك
- وجبة بيسك

### السلوك

هذه اختصارات مباشرة للـ Builder:

```text
builder.html?key=basic_salad
builder.html?key=basic_meal
```

أو الأفضل:

```text
builder.html?productId=<basic_salad_id>
builder.html?productId=<basic_meal_id>
```

### ملاحظات

هذه الاختصارات يمكن أن تبقى في الهوم لأنها واضحة ومحددة.

---

## 6.4 قسم "مقترح لك"

### الفكرة النهائية

هذا القسم للعرض والتوجيه فقط، وليس للإضافة للسلة.

### العناصر النهائية

1. سلطة فواكه
2. زبادي يوناني
3. ساندوتش ساوردو
4. عصائر

### السلوك

| الكارت | النوع | السلوك |
| --- | --- | --- |
| سلطة فواكه | منتج قابل للتخصيص | يفتح Builder |
| زبادي يوناني | منتج قابل للتخصيص | يفتح Builder |
| ساندوتش ساوردو | تصنيف | يفتح المنيو عند قسم الساوردو |
| عصائر | تصنيف | يفتح المنيو عند قسم العصائر |

### الروابط المقترحة

```text
سلطة فواكه -> builder.html?key=fruit_salad
زبادي يوناني -> builder.html?key=greek_yogurt
ساندوتش ساوردو -> menu.html?section=sourdough
عصائر -> menu.html?section=juices
```

### ملاحظات UI

- لا يوجد زر `+`.
- لا يوجد add to cart من هذا القسم.
- يتم استخدام chip:
  - `تخصيص` للمنتجات القابلة للتخصيص.
  - `عرض` للتصنيفات.
- الكارت كله قابل للضغط.

---

# 7. تصميم Menu Screen

## 7.1 الهيدر

### العناصر

- عنوان: المنيو
- وصف: طلبات بيك أب لمرة واحدة
- أيقونة السلة
- أيقونة الرجوع للرئيسية
- شريط تنبيه: الطلبات للاستلام من الفرع فقط
- Search input
- Category chips

### الربط مع الباك إند

- `GET /api/orders/menu`
- يتم عرض التصنيفات من `categories`
- يتم عرض المنتجات من `products`
- لا يتم الاعتماد على ترتيب ثابت، بل على `sortOrder`

---

## 7.2 قسم "اطلب على مزاجك"

### الوظيفة

يعرض المنتجات القابلة للتخصيص.

### الكروت

- سلطة بيسك
- وجبة بيسك
- سلطة فواكه
- زبادي يوناني

### التصميم

- سلطة ووجبة بيسك: كروت كبيرة premium.
- سلطة فواكه وزبادي يوناني: كروت أصغر ولكن بنفس الروح البصرية.
- صورة أو thumbnail على الشمال.
- النص على اليمين.
- زر "ابدأ التخصيص".
- لا يوجد add to cart مباشر.

### السلوك

كل كارت يفتح Builder.

```text
basic_salad -> builder.html?productId=<id>
basic_meal -> builder.html?productId=<id>
fruit_salad -> builder.html?productId=<id>
greek_yogurt -> builder.html?productId=<id>
```

---

## 7.3 قسم "الساندوتش البارد"

### طبيعة القسم

منتجات ثابتة السعر غالبًا.

### المنتجات الحالية

- بيض مسلوق — 9 ريال
- تركي — 13 ريال
- حلوم كلاسيكي — 13 ريال
- تونا — 13 ريال
- بيض اسكرامبل — 13 ريال
- دجاج فاهيتا — 13 ريال
- دجاج مكسيكي — 13 ريال
- دجاج مشوي — السعر حسب الباك إند

### التصميم

- Horizontal compact cards.
- لا نعتمد على صور حقيقية.
- نستخدم fallback tile بالحروف.
- زر `+` يضيف للسلة.

### السلوك

إذا المنتج fixed:

```json
{
  "productId": "<id>",
  "qty": 1
}
```

---

## 7.4 قسم "الساوردو"

### المنتجات الحالية

- ساوردو حلومي — 23 ريال
- ساوردو تركي — 23 ريال
- ساوردو تونا — 23 ريال
- ساوردو دجاج مشوي — 23 ريال

### التصميم

- Vertical list cards.
- بدون صور حقيقية في المنيو.
- fallback tile موحد أو اختصار.
- زر `+`.

### السلوك

Fixed product add to cart.

---

## 7.5 قسم العصائر

### التصميم

- يمكن عرضه كتصنيف ثابت.
- إذا المنتجات موجودة من الباك إند يتم عرضها.
- إذا لا توجد صور، fallback tile.
- إذا تم الدخول من الهوم عبر `menu.html?section=juices` يتم scroll لهذا القسم.

---

# 8. Builder UI

## 8.1 متى نفتح Builder؟

يجب فتح Builder إذا كان المنتج:

- لديه `optionGroups`
- أو `pricingModel = per_100g`
- أو يتطلب اختيار مكونات
- أو ليس fixed product بسيط

أمثلة:

- basic_salad
- basic_meal
- fruit_salad
- greek_yogurt

---

## 8.2 تصميم Builder

### الهيدر

يعرض:

- اسم المنتج
- السعر الأساسي
- وصف قصير
- الوزن الحالي إن وجد
- ملخص التقدم

مثال:

```text
سلطة بيسك
29 ريال / 100 غرام
اختر المكونات حسب رغبتك
3 من 6 مكتمل
```

---

## 8.3 مجموعات الاختيارات

يتم عرض `optionGroups` كـ Accordion أو Cards.

كل group يحتوي على:

- اسم المجموعة
- قاعدة الاختيار
- عداد الاختيارات
- خيارات على هيئة chips

مثال:

```text
ورقيات
اختر 2
1/2
[خس] [جرجير] [ملفوف]
```

مثال:

```text
بروتينات
اختر 1
0/1
[دجاج مشوي] [تونا] [سالمون ★]
```

---

## 8.4 قواعد الاختيار

تعتمد على:

```text
minSelections
maxSelections
isRequired
```

### الحالات

| الحالة | عرض UI |
| --- | --- |
| min = max = 1 | اختر 1 |
| min = max = 2 | اختر 2 |
| min = 0, max > 1 | اختر حتى X |
| required = false | اختياري |
| max reached | تعطيل باقي الاختيارات مؤقتًا |

---

## 8.5 Options UI

كل option يظهر كـ chip:

### غير مختار

- خلفية بيضاء
- Border خفيف
- نص أخضر غامق

### مختار

- خلفية خضراء
- علامة check
- نص واضح

### Premium

إذا كان عنده نجمة أو extra price:

- يعرض chip صغير:
  - `مميز`
  - أو `+ سعر`

لكن لا يتم حساب النهائي في الواجهة.

---

## 8.6 الوزن

للمنتجات `per_100g` يجب عرض Weight selector.

يعتمد على:

- `defaultWeightGrams`
- `minWeightGrams`
- `maxWeightGrams`
- `weightStepGrams`

مثال:

```text
الوزن
[-] 100 غرام [+]
```

### الإرسال

```json
{
  "productId": "<id>",
  "qty": 1,
  "weightGrams": 200,
  "selectedOptions": []
}
```

---

## 8.7 Extra weight options

لو option يدعم:

- `extraWeightUnitGrams`
- `extraWeightPriceHalala`

مثال:

```json
{
  "groupId": "<groupId>",
  "optionId": "<optionId>",
  "extraWeightGrams": 50
}
```

### UI مقترح

عند اختيار بروتين له وزن إضافي:

```text
دجاج مشوي
+5 ريال / 50 غرام
[-] 50 غرام [+]
```

لكن السعر النهائي يتم تأكيده من quote.

---

## 8.8 Sticky bottom bar

أسفل شاشة Builder:

```text
السعر النهائي حسب الوزن والاختيارات
[عرض السعر] أو [إضافة للسلة]
```

الأفضل:

1. عند اختيار المكونات المطلوبة، يتم تفعيل زر:
   - `عرض السعر`
2. يتم إرسال Quote.
3. بعد quote يظهر:
   - الإجمالي
   - زر `إضافة للسلة`

أو يمكن عمل quote عند كل تغيير مع debounce.

---

# 9. Cart و Checkout

## 9.1 بناء السلة محليًا

السلة المحلية تستخدم IDs فقط.

### fixed product

```json
{
  "productId": "<id>",
  "qty": 1
}
```

### per_100g product

```json
{
  "productId": "<id>",
  "qty": 1,
  "weightGrams": 200,
  "selectedOptions": [
    {
      "groupId": "<groupId>",
      "optionId": "<optionId>"
    }
  ]
}
```

---

## 9.2 Quote

عند checkout:

```http
POST /api/orders/quote
```

### لا ترسل

- price
- unitPrice
- total
- VAT
- delivery
- subscription fields

### أرسل فقط

- fulfillmentMethod = pickup
- pickup branch/window
- items
- productId
- qty
- weightGrams
- selectedOptions

---

## 9.3 Create order

```http
POST /api/orders
```

يجب استخدام:

```http
Idempotency-Key
```

لنفس محاولة الدفع.

---

## 9.4 Payment

الواجهة تفتح:

```text
paymentUrl
```

ثم بعد الرجوع:

```http
POST /api/orders/:orderId/payments/:paymentId/verify
```

لا يتم اعتبار الطلب مدفوعًا بدون verify من الباك إند.

---

# 10. الفروقات بين التصميم الحالي ومتطلبات الباك إند

## 10.1 الفرق الأول: التصميم يستخدم أسماء، الباك إند يريد IDs

### الحالي

قد يكون UI يستخدم:

```text
basic_salad
سلطة بيسك
```

### المطلوب

استخدام:

```text
productId
groupId
optionId
```

### الحل

- استخدم `key` فقط للبحث والربط المؤقت.
- عند الإرسال للباك إند، استخدم IDs.

---

## 10.2 الفرق الثاني: الأسعار في UI للعرض فقط

### الحالي

الـ UI يعرض:

```text
29 ريال / 100 غرام
```

### المطلوب

الـ checkout يعتمد على quote.

### الحل

- عرض السعر الأساسي من `priceHalala`.
- لا يتم حساب الإجمالي محليًا.
- النهائي من `POST /api/orders/quote`.

---

## 10.3 الفرق الثالث: بعض منتجات الهوم ليست منتجات

### الحالي

"ساندوتش ساوردو" و "عصائر" في الهوم يمكن أن يظهرا مثل منتجات.

### المطلوب

هما category shortcuts.

### الحل

- لا تعرض price.
- لا تعرض plus.
- اضغط يفتح category في المنيو.

---

## 10.4 الفرق الرابع: Fruit Salad و Greek Yogurt غير واضحين في itemTypes

### الحالي

الملف يذكر itemTypes مثل:

```text
basic_salad
basic_meal
cold_sandwich
dessert
juice
drink
```

### المطلوب

تحديد طريقة تمثيل:

- `fruit_salad`
- `greek_yogurt`

### الحل المفضل

إضافة itemTypes أو keys واضحة:

```text
fruit_salad
greek_yogurt
```

أو جعلهما داخل category `dessert` لكن product key واضح.

---

## 10.5 الفرق الخامس: التصنيفات التي يستخدمها الهوم يجب أن تكون موجودة كـ keys

### المطلوب

الهوم يفتح:

```text
menu.html?section=sourdough
menu.html?section=juices
menu.html?section=custom-order
```

### الحل

تأكد أن backend categories أو frontend mapping يحتوي على:

```text
custom-order
sourdough
juices
```

لو الباك إند يستخدم keys مختلفة، يجب عمل mapping في الواجهة.

---

# 11. توصيات تعديلات الباك إند

## 11.1 Product keys واضحة

تأكد من وجود keys ثابتة للمنتجات المهمة:

```text
basic_salad
basic_meal
fruit_salad
greek_yogurt
```

## 11.2 Category keys واضحة

تأكد من وجود category keys:

```text
custom_order
cold_sandwiches
sourdough
juices
light_options
```

أو أي naming ثابت، مع mapping في الواجهة.

## 11.3 Product itemType

يفضل أن تكون:

```text
basic_salad
basic_meal
fruit_salad
greek_yogurt
cold_sandwich
sourdough_sandwich
juice
drink
```

حتى يمكن للـ UI تحديد السلوك بسهولة.

## 11.4 Product behavior flags

إضافة حقول اختيارية تساعد الواجهة:

```json
{
  "uiBehavior": "builder",
  "layoutHint": "large_builder_card",
  "isShortcut": false
}
```

أو:

```json
{
  "requiresBuilder": true,
  "canAddDirectly": false
}
```

### مثال

```json
{
  "key": "basic_salad",
  "requiresBuilder": true,
  "canAddDirectly": false
}
```

### مثال للساندوتش

```json
{
  "key": "turkey_cold_sandwich",
  "requiresBuilder": false,
  "canAddDirectly": true
}
```

## 11.5 Images

الـ UI يمكنه استخدام:

```json
{
  "imageUrl": "https://..."
}
```

لو لا توجد صورة:

- الواجهة تستخدم fallback tile.

للمنتجات التي صممنا لها صور:

- basic_salad
- basic_meal
- fruit_salad
- greek_yogurt
- sourdough category
- juices category

يمكن إضافة `imageUrl` في product أو category.

## 11.6 Sort order

تأكد من ضبط `sortOrder` للتصنيفات والمنتجات.

الواجهة لا يجب أن تعتمد على order عشوائي.

## 11.7 Option group keys

يفضل استخدام keys واضحة:

### سلطة بيسك

```text
leafy_greens
vegetables_legumes
fruits
proteins
cheese_nuts
sauces
```

### وجبة بيسك

```text
carbs
proteins
```

### سلطة فواكه

```text
fruits
```

### زبادي يوناني

```text
fruits
nuts
```

---

# 12. المنتجات وقواعدها المطلوبة

## 12.1 سلطة بيسك

### السعر

```text
29 ريال / 100 غرام
+5 ريال كل 50 غرام دجاج
+6 ريال كل 50 غرام لحم
```

### groups

#### ورقيات

```text
اختر 2
خس
جرجير
ملفوف
```

#### خضراوات وبقوليات

```text
اختر حتى 19
طماطم
جزر
خيار
ذرة
حمص
هالبينو
فاصوليا حمراء
بنجر
فلفل حار
كزبرة
فطر
بروكلي
خضار مشكل مشوي
بصل احمر
بصل اخضر
زيتون اخضر
زيتون اسود
نعناع
بصل مخلل
```

#### فواكه

```text
اختر حتى 4
مانجا
تفاح اخضر
رمان
فراولة
توت ازرق
بطيخ
شمام
تمر
```

#### بروتينات

```text
اختر 1
بيض مسلوق
تونا
فاهيتا
دجاج سبايسي
دجاج توابل إيطالية
دجاج تكا
دجاج آسيوي
استربس
دجاج مشوي
دجاج مكسيكي
كرات لحم
لحم استرغانوف
ستيك لحم ★
جمبري ★
سمك فيليه
سالمون ★
```

#### جبن ومكسرات

```text
اختر حتى 2
كاجو
عين الجمل
سمسم
فيتا
بارميزان
```

#### صوصات

```text
اختر 1
رانش
سبايسي رانش
صوص بيستو
بالسميك
سيزر
هاني ماستر
زبادي بالنعناع
عسل بالثوم
```

---

## 12.2 وجبة بيسك

### السعر

```text
19 ريال / 100 غرام
+5 ريال كل 50 غرام دجاج
+6 ريال كل 50 غرام لحم
```

### groups

#### كارب

```text
اختر 3
رز ابيض
رز بالكركم
رز برياني
كينوا
باستا الفريدو
باستا بالصوص الأحمر
بطاطس مشوي
بطاطا حلوة
خضار مشكل مشوي
```

#### بروتينات

```text
اختر 1
بيض مسلوق
تونا
فاهيتا
دجاج زبدة
دجاج كريمة
دجاج كاري وجوز الهند
دجاج سبايسي
دجاج توابل إيطالية
دجاج تكا
دجاج آسيوي
استربس
دجاج مشوي
دجاج مكسيكي
كرات لحم
لحم استرغانوف
ستيك لحم ★
جمبري ★
سمك فيليه
سالمون ★
```

---

## 12.3 سلطة فواكه

### groups

#### فواكه

```text
اختر 9
مانجا
تفاح اخضر
رمان
فراولة
توت ازرق
بطيخ
شمام
تمر
عسل
```

ملاحظة: العسل قد يكون أفضل كـ topping/sauce بدل فاكهة، لكن يمكن تركه مؤقتًا ضمن نفس المجموعة إذا هذا هو المطلوب في الداتا.

---

## 12.4 زبادي يوناني

### groups

#### فواكه

```text
اختر 5
مانجا
تفاح اخضر
رمان
فراولة
توت ازرق
بطيخ
شمام
تمر
عسل
```

#### مكسرات

```text
اختياري
كاجو
عين الجمل
سمسم
```

ملاحظة: العسل هنا أيضًا قد يكون topping بدل فاكهة.

---

# 13. صورة JSON مقترحة للباك إند

## 13.1 Product

```json
{
  "id": "product_id",
  "key": "basic_salad",
  "name": "سلطة بيسك",
  "nameI18n": {
    "ar": "سلطة بيسك",
    "en": "Basic Salad"
  },
  "itemType": "basic_salad",
  "pricingModel": "per_100g",
  "priceHalala": 2900,
  "baseUnitGrams": 100,
  "defaultWeightGrams": 100,
  "minWeightGrams": 100,
  "maxWeightGrams": 0,
  "weightStepGrams": 50,
  "requiresBuilder": true,
  "canAddDirectly": false,
  "imageUrl": "https://..."
}
```

## 13.2 Option Group

```json
{
  "id": "group_id",
  "groupId": "group_id",
  "key": "proteins",
  "name": "بروتينات",
  "nameI18n": {
    "ar": "بروتينات",
    "en": "Proteins"
  },
  "minSelections": 1,
  "maxSelections": 1,
  "isRequired": true,
  "sortOrder": 1,
  "options": []
}
```

## 13.3 Option

```json
{
  "id": "option_id",
  "optionId": "option_id",
  "groupId": "group_id",
  "key": "grilled_chicken",
  "name": "دجاج مشوي",
  "nameI18n": {
    "ar": "دجاج مشوي",
    "en": "Grilled Chicken"
  },
  "extraPriceHalala": 0,
  "extraWeightUnitGrams": 50,
  "extraWeightPriceHalala": 500,
  "sortOrder": 1
}
```

---

# 14. قواعد UI حسب بيانات المنتج

## 14.1 تحديد إذا المنتج يفتح Builder

```text
if product.optionGroups.length > 0
or product.pricingModel === "per_100g"
or product.requiresBuilder === true
=> open Builder
```

## 14.2 تحديد إذا المنتج يضاف مباشرة

```text
if product.pricingModel === "fixed"
and product.optionGroups.length === 0
and product.canAddDirectly !== false
=> direct add to cart
```

---

# 15. Mapping مقترح للـ Home

الهوم يمكنه استخدام curated keys:

```json
{
  "quickOrderMain": {
    "target": "menu.html?section=custom-order"
  },
  "quickShortcuts": [
    { "key": "basic_salad" },
    { "key": "basic_meal" }
  ],
  "recommended": [
    { "type": "product", "key": "fruit_salad" },
    { "type": "product", "key": "greek_yogurt" },
    { "type": "category", "key": "sourdough" },
    { "type": "category", "key": "juices" }
  ]
}
```

يمكن أن يكون هذا hardcoded مؤقتًا في الواجهة، أو يأتي من endpoint لاحقًا مثل:

```http
GET /api/orders/home-catalog
```

---

# 16. الأخطاء التي يجب تجنبها

- لا تعتمد على أسماء عربية في الـ logic.
- لا تبعت `price` من الواجهة.
- لا تحسب VAT في الواجهة.
- لا تضيف VAT مرة أخرى.
- لا تبعت delivery.
- لا تبعت subscription fields.
- لا تضيف منتجات قابلة للتخصيص للسلة بدون Builder.
- لا تجعل كروت الهوم تضيف للسلة.
- لا تستخدم option name بدل optionId.
- لا تعتمد على ترتيب المصفوفات.
- لا تظهر خيارات inactive.
- لا تظهر courier tracking لأن الطلب pickup-only.

---

# 17. Checklist للربط النهائي

## Backend

- [ ] product keys ثابتة.
- [ ] category keys ثابتة.
- [ ] optionGroups مضبوطة لكل منتج مخصص.
- [ ] min/max selections صحيحة.
- [ ] pricingModel صحيح.
- [ ] priceHalala بالهلالة.
- [ ] imageUrl متاح إن وجد.
- [ ] sortOrder مضبوط.
- [ ] products active/published.
- [ ] quote endpoint ينجح مع cart من الواجهة.

## Frontend

- [ ] تحميل `GET /api/orders/menu`.
- [ ] Render categories ديناميكيًا.
- [ ] Render products ديناميكيًا.
- [ ] فتح Builder للمنتجات المخصصة.
- [ ] Add direct للمنتجات fixed فقط.
- [ ] selectedOptions ترسل IDs.
- [ ] quote قبل checkout.
- [ ] لا يتم حساب final total في الواجهة.
- [ ] payment verify بعد الرجوع من Moyasar.
- [ ] deep-link sections تعمل:
  - custom-order
  - sourdough
  - juices
- [ ] Home لا يضيف للسلة.
- [ ] bottom nav لا يغطي المحتوى.

---

# 18. الخلاصة النهائية

الباك إند الحالي مناسب جدًا لاتجاه الـ UI، لأنه يدعم:

- Dynamic catalog.
- Products.
- Categories.
- Option groups.
- Per-100g pricing.
- Fixed pricing.
- Backend quote.
- Moyasar payment.
- Pickup-only lifecycle.

لكن يجب أن يتم تعديل الربط بحيث يكون:

```text
Home = discovery/navigation
Menu = catalog browsing
Builder = configurable selections
Cart = productId + selectedOptions + weight
Quote = backend pricing source
Checkout = backend order + Moyasar
```

وأهم تعديل في الباك إند إن لم يكن موجودًا بالفعل:

- إضافة keys واضحة للمنتجات والتصنيفات.
- تمثيل Fruit Salad و Greek Yogurt بوضوح.
- توفير optionGroups لكل المنتجات القابلة للتخصيص.
- توفير imageUrl أو ترك الواجهة تستخدم fallback.
- عدم الاعتماد على أسماء العرض في أي logic.
