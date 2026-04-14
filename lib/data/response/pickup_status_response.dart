import 'package:json_annotation/json_annotation.dart';

part 'pickup_status_response.g.dart';

@JsonSerializable()
class PickupStatusDataResponse {
  @JsonKey(name: "subscriptionId")
  String? subscriptionId;
  @JsonKey(name: "date")
  String? date;
  @JsonKey(name: "currentStep")
  int? currentStep;
  @JsonKey(name: "status")
  String? status;
  @JsonKey(name: "statusLabel")
  String? statusLabel;
  @JsonKey(name: "message")
  String? message;
  @JsonKey(name: "canModify")
  bool? canModify;
  @JsonKey(name: "isReady")
  bool? isReady;
  @JsonKey(name: "isCompleted")
  bool? isCompleted;
  @JsonKey(name: "pickupCode")
  String? pickupCode;
  @JsonKey(name: "pickupCodeIssuedAt")
  String? pickupCodeIssuedAt;
  @JsonKey(name: "fulfilledAt")
  String? fulfilledAt;

  PickupStatusDataResponse(
    this.subscriptionId,
    this.date,
    this.currentStep,
    this.status,
    this.statusLabel,
    this.message,
    this.canModify,
    this.isReady,
    this.isCompleted,
    this.pickupCode,
    this.pickupCodeIssuedAt,
    this.fulfilledAt,
  );

  factory PickupStatusDataResponse.fromJson(Map<String, dynamic> json) =>
      _$PickupStatusDataResponseFromJson(json);

  Map<String, dynamic> toJson() => _$PickupStatusDataResponseToJson(this);
}

@JsonSerializable()
class PickupStatusResponse {
  @JsonKey(name: "status")
  bool? status;
  @JsonKey(name: "data")
  PickupStatusDataResponse? data;

  PickupStatusResponse(this.status, this.data);

  factory PickupStatusResponse.fromJson(Map<String, dynamic> json) =>
      _$PickupStatusResponseFromJson(json);

  Map<String, dynamic> toJson() => _$PickupStatusResponseToJson(this);
}
