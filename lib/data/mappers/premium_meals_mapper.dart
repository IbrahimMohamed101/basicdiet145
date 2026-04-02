import 'package:basic_diet/app/constants.dart';
import 'package:basic_diet/data/response/premium_meals_response.dart';
import 'package:basic_diet/domain/model/premium_meals_model.dart';

extension PremiumMealsResponseMapper on PremiumMealsResponse? {
  PremiumMealsModel toDomain() {
    return PremiumMealsModel(
      meals: this?.data?.map((meal) => meal.toDomain()).toList() ?? [],
    );
  }
}

extension PremiumMealResponseMapper on PremiumMealResponse? {
  PremiumMealModel toDomain() {
    return PremiumMealModel(
      id: this?.id ?? Constants.empty,
      name: this?.name ?? Constants.empty,
      description: this?.description ?? Constants.empty,
      imageUrl: this?.imageUrl ?? Constants.empty,
      currency: this?.currency ?? Constants.empty,
      extraFeeHalala: this?.extraFeeHalala ?? Constants.zero,
      extraFeeSar: this?.extraFeeSar ?? 0.0,
      priceHalala: this?.priceHalala ?? Constants.zero,
      priceSar: this?.priceSar ?? 0.0,
      priceLabel: this?.priceLabel ?? Constants.empty,
      ui:
          this?.ui.toDomain() ??
          PremiumMealUiModel(
            title: Constants.empty,
            subtitle: Constants.empty,
            ctaLabel: Constants.empty,
            selectionStyle: Constants.empty,
          ),
    );
  }
}

extension PremiumMealUiResponseMapper on PremiumMealUiResponse? {
  PremiumMealUiModel toDomain() {
    return PremiumMealUiModel(
      title: this?.title ?? Constants.empty,
      subtitle: this?.subtitle ?? Constants.empty,
      ctaLabel: this?.ctaLabel ?? Constants.empty,
      selectionStyle: this?.selectionStyle ?? Constants.empty,
    );
  }
}
