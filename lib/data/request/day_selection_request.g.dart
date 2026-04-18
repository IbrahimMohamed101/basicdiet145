// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'day_selection_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DaySelectionRequest _$DaySelectionRequestFromJson(Map<String, dynamic> json) =>
    DaySelectionRequest(
      (json['mealSlots'] as List<dynamic>)
          .map((e) => MealSlotRequest.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$DaySelectionRequestToJson(
  DaySelectionRequest instance,
) => <String, dynamic>{'mealSlots': instance.mealSlots};

MealSlotRequest _$MealSlotRequestFromJson(Map<String, dynamic> json) =>
    MealSlotRequest(
      (json['slotIndex'] as num).toInt(),
      json['slotKey'] as String,
      json['proteinId'] as String?,
      json['carbId'] as String?,
    );

Map<String, dynamic> _$MealSlotRequestToJson(MealSlotRequest instance) =>
    <String, dynamic>{
      'slotIndex': instance.slotIndex,
      'slotKey': instance.slotKey,
      'proteinId': instance.proteinId,
      'carbId': instance.carbId,
    };
