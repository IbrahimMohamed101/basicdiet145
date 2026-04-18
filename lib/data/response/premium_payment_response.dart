import 'package:json_annotation/json_annotation.dart';

part 'premium_payment_response.g.dart';

@JsonSerializable()
class PremiumPaymentResponse {
  @JsonKey(name: 'paymentId')
  final String? paymentId;
  
  @JsonKey(name: 'paymentUrl')
  final String? paymentUrl;
  
  @JsonKey(name: 'amountHalala')
  final int? amountHalala;
  
  @JsonKey(name: 'currency')
  final String? currency;
  
  @JsonKey(name: 'reused')
  final bool? reused;

  PremiumPaymentResponse({
    this.paymentId,
    this.paymentUrl,
    this.amountHalala,
    this.currency,
    this.reused,
  });

  factory PremiumPaymentResponse.fromJson(Map<String, dynamic> json) =>
      _$PremiumPaymentResponseFromJson(json);

  Map<String, dynamic> toJson() => _$PremiumPaymentResponseToJson(this);
}

@JsonSerializable()
class PremiumPaymentVerificationResponse {
  @JsonKey(name: 'paymentStatus')
  final String? paymentStatus;
  
  @JsonKey(name: 'message')
  final String? message;

  PremiumPaymentVerificationResponse({
    this.paymentStatus,
    this.message,
  });

  factory PremiumPaymentVerificationResponse.fromJson(Map<String, dynamic> json) =>
      _$PremiumPaymentVerificationResponseFromJson(json);

  Map<String, dynamic> toJson() => _$PremiumPaymentVerificationResponseToJson(this);
}
