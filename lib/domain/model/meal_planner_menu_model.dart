class MealPlannerMenuModel {
  final String currency;
  final BuilderCatalogModel builderCatalog;

  MealPlannerMenuModel({
    required this.currency,
    required this.builderCatalog,
  });
}

class BuilderCatalogModel {
  final List<BuilderCategoryModel> categories;
  final List<BuilderProteinModel> proteins;
  final List<BuilderCarbModel> carbs;
  final BuilderRulesModel rules;

  BuilderCatalogModel({
    required this.categories,
    required this.proteins,
    required this.carbs,
    required this.rules,
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

  BuilderRulesModel({
    required this.version,
    required this.beef,
  });
}

class BeefRuleModel {
  final String proteinFamilyKey;
  final int maxSlotsPerDay;

  BeefRuleModel({
    required this.proteinFamilyKey,
    required this.maxSlotsPerDay,
  });
}

