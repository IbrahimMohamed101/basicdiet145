import 'package:basic_diet/domain/model/categories_with_meals_model.dart';
import 'package:basic_diet/domain/model/timeline_model.dart';
import 'package:equatable/equatable.dart';

abstract class MealPlannerState extends Equatable {
  const MealPlannerState();

  @override
  List<Object?> get props => [];
}

class MealPlannerInitial extends MealPlannerState {}

class MealPlannerLoading extends MealPlannerState {}

class MealPlannerError extends MealPlannerState {
  final String message;
  const MealPlannerError(this.message);

  @override
  List<Object?> get props => [message];
}

class MealPlannerLoaded extends MealPlannerState {
  final List<TimelineDayModel> timelineDays;
  final CategoriesWithMealsModel categoriesWithMeals;
  final int selectedDayIndex;
  final Map<int, List<String>> selectedMealsPerDay;
  final Map<int, List<String>> savedSelections;
  final bool isSaving;
  final int selectedCategoryIndex;
  final bool showSavedBanner;
  final String lastAddedMealName;
  final int premiumMealsRemaining;

  const MealPlannerLoaded({
    required this.timelineDays,
    required this.categoriesWithMeals,
    required this.selectedDayIndex,
    required this.selectedMealsPerDay,
    required this.savedSelections,
    required this.premiumMealsRemaining,
    this.isSaving = false,
    this.selectedCategoryIndex = 0,
    this.showSavedBanner = false,
    this.lastAddedMealName = "",
  });

  bool get isDirty {
    if (selectedMealsPerDay[selectedDayIndex] == null ||
        savedSelections[selectedDayIndex] == null) {
      return false;
    }
    final current = selectedMealsPerDay[selectedDayIndex]!;
    final saved = savedSelections[selectedDayIndex]!;
    if (current.length != saved.length) return true;
    for (final id in current) {
      if (!saved.contains(id)) return true;
    }
    return false;
  }

  int get maxMeals => timelineDays[selectedDayIndex].requiredMeals;

  @override
  List<Object?> get props => [
    timelineDays,
    categoriesWithMeals,
    selectedDayIndex,
    selectedMealsPerDay,
    savedSelections,
    isSaving,
    selectedCategoryIndex,
    showSavedBanner,
    lastAddedMealName,
    premiumMealsRemaining,
  ];

  MealPlannerLoaded copyWith({
    List<TimelineDayModel>? timelineDays,
    CategoriesWithMealsModel? categoriesWithMeals,
    int? selectedDayIndex,
    Map<int, List<String>>? selectedMealsPerDay,
    Map<int, List<String>>? savedSelections,
    bool? isSaving,
    int? selectedCategoryIndex,
    bool? showSavedBanner,
    String? lastAddedMealName,
    int? premiumMealsRemaining,
  }) {
    return MealPlannerLoaded(
      timelineDays: timelineDays ?? this.timelineDays,
      categoriesWithMeals: categoriesWithMeals ?? this.categoriesWithMeals,
      selectedDayIndex: selectedDayIndex ?? this.selectedDayIndex,
      selectedMealsPerDay: selectedMealsPerDay ?? this.selectedMealsPerDay,
      savedSelections: savedSelections ?? this.savedSelections,
      isSaving: isSaving ?? this.isSaving,
      selectedCategoryIndex:
          selectedCategoryIndex ?? this.selectedCategoryIndex,
      showSavedBanner: showSavedBanner ?? this.showSavedBanner,
      lastAddedMealName: lastAddedMealName ?? this.lastAddedMealName,
      premiumMealsRemaining:
          premiumMealsRemaining ?? this.premiumMealsRemaining,
    );
  }
}
