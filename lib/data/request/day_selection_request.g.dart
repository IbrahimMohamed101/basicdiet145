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
      slotKey: json['slotKey'] as String?,
      selectionType: json['selectionType'] as String?,
      sandwichId: json['sandwichId'] as String?,
      customSalad:
          json['customSalad'] == null
              ? null
              : CustomSaladRequest.fromJson(
                json['customSalad'] as Map<String, dynamic>,
              ),
    );

Map<String, dynamic> _$MealSlotRequestToJson(MealSlotRequest instance) =>
    <String, dynamic>{
      'slotIndex': instance.slotIndex,
      'proteinId': instance.proteinId,
      'carbId': instance.carbId,
      'slotKey': instance.slotKey,
      'selectionType': instance.selectionType,
      'sandwichId': instance.sandwichId,
      'customSalad': instance.customSalad,
    };

CustomSaladRequest _$CustomSaladRequestFromJson(
  Map<String, dynamic> json,
) => CustomSaladRequest(
  presetKey: json['presetKey'] as String,
  vegetables:
      (json['vegetables'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList() ??
      const [],
  addons:
      (json['addons'] as List<dynamic>?)?.map((e) => e as String).toList() ??
      const [],
  fruits:
      (json['fruits'] as List<dynamic>?)?.map((e) => e as String).toList() ??
      const [],
  nuts:
      (json['nuts'] as List<dynamic>?)?.map((e) => e as String).toList() ??
      const [],
  sauce:
      (json['sauce'] as List<dynamic>?)?.map((e) => e as String).toList() ??
      const [],
);

Map<String, dynamic> _$CustomSaladRequestToJson(CustomSaladRequest instance) =>
    <String, dynamic>{
      'presetKey': instance.presetKey,
      'vegetables': instance.vegetables,
      'addons': instance.addons,
      'fruits': instance.fruits,
      'nuts': instance.nuts,
      'sauce': instance.sauce,
    };
