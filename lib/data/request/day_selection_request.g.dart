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
      addonsOneTime:
          (json['addonsOneTime'] as List<dynamic>?)
              ?.map((e) => e as String)
              .toList() ??
          const [],
    );

Map<String, dynamic> _$DaySelectionRequestToJson(
  DaySelectionRequest instance,
) => <String, dynamic>{
  'mealSlots': instance.mealSlots,
  'addonsOneTime': instance.addonsOneTime,
};

MealSlotRequest _$MealSlotRequestFromJson(Map<String, dynamic> json) =>
    MealSlotRequest(
      slotIndex: (json['slotIndex'] as num).toInt(),
      proteinId: json['proteinId'] as String?,
      carbId: json['carbId'] as String?,
    );

Map<String, dynamic> _$MealSlotRequestToJson(MealSlotRequest instance) =>
    <String, dynamic>{
      'slotIndex': instance.slotIndex,
      'proteinId': instance.proteinId,
      'carbId': instance.carbId,
    };
