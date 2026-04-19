// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'premium_payment_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PremiumPaymentResponse _$PremiumPaymentResponseFromJson(
  Map<String, dynamic> json,
) => PremiumPaymentResponse(
  status: json['status'] as bool?,
  data:
      json['data'] == null
          ? null
          : PremiumPaymentDataResponse.fromJson(
            json['data'] as Map<String, dynamic>,
          ),
);

Map<String, dynamic> _$PremiumPaymentResponseToJson(
  PremiumPaymentResponse instance,
) => <String, dynamic>{'status': instance.status, 'data': instance.data};

PremiumPaymentDataResponse _$PremiumPaymentDataResponseFromJson(
  Map<String, dynamic> json,
) => PremiumPaymentDataResponse(
  paymentId: json['paymentId'] as String?,
  paymentUrl: json['payment_url'] as String?,
  amountHalala: (json['amountHalala'] as num?)?.toInt(),
  currency: json['currency'] as String?,
  reused: json['reused'] as bool?,
);

Map<String, dynamic> _$PremiumPaymentDataResponseToJson(
  PremiumPaymentDataResponse instance,
) => <String, dynamic>{
  'paymentId': instance.paymentId,
  'payment_url': instance.paymentUrl,
  'amountHalala': instance.amountHalala,
  'currency': instance.currency,
  'reused': instance.reused,
};

PremiumPaymentVerificationResponse _$PremiumPaymentVerificationResponseFromJson(
  Map<String, dynamic> json,
) => PremiumPaymentVerificationResponse(
  status: json['status'] as bool?,
  data:
      json['data'] == null
          ? null
          : PremiumPaymentVerificationData.fromJson(
            json['data'] as Map<String, dynamic>,
          ),
);

Map<String, dynamic> _$PremiumPaymentVerificationResponseToJson(
  PremiumPaymentVerificationResponse instance,
) => <String, dynamic>{'status': instance.status, 'data': instance.data};

PremiumPaymentVerificationData _$PremiumPaymentVerificationDataFromJson(
  Map<String, dynamic> json,
) => PremiumPaymentVerificationData(
  paymentStatus: json['paymentStatus'] as String?,
  message: json['message'] as String?,
);

Map<String, dynamic> _$PremiumPaymentVerificationDataToJson(
  PremiumPaymentVerificationData instance,
) => <String, dynamic>{
  'paymentStatus': instance.paymentStatus,
  'message': instance.message,
};
