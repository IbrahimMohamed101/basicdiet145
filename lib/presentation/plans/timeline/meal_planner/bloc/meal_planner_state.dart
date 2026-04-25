import 'package:basic_diet/domain/model/add_ons_model.dart';
import 'package:basic_diet/domain/model/current_subscription_overview_model.dart';
import 'package:basic_diet/domain/model/meal_planner_menu_model.dart';
import 'package:basic_diet/domain/model/subscription_day_model.dart';
import 'package:basic_diet/domain/model/timeline_model.dart';
import 'package:equatable/equatable.dart';

sealed class MealPlannerState extends Equatable {
  const MealPlannerState();

  @override
  List<Object?> get props => [];
}

final class MealPlannerInitial extends MealPlannerState {}

final class MealPlannerLoading extends MealPlannerState {}

final class MealPlannerError extends MealPlannerState {
  final String message;
  const MealPlannerError(this.message);

  @override
  List<Object?> get props => [message];
}

final class MealPlannerSlotSelection extends Equatable {
  final int slotIndex;
  final String slotKey;
  final String? proteinId;
  final String? carbId;

  const MealPlannerSlotSelection({
    required this.slotIndex,
    required this.slotKey,
    required this.proteinId,
    required this.carbId,
  });

  MealPlannerSlotSelection copyWith({
    int? slotIndex,
    String? slotKey,
    String? proteinId,
    String? carbId,
  }) {
    return MealPlannerSlotSelection(
      slotIndex: slotIndex ?? this.slotIndex,
      slotKey: slotKey ?? this.slotKey,
      proteinId: proteinId ?? this.proteinId,
      carbId: carbId ?? this.carbId,
    );
  }

  @override
  List<Object?> get props => [slotIndex, slotKey, proteinId, carbId];
}

final class PendingAddonPrompt extends Equatable {
  final String addonId;
  final String title;
  final String category;
  final int priceHalala;
  final String currency;

  const PendingAddonPrompt({
    required this.addonId,
    required this.title,
    required this.category,
    required this.priceHalala,
    required this.currency,
  });

  @override
  List<Object?> get props => [addonId, title, category, priceHalala, currency];
}

final class MealPlannerLoaded extends MealPlannerState {
  static const List<String> addonCategoryOrder = [
    'juice',
    'snack',
    'small_salad',
  ];

  final List<TimelineDayModel> timelineDays;
  final MealPlannerMenuModel menu;
  final List<AddOnModel> addOnsCatalog;
  final List<AddonSubscriptionModel> addonEntitlements;
  final int selectedDayIndex;
  final Map<int, List<MealPlannerSlotSelection>> selectedSlotsPerDay;
  final Map<int, List<MealPlannerSlotSelection>> savedSlotsPerDay;
  final Map<int, List<String>> selectedAddOnIdsByDay;
  final Map<int, List<String>> savedAddOnIdsByDay;
  final Map<int, SubscriptionDayModel> dayDetailsByIndex;
  final bool isSaving;
  final bool isRefreshingDay;
  final bool showSavedBanner;
  final String lastAddedMealName;
  final int premiumMealsRemaining;
  final bool saveSuccess;
  final int premiumMealsPendingPayment;
  final String? paymentUrl;
  final String? paymentId;
  final String? paymentError;
  final String? activePaymentKind;
  final PendingAddonPrompt? pendingAddonPrompt;

  const MealPlannerLoaded({
    required this.timelineDays,
    required this.menu,
    required this.addOnsCatalog,
    required this.addonEntitlements,
    required this.selectedDayIndex,
    required this.selectedSlotsPerDay,
    required this.savedSlotsPerDay,
    required this.selectedAddOnIdsByDay,
    required this.savedAddOnIdsByDay,
    required this.dayDetailsByIndex,
    required this.premiumMealsRemaining,
    this.isSaving = false,
    this.isRefreshingDay = false,
    this.saveSuccess = false,
    this.showSavedBanner = false,
    this.lastAddedMealName = "",
    this.premiumMealsPendingPayment = 0,
    this.paymentUrl,
    this.paymentId,
    this.paymentError,
    this.activePaymentKind,
    this.pendingAddonPrompt,
  });

  TimelineDayModel get selectedTimelineDay => timelineDays[selectedDayIndex];

  SubscriptionDayModel? get selectedDayDetail =>
      dayDetailsByIndex[selectedDayIndex];

  List<String> get selectedAddOnIds =>
      selectedAddOnIdsByDay[selectedDayIndex] ?? const [];

  List<String> get savedAddOnIds =>
      savedAddOnIdsByDay[selectedDayIndex] ?? const [];

  List<AddonSelectionModel> get addonSelections =>
      selectedDayDetail?.addonSelections ?? const [];

  List<AddOnModel> get plannerAddOnsCatalog =>
      addOnsCatalog.where((addon) => addon.kind == 'item').toList();

  Map<String, List<AddOnModel>> get groupedAddons {
    final grouped = <String, List<AddOnModel>>{
      for (final category in addonCategoryOrder) category: <AddOnModel>[],
    };

    for (final addon in plannerAddOnsCatalog) {
      grouped.putIfAbsent(addon.category, () => <AddOnModel>[]).add(addon);
    }

    return grouped;
  }

  List<AddOnModel> get selectedAddOnModels {
    final ids = selectedAddOnIds.toSet();
    return plannerAddOnsCatalog
        .where((addon) => ids.contains(addon.id))
        .toList();
  }

  bool isAddonCoveredBySubscription(String category) {
    for (final entitlement in addonEntitlements) {
      if (entitlement.category == category &&
          entitlement.status == 'active' &&
          entitlement.includedCount > 0) {
        return true;
      }
    }
    return false;
  }

  AddOnModel? selectedAddonForCategory(String category) {
    for (final addon in selectedAddOnModels) {
      if (addon.category == category) return addon;
    }
    return null;
  }

  String addonSelectionStatusFor(String addonId) {
    final backendSelection = addonSelections
        .where((selection) => selection.addonId == addonId)
        .cast<AddonSelectionModel?>()
        .firstWhere((selection) => selection != null, orElse: () => null);

    if (backendSelection != null && backendSelection.status.isNotEmpty) {
      return backendSelection.status;
    }

    final selectedAddon = plannerAddOnsCatalog
        .where((addon) => addon.id == addonId)
        .cast<AddOnModel?>()
        .firstWhere((addon) => addon != null, orElse: () => null);

    if (selectedAddon == null) return 'pending_payment';

    return isAddonCoveredBySubscription(selectedAddon.category)
        ? 'subscription'
        : 'pending_payment';
  }

  int get localAddonPendingAmountHalala {
    var total = 0;
    for (final addon in selectedAddOnModels) {
      final status = addonSelectionStatusFor(addon.id);
      if (status == 'pending_payment') {
        total += addon.priceHalala;
      }
    }
    return total;
  }

  int get localAddonPendingCount {
    var total = 0;
    for (final addon in selectedAddOnModels) {
      if (addonSelectionStatusFor(addon.id) == 'pending_payment') {
        total++;
      }
    }
    return total;
  }

  int get addonPendingPaymentCount {
    return selectedDayDetail?.paymentRequirement?.addonPendingPaymentCount ??
        localAddonPendingCount;
  }

  int get addonPendingPaymentAmountHalala {
    return localAddonPendingAmountHalala;
  }

  int get premiumPendingPaymentAmountHalala {
    var totalHalala = 0;
    var usedCredits = 0;
    final slots = selectedSlotsPerDay[selectedDayIndex] ?? const [];

    for (final slot in slots) {
      final proteinId = slot.proteinId;
      if (proteinId == null) continue;

      final protein = menu.builderCatalog.proteins
          .where((item) => item.id == proteinId)
          .cast<BuilderProteinModel?>()
          .firstWhere((item) => item != null, orElse: () => null);

      if (protein == null || !protein.isPremium) continue;

      final cost =
          protein.premiumCreditCost == 0 ? 1 : protein.premiumCreditCost;
      usedCredits += cost;

      if (usedCredits > premiumMealsRemaining) {
        totalHalala += protein.extraFeeHalala;
      }
    }

    return totalHalala;
  }

  int get totalPendingPaymentAmountHalala =>
      premiumPendingPaymentAmountHalala + addonPendingPaymentAmountHalala;

  String get paymentCurrency {
    final dayCurrency = selectedDayDetail?.paymentRequirement?.currency;
    if (dayCurrency != null && dayCurrency.isNotEmpty) {
      return dayCurrency;
    }
    if (menu.currency.isNotEmpty) return menu.currency;
    return 'SAR';
  }

  int get maxMeals => selectedTimelineDay.requiredMeals;

  bool get isSelectedDayEditable {
    final normalized = selectedTimelineDay.status.toLowerCase();
    return normalized == 'open' || normalized == 'extension';
  }

  bool get hasPendingAddonPayment {
    return addonPendingPaymentCount > 0;
  }

  bool get hasPendingPremiumPayment => premiumMealsPendingPayment > 0;

  bool get hasAnyPendingPayment =>
      hasPendingPremiumPayment || hasPendingAddonPayment;

  bool get isDirty {
    for (final entry in selectedSlotsPerDay.entries) {
      final current = entry.value;
      final saved = savedSlotsPerDay[entry.key];
      if (saved == null || current.length != saved.length) return true;
      for (var i = 0; i < current.length; i++) {
        if (current[i] != saved[i]) return true;
      }
    }

    for (final entry in selectedAddOnIdsByDay.entries) {
      final current = entry.value;
      final saved = savedAddOnIdsByDay[entry.key] ?? const [];
      if (current.length != saved.length) return true;
      for (var i = 0; i < current.length; i++) {
        if (current[i] != saved[i]) return true;
      }
    }

    return false;
  }

  @override
  List<Object?> get props => [
    timelineDays,
    menu,
    addOnsCatalog,
    addonEntitlements,
    selectedDayIndex,
    selectedSlotsPerDay,
    savedSlotsPerDay,
    selectedAddOnIdsByDay,
    savedAddOnIdsByDay,
    dayDetailsByIndex,
    isSaving,
    isRefreshingDay,
    showSavedBanner,
    lastAddedMealName,
    premiumMealsRemaining,
    saveSuccess,
    premiumMealsPendingPayment,
    paymentUrl,
    paymentId,
    paymentError,
    activePaymentKind,
    pendingAddonPrompt,
  ];

  MealPlannerLoaded copyWith({
    List<TimelineDayModel>? timelineDays,
    MealPlannerMenuModel? menu,
    List<AddOnModel>? addOnsCatalog,
    List<AddonSubscriptionModel>? addonEntitlements,
    int? selectedDayIndex,
    Map<int, List<MealPlannerSlotSelection>>? selectedSlotsPerDay,
    Map<int, List<MealPlannerSlotSelection>>? savedSlotsPerDay,
    Map<int, List<String>>? selectedAddOnIdsByDay,
    Map<int, List<String>>? savedAddOnIdsByDay,
    Map<int, SubscriptionDayModel>? dayDetailsByIndex,
    bool? isSaving,
    bool? isRefreshingDay,
    bool? showSavedBanner,
    String? lastAddedMealName,
    int? premiumMealsRemaining,
    bool? saveSuccess,
    int? premiumMealsPendingPayment,
    String? paymentUrl,
    String? paymentId,
    String? paymentError,
    String? activePaymentKind,
    PendingAddonPrompt? pendingAddonPrompt,
    bool clearPaymentUrl = false,
    bool clearPaymentId = false,
    bool clearPaymentError = false,
    bool clearPendingAddonPrompt = false,
  }) {
    return MealPlannerLoaded(
      timelineDays: timelineDays ?? this.timelineDays,
      menu: menu ?? this.menu,
      addOnsCatalog: addOnsCatalog ?? this.addOnsCatalog,
      addonEntitlements: addonEntitlements ?? this.addonEntitlements,
      selectedDayIndex: selectedDayIndex ?? this.selectedDayIndex,
      selectedSlotsPerDay: selectedSlotsPerDay ?? this.selectedSlotsPerDay,
      savedSlotsPerDay: savedSlotsPerDay ?? this.savedSlotsPerDay,
      selectedAddOnIdsByDay:
          selectedAddOnIdsByDay ?? this.selectedAddOnIdsByDay,
      savedAddOnIdsByDay: savedAddOnIdsByDay ?? this.savedAddOnIdsByDay,
      dayDetailsByIndex: dayDetailsByIndex ?? this.dayDetailsByIndex,
      isSaving: isSaving ?? this.isSaving,
      isRefreshingDay: isRefreshingDay ?? this.isRefreshingDay,
      showSavedBanner: showSavedBanner ?? this.showSavedBanner,
      lastAddedMealName: lastAddedMealName ?? this.lastAddedMealName,
      premiumMealsRemaining:
          premiumMealsRemaining ?? this.premiumMealsRemaining,
      saveSuccess: saveSuccess ?? this.saveSuccess,
      premiumMealsPendingPayment:
          premiumMealsPendingPayment ?? this.premiumMealsPendingPayment,
      paymentUrl: clearPaymentUrl ? null : paymentUrl ?? this.paymentUrl,
      paymentId: clearPaymentId ? null : paymentId ?? this.paymentId,
      paymentError:
          clearPaymentError ? null : paymentError ?? this.paymentError,
      activePaymentKind: activePaymentKind ?? this.activePaymentKind,
      pendingAddonPrompt:
          clearPendingAddonPrompt
              ? null
              : pendingAddonPrompt ?? this.pendingAddonPrompt,
    );
  }
}
