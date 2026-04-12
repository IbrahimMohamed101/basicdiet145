// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'bulk_selections_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

BulkSelectionsRequest _$BulkSelectionsRequestFromJson(
  Map<String, dynamic> json,
) => BulkSelectionsRequest(
  days: (json['days'] as List<dynamic>)
      .map((e) => BulkSelectionDayRequest.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$BulkSelectionsRequestToJson(
  BulkSelectionsRequest instance,
) => <String, dynamic>{'days': instance.days};

BulkSelectionDayRequest _$BulkSelectionDayRequestFromJson(
  Map<String, dynamic> json,
) => BulkSelectionDayRequest(
  date: json['date'] as String,
  selections: (json['selections'] as List<dynamic>)
      .map((e) => e as String)
      .toList(),
  premiumSelections: (json['premiumSelections'] as List<dynamic>)
      .map((e) => e as String)
      .toList(),
  addonsOneTime: (json['addonsOneTime'] as List<dynamic>)
      .map((e) => e as String)
      .toList(),
);

Map<String, dynamic> _$BulkSelectionDayRequestToJson(
  BulkSelectionDayRequest instance,
) => <String, dynamic>{
  'date': instance.date,
  'selections': instance.selections,
  'premiumSelections': instance.premiumSelections,
  'addonsOneTime': instance.addonsOneTime,
};
