// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'pickup_status_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PickupStatusDataResponse _$PickupStatusDataResponseFromJson(
  Map<String, dynamic> json,
) => PickupStatusDataResponse(
  json['subscriptionId'] as String?,
  json['date'] as String?,
  (json['currentStep'] as num?)?.toInt(),
  json['status'] as String?,
  json['statusLabel'] as String?,
  json['message'] as String?,
  json['canModify'] as bool?,
  json['isReady'] as bool?,
  json['isCompleted'] as bool?,
  json['pickupCode'] as String?,
  json['pickupCodeIssuedAt'] as String?,
  json['fulfilledAt'] as String?,
);

Map<String, dynamic> _$PickupStatusDataResponseToJson(
  PickupStatusDataResponse instance,
) => <String, dynamic>{
  'subscriptionId': instance.subscriptionId,
  'date': instance.date,
  'currentStep': instance.currentStep,
  'status': instance.status,
  'statusLabel': instance.statusLabel,
  'message': instance.message,
  'canModify': instance.canModify,
  'isReady': instance.isReady,
  'isCompleted': instance.isCompleted,
  'pickupCode': instance.pickupCode,
  'pickupCodeIssuedAt': instance.pickupCodeIssuedAt,
  'fulfilledAt': instance.fulfilledAt,
};

PickupStatusResponse _$PickupStatusResponseFromJson(
  Map<String, dynamic> json,
) => PickupStatusResponse(
  json['status'] as bool?,
  json['data'] == null
      ? null
      : PickupStatusDataResponse.fromJson(json['data'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PickupStatusResponseToJson(
  PickupStatusResponse instance,
) => <String, dynamic>{'status': instance.status, 'data': instance.data};
