// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'checkout_draft_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CheckoutDraftResponse _$CheckoutDraftResponseFromJson(
  Map<String, dynamic> json,
) => CheckoutDraftResponse(
  status: json['status'],
  message: json['message'] as String?,
  data:
      json['data'] == null
          ? null
          : CheckoutDraftDataResponse.fromJson(
            json['data'] as Map<String, dynamic>,
          ),
);

Map<String, dynamic> _$CheckoutDraftResponseToJson(
  CheckoutDraftResponse instance,
) => <String, dynamic>{
  'status': instance.status,
  'message': instance.message,
  'data': instance.data?.toJson(),
};

CheckoutDraftDataResponse _$CheckoutDraftDataResponseFromJson(
  Map<String, dynamic> json,
) => CheckoutDraftDataResponse(
  subscriptionId: json['subscriptionId'] as String?,
  draftId: json['draftId'] as String?,
  paymentId: json['paymentId'] as String?,
  paymentUrl: json['payment_url'] as String?,
  invoiceId: json['providerInvoiceId'] as String?,
  checkoutStatusLabel: json['checkoutStatusLabel'] as String?,
  paymentStatusLabel: json['paymentStatusLabel'] as String?,
  checkedProvider: json['checkedProvider'] as bool?,
);

Map<String, dynamic> _$CheckoutDraftDataResponseToJson(
  CheckoutDraftDataResponse instance,
) => <String, dynamic>{
  'subscriptionId': instance.subscriptionId,
  'draftId': instance.draftId,
  'paymentId': instance.paymentId,
  'payment_url': instance.paymentUrl,
  'providerInvoiceId': instance.invoiceId,
  'checkoutStatusLabel': instance.checkoutStatusLabel,
  'paymentStatusLabel': instance.paymentStatusLabel,
  'checkedProvider': instance.checkedProvider,
};
