import 'package:json_annotation/json_annotation.dart';

part 'day_selection_request.g.dart';

@JsonSerializable()
class DaySelectionRequest {
  @JsonKey(name: "mealSlots")
  final List<MealSlotRequest> mealSlots;

  @JsonKey(name: "addonsOneTime")
  final List<String> addonsOneTime;

  DaySelectionRequest(this.mealSlots, {this.addonsOneTime = const []});

  factory DaySelectionRequest.fromJson(Map<String, dynamic> json) =>
      _$DaySelectionRequestFromJson(json);

  Map<String, dynamic> toJson() => _$DaySelectionRequestToJson(this);
}

@JsonSerializable()
class MealSlotRequest {
  @JsonKey(name: "slotIndex")
  final int slotIndex;

  @JsonKey(name: "proteinId")
  final String? proteinId;

  @JsonKey(name: "carbId")
  final String? carbId;

  MealSlotRequest({required this.slotIndex, this.proteinId, this.carbId});

  factory MealSlotRequest.fromJson(Map<String, dynamic> json) =>
      _$MealSlotRequestFromJson(json);

  Map<String, dynamic> toJson() => _$MealSlotRequestToJson(this);
}
