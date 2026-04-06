import 'package:equatable/equatable.dart';

abstract class TimelineEvent extends Equatable {
  const TimelineEvent();

  @override
  List<Object?> get props => [];
}

class FetchTimelineEvent extends TimelineEvent {
  final String subscriptionId;

  const FetchTimelineEvent(this.subscriptionId);

  @override
  List<Object?> get props => [subscriptionId];
}
