class PlansModel {
  List<PlanModel> plans;

  PlansModel({required this.plans});
}

class PlanModel {
  String id;
  String name;
  int daysCount;
  String currency;
  bool isActive;
  List<GramOptionModel> gramsOptions;

  PlanModel({
    required this.id,
    required this.name,
    required this.daysCount,
    required this.currency,
    required this.isActive,
    required this.gramsOptions,
  });
}

class GramOptionModel {
  int grams;
  List<MealOptionModel> mealsOptions;

  GramOptionModel({required this.grams, required this.mealsOptions});
}

class MealOptionModel {
  int mealsPerDay;
  double priceSar;
  double compareAtSar;

  MealOptionModel({
    required this.mealsPerDay,
    required this.priceSar,
    required this.compareAtSar,
  });
}
