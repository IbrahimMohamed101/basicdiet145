import 'package:basic_diet/domain/model/add_ons_model.dart';
import 'package:basic_diet/domain/model/plans_model.dart';
import 'package:basic_diet/domain/model/subscription_checkout_model.dart';
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

enum SubscriptionCheckoutStatus { initial, loading, success, failure }

enum SubscriptionPromoStatus {
  initial,
  applying,
  applied,
  invalid,
  expired,
  ineligible,
  backendError,
}

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
  final dynamic quoteErrorCode;
  final SubscriptionQuoteRequestModel? lastQuoteRequest;
  final SubscriptionQuoteRequestModel? lastSuccessfulQuoteRequest;
  final SubscriptionCheckoutRequestModel? lastCheckoutRequest;
  final SubscriptionCheckoutStatus checkoutStatus;
  final SubscriptionCheckoutModel? subscriptionCheckout;
  final String? checkoutErrorMessage;
  final String promoCodeInput;
  final SubscriptionPromoStatus promoStatus;
  final String? promoMessage;
  final SubscriptionAppliedPromoModel? appliedPromo;
  final bool isPricingStale;
  final int expandedPlanIndex;

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
    this.quoteErrorCode,
    this.lastQuoteRequest,
    this.lastSuccessfulQuoteRequest,
    this.lastCheckoutRequest,
    this.checkoutStatus = SubscriptionCheckoutStatus.initial,
    this.subscriptionCheckout,
    this.checkoutErrorMessage,
    this.promoCodeInput = '',
    this.promoStatus = SubscriptionPromoStatus.initial,
    this.promoMessage,
    this.appliedPromo,
    this.isPricingStale = false,
    this.expandedPlanIndex = -1,
  });

  bool get canCheckout =>
      subscriptionQuote != null &&
      lastSuccessfulQuoteRequest != null &&
      !isPricingStale &&
      quoteStatus != SubscriptionQuoteStatus.loading &&
      checkoutStatus != SubscriptionCheckoutStatus.loading;

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
    Object? quoteErrorCode = _noChange,
    Object? lastQuoteRequest = _noChange,
    Object? lastSuccessfulQuoteRequest = _noChange,
    Object? lastCheckoutRequest = _noChange,
    SubscriptionCheckoutStatus? checkoutStatus,
    Object? subscriptionCheckout = _noChange,
    Object? checkoutErrorMessage = _noChange,
    String? promoCodeInput,
    SubscriptionPromoStatus? promoStatus,
    Object? promoMessage = _noChange,
    Object? appliedPromo = _noChange,
    bool? isPricingStale,
    int? expandedPlanIndex,
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
      subscriptionQuote: identical(subscriptionQuote, _noChange)
          ? this.subscriptionQuote
          : subscriptionQuote as SubscriptionQuoteModel?,
      quoteErrorMessage: identical(quoteErrorMessage, _noChange)
          ? this.quoteErrorMessage
          : quoteErrorMessage as String?,
      quoteErrorCode: identical(quoteErrorCode, _noChange)
          ? this.quoteErrorCode
          : quoteErrorCode,
      lastQuoteRequest: identical(lastQuoteRequest, _noChange)
          ? this.lastQuoteRequest
          : lastQuoteRequest as SubscriptionQuoteRequestModel?,
      lastSuccessfulQuoteRequest:
          identical(lastSuccessfulQuoteRequest, _noChange)
          ? this.lastSuccessfulQuoteRequest
          : lastSuccessfulQuoteRequest as SubscriptionQuoteRequestModel?,
      lastCheckoutRequest: identical(lastCheckoutRequest, _noChange)
          ? this.lastCheckoutRequest
          : lastCheckoutRequest as SubscriptionCheckoutRequestModel?,
      checkoutStatus: checkoutStatus ?? this.checkoutStatus,
      subscriptionCheckout: identical(subscriptionCheckout, _noChange)
          ? this.subscriptionCheckout
          : subscriptionCheckout as SubscriptionCheckoutModel?,
      checkoutErrorMessage: identical(checkoutErrorMessage, _noChange)
          ? this.checkoutErrorMessage
          : checkoutErrorMessage as String?,
      promoCodeInput: promoCodeInput ?? this.promoCodeInput,
      promoStatus: promoStatus ?? this.promoStatus,
      promoMessage: identical(promoMessage, _noChange)
          ? this.promoMessage
          : promoMessage as String?,
      appliedPromo: identical(appliedPromo, _noChange)
          ? this.appliedPromo
          : appliedPromo as SubscriptionAppliedPromoModel?,
      isPricingStale: isPricingStale ?? this.isPricingStale,
      expandedPlanIndex: expandedPlanIndex ?? this.expandedPlanIndex,
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
    quoteErrorCode,
    lastQuoteRequest,
    lastSuccessfulQuoteRequest,
    lastCheckoutRequest,
    checkoutStatus,
    subscriptionCheckout,
    checkoutErrorMessage,
    promoCodeInput,
    promoStatus,
    promoMessage,
    appliedPromo,
    isPricingStale,
    expandedPlanIndex,
  ];
}

class SubscriptionError extends SubscriptionState {
  final String message;
  const SubscriptionError(this.message);

  @override
  List<Object?> get props => [message];
}
