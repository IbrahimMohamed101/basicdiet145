import 'package:json_annotation/json_annotation.dart';

part 'pickup_prepare_response.g.dart';

@JsonSerializable()
class PickupPrepareDataResponse {
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
  @JsonKey(name: "pickupRequested")
  bool? pickupRequested;
  @JsonKey(name: "nextAction")
  String? nextAction;

  PickupPrepareDataResponse(
    this.subscriptionId,
    this.date,
    this.currentStep,
    this.status,
    this.statusLabel,
    this.message,
    this.pickupRequested,
    this.nextAction,
  );

  factory PickupPrepareDataResponse.fromJson(Map<String, dynamic> json) =>
      _$PickupPrepareDataResponseFromJson(json);

  Map<String, dynamic> toJson() => _$PickupPrepareDataResponseToJson(this);
}

@JsonSerializable()
class PickupPrepareResponse {
  @JsonKey(name: "status")
  bool? status;
  @JsonKey(name: "data")
  PickupPrepareDataResponse? data;

  PickupPrepareResponse(this.status, this.data);

  factory PickupPrepareResponse.fromJson(Map<String, dynamic> json) =>
      _$PickupPrepareResponseFromJson(json);

  Map<String, dynamic> toJson() => _$PickupPrepareResponseToJson(this);
}
