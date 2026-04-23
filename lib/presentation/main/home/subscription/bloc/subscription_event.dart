import 'package:basic_diet/domain/model/add_ons_model.dart';
import 'package:basic_diet/domain/model/plans_model.dart';
import 'package:basic_diet/domain/model/subscription_checkout_model.dart';
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

class TogglePlanExpansionEvent extends SubscriptionEvent {
  final int index;
  const TogglePlanExpansionEvent(this.index);

  @override
  List<Object> get props => [index];
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
  final bool isPromoUpdate;

  const GetSubscriptionQuoteEvent(this.request, {this.isPromoUpdate = false});

  @override
  List<Object> get props => [request, isPromoUpdate];
}

class CheckoutSubscriptionEvent extends SubscriptionEvent {
  final SubscriptionCheckoutRequestModel request;

  const CheckoutSubscriptionEvent(this.request);

  @override
  List<Object> get props => [request];
}

class UpdatePromoCodeInputEvent extends SubscriptionEvent {
  final String value;

  const UpdatePromoCodeInputEvent(this.value);

  @override
  List<Object> get props => [value];
}

class ApplyPromoCodeEvent extends SubscriptionEvent {
  const ApplyPromoCodeEvent();
}

class RemovePromoCodeEvent extends SubscriptionEvent {
  const RemovePromoCodeEvent();
}
