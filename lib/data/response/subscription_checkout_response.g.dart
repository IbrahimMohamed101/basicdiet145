// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'subscription_checkout_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SubscriptionCheckoutResponse _$SubscriptionCheckoutResponseFromJson(
  Map<String, dynamic> json,
) => SubscriptionCheckoutResponse(
  status: json['status'],
  message: json['message'] as String?,
  data:
      json['data'] == null
          ? null
          : SubscriptionCheckoutDataResponse.fromJson(
            json['data'] as Map<String, dynamic>,
          ),
);

Map<String, dynamic> _$SubscriptionCheckoutResponseToJson(
  SubscriptionCheckoutResponse instance,
) => <String, dynamic>{
  'status': instance.status,
  'message': instance.message,
  'data': instance.data?.toJson(),
};

SubscriptionCheckoutDataResponse _$SubscriptionCheckoutDataResponseFromJson(
  Map<String, dynamic> json,
) => SubscriptionCheckoutDataResponse(
  subscriptionId: json['subscriptionId'] as String?,
  draftId: json['draftId'] as String?,
  paymentId: json['paymentId'] as String?,
  paymentUrl: json['payment_url'] as String?,
  totals:
      json['totals'] == null
          ? null
          : SubscriptionCheckoutTotalsResponse.fromJson(
            json['totals'] as Map<String, dynamic>,
          ),
  reused: json['reused'] as bool?,
);

Map<String, dynamic> _$SubscriptionCheckoutDataResponseToJson(
  SubscriptionCheckoutDataResponse instance,
) => <String, dynamic>{
  'subscriptionId': instance.subscriptionId,
  'draftId': instance.draftId,
  'paymentId': instance.paymentId,
  'payment_url': instance.paymentUrl,
  'totals': instance.totals?.toJson(),
  'reused': instance.reused,
};

SubscriptionCheckoutTotalsResponse _$SubscriptionCheckoutTotalsResponseFromJson(
  Map<String, dynamic> json,
) => SubscriptionCheckoutTotalsResponse(
  basePlanPriceHalala: (json['basePlanPriceHalala'] as num?)?.toInt(),
  premiumTotalHalala: (json['premiumTotalHalala'] as num?)?.toInt(),
  addonsTotalHalala: (json['addonsTotalHalala'] as num?)?.toInt(),
  deliveryFeeHalala: (json['deliveryFeeHalala'] as num?)?.toInt(),
  vatHalala: (json['vatHalala'] as num?)?.toInt(),
  totalHalala: (json['totalHalala'] as num?)?.toInt(),
  currency: json['currency'] as String?,
);

Map<String, dynamic> _$SubscriptionCheckoutTotalsResponseToJson(
  SubscriptionCheckoutTotalsResponse instance,
) => <String, dynamic>{
  'basePlanPriceHalala': instance.basePlanPriceHalala,
  'premiumTotalHalala': instance.premiumTotalHalala,
  'addonsTotalHalala': instance.addonsTotalHalala,
  'deliveryFeeHalala': instance.deliveryFeeHalala,
  'vatHalala': instance.vatHalala,
  'totalHalala': instance.totalHalala,
  'currency': instance.currency,
};
