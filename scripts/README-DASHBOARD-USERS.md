# دليل إنشاء مستخدمي الداشبورد

هذا الدليل يشرح كيفية إنشاء أو تحديث إيميلات الداشبورد (Admin / Kitchen / Courier / Superadmin) حتى أي شخص جديد في الفريق يقدر ينفذ العملية بسهولة.

## المتطلبات

- وجود ملف `.env` صحيح وفيه اتصال قاعدة البيانات (`MONGO_URI` أو `MONGODB_URI`).
- تثبيت الحزم:

```bash
npm install
```

## إنشاء تلقائي عند تشغيل السيرفر (Default Users Bootstrap)

من الآن، السيرفر يقوم تلقائيًا عند كل تشغيل بـ:

1. قراءة حسابات الداشبورد الافتراضية من `.env`.
2. إنشاء أي حساب غير موجود.
3. تجاهل أي حساب موجود مسبقًا (بدون إنشاء مكرر).

يعني الحسابات المحددة في `.env` تكون دائمًا موجودة بعد تشغيل السيرفر، بدون تكرار.

## سكريبتات إنشاء المستخدمين

يوجد طريقتان:

1. إنشاء/تحديث مستخدم واحد يدويًا: `create-dashboard-user.js`
2. إنشاء/تحديث مجموعة مستخدمين افتراضيين من `.env`: `seed-dashboard-users.js`

---

## أنواع المستخدمين ومهامهم

النظام يحتوي على 4 أدوار:

1. `superadmin`
2. `admin`
3. `kitchen`
4. `courier`

### الفرق بينهم

- `superadmin`:
  - أعلى صلاحية.
  - يقدر يدخل على أي Endpoint محمي للداشبورد حتى لو endpoint مسموح لدور آخر فقط.
  - مناسب لمالك النظام أو مسؤول تقني رئيسي.

- `admin`:
  - إدارة إعدادات النظام من لوحة التحكم.
  - إنشاء/تعديل الخطط والإعدادات (مثل cutoff وdelivery windows وpremium price).
  - إدارة مستخدمي الداشبورد (إنشاء حسابات جديدة من API).
  - مراجعة Activity Logs وNotification Logs.

- `kitchen`:
  - تشغيل العمليات الخاصة بالمطبخ (تجهيز الوجبات، متابعة طلبات التحضير).
  - لا يُفترض استخدامه لإدارة إعدادات النظام أو إدارة مستخدمين.

- `courier`:
  - تشغيل العمليات الخاصة بالتوصيل (متابعة الطلبات الخارجة للتوصيل والتسليم).
  - لا يُفترض استخدامه لإدارة إعدادات النظام أو إدارة مستخدمين.

### ملاحظات صلاحيات مهمة

- Endpointات `/api/admin/*` و`/api/dashboard/*` مرتبطة بصلاحيات dashboard auth.
- بعض المسارات الإدارية حاليًا تتطلب `admin`، و`superadmin` يتجاوز هذا الشرط تلقائيًا.
- يفضل عدم مشاركة حساب `superadmin` في العمل اليومي، واستخدام حسابات مخصصة لكل فريق.

---

## 1) إنشاء أو تحديث إيميل واحد (يدوي)

الأمر:

```bash
npm run create:dashboard-user -- --email admin@example.com --password 'StrongPass123' --role admin --active true
```

### البراميترات

- `--email` (إجباري): الإيميل.
- `--password`:
  - إجباري عند إنشاء مستخدم جديد.
  - اختياري عند التعديل على مستخدم موجود.
- `--role`:
  - إجباري عند الإنشاء الجديد.
  - اختياري عند التعديل.
  - القيم المسموحة: `superadmin`, `admin`, `kitchen`, `courier`.
- `--active` (اختياري): `true` أو `false`.

### سلوك السكريبت

- لو الإيميل غير موجود: يعمل **Create**.
- لو الإيميل موجود: يعمل **Update** للحقول المرسلة فقط.
- عند تغيير الباسورد: يعيد تعيين `failedAttempts` و`lockUntil`.
- البحث عن الإيميل لا يفرق بين الحروف الكبيرة والصغيرة.

### أمثلة سريعة

```bash
# إنشاء superadmin
npm run create:dashboard-user -- --email superadmin@company.com --password 'StrongPass123' --role superadmin --active true

# إنشاء kitchen
npm run create:dashboard-user -- --email kitchen1@company.com --password 'StrongPass123' --role kitchen --active true

# تعطيل مستخدم موجود
npm run create:dashboard-user -- --email kitchen1@company.com --active false

# تغيير باسورد مستخدم موجود
npm run create:dashboard-user -- --email admin@company.com --password 'NewStrongPass456'
```

---

## 2) إنشاء مجموعة إيميلات محددة من `.env`

أضف القيم التالية في `.env` (ضع فقط الحسابات التي تحتاجها):

```env
DASHBOARD_DEFAULT_SUPERADMIN_EMAIL=superadmin@company.com
DASHBOARD_DEFAULT_SUPERADMIN_PASSWORD=StrongPass123
DASHBOARD_DEFAULT_SUPERADMIN_ACTIVE=true

DASHBOARD_DEFAULT_ADMIN_EMAIL=admin@company.com
DASHBOARD_DEFAULT_ADMIN_PASSWORD=StrongPass123
DASHBOARD_DEFAULT_ADMIN_ACTIVE=true

DASHBOARD_DEFAULT_KITCHEN_EMAIL=kitchen@company.com
DASHBOARD_DEFAULT_KITCHEN_PASSWORD=StrongPass123
DASHBOARD_DEFAULT_KITCHEN_ACTIVE=true

DASHBOARD_DEFAULT_COURIER_EMAIL=courier@company.com
DASHBOARD_DEFAULT_COURIER_PASSWORD=StrongPass123
DASHBOARD_DEFAULT_COURIER_ACTIVE=true
```

ثم شغّل:

```bash
npm run seed:dashboard-users
```

### سلوك السكريبت

- ينشئ أو يحدث كل مستخدم له `EMAIL + PASSWORD` موجودين في `.env`.
- أي role لا يحتوي بيانات كافية يتم تجاهله.
- مفيد للتجهيز السريع على بيئة جديدة.

> ملاحظة: هذا السكريبت يقوم بالتحديث أيضًا، لكن الإقلاع التلقائي للسيرفر يقوم بإنشاء الناقص فقط.

---

## تسجيل الدخول للداشبورد

بعد إنشاء المستخدم:

- Endpoint اللوجين: `POST /api/dashboard/auth/login`
- Body:

```json
{
  "email": "admin@company.com",
  "password": "StrongPass123"
}
```

لو البيانات صحيحة سيرجع `token` يستخدم في `Authorization: Bearer <token>`.

---

## مشاكل شائعة

1. `--role is required when creating a new dashboard user`
- مررت إيميل جديد بدون `--role`.

2. `--password is required when creating a new dashboard user`
- مررت إيميل جديد بدون `--password`.

3. `invalid email format`
- صيغة الإيميل غير صحيحة.

4. فشل اتصال قاعدة البيانات
- تأكد من `MONGO_URI` أو `MONGODB_URI` في `.env`.

5. `password must be at least 8 characters`
- استخدم كلمة مرور 8 أحرف أو أكثر.

---

## ملاحظة أمان

- لا تستخدم كلمات مرور افتراضية في الإنتاج.
- يفضّل تغيير كل كلمات المرور الافتراضية مباشرة بعد أول تشغيل.
