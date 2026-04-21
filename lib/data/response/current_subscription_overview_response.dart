import 'package:json_annotation/json_annotation.dart';
import 'package:basic_diet/data/response/base_response/base_response.dart';

part 'current_subscription_overview_response.g.dart';

@JsonSerializable()
class MetaResponse {
  @JsonKey(name: "testScenario")
  String? testScenario;

  MetaResponse(this.testScenario);

  factory MetaResponse.fromJson(Map<String, dynamic> json) =>
      _$MetaResponseFromJson(json);
  Map<String, dynamic> toJson() => _$MetaResponseToJson(this);
}

@JsonSerializable()
class ContractResponse {
  @JsonKey(name: "isCanonical")
  bool? isCanonical;
  @JsonKey(name: "isGrandfathered")
  bool? isGrandfathered;
  @JsonKey(name: "version")
  String? version;

  ContractResponse(this.isCanonical, this.isGrandfathered, this.version);

  factory ContractResponse.fromJson(Map<String, dynamic> json) =>
      _$ContractResponseFromJson(json);
  Map<String, dynamic> toJson() => _$ContractResponseToJson(this);
}

@JsonSerializable()
class PickupPreparationResponse {
  @JsonKey(name: "flowStatus")
  String? flowStatus;
  @JsonKey(name: "reason")
  String? reason;
  @JsonKey(name: "buttonLabel")
  String? buttonLabel;
  @JsonKey(name: "message")
  String? message;
  @JsonKey(name: "canRequestPrepare")
  bool? canRequestPrepare;
  @JsonKey(name: "canBePrepared")
  bool? canBePrepared;
  @JsonKey(name: "planningReady")
  bool? planningReady;
  @JsonKey(name: "showMealPlannerCta")
  bool? showMealPlannerCta;
  @JsonKey(name: "mealPlannerCtaLabelAr")
  String? mealPlannerCtaLabelAr;
  @JsonKey(name: "mealPlannerCtaLabelEn")
  String? mealPlannerCtaLabelEn;
  @JsonKey(name: "messageAr")
  String? messageAr;
  @JsonKey(name: "messageEn")
  String? messageEn;
  @JsonKey(name: "businessDate")
  String? businessDate;
  @JsonKey(name: "pickupRequested")
  bool? pickupRequested;
  @JsonKey(name: "pickupPrepared")
  bool? pickupPrepared;

  PickupPreparationResponse(
    this.flowStatus,
    this.reason,
    this.buttonLabel,
    this.message,
    this.canRequestPrepare,
    this.canBePrepared,
    this.planningReady,
    this.showMealPlannerCta,
    this.mealPlannerCtaLabelAr,
    this.mealPlannerCtaLabelEn,
    this.messageAr,
    this.messageEn,
    this.businessDate,
    this.pickupRequested,
    this.pickupPrepared,
  );

  factory PickupPreparationResponse.fromJson(Map<String, dynamic> json) =>
      _$PickupPreparationResponseFromJson(json);
  Map<String, dynamic> toJson() => _$PickupPreparationResponseToJson(this);
}

@JsonSerializable()
class OverviewDeliverySlotResponse {
  @JsonKey(name: "slotId")
  String? slotId;
  @JsonKey(name: "type")
  String? type;
  @JsonKey(name: "window")
  String? window;

  OverviewDeliverySlotResponse(this.slotId, this.type, this.window);

  factory OverviewDeliverySlotResponse.fromJson(Map<String, dynamic> json) =>
      _$OverviewDeliverySlotResponseFromJson(json);
  Map<String, dynamic> toJson() => _$OverviewDeliverySlotResponseToJson(this);
}

@JsonSerializable()
class AddonSubscriptionResponse {
  @JsonKey(name: "addonId")
  String? addonId;
  @JsonKey(name: "name")
  String? name;
  @JsonKey(name: "price")
  int? price;

  AddonSubscriptionResponse(this.addonId, this.name, this.price);

  factory AddonSubscriptionResponse.fromJson(Map<String, dynamic> json) =>
      _$AddonSubscriptionResponseFromJson(json);

  Map<String, dynamic> toJson() => _$AddonSubscriptionResponseToJson(this);
}

@JsonSerializable()
class PremiumSummaryResponse {
  @JsonKey(name: "premiumMealId")
  String? premiumMealId;
  @JsonKey(name: "name")
  String? name;
  @JsonKey(name: "purchasedQtyTotal")
  int? purchasedQtyTotal;
  @JsonKey(name: "remainingQtyTotal")
  int? remainingQtyTotal;
  @JsonKey(name: "consumedQtyTotal")
  int? consumedQtyTotal;

  PremiumSummaryResponse(
    this.premiumMealId,
    this.name,
    this.purchasedQtyTotal,
    this.remainingQtyTotal,
    this.consumedQtyTotal,
  );

  factory PremiumSummaryResponse.fromJson(Map<String, dynamic> json) =>
      _$PremiumSummaryResponseFromJson(json);

  Map<String, dynamic> toJson() => _$PremiumSummaryResponseToJson(this);
}

@JsonSerializable()
class AddonSummaryResponse {
  @JsonKey(name: "addonId")
  String? addonId;
  @JsonKey(name: "name")
  String? name;
  @JsonKey(name: "purchasedQtyTotal")
  int? purchasedQtyTotal;
  @JsonKey(name: "remainingQtyTotal")
  int? remainingQtyTotal;
  @JsonKey(name: "consumedQtyTotal")
  int? consumedQtyTotal;

  AddonSummaryResponse(
    this.addonId,
    this.name,
    this.purchasedQtyTotal,
    this.remainingQtyTotal,
    this.consumedQtyTotal,
  );

  factory AddonSummaryResponse.fromJson(Map<String, dynamic> json) =>
      _$AddonSummaryResponseFromJson(json);

  Map<String, dynamic> toJson() => _$AddonSummaryResponseToJson(this);
}

@JsonSerializable()
class CurrentSubscriptionOverviewDataResponse {
  @JsonKey(name: "_id")
  String? id;
  @JsonKey(name: "businessDate")
  String? businessDate;
  @JsonKey(name: "status")
  String? status;
  @JsonKey(name: "startDate")
  String? startDate;
  @JsonKey(name: "endDate")
  String? endDate;
  @JsonKey(name: "totalMeals")
  int? totalMeals;
  @JsonKey(name: "remainingMeals")
  int? remainingMeals;
  @JsonKey(name: "premiumRemaining")
  int? premiumRemaining;
  @JsonKey(name: "addonSubscriptions")
  List<AddonSubscriptionResponse>? addonSubscriptions;
  @JsonKey(name: "selectedMealsPerDay")
  int? selectedMealsPerDay;
  @JsonKey(name: "deliveryMode")
  String? deliveryMode;
  @JsonKey(name: "premiumSummary")
  List<PremiumSummaryResponse>? premiumSummary;
  @JsonKey(name: "addonsSummary")
  List<AddonSummaryResponse>? addonsSummary;
  @JsonKey(name: "statusLabel")
  String? statusLabel;
  @JsonKey(name: "deliveryModeLabel")
  String? deliveryModeLabel;
  @JsonKey(name: "validityEndDate")
  String? validityEndDate;
  @JsonKey(name: "skipDaysUsed")
  int? skipDaysUsed;
  @JsonKey(name: "skipDaysLimit")
  int? skipDaysLimit;
  @JsonKey(name: "remainingSkipDays")
  int? remainingSkipDays;
  @JsonKey(name: "meta")
  MetaResponse? meta;
  @JsonKey(name: "contract")
  ContractResponse? contract;
  @JsonKey(name: "pickupPreparation")
  PickupPreparationResponse? pickupPreparation;
  @JsonKey(name: "deliverySlot")
  OverviewDeliverySlotResponse? deliverySlot;

  CurrentSubscriptionOverviewDataResponse(
    this.id,
    this.businessDate,
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

  factory CurrentSubscriptionOverviewDataResponse.fromJson(
    Map<String, dynamic> json,
  ) => _$CurrentSubscriptionOverviewDataResponseFromJson(json);

  Map<String, dynamic> toJson() =>
      _$CurrentSubscriptionOverviewDataResponseToJson(this);
}

@JsonSerializable()
class CurrentSubscriptionOverviewResponse extends BaseResponse {
  @JsonKey(name: "data")
  CurrentSubscriptionOverviewDataResponse? data;

  CurrentSubscriptionOverviewResponse(this.data);

  factory CurrentSubscriptionOverviewResponse.fromJson(
    Map<String, dynamic> json,
  ) => _$CurrentSubscriptionOverviewResponseFromJson(json);

  @override
  Map<String, dynamic> toJson() =>
      _$CurrentSubscriptionOverviewResponseToJson(this);
}
