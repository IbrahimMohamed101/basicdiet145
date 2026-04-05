// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'freeze_subscription_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

FreezeSubscriptionRequest _$FreezeSubscriptionRequestFromJson(
  Map<String, dynamic> json,
) => FreezeSubscriptionRequest(
  json['startDate'] as String,
  (json['days'] as num).toInt(),
);

Map<String, dynamic> _$FreezeSubscriptionRequestToJson(
  FreezeSubscriptionRequest instance,
) => <String, dynamic>{'startDate': instance.startDate, 'days': instance.days};
