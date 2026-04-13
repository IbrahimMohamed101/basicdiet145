class MetaModel {
  String testScenario;
  MetaModel(this.testScenario);
}

class ContractModel {
  bool isCanonical;
  bool isGrandfathered;
  String version;

  ContractModel(this.isCanonical, this.isGrandfathered, this.version);
}

class PickupPreparationModel {
  String flowStatus;
  String reason;
  String buttonLabel;
  String message;

  PickupPreparationModel(this.flowStatus, this.reason, this.buttonLabel, this.message);
}

class DeliverySlotModel {
  String slotId;
  String type;
  String window;

  DeliverySlotModel(this.slotId, this.type, this.window);
}

class AddonSubscriptionModel {
  String addonId;
  String name;
  int price;

  AddonSubscriptionModel(this.addonId, this.name, this.price);
}

class PremiumSummaryModel {
  String premiumMealId;
  String name;
  int purchasedQtyTotal;
  int remainingQtyTotal;
  int consumedQtyTotal;

  PremiumSummaryModel(
    this.premiumMealId,
    this.name,
    this.purchasedQtyTotal,
    this.remainingQtyTotal,
    this.consumedQtyTotal,
  );
}

class AddonSummaryModel {
  String addonId;
  String name;
  int purchasedQtyTotal;
  int remainingQtyTotal;
  int consumedQtyTotal;

  AddonSummaryModel(
    this.addonId,
    this.name,
    this.purchasedQtyTotal,
    this.remainingQtyTotal,
    this.consumedQtyTotal,
  );
}

class CurrentSubscriptionOverviewDataModel {
  String id;
  String status;
  String startDate;
  String endDate;
  int totalMeals;
  int remainingMeals;
  int premiumRemaining;
  List<AddonSubscriptionModel> addonSubscriptions;
  int selectedMealsPerDay;
  String deliveryMode;
  List<PremiumSummaryModel> premiumSummary;
  List<AddonSummaryModel> addonsSummary;
  String statusLabel;
  String deliveryModeLabel;
  String validityEndDate;
  int skipDaysUsed;
  int skipDaysLimit;
  int remainingSkipDays;
  MetaModel? meta;
  ContractModel? contract;
  PickupPreparationModel? pickupPreparation;
  DeliverySlotModel? deliverySlot;

  CurrentSubscriptionOverviewDataModel(
    this.id,
    this.status,
    this.startDate,
    this.endDate,
    this.totalMeals,
    this.remainingMeals,
    this.premiumRemaining,
    this.addonSubscriptions,
    this.selectedMealsPerDay,
    this.deliveryMode,
    this.premiumSummary,
    this.addonsSummary,
    this.statusLabel,
    this.deliveryModeLabel,
    this.validityEndDate,
    this.skipDaysUsed,
    this.skipDaysLimit,
    this.remainingSkipDays,
    this.meta,
    this.contract,
    this.pickupPreparation,
    this.deliverySlot,
  );
}

class CurrentSubscriptionOverviewModel {
  CurrentSubscriptionOverviewDataModel? data;

  CurrentSubscriptionOverviewModel(this.data);
}
