// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'skip_days_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SkipDayRequest _$SkipDayRequestFromJson(Map<String, dynamic> json) =>
    SkipDayRequest(json['date'] as String);

Map<String, dynamic> _$SkipDayRequestToJson(SkipDayRequest instance) =>
    <String, dynamic>{'date': instance.date};

SkipDateRangeRequest _$SkipDateRangeRequestFromJson(
  Map<String, dynamic> json,
) => SkipDateRangeRequest(
  json['startDate'] as String,
  json['endDate'] as String,
);

Map<String, dynamic> _$SkipDateRangeRequestToJson(
  SkipDateRangeRequest instance,
) => <String, dynamic>{
  'startDate': instance.startDate,
  'endDate': instance.endDate,
};
