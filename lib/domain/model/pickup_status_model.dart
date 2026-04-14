class PickupStatusDataModel {
  String subscriptionId;
  String date;
  int currentStep;
  String status;
  String statusLabel;
  String message;
  bool canModify;
  bool isReady;
  bool isCompleted;
  String? pickupCode;
  String? pickupCodeIssuedAt;
  String? fulfilledAt;

  PickupStatusDataModel(
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
}

class PickupStatusModel {
  bool status;
  PickupStatusDataModel? data;

  PickupStatusModel(this.status, this.data);
}
