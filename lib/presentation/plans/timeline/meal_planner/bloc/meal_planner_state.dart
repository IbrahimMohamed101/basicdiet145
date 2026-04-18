import 'package:basic_diet/domain/model/meal_planner_menu_model.dart';
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
  final String? proteinId;
  final String? carbId;

  const MealPlannerSlotSelection({
    required this.proteinId,
    required this.carbId,
  });

  MealPlannerSlotSelection copyWith({
    String? proteinId,
    String? carbId,
  }) {
    return MealPlannerSlotSelection(
      proteinId: proteinId ?? this.proteinId,
      carbId: carbId ?? this.carbId,
    );
  }

  @override
  List<Object?> get props => [proteinId, carbId];
}

final class MealPlannerLoaded extends MealPlannerState {
  final List<TimelineDayModel> timelineDays;
  final MealPlannerMenuModel menu;
  final int selectedDayIndex;
  final Map<int, List<MealPlannerSlotSelection>> selectedSlotsPerDay;
  final Map<int, List<MealPlannerSlotSelection>> savedSlotsPerDay;
  final bool isSaving;
  final bool showSavedBanner;
  final String lastAddedMealName;
  final int premiumMealsRemaining;
  final bool saveSuccess;
  final int premiumMealsPendingPayment;
  final String? paymentUrl;
  final String? paymentId;
  final String? paymentError;

  const MealPlannerLoaded({
    required this.timelineDays,
    required this.menu,
    required this.selectedDayIndex,
    required this.selectedSlotsPerDay,
    required this.savedSlotsPerDay,
    required this.premiumMealsRemaining,
    this.isSaving = false,
    this.saveSuccess = false,
    this.showSavedBanner = false,
    this.lastAddedMealName = "",
    this.premiumMealsPendingPayment = 0,
    this.paymentUrl,
    this.paymentId,
    this.paymentError,
  });

  bool get isDirty {
    for (final entry in selectedSlotsPerDay.entries) {
      final dayIndex = entry.key;
      final current = entry.value;
      final saved = savedSlotsPerDay[dayIndex];
      if (saved == null) continue;
      if (current.length != saved.length) return true;
      for (var i = 0; i < current.length; i++) {
        if (i >= saved.length) return true;
        if (current[i] != saved[i]) return true;
      }
    }
    return false;
  }

  int get maxMeals => timelineDays[selectedDayIndex].requiredMeals;

  @override
  List<Object?> get props => [
    timelineDays,
    menu,
    selectedDayIndex,
    selectedSlotsPerDay,
    savedSlotsPerDay,
    isSaving,
    showSavedBanner,
    lastAddedMealName,
    premiumMealsRemaining,
    saveSuccess,
    premiumMealsPendingPayment,
    paymentUrl,
    paymentId,
    paymentError,
  ];

  MealPlannerLoaded copyWith({
    List<TimelineDayModel>? timelineDays,
    MealPlannerMenuModel? menu,
    int? selectedDayIndex,
    Map<int, List<MealPlannerSlotSelection>>? selectedSlotsPerDay,
    Map<int, List<MealPlannerSlotSelection>>? savedSlotsPerDay,
    bool? isSaving,
    bool? showSavedBanner,
    String? lastAddedMealName,
    int? premiumMealsRemaining,
    bool? saveSuccess,
    int? premiumMealsPendingPayment,
    String? paymentUrl,
    String? paymentId,
    String? paymentError,
  }) {
    return MealPlannerLoaded(
      timelineDays: timelineDays ?? this.timelineDays,
      menu: menu ?? this.menu,
      selectedDayIndex: selectedDayIndex ?? this.selectedDayIndex,
      selectedSlotsPerDay: selectedSlotsPerDay ?? this.selectedSlotsPerDay,
      savedSlotsPerDay: savedSlotsPerDay ?? this.savedSlotsPerDay,
      isSaving: isSaving ?? this.isSaving,
      showSavedBanner: showSavedBanner ?? this.showSavedBanner,
      lastAddedMealName: lastAddedMealName ?? this.lastAddedMealName,
      premiumMealsRemaining:
          premiumMealsRemaining ?? this.premiumMealsRemaining,
      saveSuccess: saveSuccess ?? this.saveSuccess,
      premiumMealsPendingPayment:
          premiumMealsPendingPayment ?? this.premiumMealsPendingPayment,
      paymentUrl: paymentUrl,
      paymentId: paymentId,
      paymentError: paymentError,
    );
  }
}
