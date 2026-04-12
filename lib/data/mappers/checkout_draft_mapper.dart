import 'package:basic_diet/app/extensions.dart';
import 'package:basic_diet/data/response/checkout_draft_response.dart';
import 'package:basic_diet/domain/model/checkout_draft_model.dart';

extension CheckoutDraftDataResponseMapper on CheckoutDraftDataResponse? {
  CheckoutDraftModel toDomain() {
    return CheckoutDraftModel(
      subscriptionId: this?.subscriptionId,
      draftId: this?.draftId?.orEmpty() ?? '',
      paymentId: this?.paymentId?.orEmpty() ?? '',
      paymentUrl: this?.paymentUrl?.orEmpty() ?? '',
      invoiceId: this?.invoiceId?.orEmpty() ?? '',
      checkoutStatusLabel: this?.checkoutStatusLabel?.orEmpty() ?? '',
      paymentStatusLabel: this?.paymentStatusLabel?.orEmpty() ?? '',
      checkedProvider: this?.checkedProvider ?? false,
    );
  }
}

extension CheckoutDraftResponseMapper on CheckoutDraftResponse? {
  CheckoutDraftModel toDomain() {
    return this?.data.toDomain() ??
        const CheckoutDraftModel(
          subscriptionId: null,
          draftId: '',
          paymentId: '',
          paymentUrl: '',
          invoiceId: '',
          checkoutStatusLabel: '',
          paymentStatusLabel: '',
          checkedProvider: false,
        );
  }
}
