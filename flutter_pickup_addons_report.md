# 📱 تقرير فني لفريق Flutter: حل مشكلة اختفاء الإضافات من شاشة الاستلام

**التاريخ:** 8 يوليو 2026  
**الهدف:** معالجة مشكلة عدم ظهور الإضافات (Add-ons) المحددة في شاشة `PickupAvailabilitySheet`، ومواءمة منطق اختيار العناصر مع استجابة الباك إند.

---

## 🛑 المشكلة الحالية
عندما يقوم المستخدم بإضافة وجبات وإضافات (مثل السلطات، الحلويات، وغيرها) من خلال شاشة تخطيط الوجبات وحفظها بنجاح، تظهر الوجبات فقط عند فتح شاشة "طلب استلام" (`PickupAvailabilitySheet`)، بينما تختفي جميع الإضافات التي تمت إضافتها لنفس اليوم.

## 🔍 التحليل الفني للمشكلة

### 1. تجاهل مصفوفة الإضافات (`dayAddons`) في الواجهة
*   الباك إند يقوم بإرجاع بيانات الإضافات المستقلة داخل مصفوفة `dayAddons` ضمن استجابة `PickupAvailabilityResponse`.
*   شاشة `PickupAvailabilitySheet` في فلاتر تعتمد **حصرياً** على المرور (Iterating) عبر مصفوفة `availability.pickupItems` لعرض العناصر:
    ```dart
    if (hasPickupItems)
      ...availability.pickupItems.map((item) => _PickupItemTile(...))
    ```
*   **المشكلة**: في ملف `pickup_request_mapper.dart`، يتم تعيين `pickupItems` مباشرة من `data?.pickupItems`، ولكن يتم ترك `data?.dayAddons` لتعيينها في متغير منفصل `dayAddons` لا يتم استخدامه في بناء قائمة العرض. لضمان ظهور الإضافات كعناصر قابلة للاستلام، يجب دمج `dayAddons` (بعد تحويلها إلى `PickupAvailabilityItemModel`) داخل مصفوفة `pickupItems`.

### 2. اختلاف منطق قابلية الاختيار (`isSelectable`)
*   يعتمد الباك إند على الحقل `selectionMode: "independent"` كشرط أساسي لاعتبار العنصر مستقلاً وقابلاً للاختيار في ملخص طلبات الاستلام.
*   **المشكلة**: في نموذج `PickupAvailabilityItemModel` في فلاتر، دالة `isSelectable` الحالية تتجاهل التحقق من `selectionMode`:
    ```dart
    // المنطق الحالي الخاطئ
    bool get isSelectable => itemId.isNotEmpty && available && canSelect && !paymentRequired;
    ```
    هذا يؤدي إلى عدم تطابق حالة العناصر القابلة للتحديد بين الباك إند وتطبيق الموبايل، وقد يؤدي لظهور عناصر غير معدة للاختيار المستقل (كالمكونات الداخلية للوجبات).

---

## 🛠️ التعديلات المطلوبة (Action Items)

يرجى من فريق فلاتر تطبيق التعديلات التالية لمعالجة المشكلة:

### التعديل الأول: تحديث Mapper لدمج الإضافات في قائمة الاستلام
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

### التعديل الثاني: مواءمة منطق التحديد `isSelectable`
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

## ✅ النتيجة المتوقعة بعد التعديل
1. **ظهور جميع العناصر:** عند فتح شاشة `PickupAvailabilitySheet`، ستقوم مصفوفة `pickupItems` (التي أصبحت تشمل الإضافات) بتمرير بيانات الإضافات لـ `_PickupItemTile`، مما يضمن عرض "الوجبات" و"الإضافات" في نفس القائمة.
2. **استقرار حالة التحديد:** سيتطابق التحديد المستقل مع منطق الباك إند (`selectionMode == 'independent'`)، مما يمنع المستخدم من تحديد عناصر غير صالحة للاستلام المستقل، ويضمن استقرار إرسال طلب `confirmSelectedSlots`.
