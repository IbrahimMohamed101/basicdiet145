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
  @JsonKey(name: "selections")
  List<String> selections;
  @JsonKey(name: "premiumSelections")
  List<String> premiumSelections;
  @JsonKey(name: "addonsOneTime")
  List<String> addonsOneTime;

  BulkSelectionDayRequest({
    required this.date,
    required this.selections,
    required this.premiumSelections,
    required this.addonsOneTime,
  });

  factory BulkSelectionDayRequest.fromJson(Map<String, dynamic> json) => _$BulkSelectionDayRequestFromJson(json);

  Map<String, dynamic> toJson() => _$BulkSelectionDayRequestToJson(this);
}
