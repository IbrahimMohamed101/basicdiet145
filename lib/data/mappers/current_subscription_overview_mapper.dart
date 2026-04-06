import 'package:basic_diet/app/constants.dart';
import 'package:basic_diet/app/extensions.dart';
import 'package:basic_diet/data/response/current_subscription_overview_response.dart';
import 'package:basic_diet/domain/model/current_subscription_overview_model.dart';

extension AddonSubscriptionResponseMapper on AddonSubscriptionResponse? {
  AddonSubscriptionModel toDomain() {
    return AddonSubscriptionModel(
      this?.addonId.orEmpty() ?? Constants.empty,
      this?.name.orEmpty() ?? Constants.empty,
      this?.price.orZero() ?? Constants.zero,
    );
  }
}

extension PremiumSummaryResponseMapper on PremiumSummaryResponse? {
  PremiumSummaryModel toDomain() {
    return PremiumSummaryModel(
      this?.premiumMealId.orEmpty() ?? Constants.empty,
      this?.name.orEmpty() ?? Constants.empty,
      this?.purchasedQtyTotal.orZero() ?? Constants.zero,
      this?.remainingQtyTotal.orZero() ?? Constants.zero,
      this?.consumedQtyTotal.orZero() ?? Constants.zero,
    );
  }
}

extension AddonSummaryResponseMapper on AddonSummaryResponse? {
  AddonSummaryModel toDomain() {
    return AddonSummaryModel(
      this?.addonId.orEmpty() ?? Constants.empty,
      this?.name.orEmpty() ?? Constants.empty,
      this?.purchasedQtyTotal.orZero() ?? Constants.zero,
      this?.remainingQtyTotal.orZero() ?? Constants.zero,
      this?.consumedQtyTotal.orZero() ?? Constants.zero,
    );
  }
}

extension CurrentSubscriptionOverviewDataResponseMapper on CurrentSubscriptionOverviewDataResponse? {
  CurrentSubscriptionOverviewDataModel toDomain() {
    return CurrentSubscriptionOverviewDataModel(
      this?.id.orEmpty() ?? Constants.empty,
      this?.status.orEmpty() ?? Constants.empty,
      this?.startDate.orEmpty() ?? Constants.empty,
      this?.endDate.orEmpty() ?? Constants.empty,
      this?.totalMeals.orZero() ?? Constants.zero,
      this?.remainingMeals.orZero() ?? Constants.zero,
      this?.premiumRemaining.orZero() ?? Constants.zero,
      (this?.addonSubscriptions?.map((e) => e.toDomain()) ?? const Iterable.empty()).cast<AddonSubscriptionModel>().toList(),
      this?.selectedMealsPerDay.orZero() ?? Constants.zero,
      this?.deliveryMode.orEmpty() ?? Constants.empty,
      (this?.premiumSummary?.map((e) => e.toDomain()) ?? const Iterable.empty()).cast<PremiumSummaryModel>().toList(),
      (this?.addonsSummary?.map((e) => e.toDomain()) ?? const Iterable.empty()).cast<AddonSummaryModel>().toList(),
      this?.statusLabel.orEmpty() ?? Constants.empty,
      this?.deliveryModeLabel.orEmpty() ?? Constants.empty,
      this?.validityEndDate.orEmpty() ?? Constants.empty,
      this?.skipDaysUsed.orZero() ?? Constants.zero,
      this?.skipDaysLimit.orZero() ?? Constants.zero,
      this?.remainingSkipDays.orZero() ?? Constants.zero,
    );
  }
}

extension CurrentSubscriptionOverviewResponseMapper on CurrentSubscriptionOverviewResponse? {
  CurrentSubscriptionOverviewModel toDomain() {
    return CurrentSubscriptionOverviewModel(
      this?.data?.toDomain(),
    );
  }
}
