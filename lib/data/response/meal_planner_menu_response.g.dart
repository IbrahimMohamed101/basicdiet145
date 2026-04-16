// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'meal_planner_menu_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MealPlannerMenuResponse _$MealPlannerMenuResponseFromJson(
  Map<String, dynamic> json,
) => MealPlannerMenuResponse(
  status: MealPlannerMenuResponse._readOkOrStatus(json, 'status'),
  message: json['message'] as String?,
  data:
      json['data'] == null
          ? null
          : MealPlannerMenuDataResponse.fromJson(
            json['data'] as Map<String, dynamic>,
          ),
);

Map<String, dynamic> _$MealPlannerMenuResponseToJson(
  MealPlannerMenuResponse instance,
) => <String, dynamic>{
  'status': instance.status,
  'message': instance.message,
  'data': instance.data,
};

MealPlannerMenuDataResponse _$MealPlannerMenuDataResponseFromJson(
  Map<String, dynamic> json,
) => MealPlannerMenuDataResponse(
  currency: json['currency'] as String?,
  builderCatalog:
      json['builderCatalog'] == null
          ? null
          : BuilderCatalogResponse.fromJson(
            json['builderCatalog'] as Map<String, dynamic>,
          ),
);

Map<String, dynamic> _$MealPlannerMenuDataResponseToJson(
  MealPlannerMenuDataResponse instance,
) => <String, dynamic>{
  'currency': instance.currency,
  'builderCatalog': instance.builderCatalog,
};

BuilderCatalogResponse _$BuilderCatalogResponseFromJson(
  Map<String, dynamic> json,
) => BuilderCatalogResponse(
  categories:
      (json['categories'] as List<dynamic>?)
          ?.map(
            (e) => BuilderCategoryResponse.fromJson(e as Map<String, dynamic>),
          )
          .toList(),
  proteins:
      (json['proteins'] as List<dynamic>?)
          ?.map(
            (e) => BuilderProteinResponse.fromJson(e as Map<String, dynamic>),
          )
          .toList(),
  carbs:
      (json['carbs'] as List<dynamic>?)
          ?.map((e) => BuilderCarbResponse.fromJson(e as Map<String, dynamic>))
          .toList(),
  rules:
      json['rules'] == null
          ? null
          : BuilderRulesResponse.fromJson(
            json['rules'] as Map<String, dynamic>,
          ),
);

Map<String, dynamic> _$BuilderCatalogResponseToJson(
  BuilderCatalogResponse instance,
) => <String, dynamic>{
  'categories': instance.categories,
  'proteins': instance.proteins,
  'carbs': instance.carbs,
  'rules': instance.rules,
};

BuilderCategoryResponse _$BuilderCategoryResponseFromJson(
  Map<String, dynamic> json,
) => BuilderCategoryResponse(
  id: json['id'] as String?,
  key: json['key'] as String?,
  dimension: json['dimension'] as String?,
  name: json['name'] as String?,
  description: json['description'] as String?,
  sortOrder: (json['sortOrder'] as num?)?.toInt(),
  rules: json['rules'],
);

Map<String, dynamic> _$BuilderCategoryResponseToJson(
  BuilderCategoryResponse instance,
) => <String, dynamic>{
  'id': instance.id,
  'key': instance.key,
  'dimension': instance.dimension,
  'name': instance.name,
  'description': instance.description,
  'sortOrder': instance.sortOrder,
  'rules': instance.rules,
};

BuilderProteinResponse _$BuilderProteinResponseFromJson(
  Map<String, dynamic> json,
) => BuilderProteinResponse(
  id: json['id'] as String?,
  displayCategoryId: json['displayCategoryId'] as String?,
  displayCategoryKey: json['displayCategoryKey'] as String?,
  name: json['name'] as String?,
  description: json['description'] as String?,
  proteinFamilyKey: json['proteinFamilyKey'] as String?,
  ruleTags:
      (json['ruleTags'] as List<dynamic>?)?.map((e) => e as String).toList(),
  isPremium: json['isPremium'] as bool?,
  premiumCreditCost: (json['premiumCreditCost'] as num?)?.toInt(),
  extraFeeHalala: (json['extraFeeHalala'] as num?)?.toInt(),
  currency: json['currency'] as String?,
  sortOrder: (json['sortOrder'] as num?)?.toInt(),
);

Map<String, dynamic> _$BuilderProteinResponseToJson(
  BuilderProteinResponse instance,
) => <String, dynamic>{
  'id': instance.id,
  'displayCategoryId': instance.displayCategoryId,
  'displayCategoryKey': instance.displayCategoryKey,
  'name': instance.name,
  'description': instance.description,
  'proteinFamilyKey': instance.proteinFamilyKey,
  'ruleTags': instance.ruleTags,
  'isPremium': instance.isPremium,
  'premiumCreditCost': instance.premiumCreditCost,
  'extraFeeHalala': instance.extraFeeHalala,
  'currency': instance.currency,
  'sortOrder': instance.sortOrder,
};

BuilderCarbResponse _$BuilderCarbResponseFromJson(Map<String, dynamic> json) =>
    BuilderCarbResponse(
      id: json['id'] as String?,
      displayCategoryId: json['displayCategoryId'] as String?,
      displayCategoryKey: json['displayCategoryKey'] as String?,
      name: json['name'] as String?,
      description: json['description'] as String?,
      sortOrder: (json['sortOrder'] as num?)?.toInt(),
    );

Map<String, dynamic> _$BuilderCarbResponseToJson(
  BuilderCarbResponse instance,
) => <String, dynamic>{
  'id': instance.id,
  'displayCategoryId': instance.displayCategoryId,
  'displayCategoryKey': instance.displayCategoryKey,
  'name': instance.name,
  'description': instance.description,
  'sortOrder': instance.sortOrder,
};

BuilderRulesResponse _$BuilderRulesResponseFromJson(
  Map<String, dynamic> json,
) => BuilderRulesResponse(
  version: json['version'] as String?,
  beef:
      json['beef'] == null
          ? null
          : BeefRuleResponse.fromJson(json['beef'] as Map<String, dynamic>),
);

Map<String, dynamic> _$BuilderRulesResponseToJson(
  BuilderRulesResponse instance,
) => <String, dynamic>{'version': instance.version, 'beef': instance.beef};

BeefRuleResponse _$BeefRuleResponseFromJson(Map<String, dynamic> json) =>
    BeefRuleResponse(
      proteinFamilyKey: json['proteinFamilyKey'] as String?,
      maxSlotsPerDay: (json['maxSlotsPerDay'] as num?)?.toInt(),
    );

Map<String, dynamic> _$BeefRuleResponseToJson(BeefRuleResponse instance) =>
    <String, dynamic>{
      'proteinFamilyKey': instance.proteinFamilyKey,
      'maxSlotsPerDay': instance.maxSlotsPerDay,
    };
