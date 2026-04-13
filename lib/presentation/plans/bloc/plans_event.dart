import 'package:equatable/equatable.dart';

abstract class PlansEvent extends Equatable {
  const PlansEvent();

  @override
  List<Object> get props => [];
}

class FetchCurrentSubscriptionOverviewEvent extends PlansEvent {}

class FetchTimelineAndOpenPlannerEvent extends PlansEvent {
  final String subscriptionId;
  const FetchTimelineAndOpenPlannerEvent(this.subscriptionId);

  @override
  List<Object> get props => [subscriptionId];
}
