import 'package:json_annotation/json_annotation.dart';
import 'package:basic_diet/data/response/base_response/base_response.dart';

part 'timeline_response.g.dart';

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
  @JsonKey(name: "selectedMeals")
  int? selectedMeals;
  @JsonKey(name: "requiredMeals")
  int? requiredMeals;
  @JsonKey(name: "selections")
  List<String>? selections;
  @JsonKey(name: "premiumSelections")
  List<String>? premiumSelections;

  TimelineDayResponse(
    this.date,
    this.day,
    this.month,
    this.dayNumber,
    this.status,
    this.selectedMeals,
    this.requiredMeals,
    this.selections,
    this.premiumSelections,
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

  TimelineDataResponse(
    this.subscriptionId,
    this.dailyMealsRequired,
    this.days,
    this.premiumMealsRemaining,
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
