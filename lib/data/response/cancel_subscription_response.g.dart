// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'cancel_subscription_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CancelSubscriptionDataResponse _$CancelSubscriptionDataResponseFromJson(
  Map<String, dynamic> json,
) => CancelSubscriptionDataResponse(
  id: json['_id'] as String?,
  status: json['status'] as String?,
  canceledAt: json['canceledAt'] as String?,
);

Map<String, dynamic> _$CancelSubscriptionDataResponseToJson(
  CancelSubscriptionDataResponse instance,
) => <String, dynamic>{
  '_id': instance.id,
  'status': instance.status,
  'canceledAt': instance.canceledAt,
};

CancelSubscriptionResponse _$CancelSubscriptionResponseFromJson(
  Map<String, dynamic> json,
) =>
    CancelSubscriptionResponse(
        data:
            json['data'] == null
                ? null
                : CancelSubscriptionDataResponse.fromJson(
                  json['data'] as Map<String, dynamic>,
                ),
      )
      ..status = json['status']
      ..message = json['message'] as String?;

Map<String, dynamic> _$CancelSubscriptionResponseToJson(
  CancelSubscriptionResponse instance,
) => <String, dynamic>{
  'status': instance.status,
  'message': instance.message,
  'data': instance.data,
};
