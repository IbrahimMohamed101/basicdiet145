# D-098 — إدارة منيو الكاشير على Production (2026-11-08)

**قرار المالك:** عند تفعيل POS على Production بالسياج القائم `POS_PRODUCTION_ENABLED=true` وبشرط Mongo `rs0` PRIMARY والهوية الصحيحة، صلاحيات **عرض إدارة كتالوج الكاشير، حفظ المسودة، النشر، وقراءة النسخ السابقة** متطابقة مع Staging للأدوار:
- `admin`, `superadmin`, `restaurant`, `cashier`: مسموح.
- `kitchen`, `courier`: رفض `403 FORBIDDEN`.

هذه الصلاحيات للكتالوج المستقل الخاص بالكاشير فقط، ولا تُغيّر صلاحيات منيو تطبيق العملاء أو المعاملات المالية أو أي صلاحية أخرى. يتسق ذلك مع **D-091** و**D-092** (تكافؤ `restaurant` و`cashier`).

**حاجز التشغيل لم يتغير:** إن لم يكن POS مفعلًا ويجتز `getPosRuntimeStatus()`، تظل الإدارة والقراءة والنشر جميعها محجوبة بـ `403 POS_DISABLED`، حتى عن الإدارة. لا يوجد seed تلقائي على Production؛ أول مسودة لا تنشر شيئًا تلقائيًا.

**اختبار CI:** في بيئة `NODE_ENV=production` مع `POS_PRODUCTION_ENABLED=true`، تُختبر كل مسارات `/catalog/manage`، `/catalog/revisions`، `/catalog/revisions/:revision`، `PUT /catalog/draft`، `POST /catalog/publish` لكل الأدوار الستة، بجانب اختبارات سياج التفعيل القائم. التغيير كود/اختبارات فقط على PR #212؛ **لا دمج، لا نشر، لا Railway/Production/main**.
