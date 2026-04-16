import 'package:basic_diet/app/constants.dart';
import 'package:basic_diet/app/extensions.dart';
import 'package:basic_diet/data/response/meal_planner_menu_response.dart';
import 'package:basic_diet/domain/model/meal_planner_menu_model.dart';

extension BuilderCategoryResponseMapper on BuilderCategoryResponse? {
  BuilderCategoryModel toDomain() {
    return BuilderCategoryModel(
      id: this?.id.orEmpty() ?? Constants.empty,
      key: this?.key.orEmpty() ?? Constants.empty,
      dimension: this?.dimension.orEmpty() ?? Constants.empty,
      name: this?.name.orEmpty() ?? Constants.empty,
      description: this?.description.orEmpty() ?? Constants.empty,
      sortOrder: this?.sortOrder.orZero() ?? Constants.zero,
    );
  }
}

extension BuilderProteinResponseMapper on BuilderProteinResponse? {
  BuilderProteinModel toDomain() {
    return BuilderProteinModel(
      id: this?.id.orEmpty() ?? Constants.empty,
      displayCategoryId: this?.displayCategoryId.orEmpty() ?? Constants.empty,
      displayCategoryKey: this?.displayCategoryKey.orEmpty() ?? Constants.empty,
      name: this?.name.orEmpty() ?? Constants.empty,
      description: this?.description.orEmpty() ?? Constants.empty,
      proteinFamilyKey: this?.proteinFamilyKey.orEmpty() ?? Constants.empty,
      ruleTags: this?.ruleTags ?? const [],
      isPremium: this?.isPremium.orFalse() ?? Constants.falseValue,
      premiumCreditCost: this?.premiumCreditCost.orZero() ?? Constants.zero,
      extraFeeHalala: this?.extraFeeHalala.orZero() ?? Constants.zero,
      currency: this?.currency.orEmpty() ?? Constants.empty,
      sortOrder: this?.sortOrder.orZero() ?? Constants.zero,
    );
  }
}

extension BuilderCarbResponseMapper on BuilderCarbResponse? {
  BuilderCarbModel toDomain() {
    return BuilderCarbModel(
      id: this?.id.orEmpty() ?? Constants.empty,
      displayCategoryId: this?.displayCategoryId.orEmpty() ?? Constants.empty,
      displayCategoryKey: this?.displayCategoryKey.orEmpty() ?? Constants.empty,
      name: this?.name.orEmpty() ?? Constants.empty,
      description: this?.description.orEmpty() ?? Constants.empty,
      sortOrder: this?.sortOrder.orZero() ?? Constants.zero,
    );
  }
}

extension BeefRuleResponseMapper on BeefRuleResponse? {
  BeefRuleModel toDomain() {
    return BeefRuleModel(
      proteinFamilyKey: this?.proteinFamilyKey.orEmpty() ?? Constants.empty,
      maxSlotsPerDay: this?.maxSlotsPerDay.orZero() ?? Constants.zero,
    );
  }
}

extension BuilderRulesResponseMapper on BuilderRulesResponse? {
  BuilderRulesModel toDomain() {
    final self = this;
    return BuilderRulesModel(
      version: self?.version.orEmpty() ?? Constants.empty,
      beef: (self?.beef).toDomain(),
    );
  }
}

extension BuilderCatalogResponseMapper on BuilderCatalogResponse? {
  BuilderCatalogModel toDomain() {
    final self = this;
    return BuilderCatalogModel(
      categories: (self?.categories?.map((e) => e.toDomain()).toList()) ?? [],
      proteins: (self?.proteins?.map((e) => e.toDomain()).toList()) ?? [],
      carbs: (self?.carbs?.map((e) => e.toDomain()).toList()) ?? [],
      rules: (self?.rules).toDomain(),
    );
  }
}

extension MealPlannerMenuResponseMapper on MealPlannerMenuResponse? {
  MealPlannerMenuModel toDomain() {
    final self = this;
    return MealPlannerMenuModel(
      currency: self?.data?.currency.orEmpty() ?? Constants.empty,
      builderCatalog: (self?.data?.builderCatalog).toDomain(),
    );
  }
}
