// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'bulk_selections_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

BulkSelectionsRequest _$BulkSelectionsRequestFromJson(
  Map<String, dynamic> json,
) => BulkSelectionsRequest(
  days:
      (json['days'] as List<dynamic>)
          .map(
            (e) => BulkSelectionDayRequest.fromJson(e as Map<String, dynamic>),
          )
          .toList(),
);

Map<String, dynamic> _$BulkSelectionsRequestToJson(
  BulkSelectionsRequest instance,
) => <String, dynamic>{'days': instance.days};

BulkSelectionDayRequest _$BulkSelectionDayRequestFromJson(
  Map<String, dynamic> json,
) => BulkSelectionDayRequest(
  date: json['date'] as String,
  mealSlots:
      (json['mealSlots'] as List<dynamic>)
          .map((e) => MealSlotRequest.fromJson(e as Map<String, dynamic>))
          .toList(),
);

Map<String, dynamic> _$BulkSelectionDayRequestToJson(
  BulkSelectionDayRequest instance,
) => <String, dynamic>{'date': instance.date, 'mealSlots': instance.mealSlots};

MealSlotRequest _$MealSlotRequestFromJson(Map<String, dynamic> json) =>
    MealSlotRequest(
      slotIndex: (json['slotIndex'] as num).toInt(),
      slotKey: json['slotKey'] as String,
      proteinId: json['proteinId'] as String?,
      carbId: json['carbId'] as String?,
    );

Map<String, dynamic> _$MealSlotRequestToJson(MealSlotRequest instance) =>
    <String, dynamic>{
      'slotIndex': instance.slotIndex,
      'slotKey': instance.slotKey,
      'proteinId': instance.proteinId,
      'carbId': instance.carbId,
    };
