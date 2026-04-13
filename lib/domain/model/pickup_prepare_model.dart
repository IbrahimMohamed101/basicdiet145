class PickupPrepareDataModel {
  String subscriptionId;
  String date;
  int currentStep;
  String status;
  String statusLabel;
  String message;
  bool pickupRequested;
  String nextAction;

  PickupPrepareDataModel(
    this.subscriptionId,
    this.date,
    this.currentStep,
    this.status,
    this.statusLabel,
    this.message,
    this.pickupRequested,
    this.nextAction,
  );
}

class PickupPrepareModel {
  bool status;
  PickupPrepareDataModel? data;

  PickupPrepareModel(this.status, this.data);
}
