import 'package:basic_diet/domain/model/current_subscription_overview_model.dart';
import 'package:equatable/equatable.dart';

abstract class PlansState extends Equatable {
  const PlansState();

  @override
  List<Object?> get props => [];
}

class PlansInitial extends PlansState {}

class PlansLoading extends PlansState {}

class CurrentSubscriptionOverviewLoaded extends PlansState {
  final CurrentSubscriptionOverviewModel currentSubscriptionOverviewModel;

  const CurrentSubscriptionOverviewLoaded(this.currentSubscriptionOverviewModel);

  @override
  List<Object> get props => [currentSubscriptionOverviewModel];
}

class PlansError extends PlansState {
  final String message;

  const PlansError(this.message);

  @override
  List<Object> get props => [message];
}
