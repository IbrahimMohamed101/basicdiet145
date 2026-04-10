import 'package:equatable/equatable.dart';

abstract class MealPlannerEvent extends Equatable {
  const MealPlannerEvent();

  @override
  List<Object?> get props => [];
}

class GetMealPlannerDataEvent extends MealPlannerEvent {
  const GetMealPlannerDataEvent();
}

class ChangeDateEvent extends MealPlannerEvent {
  final int index;
  const ChangeDateEvent(this.index);

  @override
  List<Object?> get props => [index];
}

class ToggleMealSelectionEvent extends MealPlannerEvent {
  final String mealId;
  const ToggleMealSelectionEvent(this.mealId);

  @override
  List<Object?> get props => [mealId];
}

class SaveMealPlannerChangesEvent extends MealPlannerEvent {
  const SaveMealPlannerChangesEvent();
}

class ChangeCategoryEvent extends MealPlannerEvent {
  final int index;
  const ChangeCategoryEvent(this.index);

  @override
  List<Object?> get props => [index];
}

class HideBannerEvent extends MealPlannerEvent {
  const HideBannerEvent();
}
