import 'package:json_annotation/json_annotation.dart';

part 'meal_planner_menu_response.g.dart';

@JsonSerializable()
class MealPlannerMenuResponse {
  @JsonKey(name: "status", readValue: _readOkOrStatus)
  dynamic status;
  @JsonKey(name: "message")
  String? message;
  @JsonKey(name: "data")
  MealPlannerMenuDataResponse? data;

  MealPlannerMenuResponse({this.status, this.message, this.data});

  static Object? _readOkOrStatus(Map<dynamic, dynamic> json, String key) {
    final value = json['ok'] ?? json['status'];
    if (value is bool) return value;
    if (value is num) {
      if (value == 1) return true;
      if (value == 0) return false;
      return value;
    }
    if (value is String) {
      final normalized = value.trim().toLowerCase();
      if (normalized == 'true' || normalized == '1') return true;
      if (normalized == 'false' || normalized == '0') return false;
    }
    return value;
  }

  factory MealPlannerMenuResponse.fromJson(Map<String, dynamic> json) =>
      _$MealPlannerMenuResponseFromJson(json);
  Map<String, dynamic> toJson() => _$MealPlannerMenuResponseToJson(this);
}

@JsonSerializable()
class MealPlannerMenuDataResponse {
  @JsonKey(name: "currency")
  String? currency;

  @JsonKey(name: "builderCatalog")
  BuilderCatalogResponse? builderCatalog;

  MealPlannerMenuDataResponse({this.currency, this.builderCatalog});

  factory MealPlannerMenuDataResponse.fromJson(Map<String, dynamic> json) =>
      _$MealPlannerMenuDataResponseFromJson(json);
  Map<String, dynamic> toJson() => _$MealPlannerMenuDataResponseToJson(this);
}

@JsonSerializable()
class BuilderCatalogResponse {
  @JsonKey(name: "categories")
  List<BuilderCategoryResponse>? categories;
  @JsonKey(name: "proteins")
  List<BuilderProteinResponse>? proteins;
  @JsonKey(name: "carbs")
  List<BuilderCarbResponse>? carbs;
  @JsonKey(name: "rules")
  BuilderRulesResponse? rules;
  @JsonKey(name: "customPremiumSalad")
  CustomPremiumSaladResponse? customPremiumSalad;

  BuilderCatalogResponse({
    this.categories,
    this.proteins,
    this.carbs,
    this.rules,
    this.customPremiumSalad,
  });

  factory BuilderCatalogResponse.fromJson(Map<String, dynamic> json) =>
      _$BuilderCatalogResponseFromJson(json);
  Map<String, dynamic> toJson() => _$BuilderCatalogResponseToJson(this);
}

@JsonSerializable()
class CustomPremiumSaladResponse {
  @JsonKey(name: "id")
  String? id;
  @JsonKey(name: "carbId")
  String? carbId;
  @JsonKey(name: "selectionType")
  String? selectionType;
  @JsonKey(name: "name")
  String? name;
  @JsonKey(name: "extraFeeHalala")
  int? extraFeeHalala;
  @JsonKey(name: "currency")
  String? currency;
  @JsonKey(name: "preset")
  CustomPremiumSaladPresetResponse? preset;
  @JsonKey(name: "ingredients")
  List<CustomPremiumSaladIngredientResponse>? ingredients;

  CustomPremiumSaladResponse({
    this.id,
    this.carbId,
    this.selectionType,
    this.name,
    this.extraFeeHalala,
    this.currency,
    this.preset,
    this.ingredients,
  });

  factory CustomPremiumSaladResponse.fromJson(Map<String, dynamic> json) =>
      _$CustomPremiumSaladResponseFromJson(json);
  Map<String, dynamic> toJson() => _$CustomPremiumSaladResponseToJson(this);
}

@JsonSerializable()
class CustomPremiumSaladPresetResponse {
  @JsonKey(name: "key")
  String? key;
  @JsonKey(name: "name")
  String? name;
  @JsonKey(name: "selectionType")
  String? selectionType;
  @JsonKey(name: "fixedPriceHalala")
  int? fixedPriceHalala;
  @JsonKey(name: "currency")
  String? currency;
  @JsonKey(name: "groups")
  List<CustomPremiumSaladGroupRuleResponse>? groups;

  CustomPremiumSaladPresetResponse({
    this.key,
    this.name,
    this.selectionType,
    this.fixedPriceHalala,
    this.currency,
    this.groups,
  });

  factory CustomPremiumSaladPresetResponse.fromJson(Map<String, dynamic> json) =>
      _$CustomPremiumSaladPresetResponseFromJson(json);
  Map<String, dynamic> toJson() => _$CustomPremiumSaladPresetResponseToJson(this);
}

@JsonSerializable()
class CustomPremiumSaladGroupRuleResponse {
  @JsonKey(name: "key")
  String? key;
  @JsonKey(name: "minSelect")
  int? minSelect;
  @JsonKey(name: "maxSelect")
  int? maxSelect;

  CustomPremiumSaladGroupRuleResponse({
    this.key,
    this.minSelect,
    this.maxSelect,
  });

  factory CustomPremiumSaladGroupRuleResponse.fromJson(
    Map<String, dynamic> json,
  ) => _$CustomPremiumSaladGroupRuleResponseFromJson(json);
  Map<String, dynamic> toJson() => _$CustomPremiumSaladGroupRuleResponseToJson(this);
}

@JsonSerializable()
class CustomPremiumSaladIngredientResponse {
  @JsonKey(name: "id")
  String? id;
  @JsonKey(name: "groupKey")
  String? groupKey;
  @JsonKey(name: "name")
  String? name;
  @JsonKey(name: "calories")
  int? calories;

  CustomPremiumSaladIngredientResponse({
    this.id,
    this.groupKey,
    this.name,
    this.calories,
  });

  factory CustomPremiumSaladIngredientResponse.fromJson(
    Map<String, dynamic> json,
  ) => _$CustomPremiumSaladIngredientResponseFromJson(json);
  Map<String, dynamic> toJson() => _$CustomPremiumSaladIngredientResponseToJson(this);
}

@JsonSerializable()
class BuilderCategoryResponse {
  @JsonKey(name: "id")
  String? id;
  @JsonKey(name: "key")
  String? key;
  @JsonKey(name: "dimension")
  String? dimension;
  @JsonKey(name: "name")
  String? name;
  @JsonKey(name: "description")
  String? description;
  @JsonKey(name: "sortOrder")
  int? sortOrder;
  @JsonKey(name: "rules")
  dynamic rules;

  BuilderCategoryResponse({
    this.id,
    this.key,
    this.dimension,
    this.name,
    this.description,
    this.sortOrder,
    this.rules,
  });

  factory BuilderCategoryResponse.fromJson(Map<String, dynamic> json) =>
      _$BuilderCategoryResponseFromJson(json);
  Map<String, dynamic> toJson() => _$BuilderCategoryResponseToJson(this);
}

@JsonSerializable()
class BuilderProteinResponse {
  @JsonKey(name: "id")
  String? id;
  @JsonKey(name: "displayCategoryId")
  String? displayCategoryId;
  @JsonKey(name: "displayCategoryKey")
  String? displayCategoryKey;
  @JsonKey(name: "name")
  String? name;
  @JsonKey(name: "description")
  String? description;
  @JsonKey(name: "proteinFamilyKey")
  String? proteinFamilyKey;
  @JsonKey(name: "ruleTags")
  List<String>? ruleTags;
  @JsonKey(name: "isPremium")
  bool? isPremium;
  @JsonKey(name: "premiumCreditCost")
  int? premiumCreditCost;
  @JsonKey(name: "extraFeeHalala")
  int? extraFeeHalala;
  @JsonKey(name: "currency")
  String? currency;
  @JsonKey(name: "sortOrder")
  int? sortOrder;

  BuilderProteinResponse({
    this.id,
    this.displayCategoryId,
    this.displayCategoryKey,
    this.name,
    this.description,
    this.proteinFamilyKey,
    this.ruleTags,
    this.isPremium,
    this.premiumCreditCost,
    this.extraFeeHalala,
    this.currency,
    this.sortOrder,
  });

  factory BuilderProteinResponse.fromJson(Map<String, dynamic> json) =>
      _$BuilderProteinResponseFromJson(json);
  Map<String, dynamic> toJson() => _$BuilderProteinResponseToJson(this);
}

@JsonSerializable()
class BuilderCarbResponse {
  @JsonKey(name: "id")
  String? id;
  @JsonKey(name: "displayCategoryId")
  String? displayCategoryId;
  @JsonKey(name: "displayCategoryKey")
  String? displayCategoryKey;
  @JsonKey(name: "name")
  String? name;
  @JsonKey(name: "description")
  String? description;
  @JsonKey(name: "sortOrder")
  int? sortOrder;

  BuilderCarbResponse({
    this.id,
    this.displayCategoryId,
    this.displayCategoryKey,
    this.name,
    this.description,
    this.sortOrder,
  });

  factory BuilderCarbResponse.fromJson(Map<String, dynamic> json) =>
      _$BuilderCarbResponseFromJson(json);
  Map<String, dynamic> toJson() => _$BuilderCarbResponseToJson(this);
}

@JsonSerializable()
class BuilderRulesResponse {
  @JsonKey(name: "version")
  String? version;
  @JsonKey(name: "beef")
  BeefRuleResponse? beef;

  BuilderRulesResponse({this.version, this.beef});

  factory BuilderRulesResponse.fromJson(Map<String, dynamic> json) =>
      _$BuilderRulesResponseFromJson(json);
  Map<String, dynamic> toJson() => _$BuilderRulesResponseToJson(this);
}

@JsonSerializable()
class BeefRuleResponse {
  @JsonKey(name: "proteinFamilyKey")
  String? proteinFamilyKey;
  @JsonKey(name: "maxSlotsPerDay")
  int? maxSlotsPerDay;

  BeefRuleResponse({this.proteinFamilyKey, this.maxSlotsPerDay});

  factory BeefRuleResponse.fromJson(Map<String, dynamic> json) =>
      _$BeefRuleResponseFromJson(json);
  Map<String, dynamic> toJson() => _$BeefRuleResponseToJson(this);
}
