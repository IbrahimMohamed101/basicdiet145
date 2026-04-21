import 'package:json_annotation/json_annotation.dart';

part 'cancel_subscription_request.g.dart';

@JsonSerializable()
class CancelSubscriptionRequest {
  @JsonKey(name: "status")
  final String status;

  const CancelSubscriptionRequest({this.status = "canceled"});

  factory CancelSubscriptionRequest.fromJson(Map<String, dynamic> json) =>
      _$CancelSubscriptionRequestFromJson(json);

  Map<String, dynamic> toJson() => _$CancelSubscriptionRequestToJson(this);
}
