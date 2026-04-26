import 'package:basic_diet/app/constants.dart';
import 'package:basic_diet/app/extensions.dart';
import 'package:basic_diet/data/response/freeze_subscription_response.dart';
import 'package:basic_diet/domain/model/freeze_subscription_model.dart';
import 'package:basic_diet/data/request/freeze_subscription_request.dart';

extension FreezeSubscriptionRequestMapper on FreezeSubscriptionRequestModel {
  FreezeSubscriptionRequest toRequest() {
    return FreezeSubscriptionRequest(startDate, days);
  }
}

extension FreezePolicyResponseMapper on FreezePolicyResponse? {
  FreezePolicyModel toDomain() {
    return FreezePolicyModel(
      this?.enabled?.orFalse() ?? Constants.falseValue,
      this?.maxDays?.orZero() ?? Constants.zero,
      this?.maxTimes?.orZero() ?? Constants.zero,
    );
  }
}

extension FreezeSubscriptionDataResponseMapper
    on FreezeSubscriptionDataResponse? {
  FreezeSubscriptionDataModel toDomain() {
    return FreezeSubscriptionDataModel(
      this?.subscriptionId?.orEmpty() ?? Constants.empty,
      this?.frozenDates?.map((e) => e).toList() ?? [],
      this?.newlyFrozenDates?.map((e) => e).toList() ?? [],
      this?.alreadyFrozen?.map((e) => e).toList() ?? [],
      this?.frozenDaysTotal?.orZero() ?? Constants.zero,
      this?.validityEndDate?.orEmpty() ?? Constants.empty,
      this?.freezePolicy.toDomain() ??
          FreezePolicyModel(
            Constants.falseValue,
            Constants.zero,
            Constants.zero,
          ),
    );
  }
}

extension FreezeSubscriptionResponseMapper on FreezeSubscriptionResponse? {
  FreezeSubscriptionModel toDomain() {
    return FreezeSubscriptionModel(
      this?.data?.toDomain() ??
          FreezeSubscriptionDataModel(
            Constants.empty,
            [],
            [],
            [],
            Constants.zero,
            Constants.empty,
            FreezePolicyModel(
              Constants.falseValue,
              Constants.zero,
              Constants.zero,
            ),
          ),
    );
  }
}
