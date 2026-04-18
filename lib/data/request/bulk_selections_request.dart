import 'package:json_annotation/json_annotation.dart';

part 'bulk_selections_request.g.dart';

@JsonSerializable()
class BulkSelectionsRequest {
  @JsonKey(name: "days")
  List<BulkSelectionDayRequest> days;

  BulkSelectionsRequest({required this.days});

  factory BulkSelectionsRequest.fromJson(Map<String, dynamic> json) => _$BulkSelectionsRequestFromJson(json);

  Map<String, dynamic> toJson() => _$BulkSelectionsRequestToJson(this);
}

@JsonSerializable()
class BulkSelectionDayRequest {
  @JsonKey(name: "date")
  String date;
  
  @JsonKey(name: "mealSlots")
  List<MealSlotRequest> mealSlots;

  BulkSelectionDayRequest({
    required this.date,
    required this.mealSlots,
  });

  factory BulkSelectionDayRequest.fromJson(Map<String, dynamic> json) => _$BulkSelectionDayRequestFromJson(json);

  Map<String, dynamic> toJson() => _$BulkSelectionDayRequestToJson(this);
}

@JsonSerializable()
class MealSlotRequest {
  @JsonKey(name: "slotIndex")
  int slotIndex;
  
  @JsonKey(name: "slotKey")
  String slotKey;
  
  @JsonKey(name: "proteinId")
  String? proteinId;
  
  @JsonKey(name: "carbId")
  String? carbId;

  MealSlotRequest({
    required this.slotIndex,
    required this.slotKey,
    this.proteinId,
    this.carbId,
  });

  factory MealSlotRequest.fromJson(Map<String, dynamic> json) => _$MealSlotRequestFromJson(json);

  Map<String, dynamic> toJson() => _$MealSlotRequestToJson(this);
}
