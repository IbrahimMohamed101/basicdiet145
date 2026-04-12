// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'timeline_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

TimelineDayResponse _$TimelineDayResponseFromJson(Map<String, dynamic> json) =>
    TimelineDayResponse(
      json['date'] as String?,
      json['day'] as String?,
      json['month'] as String?,
      (json['dayNumber'] as num?)?.toInt(),
      json['status'] as String?,
      (json['selectedMeals'] as num?)?.toInt(),
      (json['requiredMeals'] as num?)?.toInt(),
    );

Map<String, dynamic> _$TimelineDayResponseToJson(
  TimelineDayResponse instance,
) => <String, dynamic>{
  'date': instance.date,
  'day': instance.day,
  'month': instance.month,
  'dayNumber': instance.dayNumber,
  'status': instance.status,
  'selectedMeals': instance.selectedMeals,
  'requiredMeals': instance.requiredMeals,
};

TimelineDataResponse _$TimelineDataResponseFromJson(
  Map<String, dynamic> json,
) => TimelineDataResponse(
  json['subscriptionId'] as String?,
  (json['dailyMealsRequired'] as num?)?.toInt(),
  (json['days'] as List<dynamic>?)
      ?.map((e) => TimelineDayResponse.fromJson(e as Map<String, dynamic>))
      .toList(),
  (json['premiumMealsRemaining'] as num?)?.toInt(),
);

Map<String, dynamic> _$TimelineDataResponseToJson(
  TimelineDataResponse instance,
) => <String, dynamic>{
  'subscriptionId': instance.subscriptionId,
  'dailyMealsRequired': instance.dailyMealsRequired,
  'days': instance.days,
  'premiumMealsRemaining': instance.premiumMealsRemaining,
};

TimelineResponse _$TimelineResponseFromJson(Map<String, dynamic> json) =>
    TimelineResponse(
        json['data'] == null
            ? null
            : TimelineDataResponse.fromJson(
                json['data'] as Map<String, dynamic>,
              ),
      )
      ..status = json['status']
      ..message = json['message'] as String?;

Map<String, dynamic> _$TimelineResponseToJson(TimelineResponse instance) =>
    <String, dynamic>{
      'status': instance.status,
      'message': instance.message,
      'data': instance.data,
    };
