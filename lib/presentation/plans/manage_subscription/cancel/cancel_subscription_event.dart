abstract class CancelSubscriptionEvent {}

class SubmitCancelSubscriptionEvent extends CancelSubscriptionEvent {
  final String subscriptionId;

  SubmitCancelSubscriptionEvent({required this.subscriptionId});
}
