import 'package:json_annotation/json_annotation.dart';

part 'checkout_draft_response.g.dart';

@JsonSerializable(explicitToJson: true)
class CheckoutDraftResponse {
  @JsonKey(name: 'status')
  dynamic status;
  @JsonKey(name: 'message')
  String? message;
  @JsonKey(name: 'data')
  CheckoutDraftDataResponse? data;

  CheckoutDraftResponse({this.status, this.message, this.data});

  factory CheckoutDraftResponse.fromJson(Map<String, dynamic> json) =>
      _$CheckoutDraftResponseFromJson(json);

  Map<String, dynamic> toJson() => _$CheckoutDraftResponseToJson(this);
}

@JsonSerializable(explicitToJson: true)
class CheckoutDraftDataResponse {
  @JsonKey(name: 'subscriptionId')
  String? subscriptionId;
  @JsonKey(name: 'draftId')
  String? draftId;
  @JsonKey(name: 'paymentId')
  String? paymentId;
  @JsonKey(name: 'payment_url')
  String? paymentUrl;
  @JsonKey(name: 'providerInvoiceId')
  String? invoiceId;
  @JsonKey(name: 'checkoutStatusLabel')
  String? checkoutStatusLabel;
  @JsonKey(name: 'paymentStatusLabel')
  String? paymentStatusLabel;
  @JsonKey(name: 'checkedProvider')
  bool? checkedProvider;

  CheckoutDraftDataResponse({
    this.subscriptionId,
    this.draftId,
    this.paymentId,
    this.paymentUrl,
    this.invoiceId,
    this.checkoutStatusLabel,
    this.paymentStatusLabel,
    this.checkedProvider,
  });

  factory CheckoutDraftDataResponse.fromJson(Map<String, dynamic> json) =>
      _$CheckoutDraftDataResponseFromJson(json);

  Map<String, dynamic> toJson() => _$CheckoutDraftDataResponseToJson(this);
}
