// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'freeze_subscription_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

FreezePolicyResponse _$FreezePolicyResponseFromJson(
  Map<String, dynamic> json,
) => FreezePolicyResponse(
  json['enabled'] as bool?,
  (json['maxDays'] as num?)?.toInt(),
  (json['maxTimes'] as num?)?.toInt(),
);

Map<String, dynamic> _$FreezePolicyResponseToJson(
  FreezePolicyResponse instance,
) => <String, dynamic>{
  'enabled': instance.enabled,
  'maxDays': instance.maxDays,
  'maxTimes': instance.maxTimes,
};

FreezeSubscriptionDataResponse _$FreezeSubscriptionDataResponseFromJson(
  Map<String, dynamic> json,
) => FreezeSubscriptionDataResponse(
  json['subscriptionId'] as String?,
  (json['frozenDates'] as List<dynamic>?)?.map((e) => e as String).toList(),
  (json['newlyFrozenDates'] as List<dynamic>?)
      ?.map((e) => e as String)
      .toList(),
  (json['alreadyFrozen'] as List<dynamic>?)?.map((e) => e as String).toList(),
  (json['frozenDaysTotal'] as num?)?.toInt(),
  json['validityEndDate'] as String?,
  json['freezePolicy'] == null
      ? null
      : FreezePolicyResponse.fromJson(
          json['freezePolicy'] as Map<String, dynamic>,
        ),
);

Map<String, dynamic> _$FreezeSubscriptionDataResponseToJson(
  FreezeSubscriptionDataResponse instance,
) => <String, dynamic>{
  'subscriptionId': instance.subscriptionId,
  'frozenDates': instance.frozenDates,
  'newlyFrozenDates': instance.newlyFrozenDates,
  'alreadyFrozen': instance.alreadyFrozen,
  'frozenDaysTotal': instance.frozenDaysTotal,
  'validityEndDate': instance.validityEndDate,
  'freezePolicy': instance.freezePolicy,
};

FreezeSubscriptionResponse _$FreezeSubscriptionResponseFromJson(
  Map<String, dynamic> json,
) =>
    FreezeSubscriptionResponse(
        json['data'] == null
            ? null
            : FreezeSubscriptionDataResponse.fromJson(
                json['data'] as Map<String, dynamic>,
              ),
      )
      ..status = json['status'] as bool?
      ..message = json['message'] as String?;

Map<String, dynamic> _$FreezeSubscriptionResponseToJson(
  FreezeSubscriptionResponse instance,
) => <String, dynamic>{
  'status': instance.status,
  'message': instance.message,
  'data': instance.data,
};
