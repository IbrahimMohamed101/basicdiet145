import 'package:basic_diet/domain/model/freeze_subscription_model.dart';

abstract class FreezeSubscriptionState {}

class FreezeSubscriptionInitial extends FreezeSubscriptionState {}

class FreezeSubscriptionLoading extends FreezeSubscriptionState {}

class FreezeSubscriptionSuccess extends FreezeSubscriptionState {
  final FreezeSubscriptionModel data;

  FreezeSubscriptionSuccess(this.data);
}

class FreezeSubscriptionError extends FreezeSubscriptionState {
  final String message;

  FreezeSubscriptionError(this.message);
}
