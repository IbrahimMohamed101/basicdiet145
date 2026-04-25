import 'package:json_annotation/json_annotation.dart';
import 'package:basic_diet/data/response/base_response/base_response.dart';
import 'package:basic_diet/data/response/current_subscription_overview_response.dart';

part 'timeline_response.g.dart';

@JsonSerializable()
class TimelineMealSlotResponse {
  @JsonKey(name: "slotIndex")
  int? slotIndex;
  @JsonKey(name: "proteinId")
  String? proteinId;
  @JsonKey(name: "carbId")
  String? carbId;

  TimelineMealSlotResponse(this.slotIndex, this.proteinId, this.carbId);

  factory TimelineMealSlotResponse.fromJson(Map<String, dynamic> json) =>
      _$TimelineMealSlotResponseFromJson(json);

  Map<String, dynamic> toJson() => _$TimelineMealSlotResponseToJson(this);
}

@JsonSerializable()
class TimelineDayResponse {
  @JsonKey(name: "date")
  String? date;
  @JsonKey(name: "day")
  String? day;
  @JsonKey(name: "month")
  String? month;
  @JsonKey(name: "dayNumber")
  int? dayNumber;
  @JsonKey(name: "status")
  String? status;
  @JsonKey(name: "canBePrepared")
  bool? canBePrepared;
  @JsonKey(name: "fulfillmentReady")
  bool? fulfillmentReady;
  @JsonKey(name: "consumptionState")
  String? consumptionState;
  @JsonKey(name: "selectedMeals")
  int? selectedMeals;
  @JsonKey(name: "requiredMeals")
  int? requiredMeals;
  @JsonKey(name: "selections")
  List<String>? selections;
  @JsonKey(name: "premiumSelections")
  List<String>? premiumSelections;
  @JsonKey(name: "mealSlots")
  List<TimelineMealSlotResponse>? mealSlots;

  TimelineDayResponse(
    this.date,
    this.day,
    this.month,
    this.dayNumber,
    this.status,
    this.canBePrepared,
    this.fulfillmentReady,
    this.consumptionState,
    this.selectedMeals,
    this.requiredMeals,
    this.selections,
    this.premiumSelections,
    this.mealSlots,
  );

  factory TimelineDayResponse.fromJson(Map<String, dynamic> json) =>
      _$TimelineDayResponseFromJson(json);

  Map<String, dynamic> toJson() => _$TimelineDayResponseToJson(this);
}

@JsonSerializable()
class TimelineDataResponse {
  @JsonKey(name: "subscriptionId")
  String? subscriptionId;
  @JsonKey(name: "dailyMealsRequired")
  int? dailyMealsRequired;
  @JsonKey(name: "days")
  List<TimelineDayResponse>? days;
  @JsonKey(name: "premiumMealsRemaining")
  int? premiumMealsRemaining;
  @JsonKey(name: "addonSubscriptions")
  List<AddonSubscriptionResponse>? addonSubscriptions;

  TimelineDataResponse(
    this.subscriptionId,
    this.dailyMealsRequired,
    this.days,
    this.premiumMealsRemaining,
    this.addonSubscriptions,
  );

  factory TimelineDataResponse.fromJson(Map<String, dynamic> json) =>
      _$TimelineDataResponseFromJson(json);

  Map<String, dynamic> toJson() => _$TimelineDataResponseToJson(this);
}

@JsonSerializable()
class TimelineResponse extends BaseResponse {
  @JsonKey(name: "data")
  TimelineDataResponse? data;

  TimelineResponse(this.data);

  factory TimelineResponse.fromJson(Map<String, dynamic> json) =>
      _$TimelineResponseFromJson(json);

  @override
  Map<String, dynamic> toJson() => _$TimelineResponseToJson(this);
}
