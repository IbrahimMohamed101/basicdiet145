// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'premium_payment_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PremiumPaymentResponse _$PremiumPaymentResponseFromJson(
  Map<String, dynamic> json,
) => PremiumPaymentResponse(
  paymentId: json['paymentId'] as String?,
  paymentUrl: json['paymentUrl'] as String?,
  amountHalala: (json['amountHalala'] as num?)?.toInt(),
  currency: json['currency'] as String?,
  reused: json['reused'] as bool?,
);

Map<String, dynamic> _$PremiumPaymentResponseToJson(
  PremiumPaymentResponse instance,
) => <String, dynamic>{
  'paymentId': instance.paymentId,
  'paymentUrl': instance.paymentUrl,
  'amountHalala': instance.amountHalala,
  'currency': instance.currency,
  'reused': instance.reused,
};

PremiumPaymentVerificationResponse _$PremiumPaymentVerificationResponseFromJson(
  Map<String, dynamic> json,
) => PremiumPaymentVerificationResponse(
  paymentStatus: json['paymentStatus'] as String?,
  message: json['message'] as String?,
);

Map<String, dynamic> _$PremiumPaymentVerificationResponseToJson(
  PremiumPaymentVerificationResponse instance,
) => <String, dynamic>{
  'paymentStatus': instance.paymentStatus,
  'message': instance.message,
};
