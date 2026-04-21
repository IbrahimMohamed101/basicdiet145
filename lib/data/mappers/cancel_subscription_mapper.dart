import 'package:basic_diet/app/constants.dart';
import 'package:basic_diet/app/extensions.dart';
import 'package:basic_diet/data/response/cancel_subscription_response.dart';
import 'package:basic_diet/domain/model/cancel_subscription_model.dart';

extension CancelSubscriptionResponseMapper on CancelSubscriptionResponse? {
  CancelSubscriptionModel toDomain() {
    return CancelSubscriptionModel(
      id: this?.data?.id?.orEmpty() ?? Constants.empty,
      status: this?.data?.status?.orEmpty() ?? Constants.empty,
      canceledAt: this?.data?.canceledAt?.orEmpty() ?? Constants.empty,
    );
  }
}
