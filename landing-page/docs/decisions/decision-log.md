# Decision Log

كل قرار هنا يجب أن يكون له تاريخ وسبب. إذا تم تغييره لاحقًا لا نحذفه؛ نسجل القرار الجديد ونوضح أنه supersedes القرار السابق.

---

## 2026-10-07 — Research before implementation

**Status:** DECISION

لن نبدأ بالكود النهائي الآن. المرحلة الحالية هي جمع البيانات وبناء تصور تدريجي وتوثيقه.

**Reason:** تقليل إعادة العمل وبناء Landing Page تخدم التحويل فعلًا بدل البدء من Template جاهز.

---

## 2026-10-07 — GitHub workspace as Single Source of Truth

**Status:** DECISION

كل findings والقرارات والـblueprint يتم حفظها في GitHub حتى يمكن متابعة العمل من أي Chat جديد بدون فقد السياق.

---

## 2026-10-07 — Skilline is reference only

**Status:** DECISION

`mhaecal/skilline-landing-page` لن يكون أساس التنفيذ.

**Reason:**
- قديم تقنيًا.
- ليس مخصصًا لقطاع Food Subscription.
- ترخيص/تعليمات الاستخدام التجاري ليست مناسبة للاعتماد المباشر.

يمكن فقط الاستفادة من visual patterns العامة.

---

## 2026-10-07 — Primary conversion focus

**Status:** HYPOTHESIS TO VALIDATE

الهدف الأساسي للـLanding Page سيكون دفع الزائر نحو **تحميل التطبيق / بدء الاشتراك**، وليس تصفح Catalog ضخم داخل الموقع.

---

## 2026-10-07 — Competitor synthesis

**Status:** DIRECTION

- Origin Meals → visual cleanliness / food presentation.
- Diet Plus → conversion-oriented structure.
- Healthy Corner → future recommendation/calculator concept.
- Fit Home → inspiration for variety, مع تجنب الزحام.


---

## 2026-10-07 — Adopt ai-design-skills landing-page-design methodology

**Status:** DECISION

تم اعتماد `elayadesign/ai-design-skills/skills/landing-page-design/SKILL.md` كمنهج رئيسي لبناء Landing Page.

**Adopted principle:**

`Part A Strategy & Structure → Part B Visual System → Section-by-section implementation`

**Reason:**
يتوافق مع بروتوكول المشروع الحالي ويمنع القفز إلى تصميم أو كود قبل تثبيت العرض والجمهور والاعتراضات والـproof.

**Project override:**
قواعد الخطوط اللاتينية في Part B لن تطبق حرفيًا لأن الصفحة Arabic-first. سيتم اختيار نظام Typography عربي مناسب لاحقًا.
