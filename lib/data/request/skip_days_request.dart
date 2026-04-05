import 'package:json_annotation/json_annotation.dart';

part 'skip_days_request.g.dart';

@JsonSerializable()
class SkipDayRequest {
  @JsonKey(name: "date")
  final String date;

  SkipDayRequest(this.date);

  factory SkipDayRequest.fromJson(Map<String, dynamic> json) =>
      _$SkipDayRequestFromJson(json);

  Map<String, dynamic> toJson() => _$SkipDayRequestToJson(this);
}

@JsonSerializable()
class SkipDateRangeRequest {
  @JsonKey(name: "startDate")
  final String startDate;
  @JsonKey(name: "endDate")
  final String endDate;

  SkipDateRangeRequest(this.startDate, this.endDate);

  factory SkipDateRangeRequest.fromJson(Map<String, dynamic> json) =>
      _$SkipDateRangeRequestFromJson(json);

  Map<String, dynamic> toJson() => _$SkipDateRangeRequestToJson(this);
}
