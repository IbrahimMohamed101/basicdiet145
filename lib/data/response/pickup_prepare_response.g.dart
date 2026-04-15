// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'pickup_prepare_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PickupPrepareDataResponse _$PickupPrepareDataResponseFromJson(
  Map<String, dynamic> json,
) => PickupPrepareDataResponse(
  json['subscriptionId'] as String?,
  json['date'] as String?,
  (json['currentStep'] as num?)?.toInt(),
  json['status'] as String?,
  json['statusLabel'] as String?,
  json['message'] as String?,
  json['pickupRequested'] as bool?,
  json['nextAction'] as String?,
);

Map<String, dynamic> _$PickupPrepareDataResponseToJson(
  PickupPrepareDataResponse instance,
) => <String, dynamic>{
  'subscriptionId': instance.subscriptionId,
  'date': instance.date,
  'currentStep': instance.currentStep,
  'status': instance.status,
  'statusLabel': instance.statusLabel,
  'message': instance.message,
  'pickupRequested': instance.pickupRequested,
  'nextAction': instance.nextAction,
};

PickupPrepareResponse _$PickupPrepareResponseFromJson(
  Map<String, dynamic> json,
) => PickupPrepareResponse(
  json['status'] as bool?,
  json['data'] == null
      ? null
      : PickupPrepareDataResponse.fromJson(
        json['data'] as Map<String, dynamic>,
      ),
);

Map<String, dynamic> _$PickupPrepareResponseToJson(
  PickupPrepareResponse instance,
) => <String, dynamic>{'status': instance.status, 'data': instance.data};
