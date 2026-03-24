import 'package:basic_diet/domain/model/plans_model.dart';
import 'package:equatable/equatable.dart';

abstract class SubscriptionEvent extends Equatable {
  const SubscriptionEvent();

  @override
  List<Object> get props => [];
}

class GetPlansEvent extends SubscriptionEvent {
  const GetPlansEvent();
}

class SelectMealOptionEvent extends SubscriptionEvent {
  final MealOptionModel option;

  const SelectMealOptionEvent(this.option);

  @override
  List<Object> get props => [option];
}
