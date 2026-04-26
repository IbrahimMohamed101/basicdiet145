class MealPlannerMenuModel {
  final String currency;
  final BuilderCatalogModel builderCatalog;

  MealPlannerMenuModel({required this.currency, required this.builderCatalog});
}

class BuilderCatalogModel {
  final List<BuilderCategoryModel> categories;
  final List<BuilderProteinModel> proteins;
  final List<BuilderCarbModel> carbs;
  final BuilderRulesModel rules;
  final CustomPremiumSaladModel? customPremiumSalad;

  BuilderCatalogModel({
    required this.categories,
    required this.proteins,
    required this.carbs,
    required this.rules,
    this.customPremiumSalad,
  });
}

class BuilderCategoryModel {
  final String id;
  final String key;
  final String dimension;
  final String name;
  final String description;
  final int sortOrder;

  BuilderCategoryModel({
    required this.id,
    required this.key,
    required this.dimension,
    required this.name,
    required this.description,
    required this.sortOrder,
  });
}

class BuilderProteinModel {
  final String id;
  final String displayCategoryId;
  final String displayCategoryKey;
  final String name;
  final String description;
  final String proteinFamilyKey;
  final List<String> ruleTags;
  final bool isPremium;
  final int premiumCreditCost;
  final int extraFeeHalala;
  final String currency;
  final int sortOrder;

  BuilderProteinModel({
    required this.id,
    required this.displayCategoryId,
    required this.displayCategoryKey,
    required this.name,
    required this.description,
    required this.proteinFamilyKey,
    required this.ruleTags,
    required this.isPremium,
    required this.premiumCreditCost,
    required this.extraFeeHalala,
    required this.currency,
    required this.sortOrder,
  });
}

class BuilderCarbModel {
  final String id;
  final String displayCategoryId;
  final String displayCategoryKey;
  final String name;
  final String description;
  final int sortOrder;

  BuilderCarbModel({
    required this.id,
    required this.displayCategoryId,
    required this.displayCategoryKey,
    required this.name,
    required this.description,
    required this.sortOrder,
  });
}

class BuilderRulesModel {
  final String version;
  final BeefRuleModel beef;

  BuilderRulesModel({required this.version, required this.beef});
}

class BeefRuleModel {
  final String proteinFamilyKey;
  final int maxSlotsPerDay;

  BeefRuleModel({required this.proteinFamilyKey, required this.maxSlotsPerDay});
}

class CustomPremiumSaladModel {
  final String id;
  final String carbId;
  final String selectionType;
  final String name;
  final int extraFeeHalala;
  final String currency;
  final CustomPremiumSaladPresetModel preset;
  final List<CustomPremiumSaladIngredientModel> ingredients;

  CustomPremiumSaladModel({
    required this.id,
    required this.carbId,
    required this.selectionType,
    required this.name,
    required this.extraFeeHalala,
    required this.currency,
    required this.preset,
    required this.ingredients,
  });
}

class CustomPremiumSaladPresetModel {
  final String key;
  final String name;
  final String selectionType;
  final int fixedPriceHalala;
  final String currency;
  final List<CustomPremiumSaladGroupRuleModel> groups;

  CustomPremiumSaladPresetModel({
    required this.key,
    required this.name,
    required this.selectionType,
    required this.fixedPriceHalala,
    required this.currency,
    required this.groups,
  });
}

class CustomPremiumSaladGroupRuleModel {
  final String key;
  final int minSelect;
  final int maxSelect;

  CustomPremiumSaladGroupRuleModel({
    required this.key,
    required this.minSelect,
    required this.maxSelect,
  });
}

class CustomPremiumSaladIngredientModel {
  final String id;
  final String groupKey;
  final String name;
  final int calories;

  CustomPremiumSaladIngredientModel({
    required this.id,
    required this.groupKey,
    required this.name,
    required this.calories,
  });
}
