# 📱 التقرير الفني الشامل لفريق Flutter: تحديات الواجهة والتكامل مع الباك إند

**التاريخ:** 8 يوليو 2026  
**الهدف:** معالجة المشاكل المكتشفة في تطبيق الموبايل (Flutter) الخاصة بحساب الفواتير والأرصدة (Meal Calculations) بالإضافة إلى مشكلة اختفاء الإضافات من شاشة الاستلام (`PickupAvailabilitySheet`) لضمان التوافق التام مع الباك إند.

---

## الجزء الأول: مشاكل حساب الوجبات والفواتير (Meal Calculation Issues)

بعد المراجعة الدقيقة لكود الـ Flutter (`meal_planner_bloc.dart` و `meal_planner_state.dart`) ومطابقته مع الباك إند، تم تحديد **3 مشاكل رئيسية** تتسبب في خلل حساب الوجبات وتتطلب تعديلاً:

### 🔴 المشكلة 1: الخصم المزدوج للوجبات المحفوظة مسبقاً (Double Deduction)
**وصف المشكلة**:
عندما يقوم الـ Frontend بحساب الرصيد المتبقي (Premium Usage)، فإنه يقوم بإنشاء قائمة `billableSlots` والتي تشمل **جميع** الوجبات في اليوم (بما فيها الوجبات التي سبق حفظها) طالما أن اليوم ليس في وضع الـ `AppendMode`.
ثم يقوم السكربت بخصم هذه الوجبات من الرصيد الكلي `premiumSummaries.remainingQtyTotal` أو `premiumMealsRemaining`.

**التضارب مع الباك إند**:
الباك إند يُرسل قيمة الـ `remainingQtyTotal` **بعد** أن يكون قد خصم منها الوجبات المحفوظة! 
**مثال**: إذا كان لديك 10 وجبات، وحفظت 2 في هذا اليوم. الباك إند سيخبرك أن المتبقي = 8.
عندما تفتح التطبيق في هذا اليوم لتعديله، سيرى التطبيق الوجبتين المحفوظتين في الـ `billableSlots`، وسيقوم بخصمهما من الـ 8 مرة أخرى (8 - 2 = 6). هذا يجعل التطبيق يظن أن الرصيد المتبقي أقل من الحقيقي، وسيطلب من العميل الدفع بشكل خاطئ (Phantom Invoices).

**الحل المطلوب في فلاتر**:
يجب أن تقوم دالة `evaluatePremiumUsage` بتجاهل الـ `savedSlots` عند حساب الاستهلاك المحلي، أو أن يعتمد التطبيق بالكامل على حالة الرصيد المرجعة من الباك إند دون إعادة الحساب محلياً لتجنب التضارب.

---

### 🔴 المشكلة 2: إعادة ترقيم الفتحات بشكل مدمر (Destructive Re-indexing)
**وصف المشكلة**:
في دالة `_onRemoveMealSlot` داخل `meal_planner_bloc.dart`، عند قيام المستخدم بحذف وجبة، يقوم الكود بعمل Re-index لجميع الوجبات:
```dart
final indexedSlots = List<MealPlannerSlotSelection>.generate(
  currentDaySlots.length,
  (i) => currentDaySlots[i].copyWith(slotIndex: i + 1, slotKey: 'slot_${i + 1}'),
);
```

**التضارب مع الباك إند**:
في الباك إند، يُعتبر `slotIndex` هو **المعرف الفريد (Primary Key)** للوجبة داخل اليوم. 
إذا كان لدى العميل 3 وجبات: (1: عادية، 2: مميزة، 3: عادية). وقام بحذف الوجبة رقم 1. سيقوم فلاتر بإرسال:
- الوجبة المميزة برقم `slotIndex: 1`
- الوجبة العادية برقم `slotIndex: 2`
الباك إند سيقوم **باستبدال** الوجبة الأولى، وسيعتبر أن الوجبة الثالثة تم حذفها! هذا يؤدي إلى دمار الترتيب بالكامل وحسابات خاطئة جداً في الفواتير.

**الحل المطلوب في فلاتر**:
عند الحذف، يجب الاحتفاظ بـ `slotIndex` الخاص بالوجبات المتبقية كما هو وعدم تغييره إطلاقاً. `slotIndex` يجب أن يكون ثابتاً ولا يعتمد على ترتيب المصفوفة (Array index).

---

### 🟠 المشكلة 3: الاعتماد على الحساب المحلي للفواتير (Local Pending Amount Calculation)
**وصف المشكلة**:
يعتمد كود فلاتر على حساب تكلفة الوجبات المميزة أو السلطات محلياً عبر قراءة `extraFeeHalala` وضربها وجمعها، ثم مقارنتها لاستدعاء الفاتورة الموحدة `VerifyUnifiedDayPaymentEvent`.

**التضارب مع الباك إند**:
تم تعديل الباك إند ليقوم هو بكل هذه الحسابات عن طريق `paymentRequirement` داخل الـ `SubscriptionDay`. الحسابات المحلية في فلاتر معقدة جداً وتفشل في احتساب بعض الحالات (مثل الأيام المكتملة والأرصدة المسترجعة). 

**الحل المطلوب في فلاتر**:
يفضل أن يكون الحساب المحلي مجرد واجهة مبدئية، وأن يعتمد التطبيق دائماً على ما يرجع من الـ API في `paymentRequirement.pendingAmountHalala` و `requiresPayment: true` لإظهار زر الدفع وتجنب أخطاء التسعير.

---

## الجزء الثاني: مشكلة اختفاء الإضافات من شاشة الاستلام (Pickup Addons)

### 🛑 المشكلة الحالية
عندما يقوم المستخدم بإضافة وجبات وإضافات (مثل السلطات، الحلويات، وغيرها) من خلال شاشة تخطيط الوجبات وحفظها بنجاح، تظهر الوجبات فقط عند فتح شاشة "طلب استلام" (`PickupAvailabilitySheet`)، بينما تختفي جميع الإضافات التي تمت إضافتها لنفس اليوم.

### 🔍 التحليل الفني للمشكلة

#### 1. تجاهل مصفوفة الإضافات (`dayAddons`) في الواجهة
*   الباك إند يقوم بإرجاع بيانات الإضافات المستقلة داخل مصفوفة `dayAddons` ضمن استجابة `PickupAvailabilityResponse`.
*   شاشة `PickupAvailabilitySheet` في فلاتر تعتمد **حصرياً** على المرور (Iterating) عبر مصفوفة `availability.pickupItems` لعرض العناصر.
*   **المشكلة**: في ملف `pickup_request_mapper.dart`، يتم تعيين `pickupItems` مباشرة من `data?.pickupItems`، ولكن يتم ترك `data?.dayAddons` لتعيينها في متغير منفصل `dayAddons` لا يتم استخدامه في بناء قائمة العرض. لضمان ظهور الإضافات كعناصر قابلة للاستلام، يجب دمج `dayAddons` (بعد تحويلها إلى `PickupAvailabilityItemModel`) داخل مصفوفة `pickupItems`.

#### 2. اختلاف منطق قابلية الاختيار (`isSelectable`)
*   يعتمد الباك إند على الحقل `selectionMode: "independent"` كشرط أساسي لاعتبار العنصر مستقلاً وقابلاً للاختيار في ملخص طلبات الاستلام.
*   **المشكلة**: في نموذج `PickupAvailabilityItemModel` في فلاتر، دالة `isSelectable` الحالية تتجاهل التحقق من `selectionMode` وتكتفي بـ `itemId.isNotEmpty && available && canSelect && !paymentRequired`. هذا يؤدي إلى عدم تطابق حالة العناصر القابلة للتحديد بين الباك إند وتطبيق الموبايل.

### 🛠️ التعديلات المطلوبة (Action Items)

#### التعديل الأول: تحديث Mapper لدمج الإضافات في قائمة الاستلام
في ملف `lib/data/mappers/pickup_request_mapper.dart`:
يجب إضافة وظيفة مساعدة لتحويل `PickupAvailabilityAddonResponse` إلى `PickupAvailabilityItemModel`، ثم دمج مصفوفة الإضافات مع مصفوفة الوجبات في دالة `toDomain()` الخاصة بـ `PickupAvailabilityResponseMapper`.

```dart
// 1. أضف دالة مساعدة (أو قم بتوسيع المابر الحالي) لتحويل الإضافة إلى عنصر استلام:
PickupAvailabilityItemModel _mapAddonToPickupItem(PickupAvailabilityAddonModel addon) {
  return PickupAvailabilityItemModel(
    itemId: addon.id,
    itemType: 'addon',
    label: addon.nameAr, // Fallback label
    selectionMode: 'independent', // Explicitly independent
    categoryKey: 'addons',
    titleAr: addon.nameAr,
    titleEn: addon.nameEn,
    subtitleAr: '',
    subtitleEn: '',
    statusTextAr: addon.paymentRequired ? 'يجب الدفع قبل الاستلام' : '',
    statusTextEn: addon.paymentRequired ? 'Payment Required' : '',
    selectionTextAr: '',
    selectionTextEn: '',
    availabilityState: addon.paymentRequired ? 'payment_required' : 'available',
    available: !addon.paymentRequired,
    canSelect: !addon.paymentRequired,
    paymentRequired: addon.paymentRequired,
  );
}

// 2. داخل PickupAvailabilityResponseMapper، قم بدمج الإضافات في pickupItems:
extension PickupAvailabilityResponseMapper on PickupAvailabilityResponse? {
  PickupAvailabilityModel toDomain() {
    final data = this?.data;
    // ... logic ...
    
    // تحويل الإضافات الأساسية
    final parsedDayAddons = data?.dayAddons?.map((addon) => addon.toDomain()).toList() ?? const [];
    
    // دمج الإضافات داخل عناصر الاستلام لضمان ظهورها في الشاشة
    final parsedPickupItems = data?.pickupItems?.map((item) => item.toDomain()).toList() ?? [];
    final addonPickupItems = parsedDayAddons.map((addon) => _mapAddonToPickupItem(addon)).toList();
    
    // إزالة التكرارات بناءً على itemId في حال كان الباك إند يرسلها في المصفوفتين
    final allItems = [...parsedPickupItems, ...addonPickupItems];
    final uniqueItems = { for (var item in allItems) item.itemId : item }.values.toList();

    return PickupAvailabilityModel(
      // ...
      pickupItems: uniqueItems,
      dayAddons: parsedDayAddons,
      // ...
    );
  }
}
```

#### التعديل الثاني: مواءمة منطق التحديد `isSelectable`
في ملف `lib/domain/model/pickup_request_model.dart`:
قم بتحديث الجيتر `isSelectable` داخل الكلاس `PickupAvailabilityItemModel` ليتضمن التحقق من الـ `selectionMode`.

```dart
// التعديل المطلوب:
class PickupAvailabilityItemModel extends Equatable {
  // ...
  
  bool get isSelectable =>
      itemId.isNotEmpty && 
      available && 
      canSelect && 
      !paymentRequired && 
      selectionMode == 'independent'; // إضافة هذا الشرط

  // ...
}
```

---

> [!IMPORTANT]
> **ملاحظة بخصوص الباك إند**: الباك إند حالياً سليم ومُجهز لحماية هذه الأخطاء (مثل رمي `402` لو كان هناك تلاعب بالرصيد)، لذلك لا يتطلب الأمر أي تعديل في كود الباك إند. المشكلة محصورة في هيكلة الداتا المرسلة وتحديث الـ State داخل فلاتر فقط.


---

## الجزء الثالث: مشكلة ظهور الأسماء الافتراضية (وجبة عادية/ساندويتش) بدلاً من اسم المنتج

### 🛑 المشكلة الحالية
عند فتح شاشة الاستلام (`PickupAvailabilitySheet`)، تظهر الوجبات والساندويتشات بأسماء عامة مثل "وجبة عادية" أو "ساندويتش" بدلاً من ظهور الاسم الفعلي للمنتج (مثل "دجاج مشوي مع أرز" أو "ساندويتش تونة").

### 🔍 التحليل الفني للمشكلة
*   **السبب من الباك إند**: كان الباك إند يقوم بقراءة الأسماء المحفوظة سابقاً (Snapshots) كأولوية قصوى قبل البحث في قاعدة بيانات المنتجات (`Catalog`). ونظراً لأن بعض الوجبات قد تم حفظها مسبقاً بأسماء افتراضية (Fallback Labels)، كان الباك إند يرسل هذا الاسم الافتراضي للتطبيق، مما يحجب الاسم الحقيقي للوجبة.
*   **حالة الباك إند الحالية**: **تم حل المشكلة بالكامل في الباك إند**. تم تعديل خدمة `subscriptionPickupSlotService.js` لتُعطي الأولوية لاسم المنتج من الكتالوج (`productDoc.name`) ولبيانات المطبخ المُحدثة (`kitchenSlot.productName`) بدلاً من الأسماء القديمة المحفوظة في الـ Snapshots.

### 🛠️ التعديلات المطلوبة (Action Items)
*   **لا يوجد أي تعديل مطلوب من فريق فلاتر لحل هذه المشكلة.** 
*   بمجرد أن تقوموا بإجراء التعديلات المذكورة في الجزء الثاني لدمج `dayAddons` في الـ `pickupItems`، ستلاحظون أن الأسماء الحقيقية للوجبات والساندويتشات ستظهر تلقائياً بفضل التحديث الذي تم إجراؤه للتو على الباك إند.
