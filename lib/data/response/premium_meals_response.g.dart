// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'premium_meals_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PremiumMealsResponse _$PremiumMealsResponseFromJson(
  Map<String, dynamic> json,
) => PremiumMealsResponse(
  status: json['status'] as bool?,
  data:
      (json['data'] as List<dynamic>?)
          ?.map((e) => PremiumMealResponse.fromJson(e as Map<String, dynamic>))
          .toList(),
);

Map<String, dynamic> _$PremiumMealsResponseToJson(
  PremiumMealsResponse instance,
) => <String, dynamic>{'status': instance.status, 'data': instance.data};

PremiumMealResponse _$PremiumMealResponseFromJson(Map<String, dynamic> json) =>
    PremiumMealResponse(
      id: json['id'] as String?,
      name: json['name'] as String?,
      description: json['description'] as String?,
      imageUrl: json['imageUrl'] as String?,
      currency: json['currency'] as String?,
      extraFeeHalala: (json['extraFeeHalala'] as num?)?.toInt(),
      extraFeeSar: (json['extraFeeSar'] as num?)?.toDouble(),
      priceHalala: (json['priceHalala'] as num?)?.toInt(),
      priceSar: (json['priceSar'] as num?)?.toDouble(),
      priceLabel: json['priceLabel'] as String?,
      proteinGrams: (json['proteinGrams'] as num?)?.toInt(),
      carbGrams: (json['carbGrams'] as num?)?.toInt(),
      fatGrams: (json['fatGrams'] as num?)?.toInt(),
      ui:
          json['ui'] == null
              ? null
              : PremiumMealUiResponse.fromJson(
                json['ui'] as Map<String, dynamic>,
              ),
    );

Map<String, dynamic> _$PremiumMealResponseToJson(
  PremiumMealResponse instance,
) => <String, dynamic>{
  'id': instance.id,
  'name': instance.name,
  'description': instance.description,
  'imageUrl': instance.imageUrl,
  'currency': instance.currency,
  'extraFeeHalala': instance.extraFeeHalala,
  'extraFeeSar': instance.extraFeeSar,
  'priceHalala': instance.priceHalala,
  'priceSar': instance.priceSar,
  'priceLabel': instance.priceLabel,
  'proteinGrams': instance.proteinGrams,
  'carbGrams': instance.carbGrams,
  'fatGrams': instance.fatGrams,
  'ui': instance.ui,
};

PremiumMealUiResponse _$PremiumMealUiResponseFromJson(
  Map<String, dynamic> json,
) => PremiumMealUiResponse(
  title: json['title'] as String?,
  subtitle: json['subtitle'] as String?,
  ctaLabel: json['ctaLabel'] as String?,
  selectionStyle: json['selectionStyle'] as String?,
);

Map<String, dynamic> _$PremiumMealUiResponseToJson(
  PremiumMealUiResponse instance,
) => <String, dynamic>{
  'title': instance.title,
  'subtitle': instance.subtitle,
  'ctaLabel': instance.ctaLabel,
  'selectionStyle': instance.selectionStyle,
};
