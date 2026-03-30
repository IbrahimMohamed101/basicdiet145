import 'package:basic_diet/domain/model/add_ons_model.dart';
import 'package:basic_diet/domain/model/plans_model.dart';
import 'package:basic_diet/domain/model/subscription_quote_model.dart';
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
  final PlanModel plan;
  final GramOptionModel gramOption;
  final MealOptionModel option;

  const SelectMealOptionEvent({
    required this.plan,
    required this.gramOption,
    required this.option,
  });

  @override
  List<Object> get props => [plan, gramOption, option];
}

class SavePremiumMealsSelectionEvent extends SubscriptionEvent {
  final Map<String, int> mealCounters;

  const SavePremiumMealsSelectionEvent(this.mealCounters);

  @override
  List<Object> get props => [mealCounters];
}

class SaveAddOnsSelectionEvent extends SubscriptionEvent {
  final Set<AddOnModel> selectedAddOns;

  const SaveAddOnsSelectionEvent(this.selectedAddOns);

  @override
  List<Object> get props => [selectedAddOns];
}

class GetSubscriptionQuoteEvent extends SubscriptionEvent {
  final SubscriptionQuoteRequestModel request;

  const GetSubscriptionQuoteEvent(this.request);

  @override
  List<Object> get props => [request];
}
