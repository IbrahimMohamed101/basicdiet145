import 'package:json_annotation/json_annotation.dart';

part 'subscription_day_response.g.dart';

@JsonSerializable()
class SubscriptionDayResponse {
  @JsonKey(name: "ok")
  final bool? status;
  
  @JsonKey(name: "data")
  final SubscriptionDayData? data;

  SubscriptionDayResponse(this.status, this.data);

  factory SubscriptionDayResponse.fromJson(Map<String, dynamic> json) =>
      _$SubscriptionDayResponseFromJson(json);

  Map<String, dynamic> toJson() => _$SubscriptionDayResponseToJson(this);
}

@JsonSerializable()
class SubscriptionDayData {
  @JsonKey(name: "date")
  final String date;
  
  @JsonKey(name: "status")
  final String status;
  
  @JsonKey(name: "plannerState")
  final String? plannerState;
  
  @JsonKey(name: "mealSlots")
  final List<MealSlotResponse> mealSlots;
  
  @JsonKey(name: "plannerMeta")
  final PlannerMetaResponse? plannerMeta;
  
  @JsonKey(name: "paymentRequirement")
  final PaymentRequirementResponse? paymentRequirement;

  SubscriptionDayData(
    this.date,
    this.status,
    this.plannerState,
    this.mealSlots,
    this.plannerMeta,
    this.paymentRequirement,
  );

  factory SubscriptionDayData.fromJson(Map<String, dynamic> json) =>
      _$SubscriptionDayDataFromJson(json);

  Map<String, dynamic> toJson() => _$SubscriptionDayDataToJson(this);
}

@JsonSerializable()
class MealSlotResponse {
  @JsonKey(name: "slotIndex")
  final int slotIndex;
  
  @JsonKey(name: "slotKey")
  final String slotKey;
  
  @JsonKey(name: "status")
  final String status;
  
  @JsonKey(name: "proteinId")
  final String? proteinId;
  
  @JsonKey(name: "carbId")
  final String? carbId;
  
  @JsonKey(name: "isPremium")
  final bool isPremium;
  
  @JsonKey(name: "premiumSource")
  final String premiumSource;
  
  @JsonKey(name: "proteinFamilyKey")
  final String? proteinFamilyKey;

  MealSlotResponse(
    this.slotIndex,
    this.slotKey,
    this.status,
    this.proteinId,
    this.carbId,
    this.isPremium,
    this.premiumSource,
    this.proteinFamilyKey,
  );

  factory MealSlotResponse.fromJson(Map<String, dynamic> json) =>
      _$MealSlotResponseFromJson(json);

  Map<String, dynamic> toJson() => _$MealSlotResponseToJson(this);
}

@JsonSerializable()
class PlannerMetaResponse {
  @JsonKey(name: "requiredSlotCount")
  final int requiredSlotCount;
  
  @JsonKey(name: "emptySlotCount")
  final int emptySlotCount;
  
  @JsonKey(name: "partialSlotCount")
  final int partialSlotCount;
  
  @JsonKey(name: "completeSlotCount")
  final int completeSlotCount;
  
  @JsonKey(name: "premiumSlotCount")
  final int premiumSlotCount;
  
  @JsonKey(name: "premiumPendingPaymentCount")
  final int premiumPendingPaymentCount;
  
  @JsonKey(name: "premiumTotalHalala")
  final int premiumTotalHalala;
  
  @JsonKey(name: "isDraftValid")
  final bool isDraftValid;
  
  @JsonKey(name: "isConfirmable")
  final bool isConfirmable;

  PlannerMetaResponse(
    this.requiredSlotCount,
    this.emptySlotCount,
    this.partialSlotCount,
    this.completeSlotCount,
    this.premiumSlotCount,
    this.premiumPendingPaymentCount,
    this.premiumTotalHalala,
    this.isDraftValid,
    this.isConfirmable,
  );

  factory PlannerMetaResponse.fromJson(Map<String, dynamic> json) =>
      _$PlannerMetaResponseFromJson(json);

  Map<String, dynamic> toJson() => _$PlannerMetaResponseToJson(this);
}

@JsonSerializable()
class PaymentRequirementResponse {
  @JsonKey(name: "requiresPayment")
  final bool requiresPayment;
  
  @JsonKey(name: "premiumSelectedCount")
  final int premiumSelectedCount;
  
  @JsonKey(name: "premiumPendingPaymentCount")
  final int premiumPendingPaymentCount;
  
  @JsonKey(name: "amountHalala")
  final int amountHalala;
  
  @JsonKey(name: "currency")
  final String currency;

  PaymentRequirementResponse(
    this.requiresPayment,
    this.premiumSelectedCount,
    this.premiumPendingPaymentCount,
    this.amountHalala,
    this.currency,
  );

  factory PaymentRequirementResponse.fromJson(Map<String, dynamic> json) =>
      _$PaymentRequirementResponseFromJson(json);

  Map<String, dynamic> toJson() => _$PaymentRequirementResponseToJson(this);
}
