// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'categories_with_meals_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CategoriesWithMealsResponse _$CategoriesWithMealsResponseFromJson(
  Map<String, dynamic> json,
) => CategoriesWithMealsResponse(
  status: json['status'] as bool?,
  data: (json['data'] as List<dynamic>?)
      ?.map(
        (e) => CategoryWithMealsResponse.fromJson(e as Map<String, dynamic>),
      )
      .toList(),
);

Map<String, dynamic> _$CategoriesWithMealsResponseToJson(
  CategoriesWithMealsResponse instance,
) => <String, dynamic>{'status': instance.status, 'data': instance.data};

CategoryWithMealsResponse _$CategoryWithMealsResponseFromJson(
  Map<String, dynamic> json,
) => CategoryWithMealsResponse(
  id: json['id'] as String?,
  name: json['name'] as String?,
  slug: json['slug'] as String?,
  sortOrder: (json['sortOrder'] as num?)?.toInt(),
  meals: (json['meals'] as List<dynamic>?)
      ?.map((e) => MealItemResponse.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$CategoryWithMealsResponseToJson(
  CategoryWithMealsResponse instance,
) => <String, dynamic>{
  'id': instance.id,
  'name': instance.name,
  'slug': instance.slug,
  'sortOrder': instance.sortOrder,
  'meals': instance.meals,
};

MealItemResponse _$MealItemResponseFromJson(Map<String, dynamic> json) =>
    MealItemResponse(
      id: json['id'] as String?,
      name: json['name'] as String?,
      description: json['description'] as String?,
      imageUrl: json['imageUrl'] as String?,
      price: (json['price'] as num?)?.toDouble(),
      calories: (json['calories'] as num?)?.toInt(),
      proteinGrams: (json['proteinGrams'] as num?)?.toInt(),
      carbGrams: (json['carbGrams'] as num?)?.toInt(),
      fatGrams: (json['fatGrams'] as num?)?.toInt(),
      availableForOrder: json['availableForOrder'] as bool?,
      availableForSubscription: json['availableForSubscription'] as bool?,
      type: json['type'] as String?,
      sortOrder: (json['sortOrder'] as num?)?.toInt(),
    );

Map<String, dynamic> _$MealItemResponseToJson(MealItemResponse instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'description': instance.description,
      'imageUrl': instance.imageUrl,
      'price': instance.price,
      'calories': instance.calories,
      'proteinGrams': instance.proteinGrams,
      'carbGrams': instance.carbGrams,
      'fatGrams': instance.fatGrams,
      'availableForOrder': instance.availableForOrder,
      'availableForSubscription': instance.availableForSubscription,
      'type': instance.type,
      'sortOrder': instance.sortOrder,
    };
