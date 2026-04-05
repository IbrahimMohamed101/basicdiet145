import 'package:json_annotation/json_annotation.dart';
import 'package:basic_diet/data/response/base_response/base_response.dart';

part 'freeze_subscription_response.g.dart';

@JsonSerializable()
class FreezePolicyResponse {
  @JsonKey(name: "enabled")
  bool? enabled;
  @JsonKey(name: "maxDays")
  int? maxDays;
  @JsonKey(name: "maxTimes")
  int? maxTimes;

  FreezePolicyResponse(this.enabled, this.maxDays, this.maxTimes);

  factory FreezePolicyResponse.fromJson(Map<String, dynamic> json) =>
      _$FreezePolicyResponseFromJson(json);
  Map<String, dynamic> toJson() => _$FreezePolicyResponseToJson(this);
}

@JsonSerializable()
class FreezeSubscriptionDataResponse {
  @JsonKey(name: "subscriptionId")
  String? subscriptionId;
  @JsonKey(name: "frozenDates")
  List<String>? frozenDates;
  @JsonKey(name: "newlyFrozenDates")
  List<String>? newlyFrozenDates;
  @JsonKey(name: "alreadyFrozen")
  List<String>? alreadyFrozen;
  @JsonKey(name: "frozenDaysTotal")
  int? frozenDaysTotal;
  @JsonKey(name: "validityEndDate")
  String? validityEndDate;
  @JsonKey(name: "freezePolicy")
  FreezePolicyResponse? freezePolicy;

  FreezeSubscriptionDataResponse(
    this.subscriptionId,
    this.frozenDates,
    this.newlyFrozenDates,
    this.alreadyFrozen,
    this.frozenDaysTotal,
    this.validityEndDate,
    this.freezePolicy,
  );

  factory FreezeSubscriptionDataResponse.fromJson(Map<String, dynamic> json) =>
      _$FreezeSubscriptionDataResponseFromJson(json);
  Map<String, dynamic> toJson() => _$FreezeSubscriptionDataResponseToJson(this);
}

@JsonSerializable()
class FreezeSubscriptionResponse extends BaseResponse {
  @JsonKey(name: "data")
  FreezeSubscriptionDataResponse? data;

  FreezeSubscriptionResponse(this.data);

  factory FreezeSubscriptionResponse.fromJson(Map<String, dynamic> json) =>
      _$FreezeSubscriptionResponseFromJson(json);
  @override
  Map<String, dynamic> toJson() => _$FreezeSubscriptionResponseToJson(this);
}
