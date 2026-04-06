abstract class FreezeSubscriptionEvent {}

class SubmitFreezeSubscriptionEvent extends FreezeSubscriptionEvent {
  final String subscriptionId;
  final String startDate;
  final int days;

  SubmitFreezeSubscriptionEvent({
    required this.subscriptionId,
    required this.startDate,
    required this.days,
  });
}
