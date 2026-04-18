class PremiumPaymentModel {
  final String paymentId;
  final String paymentUrl;
  final int amountHalala;
  final String currency;
  final bool reused;

  PremiumPaymentModel({
    required this.paymentId,
    required this.paymentUrl,
    required this.amountHalala,
    required this.currency,
    required this.reused,
  });
}

class PremiumPaymentVerificationModel {
  final String paymentStatus;
  final String message;

  PremiumPaymentVerificationModel({
    required this.paymentStatus,
    required this.message,
  });
}
