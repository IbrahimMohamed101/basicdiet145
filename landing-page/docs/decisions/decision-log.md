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


---

## 2026-10-07 — Hero video becomes primary visual

**Status:** DECISION

الـHero سيعتمد على **فيديو قصير قوي ومميز للطعام** كعنصر بصري رئيسي بدل الاعتماد على صورة ثابتة فقط.

**Production direction:**
يمكن استخدام Google Flow أو أداة توليد فيديو مشابهة لصناعة النسخة التجريبية، مع مراجعة صارمة لواقعية الطعام واتساقه مع Basic Diet.

**Requirement:**
يجب توفير Poster/fallback image ونسخة محسنة للموبايل والأداء.

---

## 2026-10-07 — Cancellation policy excluded from landing page

**Status:** DECISION

سياسة الإلغاء موجودة في النظام، لكن لن يتم استخدامها كقسم أو رسالة أساسية في الـLanding Page.

**Reason:**
ليست ضرورية لإقناع الزائر في الصفحة الحالية، ونريد الحفاظ على تركيز الصفحة على المنتج، القيمة، الثقة، والتطبيق.


---

## 2026-10-07 — A1 core audience locked

**Status:** DECISION

Core evergreen landing-page audience:

**Jeddah customer who wants enjoyable, measured meals with less daily food planning and more control over portions and routine.**

Campaign variants can narrow to gym, weight management, busy professionals, or returning customers without fragmenting the main page.

---

## 2026-10-07 — A1 objection ranking

**Status:** DECISION FOR V1

Ranked objections:
1. Taste / boredom
2. Control / flexibility
3. Quality / trust

Price/value remains important but is not the lead emotional argument based on current evidence.

---

## 2026-10-07 — Social-first traffic assumption

**Status:** DECISION FOR V1

Design the evergreen page primarily for mobile social traffic, then direct/WhatsApp and branded search.

This assumption can be changed later from measured channel data without reopening the full intake.

---

## 2026-10-07 — Official iOS listing verified

**Status:** FACT

Basic Diet is publicly listed on Apple App Store:
https://apps.apple.com/ar/app/basic-diet/id6775085745

Public listing describes plan browsing, subscriptions, delivery management, freezing, skipping days, and pickup.

No public Google Play listing was verified during A1.

---

## 2026-10-07 — Close A1

**Status:** DECISION

A1 Intake is complete.

Remaining screenshots, hero production, image selection, Android link, exact review count, and exact delivery coverage are treated as later creative/implementation dependencies rather than strategy blockers.

Next phase:
**A2 — Page Structure**


---

## 2026-10-07 — A2 layout type selected

**Status:** DECISION

Selected layout:

**A — Classic hero + sections**

**Reason:**
Basic Diet can be understood quickly through food video + concise offer explanation. The page still needs structured proof for taste, flexibility, and trust, so a minimal page is insufficient and long-form storytelling is unnecessary for social-first mobile traffic.

---

## 2026-10-07 — A2 page argument locked

**Status:** DECISION

`Desire → Relevance → Proof → Control → Simplicity → Value → Trust → Action`

Food desire comes before pricing.

---

## 2026-10-07 — A2 section order locked

**Status:** DECISION

Header → Hero → Value strip → Food experience → Tagline reveal → Why Basic Diet → How it works → App control → Plans → Quality/customer proof → FAQ → Final CTA → Footer.

Proof is distributed beside the claims it supports.


---

## 2026-10-07 — A3 layout confirmed

**Status:** DECISION

Layout A — Classic hero + sections remains the selected structure.

---

## 2026-10-07 — Primary CTA locked

**Status:** DECISION

Primary CTA for V1:

**ابدأ اشتراكك**

Use consistently across header, hero, app, plans and final CTA.

---

## 2026-10-07 — Hero copy direction v0.1

**Status:** COPY DIRECTION

Recommended hero headline:

**وجبات تحبها، بكميات محسوبة تناسب روتينك.**

Supporting line:

اختر مدة اشتراكك، كمية الوجبة وعدد وجباتك يوميًا، وتحكم في اشتراكك من تطبيق Basic Diet.

This can be refined after visual composition testing without reopening A1–A4.

---

## 2026-10-07 — Part A closed

**Status:** DECISION

A1 through A5 are complete enough to move into Part B visual-system work.

Implementation remains gated until Part B is defined.


---

## 2026-10-07 — Part B visual system locked

**Status:** DECISION

V1 identity:
- Tajawal
- #108055 primary green
- #E95E2C accent orange
- #FFFAE8 main cream
- #F6F4E2 alternate cream
- #161A16 primary ink

Orange is accent, not the primary CTA color.

---

## 2026-10-07 — Hero composition locked

**Status:** DECISION

Hero video is a separate media panel.

Desktop:
video left / Arabic copy right.

Mobile:
video first / copy below.

This supersedes the earlier idea that the generated video needs negative space for overlaid copy.

---

## 2026-10-07 — Canonical logo selection

**Status:** DECISION

Light/cream background:
`Logo-High-Qualty.png`

Dark/green background:
`Logo-white.png`

---

## 2026-10-07 — Implementation stack locked

**Status:** DECISION

V1:
- Next.js App Router
- TypeScript
- Tailwind CSS
- Arabic/RTL-first

Use latest stable versions when implementation begins.

---

## 2026-10-07 — Pre-code design/specification complete

**Status:** DECISION

Strategy, copy direction, visual system, components, responsive rules, analytics, SEO and QA are complete.

Remaining tasks are asset production/verification:
- hero media
- app screenshots
- destination verification
- launch-time proof refresh.
