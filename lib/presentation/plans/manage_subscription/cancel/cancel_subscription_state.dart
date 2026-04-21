import 'package:basic_diet/domain/model/cancel_subscription_model.dart';

abstract class CancelSubscriptionState {}

class CancelSubscriptionInitial extends CancelSubscriptionState {}

class CancelSubscriptionLoading extends CancelSubscriptionState {}

class CancelSubscriptionSuccess extends CancelSubscriptionState {
  final CancelSubscriptionModel data;

  CancelSubscriptionSuccess(this.data);
}

class CancelSubscriptionError extends CancelSubscriptionState {
  final String message;

  CancelSubscriptionError(this.message);
}
