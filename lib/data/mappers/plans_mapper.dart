import 'package:basic_diet/app/constants.dart';
import 'package:basic_diet/data/response/plans_response.dart';
import 'package:basic_diet/domain/model/plans_model.dart';

extension PlansResponseMapper on PlansResponse? {
  PlansModel toDomain() {
    return PlansModel(
      plans:
          this?.data?.map((plan) => plan.toDomain()).toList() ??
          [],
    );
  }
}

extension PlanResponseMapper on PlanResponse? {
  PlanModel toDomain() {
    return PlanModel(
      id: this?.id ?? Constants.empty,
      name: this?.name ?? Constants.empty,
      daysCount: this?.daysCount ?? Constants.zero,
      currency: this?.currency ?? Constants.empty,
      isActive: this?.isActive ?? false,
      gramsOptions:
          this?.gramsOptions?.map((gram) => gram.toDomain()).toList() ?? [],
    );
  }
}

extension GramOptionResponseMapper on GramOptionResponse? {
  GramOptionModel toDomain() {
    return GramOptionModel(
      grams: this?.grams ?? Constants.zero,
      mealsOptions:
          this?.mealsOptions?.map((meal) => meal.toDomain()).toList() ?? [],
    );
  }
}

extension MealOptionResponseMapper on MealOptionResponse? {
  MealOptionModel toDomain() {
    return MealOptionModel(
      mealsPerDay: this?.mealsPerDay ?? Constants.zero,
      priceSar: this?.priceSar ?? 0.0,
      compareAtSar: this?.compareAtSar ?? 0.0,
    );
  }
}
