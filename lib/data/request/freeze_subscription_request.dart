import 'package:json_annotation/json_annotation.dart';

part 'freeze_subscription_request.g.dart';

@JsonSerializable()
class FreezeSubscriptionRequest {
  @JsonKey(name: "startDate")
  String startDate;
  @JsonKey(name: "days")
  int days;

  FreezeSubscriptionRequest(this.startDate, this.days);

  factory FreezeSubscriptionRequest.fromJson(Map<String, dynamic> json) =>
      _$FreezeSubscriptionRequestFromJson(json);

  Map<String, dynamic> toJson() => _$FreezeSubscriptionRequestToJson(this);
}
