// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'popular_packages_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PopularPackagesResponse _$PopularPackagesResponseFromJson(
  Map<String, dynamic> json,
) => PopularPackagesResponse(
  status: json['status'],
  data:
      (json['data'] as List<dynamic>?)
          ?.map(
            (e) => PopularPackageResponse.fromJson(e as Map<String, dynamic>),
          )
          .toList(),
);

Map<String, dynamic> _$PopularPackagesResponseToJson(
  PopularPackagesResponse instance,
) => <String, dynamic>{'status': instance.status, 'data': instance.data};

PopularPackageResponse _$PopularPackageResponseFromJson(
  Map<String, dynamic> json,
) => PopularPackageResponse(
  id: json['id'] as String?,
  planId: json['planId'] as String?,
  name: json['name'] as String?,
  daysCount: (json['daysCount'] as num?)?.toInt(),
  mealsPerDay: (json['mealsPerDay'] as num?)?.toInt(),
  grams: (json['grams'] as num?)?.toInt(),
  oldPrice: (json['oldPrice'] as num?)?.toDouble(),
  newPrice: (json['newPrice'] as num?)?.toDouble(),
  moneySave: (json['moneySave'] as num?)?.toDouble(),
  currency: json['currency'] as String?,
);

Map<String, dynamic> _$PopularPackageResponseToJson(
  PopularPackageResponse instance,
) => <String, dynamic>{
  'id': instance.id,
  'planId': instance.planId,
  'name': instance.name,
  'daysCount': instance.daysCount,
  'mealsPerDay': instance.mealsPerDay,
  'grams': instance.grams,
  'oldPrice': instance.oldPrice,
  'newPrice': instance.newPrice,
  'moneySave': instance.moneySave,
  'currency': instance.currency,
};
