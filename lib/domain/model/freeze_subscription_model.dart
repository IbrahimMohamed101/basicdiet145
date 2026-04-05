class FreezePolicyModel {
  bool enabled;
  int maxDays;
  int maxTimes;

  FreezePolicyModel(this.enabled, this.maxDays, this.maxTimes);
}

class FreezeSubscriptionDataModel {
  String subscriptionId;
  List<String> frozenDates;
  List<String> newlyFrozenDates;
  List<String> alreadyFrozen;
  int frozenDaysTotal;
  String validityEndDate;
  FreezePolicyModel freezePolicy;

  FreezeSubscriptionDataModel(
    this.subscriptionId,
    this.frozenDates,
    this.newlyFrozenDates,
    this.alreadyFrozen,
    this.frozenDaysTotal,
    this.validityEndDate,
    this.freezePolicy,
  );
}

class FreezeSubscriptionModel {
  FreezeSubscriptionDataModel data;

  FreezeSubscriptionModel(this.data);
}

class FreezeSubscriptionRequestModel {
  String startDate;
  int days;

  FreezeSubscriptionRequestModel(this.startDate, this.days);
}
