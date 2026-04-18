import 'package:json_annotation/json_annotation.dart';

part 'day_selection_request.g.dart';

@JsonSerializable()
class DaySelectionRequest {
  @JsonKey(name: "mealSlots")
  final List<MealSlotRequest> mealSlots;

  DaySelectionRequest(this.mealSlots);

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

  MealSlotRequest({
    required this.slotIndex,
    this.proteinId,
    this.carbId,
  });

  factory MealSlotRequest.fromJson(Map<String, dynamic> json) =>
      _$MealSlotRequestFromJson(json);

  Map<String, dynamic> toJson() => _$MealSlotRequestToJson(this);
}
