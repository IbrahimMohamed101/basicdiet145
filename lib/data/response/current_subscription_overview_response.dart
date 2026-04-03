import 'package:json_annotation/json_annotation.dart';
import 'package:basic_diet/data/response/base_response/base_response.dart';

part 'current_subscription_overview_response.g.dart';

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

  CurrentSubscriptionOverviewDataResponse(
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
  );

  factory CurrentSubscriptionOverviewDataResponse.fromJson(Map<String, dynamic> json) =>
      _$CurrentSubscriptionOverviewDataResponseFromJson(json);

  Map<String, dynamic> toJson() => _$CurrentSubscriptionOverviewDataResponseToJson(this);
}

@JsonSerializable()
class CurrentSubscriptionOverviewResponse extends BaseResponse {
  @JsonKey(name: "data")
  CurrentSubscriptionOverviewDataResponse? data;

  CurrentSubscriptionOverviewResponse(this.data);

  factory CurrentSubscriptionOverviewResponse.fromJson(Map<String, dynamic> json) =>
      _$CurrentSubscriptionOverviewResponseFromJson(json);

  Map<String, dynamic> toJson() => _$CurrentSubscriptionOverviewResponseToJson(this);
}
