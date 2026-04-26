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
  
  @JsonKey(name: "slotKey")
  final String? slotKey;

  @JsonKey(name: "selectionType")
  final String? selectionType;

  @JsonKey(name: "sandwichId")
  final String? sandwichId;

  @JsonKey(name: "customSalad")
  final CustomSaladRequest? customSalad;

  MealSlotRequest({
    required this.slotIndex,
    this.proteinId,
    this.carbId,
    this.slotKey,
    this.selectionType,
    this.sandwichId,
    this.customSalad,
  });

  factory MealSlotRequest.fromJson(Map<String, dynamic> json) =>
      _$MealSlotRequestFromJson(json);

  Map<String, dynamic> toJson() => _$MealSlotRequestToJson(this);
}

@JsonSerializable()
class CustomSaladRequest {
  @JsonKey(name: 'presetKey')
  final String presetKey;

  @JsonKey(name: 'vegetables')
  final List<String> vegetables;

  @JsonKey(name: 'addons')
  final List<String> addons;

  @JsonKey(name: 'fruits')
  final List<String> fruits;

  @JsonKey(name: 'nuts')
  final List<String> nuts;

  @JsonKey(name: 'sauce')
  final List<String> sauce;

  const CustomSaladRequest({
    required this.presetKey,
    this.vegetables = const [],
    this.addons = const [],
    this.fruits = const [],
    this.nuts = const [],
    this.sauce = const [],
  });

  factory CustomSaladRequest.fromJson(Map<String, dynamic> json) =>
      _$CustomSaladRequestFromJson(json);

  Map<String, dynamic> toJson() => _$CustomSaladRequestToJson(this);
}
