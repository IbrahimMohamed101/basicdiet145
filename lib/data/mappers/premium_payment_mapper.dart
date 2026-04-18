import 'package:basic_diet/app/constants.dart';
import 'package:basic_diet/data/response/premium_payment_response.dart';
import 'package:basic_diet/domain/model/premium_payment_model.dart';

extension PremiumPaymentResponseMapper on PremiumPaymentResponse? {
  PremiumPaymentModel toDomain() {
    return PremiumPaymentModel(
      paymentId: this?.paymentId ?? Constants.empty,
      paymentUrl: this?.paymentUrl ?? Constants.empty,
      amountHalala: this?.amountHalala ?? Constants.zero,
      currency: this?.currency ?? Constants.empty,
      reused: this?.reused ?? false,
    );
  }
}

extension PremiumPaymentVerificationResponseMapper on PremiumPaymentVerificationResponse? {
  PremiumPaymentVerificationModel toDomain() {
    return PremiumPaymentVerificationModel(
      paymentStatus: this?.paymentStatus ?? Constants.empty,
      message: this?.message ?? Constants.empty,
    );
  }
}
