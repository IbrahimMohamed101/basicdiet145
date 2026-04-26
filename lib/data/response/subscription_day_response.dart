import 'package:json_annotation/json_annotation.dart';

part 'subscription_day_response.g.dart';

@JsonSerializable(createFactory: false)
class SubscriptionDayResponse {
  /// Top-level success flag (`status` on current API, `ok` on some older payloads).
  final bool? status;

  @JsonKey(name: "data")
  final SubscriptionDayData? data;

  SubscriptionDayResponse(this.status, this.data);

  factory SubscriptionDayResponse.fromJson(Map<String, dynamic> json) {
    bool? top;
    if (json['status'] is bool) {
      top = json['status'] as bool;
    } else if (json['ok'] is bool) {
      top = json['ok'] as bool;
    } else if (json['status'] is int) {
      top = json['status'] >= 200 && json['status'] < 300;
    }
    top ??= false;

    return SubscriptionDayResponse(
      top,
      json['data'] == null
          ? null
          : SubscriptionDayData.fromJson(json['data'] as Map<String, dynamic>),
    );
  }

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

  @JsonKey(name: "mealSlots", defaultValue: [])
  final List<MealSlotResponse> mealSlots;

  @JsonKey(name: "addonSelections", defaultValue: [])
  final List<AddonSelectionResponse> addonSelections;

  @JsonKey(name: "plannerMeta")
  final PlannerMetaResponse? plannerMeta;

  @JsonKey(name: "planning")
  final PlanningResponse? planning;

  @JsonKey(name: "paymentRequirement")
  final PaymentRequirementResponse? paymentRequirement;

  SubscriptionDayData(
    this.date,
    this.status,
    this.plannerState,
    this.mealSlots,
    this.addonSelections,
    this.plannerMeta,
    this.planning,
    this.paymentRequirement,
  );

  factory SubscriptionDayData.fromJson(Map<String, dynamic> json) =>
      _$SubscriptionDayDataFromJson(json);

  Map<String, dynamic> toJson() => _$SubscriptionDayDataToJson(this);
}

@JsonSerializable()
class PlanningResponse {
  @JsonKey(name: "version")
  final String? version;

  @JsonKey(name: "state")
  final String? state;

  @JsonKey(name: "requiredMealCount", defaultValue: 0)
  final int requiredMealCount;

  @JsonKey(name: "selectedTotalMealCount", defaultValue: 0)
  final int selectedTotalMealCount;

  @JsonKey(name: "isExactCountSatisfied", defaultValue: false)
  final bool isExactCountSatisfied;

  @JsonKey(name: "confirmedAt")
  final String? confirmedAt;

  @JsonKey(name: "confirmedByRole")
  final String? confirmedByRole;

  PlanningResponse(
    this.version,
    this.state,
    this.requiredMealCount,
    this.selectedTotalMealCount,
    this.isExactCountSatisfied,
    this.confirmedAt,
    this.confirmedByRole,
  );

  factory PlanningResponse.fromJson(Map<String, dynamic> json) =>
      _$PlanningResponseFromJson(json);

  Map<String, dynamic> toJson() => _$PlanningResponseToJson(this);
}

@JsonSerializable()
class AddonSelectionResponse {
  @JsonKey(name: "addonId")
  final String? addonId;

  @JsonKey(name: "category")
  final String? category;

  @JsonKey(name: "status")
  final String? status;

  @JsonKey(name: "source")
  final String? source;

  @JsonKey(name: "name")
  final String? name;

  @JsonKey(name: "priceHalala")
  final int? priceHalala;

  @JsonKey(name: "currency")
  final String? currency;

  AddonSelectionResponse(
    this.addonId,
    this.category,
    this.status,
    this.source,
    this.name,
    this.priceHalala,
    this.currency,
  );

  factory AddonSelectionResponse.fromJson(Map<String, dynamic> json) =>
      _$AddonSelectionResponseFromJson(json);

  Map<String, dynamic> toJson() => _$AddonSelectionResponseToJson(this);
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
  
  @JsonKey(name: "selectionType")
  final String? selectionType;

  @JsonKey(name: "sandwichId")
  final String? sandwichId;

  @JsonKey(name: "customSalad")
  final CustomSaladResponse? customSalad;

  @JsonKey(name: "isPremium", defaultValue: false)
  final bool isPremium;

  @JsonKey(name: "premiumSource", defaultValue: "none")
  final String premiumSource;

  @JsonKey(name: "proteinFamilyKey")
  final String? proteinFamilyKey;

  MealSlotResponse(
    this.slotIndex,
    this.slotKey,
    this.status,
    this.proteinId,
    this.carbId,
    this.selectionType,
    this.sandwichId,
    this.customSalad,
    this.isPremium,
    this.premiumSource,
    this.proteinFamilyKey,
  );

  factory MealSlotResponse.fromJson(Map<String, dynamic> json) =>
      _$MealSlotResponseFromJson(json);

  Map<String, dynamic> toJson() => _$MealSlotResponseToJson(this);
}

@JsonSerializable()
class CustomSaladResponse {
  @JsonKey(name: "presetKey")
  final String? presetKey;

  @JsonKey(name: "vegetables", defaultValue: [])
  final List<String> vegetables;

  @JsonKey(name: "addons", defaultValue: [])
  final List<String> addons;

  @JsonKey(name: "fruits", defaultValue: [])
  final List<String> fruits;

  @JsonKey(name: "nuts", defaultValue: [])
  final List<String> nuts;

  @JsonKey(name: "sauce", defaultValue: [])
  final List<String> sauce;

  CustomSaladResponse(
    this.presetKey,
    this.vegetables,
    this.addons,
    this.fruits,
    this.nuts,
    this.sauce,
  );

  factory CustomSaladResponse.fromJson(Map<String, dynamic> json) =>
      _$CustomSaladResponseFromJson(json);

  Map<String, dynamic> toJson() => _$CustomSaladResponseToJson(this);
}

@JsonSerializable()
class PlannerMetaResponse {
  @JsonKey(name: "requiredSlotCount", defaultValue: 0)
  final int requiredSlotCount;

  @JsonKey(name: "emptySlotCount", defaultValue: 0)
  final int emptySlotCount;

  @JsonKey(name: "partialSlotCount", defaultValue: 0)
  final int partialSlotCount;

  @JsonKey(name: "completeSlotCount", defaultValue: 0)
  final int completeSlotCount;

  @JsonKey(name: "premiumSlotCount", defaultValue: 0)
  final int premiumSlotCount;

  @JsonKey(name: "premiumPendingPaymentCount", defaultValue: 0)
  final int premiumPendingPaymentCount;

  /// Not always present on newer API payloads; default to 0.
  @JsonKey(name: "premiumTotalHalala", defaultValue: 0)
  final int premiumTotalHalala;

  @JsonKey(name: "isDraftValid", defaultValue: true)
  final bool isDraftValid;

  @JsonKey(name: "isConfirmable", defaultValue: false)
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
  @JsonKey(name: "status", defaultValue: "satisfied")
  final String status;

  @JsonKey(name: "requiresPayment", defaultValue: false)
  final bool requiresPayment;

  @JsonKey(name: "premiumSelectedCount", defaultValue: 0)
  final int premiumSelectedCount;

  @JsonKey(name: "premiumPendingPaymentCount", defaultValue: 0)
  final int premiumPendingPaymentCount;

  @JsonKey(name: "addonSelectedCount", defaultValue: 0)
  final int addonSelectedCount;

  @JsonKey(name: "addonPendingPaymentCount", defaultValue: 0)
  final int addonPendingPaymentCount;

  @JsonKey(name: "amountHalala", defaultValue: 0)
  final int amountHalala;

  @JsonKey(name: "pendingAmountHalala", defaultValue: 0)
  final int pendingAmountHalala;

  @JsonKey(name: "currency", defaultValue: "SAR")
  final String currency;

  @JsonKey(name: "pricingStatus", defaultValue: "not_required")
  final String pricingStatus;

  @JsonKey(name: "blockingReason")
  final String? blockingReason;

  @JsonKey(name: "canCreatePayment", defaultValue: false)
  final bool canCreatePayment;

  PaymentRequirementResponse(
    this.status,
    this.requiresPayment,
    this.premiumSelectedCount,
    this.premiumPendingPaymentCount,
    this.addonSelectedCount,
    this.addonPendingPaymentCount,
    this.amountHalala,
    this.pendingAmountHalala,
    this.currency,
    this.pricingStatus,
    this.blockingReason,
    this.canCreatePayment,
  );

  factory PaymentRequirementResponse.fromJson(Map<String, dynamic> json) =>
      _$PaymentRequirementResponseFromJson(json);

  Map<String, dynamic> toJson() => _$PaymentRequirementResponseToJson(this);
}

