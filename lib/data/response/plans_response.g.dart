// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'plans_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PlansResponse _$PlansResponseFromJson(Map<String, dynamic> json) =>
    PlansResponse(
      status: json['status'] as bool?,
      data: (json['data'] as List<dynamic>?)
          ?.map((e) => PlanResponse.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$PlansResponseToJson(PlansResponse instance) =>
    <String, dynamic>{'status': instance.status, 'data': instance.data};

PlanResponse _$PlanResponseFromJson(Map<String, dynamic> json) => PlanResponse(
  id: json['id'] as String?,
  name: json['name'] as String?,
  daysCount: (json['daysCount'] as num?)?.toInt(),
  currency: json['currency'] as String?,
  isActive: json['isActive'] as bool?,
  gramsOptions: (json['gramsOptions'] as List<dynamic>?)
      ?.map((e) => GramOptionResponse.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$PlanResponseToJson(PlanResponse instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'daysCount': instance.daysCount,
      'currency': instance.currency,
      'isActive': instance.isActive,
      'gramsOptions': instance.gramsOptions,
    };

GramOptionResponse _$GramOptionResponseFromJson(Map<String, dynamic> json) =>
    GramOptionResponse(
      grams: (json['grams'] as num?)?.toInt(),
      mealsOptions: (json['mealsOptions'] as List<dynamic>?)
          ?.map((e) => MealOptionResponse.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$GramOptionResponseToJson(GramOptionResponse instance) =>
    <String, dynamic>{
      'grams': instance.grams,
      'mealsOptions': instance.mealsOptions,
    };

MealOptionResponse _$MealOptionResponseFromJson(Map<String, dynamic> json) =>
    MealOptionResponse(
      mealsPerDay: (json['mealsPerDay'] as num?)?.toInt(),
      priceSar: (json['priceSar'] as num?)?.toDouble(),
      compareAtSar: (json['compareAtSar'] as num?)?.toDouble(),
    );

Map<String, dynamic> _$MealOptionResponseToJson(MealOptionResponse instance) =>
    <String, dynamic>{
      'mealsPerDay': instance.mealsPerDay,
      'priceSar': instance.priceSar,
      'compareAtSar': instance.compareAtSar,
    };
