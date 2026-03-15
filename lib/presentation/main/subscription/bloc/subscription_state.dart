import 'package:basic_diet/domain/model/plans_model.dart';

abstract class SubscriptionState {
  const SubscriptionState();
}

class SubscriptionInitial extends SubscriptionState {
  const SubscriptionInitial();
}

class SubscriptionLoading extends SubscriptionState {
  const SubscriptionLoading();
}

class SubscriptionSuccess extends SubscriptionState {
  final PlansModel plansModel;
  const SubscriptionSuccess(this.plansModel);
}

class SubscriptionError extends SubscriptionState {
  final String message;
  const SubscriptionError(this.message);
}
