import 'package:json_annotation/json_annotation.dart';
import 'package:basic_diet/data/response/base_response/base_response.dart';

part 'cancel_subscription_response.g.dart';

@JsonSerializable()
class CancelSubscriptionDataResponse {
  @JsonKey(name: "_id")
  final String? id;
  @JsonKey(name: "status")
  final String? status;
  @JsonKey(name: "canceledAt")
  final String? canceledAt;

  CancelSubscriptionDataResponse({this.id, this.status, this.canceledAt});

  factory CancelSubscriptionDataResponse.fromJson(Map<String, dynamic> json) =>
      _$CancelSubscriptionDataResponseFromJson(json);

  Map<String, dynamic> toJson() => _$CancelSubscriptionDataResponseToJson(this);
}

@JsonSerializable()
class CancelSubscriptionResponse extends BaseResponse {
  @JsonKey(name: "data")
  final CancelSubscriptionDataResponse? data;

  CancelSubscriptionResponse({this.data});

  factory CancelSubscriptionResponse.fromJson(Map<String, dynamic> json) =>
      _$CancelSubscriptionResponseFromJson(json);

  @override
  Map<String, dynamic> toJson() => _$CancelSubscriptionResponseToJson(this);
}
