import 'package:basic_diet/app/constants.dart';
import 'package:basic_diet/data/response/premium_payment_response.dart';
import 'package:basic_diet/domain/model/premium_payment_model.dart';

extension PremiumPaymentResponseMapper on PremiumPaymentResponse? {
  PremiumPaymentModel toDomain() {
    final data = this?.data;
    return PremiumPaymentModel(
      paymentId: data?.paymentId ?? Constants.empty,
      paymentUrl: data?.paymentUrl ?? Constants.empty,
      amountHalala: data?.amountHalala ?? Constants.zero,
      currency: data?.currency ?? Constants.empty,
      reused: data?.reused ?? false,
    );
  }
}

extension PremiumPaymentVerificationResponseMapper on PremiumPaymentVerificationResponse? {
  PremiumPaymentVerificationModel toDomain() {
    final data = this?.data;
    return PremiumPaymentVerificationModel(
      paymentStatus: data?.paymentStatus ?? Constants.empty,
      message: data?.message ?? Constants.empty,
    );
  }
}
