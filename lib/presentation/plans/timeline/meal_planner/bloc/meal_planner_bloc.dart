import 'package:basic_diet/domain/usecase/get_categories_with_meals_usecase.dart';
import 'package:basic_diet/domain/usecase/get_premium_meals_usecase.dart';
import 'package:basic_diet/domain/model/categories_with_meals_model.dart';
import 'package:basic_diet/domain/model/timeline_model.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'meal_planner_event.dart';
import 'meal_planner_state.dart';

class MealPlannerBloc extends Bloc<MealPlannerEvent, MealPlannerState> {
  final GetCategoriesWithMealsUseCase _getCategoriesWithMealsUseCase;
  final GetPremiumMealsUseCase _getPremiumMealsUseCase;
  final List<TimelineDayModel> initialTimelineDays;
  final int initialDayIndex;
  final int premiumMealsRemaining;

  MealPlannerBloc(
    this._getCategoriesWithMealsUseCase,
    this._getPremiumMealsUseCase, {
    required this.initialTimelineDays,
    required this.initialDayIndex,
    required this.premiumMealsRemaining,
  }) : super(MealPlannerInitial()) {
    on<GetMealPlannerDataEvent>(_onGetData);
    on<ChangeDateEvent>(_onChangeDate);
    on<ToggleMealSelectionEvent>(_onToggleMeal);
    on<SaveMealPlannerChangesEvent>(_onSave);
    on<ChangeCategoryEvent>(_onChangeCategory);
    on<HideBannerEvent>(_onHideBanner);
  }

  Future<void> _onGetData(
    GetMealPlannerDataEvent event,
    Emitter<MealPlannerState> emit,
  ) async {
    emit(MealPlannerLoading());
    final categoriesResult = await _getCategoriesWithMealsUseCase.execute(null);
    final premiumResult = await _getPremiumMealsUseCase.execute(null);

    categoriesResult.fold(
      (failure) => emit(MealPlannerError(failure.message)),
      (categories) {
        premiumResult.fold(
          (failure) => emit(MealPlannerError(failure.message)),
          (premiumMeals) {
            final premiumCategory = CategoryWithMealsModel(
              id: 'premium_category',
              name: 'Premium',
              slug: 'premium',
              sortOrder: 999,
              meals: premiumMeals.meals.map((p) => MealItemModel(
                id: p.id,
                name: p.name,
                description: p.description,
                imageUrl: p.imageUrl,
                price: p.priceSar,
                calories: 0,
                proteinGrams: 0,
                carbGrams: 0,
                fatGrams: 0,
                availableForOrder: true,
                availableForSubscription: true,
                type: 'premium',
                sortOrder: 0,
              )).toList(),
            );
            
            categories.data.add(premiumCategory);

            final Map<int, List<String>> selectedMealsPerDay = {};
            final Map<int, List<String>> savedSelections = {};

            for (int i = 0; i < initialTimelineDays.length; i++) {
              final day = initialTimelineDays[i];
              selectedMealsPerDay[i] =
                  List.generate(day.selectedMeals, (index) => "initial_$index");
              savedSelections[i] = List.from(selectedMealsPerDay[i]!);
            }

            emit(MealPlannerLoaded(
              timelineDays: initialTimelineDays,
              categoriesWithMeals: categories,
              selectedDayIndex: initialDayIndex,
              selectedMealsPerDay: selectedMealsPerDay,
              savedSelections: savedSelections,
              premiumMealsRemaining: premiumMealsRemaining,
            ));
          },
        );
      },
    );
  }

  void _onChangeDate(ChangeDateEvent event, Emitter<MealPlannerState> emit) {
    if (state is MealPlannerLoaded) {
      final s = state as MealPlannerLoaded;
      emit(s.copyWith(selectedDayIndex: event.index));
    }
  }

  void _onToggleMeal(
      ToggleMealSelectionEvent event, Emitter<MealPlannerState> emit) {
    if (state is MealPlannerLoaded) {
      final s = state as MealPlannerLoaded;
      final index = s.selectedDayIndex;
      final currentList = List<String>.from(s.selectedMealsPerDay[index] ?? []);

      if (currentList.contains(event.mealId)) {
        currentList.remove(event.mealId);
      } else {
        if (currentList.length < s.maxMeals) {
          currentList.add(event.mealId);
        }
      }

      final newSelectedMeals = Map<int, List<String>>.from(s.selectedMealsPerDay);
      newSelectedMeals[index] = currentList;

      String mealName = "";
      bool showBanner = false;
      if (!currentList.contains(event.mealId)) {
        // This was a removal, but the requirement says "Once a meal is selected, show banner"
        // Let's check if we just added it.
      } else {
        showBanner = true;
        // Find meal name from categories
        for (var cat in s.categoriesWithMeals.data) {
          for (var meal in cat.meals) {
            if (meal.id == event.mealId) {
              mealName = meal.name;
              break;
            }
          }
        }
      }

      emit(s.copyWith(
        selectedMealsPerDay: newSelectedMeals,
        showSavedBanner: showBanner,
        lastAddedMealName: showBanner ? mealName : s.lastAddedMealName,
      ));
    }
  }

  void _onChangeCategory(ChangeCategoryEvent event, Emitter<MealPlannerState> emit) {
    if (state is MealPlannerLoaded) {
      final s = state as MealPlannerLoaded;
      emit(s.copyWith(selectedCategoryIndex: event.index));
    }
  }

  void _onHideBanner(HideBannerEvent event, Emitter<MealPlannerState> emit) {
    if (state is MealPlannerLoaded) {
      final s = state as MealPlannerLoaded;
      emit(s.copyWith(showSavedBanner: false));
    }
  }

  Future<void> _onSave(
      SaveMealPlannerChangesEvent event, Emitter<MealPlannerState> emit) async {
    if (state is MealPlannerLoaded) {
      final s = state as MealPlannerLoaded;
      emit(s.copyWith(isSaving: true));

      // Mock API call for saving
      await Future.delayed(const Duration(seconds: 1));

      final newSavedSelections = Map<int, List<String>>.from(s.selectedMealsPerDay);
      emit(s.copyWith(
        isSaving: false,
        savedSelections: newSavedSelections,
      ));
    }
  }
}
