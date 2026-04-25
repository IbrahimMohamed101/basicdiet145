import 'package:basic_diet/app/constants.dart';
import 'package:basic_diet/app/extensions.dart';
import 'package:basic_diet/data/response/current_subscription_overview_response.dart';
import 'package:basic_diet/domain/model/current_subscription_overview_model.dart';

extension MetaResponseMapper on MetaResponse? {
  MetaModel toDomain() {
    return MetaModel(this?.testScenario.orEmpty() ?? Constants.empty);
  }
}

extension ContractResponseMapper on ContractResponse? {
  ContractModel toDomain() {
    return ContractModel(
      this?.isCanonical ?? false,
      this?.isGrandfathered ?? false,
      this?.version.orEmpty() ?? Constants.empty,
    );
  }
}

extension PickupPreparationResponseMapper on PickupPreparationResponse? {
  PickupPreparationModel toDomain() {
    return PickupPreparationModel(
      this?.flowStatus.orEmpty() ?? Constants.empty,
      this?.reason.orEmpty() ?? Constants.empty,
      this?.buttonLabel.orEmpty() ?? Constants.empty,
      this?.message.orEmpty() ?? Constants.empty,
      this?.canRequestPrepare ?? false,
      this?.canBePrepared ?? false,
      this?.planningReady ?? false,
      this?.showMealPlannerCta ?? false,
      this?.mealPlannerCtaLabelAr.orEmpty() ?? Constants.empty,
      this?.mealPlannerCtaLabelEn.orEmpty() ?? Constants.empty,
      this?.messageAr.orEmpty() ?? Constants.empty,
      this?.messageEn.orEmpty() ?? Constants.empty,
      this?.businessDate.orEmpty() ?? Constants.empty,
      this?.pickupRequested ?? false,
      this?.pickupPrepared ?? false,
    );
  }
}

extension OverviewDeliverySlotResponseMapper on OverviewDeliverySlotResponse? {
  DeliverySlotModel toDomain() {
    return DeliverySlotModel(
      this?.slotId.orEmpty() ?? Constants.empty,
      this?.type.orEmpty() ?? Constants.empty,
      this?.window.orEmpty() ?? Constants.empty,
    );
  }
}

extension AddonSubscriptionResponseMapper on AddonSubscriptionResponse? {
  AddonSubscriptionModel toDomain() {
    return AddonSubscriptionModel(
      this?.addonId.orEmpty() ?? Constants.empty,
      this?.category.orEmpty() ?? Constants.empty,
      this?.includedCount ?? this?.maxPerDay ?? Constants.zero,
      this?.status.orEmpty() ?? 'active',
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

extension CurrentSubscriptionOverviewDataResponseMapper
    on CurrentSubscriptionOverviewDataResponse? {
  CurrentSubscriptionOverviewDataModel toDomain() {
    return CurrentSubscriptionOverviewDataModel(
      this?.id.orEmpty() ?? Constants.empty,
      this?.businessDate.orEmpty() ?? Constants.empty,
      this?.status.orEmpty() ?? Constants.empty,
      this?.startDate.orEmpty() ?? Constants.empty,
      this?.endDate.orEmpty() ?? Constants.empty,
      this?.totalMeals.orZero() ?? Constants.zero,
      this?.remainingMeals.orZero() ?? Constants.zero,
      this?.premiumRemaining.orZero() ?? Constants.zero,
      (this?.addonSubscriptions?.map((e) => e.toDomain()) ??
              const Iterable.empty())
          .cast<AddonSubscriptionModel>()
          .toList(),
      this?.selectedMealsPerDay.orZero() ?? Constants.zero,
      this?.deliveryMode.orEmpty() ?? Constants.empty,
      (this?.premiumSummary?.map((e) => e.toDomain()) ?? const Iterable.empty())
          .cast<PremiumSummaryModel>()
          .toList(),
      (this?.addonsSummary?.map((e) => e.toDomain()) ?? const Iterable.empty())
          .cast<AddonSummaryModel>()
          .toList(),
      this?.statusLabel.orEmpty() ?? Constants.empty,
      this?.deliveryModeLabel.orEmpty() ?? Constants.empty,
      this?.validityEndDate.orEmpty() ?? Constants.empty,
      this?.skipDaysUsed.orZero() ?? Constants.zero,
      this?.skipDaysLimit.orZero() ?? Constants.zero,
      this?.remainingSkipDays.orZero() ?? Constants.zero,
      this?.meta?.toDomain(),
      this?.contract?.toDomain(),
      this?.pickupPreparation?.toDomain(),
      this?.deliverySlot?.toDomain(),
    );
  }
}

extension CurrentSubscriptionOverviewResponseMapper
    on CurrentSubscriptionOverviewResponse? {
  CurrentSubscriptionOverviewModel toDomain() {
    return CurrentSubscriptionOverviewModel(this?.data?.toDomain());
  }
}
