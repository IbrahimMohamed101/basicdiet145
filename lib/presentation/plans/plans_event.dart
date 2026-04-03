import 'package:equatable/equatable.dart';

abstract class PlansEvent extends Equatable {
  const PlansEvent();

  @override
  List<Object> get props => [];
}

class FetchCurrentSubscriptionOverviewEvent extends PlansEvent {}
