import 'package:equatable/equatable.dart';

class PlansModel extends Equatable {
  final List<PlanModel> plans;

  const PlansModel({required this.plans});

  @override
  List<Object?> get props => [plans];
}

class PlanModel extends Equatable {
  final String id;
  final String name;
  final int daysCount;
  final String currency;
  final bool isActive;
  final List<GramOptionModel> gramsOptions;

  const PlanModel({
    required this.id,
    required this.name,
    required this.daysCount,
    required this.currency,
    required this.isActive,
    required this.gramsOptions,
  });

  @override
  List<Object?> get props => [
    id,
    name,
    daysCount,
    currency,
    isActive,
    gramsOptions,
  ];
}

class GramOptionModel extends Equatable {
  final int grams;
  final List<MealOptionModel> mealsOptions;

  const GramOptionModel({required this.grams, required this.mealsOptions});

  @override
  List<Object?> get props => [grams, mealsOptions];
}

class MealOptionModel extends Equatable {
  final int mealsPerDay;
  final double priceSar;
  final double compareAtSar;

  const MealOptionModel({
    required this.mealsPerDay,
    required this.priceSar,
    required this.compareAtSar,
  });

  @override
  List<Object?> get props => [mealsPerDay, priceSar, compareAtSar];
}
