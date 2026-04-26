import 'package:json_annotation/json_annotation.dart';

part 'bulk_selections_response.g.dart';

@JsonSerializable()
class BulkSelectionsResponse {
  @JsonKey(name: "status")
  bool status;

  @JsonKey(name: "data")
  BulkSelectionsData? data;

  BulkSelectionsResponse({required this.status, this.data});

  factory BulkSelectionsResponse.fromJson(Map<String, dynamic> json) =>
      _$BulkSelectionsResponseFromJson(json);

  Map<String, dynamic> toJson() => _$BulkSelectionsResponseToJson(this);
}

@JsonSerializable()
class BulkSelectionsData {
  @JsonKey(name: "summary")
  BulkSelectionsSummary summary;

  @JsonKey(name: "results")
  List<BulkSelectionResult> results;

  BulkSelectionsData({required this.summary, required this.results});

  factory BulkSelectionsData.fromJson(Map<String, dynamic> json) =>
      _$BulkSelectionsDataFromJson(json);

  Map<String, dynamic> toJson() => _$BulkSelectionsDataToJson(this);
}

@JsonSerializable()
class BulkSelectionsSummary {
  @JsonKey(name: "totalDates")
  int totalDates;

  @JsonKey(name: "updatedCount")
  int updatedCount;

  @JsonKey(name: "idempotentCount")
  int idempotentCount;

  @JsonKey(name: "failedCount")
  int failedCount;

  BulkSelectionsSummary({
    required this.totalDates,
    required this.updatedCount,
    required this.idempotentCount,
    required this.failedCount,
  });

  factory BulkSelectionsSummary.fromJson(Map<String, dynamic> json) =>
      _$BulkSelectionsSummaryFromJson(json);

  Map<String, dynamic> toJson() => _$BulkSelectionsSummaryToJson(this);
}

@JsonSerializable()
class BulkSelectionResult {
  @JsonKey(name: "date")
  String date;

  @JsonKey(name: "ok")
  bool ok;

  @JsonKey(name: "code")
  String? code;

  @JsonKey(name: "message")
  String? message;

  BulkSelectionResult({
    required this.date,
    required this.ok,
    this.code,
    this.message,
  });

  factory BulkSelectionResult.fromJson(Map<String, dynamic> json) =>
      _$BulkSelectionResultFromJson(json);

  Map<String, dynamic> toJson() => _$BulkSelectionResultToJson(this);
}
