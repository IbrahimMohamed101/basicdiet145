import 'package:basic_diet/domain/model/add_ons_model.dart';
import 'package:basic_diet/domain/model/plans_model.dart';
import 'package:basic_diet/domain/model/subscription_quote_model.dart';
import 'package:equatable/equatable.dart';

abstract class SubscriptionState extends Equatable {
  const SubscriptionState();

  @override
  List<Object?> get props => [];
}

class SubscriptionInitial extends SubscriptionState {
  const SubscriptionInitial();
}

class SubscriptionLoading extends SubscriptionState {
  const SubscriptionLoading();
}

enum SubscriptionQuoteStatus { initial, loading, success, failure }

const Object _noChange = Object();

class SubscriptionSuccess extends SubscriptionState {
  final PlansModel plansModel;
  final PlanModel? selectedPlan;
  final GramOptionModel? selectedGramOption;
  final MealOptionModel? selectedMealOption;
  final Map<String, int> selectedPremiumMealCounters;
  final Set<AddOnModel> selectedAddOns;
  final SubscriptionQuoteStatus quoteStatus;
  final SubscriptionQuoteModel? subscriptionQuote;
  final String? quoteErrorMessage;

  const SubscriptionSuccess(
    this.plansModel, {
    this.selectedPlan,
    this.selectedGramOption,
    this.selectedMealOption,
    this.selectedPremiumMealCounters = const {},
    this.selectedAddOns = const {},
    this.quoteStatus = SubscriptionQuoteStatus.initial,
    this.subscriptionQuote,
    this.quoteErrorMessage,
  });

  SubscriptionSuccess copyWith({
    PlansModel? plansModel,
    PlanModel? selectedPlan,
    GramOptionModel? selectedGramOption,
    MealOptionModel? selectedMealOption,
    Map<String, int>? selectedPremiumMealCounters,
    Set<AddOnModel>? selectedAddOns,
    SubscriptionQuoteStatus? quoteStatus,
    Object? subscriptionQuote = _noChange,
    Object? quoteErrorMessage = _noChange,
  }) {
    return SubscriptionSuccess(
      plansModel ?? this.plansModel,
      selectedPlan: selectedPlan ?? this.selectedPlan,
      selectedGramOption: selectedGramOption ?? this.selectedGramOption,
      selectedMealOption: selectedMealOption ?? this.selectedMealOption,
      selectedPremiumMealCounters:
          selectedPremiumMealCounters ?? this.selectedPremiumMealCounters,
      selectedAddOns: selectedAddOns ?? this.selectedAddOns,
      quoteStatus: quoteStatus ?? this.quoteStatus,
      subscriptionQuote:
          identical(subscriptionQuote, _noChange)
              ? this.subscriptionQuote
              : subscriptionQuote as SubscriptionQuoteModel?,
      quoteErrorMessage:
          identical(quoteErrorMessage, _noChange)
              ? this.quoteErrorMessage
              : quoteErrorMessage as String?,
    );
  }

  @override
  List<Object?> get props => [
    plansModel,
    selectedPlan,
    selectedGramOption,
    selectedMealOption,
    selectedPremiumMealCounters,
    selectedAddOns,
    quoteStatus,
    subscriptionQuote,
    quoteErrorMessage,
  ];
}

class SubscriptionError extends SubscriptionState {
  final String message;
  const SubscriptionError(this.message);

  @override
  List<Object?> get props => [message];
}
