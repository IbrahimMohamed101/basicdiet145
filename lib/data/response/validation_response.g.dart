// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'validation_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ValidationResponse _$ValidationResponseFromJson(Map<String, dynamic> json) =>
    ValidationResponse(
      json['valid'] as bool,
      (json['mealSlots'] as List<dynamic>?)
          ?.map((e) => MealSlotResponse.fromJson(e as Map<String, dynamic>))
          .toList(),
      json['plannerMeta'] == null
          ? null
          : PlannerMetaResponse.fromJson(
            json['plannerMeta'] as Map<String, dynamic>,
          ),
      json['paymentRequirement'] == null
          ? null
          : PaymentRequirementResponse.fromJson(
            json['paymentRequirement'] as Map<String, dynamic>,
          ),
      (json['slotErrors'] as List<dynamic>?)
          ?.map((e) => SlotErrorResponse.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$ValidationResponseToJson(ValidationResponse instance) =>
    <String, dynamic>{
      'valid': instance.valid,
      'mealSlots': instance.mealSlots,
      'plannerMeta': instance.plannerMeta,
      'paymentRequirement': instance.paymentRequirement,
      'slotErrors': instance.slotErrors,
    };

SlotErrorResponse _$SlotErrorResponseFromJson(Map<String, dynamic> json) =>
    SlotErrorResponse(
      (json['slotIndex'] as num).toInt(),
      json['field'] as String,
      json['code'] as String,
      json['message'] as String,
    );

Map<String, dynamic> _$SlotErrorResponseToJson(SlotErrorResponse instance) =>
    <String, dynamic>{
      'slotIndex': instance.slotIndex,
      'field': instance.field,
      'code': instance.code,
      'message': instance.message,
    };
