import 'package:basic_diet/domain/model/premium_meals_model.dart';
import 'package:equatable/equatable.dart';

abstract class PremiumMealsState extends Equatable {
  const PremiumMealsState();

  @override
  List<Object> get props => [];
}

class PremiumMealsInitial extends PremiumMealsState {
  const PremiumMealsInitial();
}

class PremiumMealsLoading extends PremiumMealsState {
  const PremiumMealsLoading();
}

class PremiumMealsError extends PremiumMealsState {
  final String message;

  const PremiumMealsError(this.message);

  @override
  List<Object> get props => [message];
}

class PremiumMealsSuccess extends PremiumMealsState {
  final PremiumMealsModel premiumMealsModel;
  final Map<String, int> mealCounters;

  const PremiumMealsSuccess(this.premiumMealsModel, {this.mealCounters = const {}});

  PremiumMealsSuccess copyWith({
    PremiumMealsModel? premiumMealsModel,
    Map<String, int>? mealCounters,
  }) {
    return PremiumMealsSuccess(
      premiumMealsModel ?? this.premiumMealsModel,
      mealCounters: mealCounters ?? this.mealCounters,
    );
  }

  @override
  List<Object> get props => [premiumMealsModel, mealCounters];
}
