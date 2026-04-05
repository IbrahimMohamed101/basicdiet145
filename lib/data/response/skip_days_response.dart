import 'package:json_annotation/json_annotation.dart';
import 'package:basic_diet/data/response/base_response/base_response.dart';

part 'skip_days_response.g.dart';

@JsonSerializable()
class SkipDaysResponse extends BaseResponse {
  @JsonKey(name: "data")
  Map<String, dynamic>? data;

  SkipDaysResponse(this.data);

  factory SkipDaysResponse.fromJson(Map<String, dynamic> json) =>
      _$SkipDaysResponseFromJson(json);

  @override
  Map<String, dynamic> toJson() => _$SkipDaysResponseToJson(this);
}
