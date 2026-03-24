// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'addons_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AddOnsResponse _$AddOnsResponseFromJson(Map<String, dynamic> json) =>
    AddOnsResponse(
      json['status'] as bool?,
      json['message'] as String?,
      (json['data'] as List<dynamic>?)
          ?.map((e) => AddOnResponse.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$AddOnsResponseToJson(AddOnsResponse instance) =>
    <String, dynamic>{
      'status': instance.status,
      'message': instance.message,
      'data': instance.data,
    };

AddOnResponse _$AddOnResponseFromJson(Map<String, dynamic> json) =>
    AddOnResponse(
      json['id'] as String?,
      json['name'] as String?,
      json['description'] as String?,
      json['imageUrl'] as String?,
      json['currency'] as String?,
      (json['priceHalala'] as num?)?.toInt(),
      (json['priceSar'] as num?)?.toDouble(),
      json['priceLabel'] as String?,
      json['type'] as String?,
      json['ui'] == null
          ? null
          : AddOnUiResponse.fromJson(json['ui'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$AddOnResponseToJson(AddOnResponse instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'description': instance.description,
      'imageUrl': instance.imageUrl,
      'currency': instance.currency,
      'priceHalala': instance.priceHalala,
      'priceSar': instance.priceSar,
      'priceLabel': instance.priceLabel,
      'type': instance.type,
      'ui': instance.ui,
    };

AddOnUiResponse _$AddOnUiResponseFromJson(Map<String, dynamic> json) =>
    AddOnUiResponse(
      json['title'] as String?,
      json['subtitle'] as String?,
      json['ctaLabel'] as String?,
      json['badge'] as String?,
    );

Map<String, dynamic> _$AddOnUiResponseToJson(AddOnUiResponse instance) =>
    <String, dynamic>{
      'title': instance.title,
      'subtitle': instance.subtitle,
      'ctaLabel': instance.ctaLabel,
      'badge': instance.badge,
    };
