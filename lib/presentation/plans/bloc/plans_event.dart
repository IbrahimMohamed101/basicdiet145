import 'package:equatable/equatable.dart';

abstract class PlansEvent extends Equatable {
  const PlansEvent();

  @override
  List<Object> get props => [];
}

class FetchCurrentSubscriptionOverviewEvent extends PlansEvent {}

class FetchTimelineAndOpenPlannerEvent extends PlansEvent {
  final String subscriptionId;
  final bool openCurrentDay;
  const FetchTimelineAndOpenPlannerEvent(
    this.subscriptionId, {
    this.openCurrentDay = false,
  });

  @override
  List<Object> get props => [subscriptionId, openCurrentDay];
}

class PreparePickupEvent extends PlansEvent {
  final String subscriptionId;
  const PreparePickupEvent(this.subscriptionId);

  @override
  List<Object> get props => [subscriptionId];
}
