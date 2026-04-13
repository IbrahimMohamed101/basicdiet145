import 'package:basic_diet/domain/model/current_subscription_overview_model.dart';
import 'package:basic_diet/domain/model/timeline_model.dart';
import 'package:equatable/equatable.dart';

abstract class PlansState extends Equatable {
  final CurrentSubscriptionOverviewModel? data;
  const PlansState({this.data});

  @override
  List<Object?> get props => [data];
}

class PlansInitial extends PlansState {
  const PlansInitial() : super();
}

class PlansLoading extends PlansState {
  const PlansLoading() : super();
}

class CurrentSubscriptionOverviewLoaded extends PlansState {
  const CurrentSubscriptionOverviewLoaded(
    CurrentSubscriptionOverviewModel data,
  ) : super(data: data);

  @override
  List<Object> get props => [data!];
}

class NavigateToMealPlannerState extends PlansState {
  final List<TimelineDayModel> timelineDays;
  final int initialDayIndex;
  final int premiumMealsRemaining;
  final String subscriptionId;

  const NavigateToMealPlannerState({
    required this.timelineDays,
    required this.initialDayIndex,
    required this.premiumMealsRemaining,
    required this.subscriptionId,
    CurrentSubscriptionOverviewModel? data,
  }) : super(data: data);

  @override
  List<Object> get props => [
        timelineDays,
        initialDayIndex,
        premiumMealsRemaining,
        subscriptionId,
        if (data != null) data!,
      ];
}

class OpenPlannerLoading extends PlansState {
  const OpenPlannerLoading({CurrentSubscriptionOverviewModel? data})
      : super(data: data);
}

class PreparePickupLoading extends PlansState {
  const PreparePickupLoading({CurrentSubscriptionOverviewModel? data})
      : super(data: data);
}

class PreparePickupSuccess extends PlansState {
  const PreparePickupSuccess({CurrentSubscriptionOverviewModel? data})
      : super(data: data);
}

class PlansError extends PlansState {
  final String message;

  const PlansError(this.message, {CurrentSubscriptionOverviewModel? data})
      : super(data: data);

  @override
  List<Object> get props => [message, if (data != null) data!];
}
