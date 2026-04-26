# دليل نظام البيانات التجريبية
# Demo Data Seeding Guide

> [!IMPORTANT]
> هذا السكريبت **للتطوير والاختبار فقط**. لا تستخدمه على قاعدة بيانات الإنتاج!

---

## نظرة عامة

سكريبت شامل لتوليد بيانات تجريبية واقعية لمشروع BasicDiet145. يشمل جميع الـ Models مع علاقات صحيحة ومنطقية.

### البيانات المُنشأة

| النوع | العدد الافتراضي | الوصف |
|-------|-----------------|-------|
| 🥗 مكونات السلطة | 20 | مكونات متنوعة بأسعار وسعرات حرارية |
| 🍽️ الوجبات العادية | 24 | دجاج، لحم، مكرونة، إلخ |
| ⭐ الوجبات المميزة | 15 | **سلمون، ستيك، جمبري** |
| ➕ الإضافات | 10 | للاشتراك ولمرة واحدة |
| 📋 الخطط | 7 | خطط متنوعة (5-30 يوم) |
| 👥 المستخدمين | 50 | عملاء بأسماء عربية وأرقام سعودية |
| 👨‍💼 مستخدمي الداشبورد | 5 | Admin, Kitchen, Courier |
| 📝 الاشتراكات | 80 | بحالات مختلفة |
| 📅 أيام الاشتراك | 500+ | موزعة على الاشتراكات النشطة |
| 🛒 الطلبات | 50 | طلبات لمرة واحدة |
| 💳 المدفوعات | 150+ | سجلات دفع للاشتراكات والطلبات |
| 📝 سجلات النشاط | 150 | Activity Logs |

---

## التثبيت والتشغيل

### المتطلبات
- Node.js 20+
- MongoDB Atlas access

### الأوامر السريعة

```bash
# تشغيل السكريبت بدون مسح البيانات القديمة
npm run seed

# مسح البيانات القديمة ثم التوليد
npm run seed:full

# مسح البيانات فقط
npm run seed:clear
```

### خيارات متقدمة

```bash
# تخصيص عدد المستخدمين
node scripts/seed-demo-data.js --clear --users=100

# تخصيص عدد الاشتراكات
node scripts/seed-demo-data.js --subscriptions=150

# تخصيص عدد الطلبات
node scripts/seed-demo-data.js --orders=80

# تخصيص شامل
node scripts/seed-demo-data.js --clear --users=100 --subscriptions=150 --orders=80
```

---

## الوجبات المميزة ⭐

السكريبت يُنشئ 15 وجبة مميزة من ثلاثة أنواع:

### 🐟 السلمون (Salmon)
- سلمون مشوي مع الليمون
- سلمون بالفرن مع الخضار
- سلمون ترياكي
- سلمون بالزبدة والثوم
- فيليه سلمون مع الأرز

### 🥩 الستيك (Steak)
- ستيك لحم مشوي
- ستيك بالفلفل
- ستيك مع البطاطس
- ستيك بالصوص
- تندرلوين ستيك

### 🦐 الجمبري (Shrimp)
- جمبري مشوي
- جمبري بالثوم والزبدة
- جمبري مقلي
- جمبري بالكاري
- جمبري سكامبي

---

## خصائص البيانات

### 1. واقعية البيانات
- ✅ أسماء عربية حقيقية من المملكة
- ✅ أرقام هواتف سعودية (+966)
- ✅ عناوين في مدن سعودية (الرياض، جدة، الدمام، مكة، المدينة)
- ✅ تواريخ منطقية (ماضي، حاضر، مستقبل)

### 2. تنوع الحالات
- اشتراكات: `pending_payment`, `active`, `expired`
- أيام اشتراك: `open`, `locked`, `in_preparation`, `out_for_delivery`, `fulfilled`, `skipped`
- طلبات: `created`, `confirmed`, `preparing`, `fulfilled`, `canceled`
- مدفوعات: `initiated`, `paid`, `failed`, `refunded`

### 3. العلاقات الصحيحة
- Foreign Keys صحيحة بين جميع الـ Collections
- احترام Business Rules (totalMeals, remainingMeals, etc.)
- Snapshots صحيحة للأيام المقفلة

---

## التحقق من البيانات

### 1. عبر MongoDB Shell

```bash
# Connect to MongoDB Atlas (use the same URI from .env)
mongosh "mongodb+srv://<user>:<password>@<cluster>.mongodb.net/basicdiet145?retryWrites=true&w=majority&appName=basicdiet145"
```

ثم:

```javascript
// عد السجلات
db.users.countDocuments()
db.subscriptions.countDocuments()
db.meals.countDocuments({ type: 'premium' })

// فحص البيانات
db.meals.find({ type: 'premium' }).pretty()
db.subscriptions.findOne({ status: 'active' })
db.subscriptiondays.findOne()

// فحص العلاقات
db.subscriptions.aggregate([
  { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
  { $limit: 1 }
])
```

### 2. عبر الـ APIs

```bash
# جلب الاشتراكات (Client Token)
curl -H "Authorization: Bearer dev-client-token" \
     http://localhost:3000/api/subscriptions

# جلب الخطط (Public)
curl http://localhost:3000/api/plans

# جلب الوجبات (Dashboard Token)
curl -H "Authorization: Bearer dev-dashboard-token" \
     http://localhost:3000/api/admin/meals

# فحص الوجبات المميزة
curl http://localhost:3000/api/meals?type=premium
```

### 3. عبر Postman

استخدم التوكنات التالية:
- **Client APIs**: `dev-client-token`
- **Dashboard APIs**: `dev-dashboard-token`

---

## أمثلة على الاستخدام

### سيناريو 1: بداية جديدة

```bash
# مسح كل شيء وإنشاء بيانات جديدة
npm run seed:full
```

### سيناريو 2: إضافة المزيد من المستخدمين

```bash
# إضافة 100 مستخدم إضافي بدون مسح البيانات الموجودة
node scripts/seed-demo-data.js --users=100
```

### سيناريو 3: اختبار حمل عالي

```bash
# إنشاء بيانات كبيرة للاختبار
node scripts/seed-demo-data.js --clear \
  --users=200 \
  --subscriptions=300 \
  --orders=150
```

---

## البنية التفصيلية

### الخطط (Plans)

7 خطط متنوعة:
- خطة 5 أيام - وجبتين (250 ر.س)
- خطة 5 أيام - 3 وجبات (350 ر.س)
- خطة 10 أيام - وجبتين (450 ر.س)
- خطة 10 أيام - 3 وجبات (650 ر.س)
- خطة 20 يوم - وجبتين (850 ر.س)
- خطة 20 يوم - 3 وجبات (1,200 ر.س)
- خطة شهرية - وجبتين (1,200 ر.س)

### الإضافات (Addons)

نوعان:
- **للاشتراك** (subscription): عصير، قهوة، شوربة، ماء ديتوكس
- **لمرة واحدة** (one_time): سلطة، مكسرات، بروتين بار، فواكه، زبادي، خبز

### مستخدمي الداشبورد

| البريد الإلكتروني | الدور |
|-------------------|-------|
| superadmin@basicdiet.sa | superadmin |
| admin@basicdiet.sa | admin |
| kitchen@basicdiet.sa | kitchen |
| kitchen2@basicdiet.sa | kitchen |
| courier@basicdiet.sa | courier |
| courier2@basicdiet.sa | courier |

> [!TIP]
> استخدم هذه الحسابات مع نظام Dashboard JWT Auth للدخول إلى الداشبورد (email + password)
> كلمة المرور الافتراضية في الـseed: `StrongPass123`

---

## استكشاف الأخطاء

### خطأ: Connection refused

```bash
# Verify MONGO_URI in .env points to MongoDB Atlas
```

### خطأ: Duplicate key error

```bash
# امسح البيانات القديمة أولاً
npm run seed:clear
```

### خطأ: Module not found

```bash
# تأكد من تثبيت جميع Dependencies
npm install
```

---

## ⚠️ تحذيرات هامة

> [!CAUTION]
> السكريبت يحذف جميع البيانات عند استخدام `--clear`!

> [!WARNING]
> **لا تستخدم هذا السكريبت على قاعدة بيانات الإنتاج!**

> [!NOTE]
> البيانات المُنشأة هي demo فقط ولا تمثل بيانات حقيقية

---

## الملفات ذات الصلة

- [seed-demo-data.js](file:///d:/basicdiet145/basicdiet145/scripts/seed-demo-data.js) - السكريبت الرئيسي
- [package.json](file:///d:/basicdiet145/basicdiet145/package.json) - npm scripts
- [.env](file:///d:/basicdiet145/basicdiet145/.env) - إعدادات قاعدة البيانات

---

## الخطوات التالية

بعد تشغيل السكريبت:

1. ✅ اختبر الـ APIs باستخدام Postman أو curl
2. ✅ ابدأ تطوير Frontend مع بيانات واقعية
3. ✅ اختبر سيناريوهات مختلفة (اشتراك، طلب، دفع)
4. ✅ طوّر الداشبورد مع بيانات المطبخ والتوصيل

---

**مُنشأ بواسطة**: BasicDiet145 Team  
**النسخة**: 1.0.0  
**التاريخ**: 2026-02-07
