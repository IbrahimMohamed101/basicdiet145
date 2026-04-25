import 'package:basic_diet/domain/model/add_ons_model.dart';
import 'package:basic_diet/domain/model/subscription_checkout_model.dart';
import 'package:basic_diet/domain/model/subscription_quote_model.dart';
import 'package:basic_diet/domain/usecase/checkout_subscription_usecase.dart';
import 'package:basic_diet/domain/usecase/get_plans_usecase.dart';
import 'package:basic_diet/domain/usecase/get_subscription_quote_usecase.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'subscription_event.dart';
import 'subscription_state.dart';

class SubscriptionBloc extends Bloc<SubscriptionEvent, SubscriptionState> {
  final GetPlansUseCase _getPlansUseCase;
  final GetSubscriptionQuoteUseCase _getSubscriptionQuoteUseCase;
  final CheckoutSubscriptionUseCase _checkoutSubscriptionUseCase;

  SubscriptionBloc(
    this._getPlansUseCase,
    this._getSubscriptionQuoteUseCase,
    this._checkoutSubscriptionUseCase,
  ) : super(const SubscriptionInitial()) {
    on<GetPlansEvent>(_onGetPlans);
    on<SelectMealOptionEvent>(_onSelectMealOption);
    on<TogglePlanExpansionEvent>(_onTogglePlanExpansion);
    on<SavePremiumMealsSelectionEvent>(_onSavePremiumMealsSelection);
    on<SaveAddOnsSelectionEvent>(_onSaveAddOnsSelection);
    on<GetSubscriptionQuoteEvent>(_onGetSubscriptionQuote);
    on<CheckoutSubscriptionEvent>(_onCheckoutSubscription);
    on<UpdatePromoCodeInputEvent>(_onUpdatePromoCodeInput);
    on<ApplyPromoCodeEvent>(_onApplyPromoCode);
    on<RemovePromoCodeEvent>(_onRemovePromoCode);
  }

  static const String _pricingChangedMessage =
      'Pricing changed. Please refresh your quote and try again.';

  Future<void> _onGetPlans(
    GetPlansEvent event,
    Emitter<SubscriptionState> emit,
  ) async {
    emit(const SubscriptionLoading());
    final result = await _getPlansUseCase.execute(null);
    result.fold((failure) => emit(SubscriptionError(failure.message)), (
      plansModel,
    ) {
      final defaultPlan = plansModel.plans.isNotEmpty
          ? plansModel.plans.first
          : null;
      final defaultGramOption =
          defaultPlan != null && defaultPlan.gramsOptions.isNotEmpty
          ? defaultPlan.gramsOptions.first
          : null;
      final defaultMealOption =
          defaultGramOption != null && defaultGramOption.mealsOptions.isNotEmpty
          ? defaultGramOption.mealsOptions.first
          : null;

      emit(
        SubscriptionSuccess(
          plansModel,
          selectedPlan: defaultPlan,
          selectedGramOption: defaultGramOption,
          selectedMealOption: defaultMealOption,
          expandedPlanIndex: defaultPlan != null ? 0 : -1,
        ),
      );
    });
  }

  void _onSelectMealOption(
    SelectMealOptionEvent event,
    Emitter<SubscriptionState> emit,
  ) {
    if (state is SubscriptionSuccess) {
      final successState = state as SubscriptionSuccess;
      assert(() {
        debugPrint('Selected: ${event.option.mealsPerDay}');
        return true;
      }());
      emit(
        successState.copyWith(
          selectedPlan: event.plan,
          selectedGramOption: event.gramOption,
          selectedMealOption: event.option,
          quoteStatus: SubscriptionQuoteStatus.initial,
          subscriptionQuote: null,
          quoteErrorMessage: null,
          quoteErrorCode: null,
          lastQuoteRequest: null,
          lastSuccessfulQuoteRequest: null,
          lastCheckoutRequest: null,
          checkoutStatus: SubscriptionCheckoutStatus.initial,
          subscriptionCheckout: null,
          checkoutErrorMessage: null,
          promoCodeInput: '',
          promoStatus: SubscriptionPromoStatus.initial,
          appliedPromo: null,
          promoMessage: null,
          isPricingStale: false,
        ),
      );
    }
  }

  void _onSavePremiumMealsSelection(
    SavePremiumMealsSelectionEvent event,
    Emitter<SubscriptionState> emit,
  ) {
    if (state is SubscriptionSuccess) {
      final successState = state as SubscriptionSuccess;
      final filteredCounters = Map<String, int>.fromEntries(
        event.mealCounters.entries.where((entry) => entry.value > 0),
      );

      emit(
        successState.copyWith(
          selectedPremiumMealCounters: filteredCounters,
          quoteStatus: SubscriptionQuoteStatus.initial,
          subscriptionQuote: null,
          quoteErrorMessage: null,
          quoteErrorCode: null,
          lastQuoteRequest: null,
          lastSuccessfulQuoteRequest: null,
          lastCheckoutRequest: null,
          checkoutStatus: SubscriptionCheckoutStatus.initial,
          subscriptionCheckout: null,
          checkoutErrorMessage: null,
          promoCodeInput: '',
          promoStatus: SubscriptionPromoStatus.initial,
          appliedPromo: null,
          promoMessage: null,
          isPricingStale: false,
        ),
      );
    }
  }

  void _onSaveAddOnsSelection(
    SaveAddOnsSelectionEvent event,
    Emitter<SubscriptionState> emit,
  ) {
    if (state is SubscriptionSuccess) {
      final successState = state as SubscriptionSuccess;
      emit(
        successState.copyWith(
          selectedAddOns: Set<AddOnModel>.from(event.selectedAddOns),
          quoteStatus: SubscriptionQuoteStatus.initial,
          subscriptionQuote: null,
          quoteErrorMessage: null,
          quoteErrorCode: null,
          lastQuoteRequest: null,
          lastSuccessfulQuoteRequest: null,
          lastCheckoutRequest: null,
          checkoutStatus: SubscriptionCheckoutStatus.initial,
          subscriptionCheckout: null,
          checkoutErrorMessage: null,
          promoCodeInput: '',
          promoStatus: SubscriptionPromoStatus.initial,
          appliedPromo: null,
          promoMessage: null,
          isPricingStale: false,
        ),
      );
    }
  }

  Future<void> _onGetSubscriptionQuote(
    GetSubscriptionQuoteEvent event,
    Emitter<SubscriptionState> emit,
  ) async {
    if (state is! SubscriptionSuccess) return;

    final successState = state as SubscriptionSuccess;
    emit(
      successState.copyWith(
        quoteStatus: SubscriptionQuoteStatus.loading,
        quoteErrorMessage: null,
        quoteErrorCode: null,
        checkoutStatus: SubscriptionCheckoutStatus.initial,
        lastCheckoutRequest: null,
        subscriptionCheckout: null,
        checkoutErrorMessage: null,
        promoStatus: event.isPromoUpdate
            ? SubscriptionPromoStatus.applying
            : successState.promoStatus,
        promoMessage: event.isPromoUpdate ? null : successState.promoMessage,
        isPricingStale: event.isPromoUpdate
            ? true
            : successState.isPricingStale,
      ),
    );

    final result = await _getSubscriptionQuoteUseCase.execute(event.request);
    result.fold(
      (failure) => emit(
        successState.copyWith(
          quoteStatus: SubscriptionQuoteStatus.failure,
          subscriptionQuote: event.isPromoUpdate
              ? successState.subscriptionQuote
              : null,
          quoteErrorMessage: failure.message,
          quoteErrorCode: failure.code,
          checkoutStatus: SubscriptionCheckoutStatus.initial,
          lastCheckoutRequest: null,
          subscriptionCheckout: null,
          checkoutErrorMessage: null,
          promoStatus: event.isPromoUpdate
              ? _promoStatusFromFailure(failure.code)
              : successState.promoStatus,
          promoMessage: event.isPromoUpdate ? failure.message : null,
          appliedPromo: event.isPromoUpdate ? successState.appliedPromo : null,
          isPricingStale: event.isPromoUpdate
              ? _isPricingStale(
                  successState.promoCodeInput,
                  successState.lastSuccessfulQuoteRequest,
                )
              : false,
        ),
      ),
      (quote) {
        final appliedPromo = quote.appliedPromo;
        final trimmedPromo = event.request.promoCode?.trim() ?? '';

        emit(
          successState.copyWith(
            lastQuoteRequest: event.request,
            lastSuccessfulQuoteRequest: event.request,
            quoteStatus: SubscriptionQuoteStatus.success,
            subscriptionQuote: quote,
            quoteErrorMessage: null,
            quoteErrorCode: null,
            checkoutStatus: SubscriptionCheckoutStatus.initial,
            lastCheckoutRequest: null,
            subscriptionCheckout: null,
            checkoutErrorMessage: null,
            promoCodeInput: appliedPromo?.code ?? trimmedPromo,
            promoStatus: trimmedPromo.isEmpty
                ? SubscriptionPromoStatus.initial
                : SubscriptionPromoStatus.applied,
            promoMessage: _resolvePromoMessage(quote, appliedPromo),
            appliedPromo: appliedPromo,
            isPricingStale: false,
          ),
        );
      },
    );
  }

  Future<void> _onCheckoutSubscription(
    CheckoutSubscriptionEvent event,
    Emitter<SubscriptionState> emit,
  ) async {
    if (state is! SubscriptionSuccess) return;

    final successState = state as SubscriptionSuccess;
    final lastSuccessfulQuoteRequest = successState.lastSuccessfulQuoteRequest;

    if (!successState.canCheckout ||
        lastSuccessfulQuoteRequest == null ||
        !_isCheckoutRequestAligned(event.request, lastSuccessfulQuoteRequest)) {
      emit(
        successState.copyWith(
          lastCheckoutRequest: event.request,
          checkoutStatus: SubscriptionCheckoutStatus.failure,
          subscriptionCheckout: null,
          checkoutErrorMessage: _pricingChangedMessage,
        ),
      );
      return;
    }

    emit(
      successState.copyWith(
        lastCheckoutRequest: event.request,
        checkoutStatus: SubscriptionCheckoutStatus.loading,
        checkoutErrorMessage: null,
      ),
    );

    final result = await _checkoutSubscriptionUseCase.execute(event.request);
    result.fold(
      (failure) => emit(
        successState.copyWith(
          lastCheckoutRequest: event.request,
          checkoutStatus: SubscriptionCheckoutStatus.failure,
          subscriptionCheckout: null,
          checkoutErrorMessage: failure.message,
        ),
      ),
      (checkout) {
        final quote = successState.subscriptionQuote;
        if (quote == null ||
            !_totalsMatchQuote(checkout.totals, quote.breakdown)) {
          emit(
            successState.copyWith(
              lastCheckoutRequest: event.request,
              checkoutStatus: SubscriptionCheckoutStatus.failure,
              subscriptionCheckout: null,
              checkoutErrorMessage: _pricingChangedMessage,
            ),
          );
          return;
        }

        emit(
          successState.copyWith(
            lastCheckoutRequest: event.request,
            checkoutStatus: SubscriptionCheckoutStatus.success,
            subscriptionCheckout: checkout,
            checkoutErrorMessage: null,
          ),
        );
      },
    );
  }

  void _onTogglePlanExpansion(
    TogglePlanExpansionEvent event,
    Emitter<SubscriptionState> emit,
  ) {
    if (state is SubscriptionSuccess) {
      final successState = state as SubscriptionSuccess;
      // expandedPlanIndex hold the index of the expanded plan
      // if the expandedPlanIndex is equal to the event.index then it will be -1 else it will be event.index
      final newIndex = successState.expandedPlanIndex == event.index
          ? -1
          : event.index;
      emit(successState.copyWith(expandedPlanIndex: newIndex));
    }
  }

  void _onUpdatePromoCodeInput(
    UpdatePromoCodeInputEvent event,
    Emitter<SubscriptionState> emit,
  ) {
    if (state is! SubscriptionSuccess) return;

    final successState = state as SubscriptionSuccess;
    final alignedSuccessfulRequest = successState.lastSuccessfulQuoteRequest;
    final isPricingStale = _isPricingStale(
      event.value,
      alignedSuccessfulRequest,
    );
    emit(
      successState.copyWith(
        promoCodeInput: event.value,
        promoStatus: event.value.trim().isEmpty
            ? SubscriptionPromoStatus.initial
            : successState.promoStatus == SubscriptionPromoStatus.applied
            ? SubscriptionPromoStatus.initial
            : successState.promoStatus,
        promoMessage: event.value.trim().isEmpty || isPricingStale
            ? null
            : successState.promoMessage,
        appliedPromo:
            event.value.trim().isEmpty ||
                isPricingStale ||
                event.value.trim() !=
                    (successState.appliedPromo?.code.trim() ?? '')
            ? null
            : successState.appliedPromo,
        isPricingStale: isPricingStale,
      ),
    );
  }

  void _onApplyPromoCode(
    ApplyPromoCodeEvent event,
    Emitter<SubscriptionState> emit,
  ) {
    if (state is! SubscriptionSuccess) return;

    final successState = state as SubscriptionSuccess;
    final lastQuoteRequest = successState.lastSuccessfulQuoteRequest;
    final promoCode = successState.promoCodeInput.trim();

    if (lastQuoteRequest == null || promoCode.isEmpty) {
      emit(
        successState.copyWith(
          promoStatus: SubscriptionPromoStatus.invalid,
          isPricingStale: true,
        ),
      );
      return;
    }

    add(
      GetSubscriptionQuoteEvent(
        SubscriptionQuoteRequestModel(
          planId: lastQuoteRequest.planId,
          grams: lastQuoteRequest.grams,
          mealsPerDay: lastQuoteRequest.mealsPerDay,
          startDate: lastQuoteRequest.startDate,
          promoCode: promoCode,
          premiumItems: lastQuoteRequest.premiumItems,
          addons: lastQuoteRequest.addons,
          delivery: lastQuoteRequest.delivery,
        ),
        isPromoUpdate: true,
      ),
    );
  }

  void _onRemovePromoCode(
    RemovePromoCodeEvent event,
    Emitter<SubscriptionState> emit,
  ) {
    if (state is! SubscriptionSuccess) return;

    final successState = state as SubscriptionSuccess;
    final lastQuoteRequest = successState.lastSuccessfulQuoteRequest;

    if (lastQuoteRequest == null) {
      emit(
        successState.copyWith(
          promoCodeInput: '',
          promoStatus: SubscriptionPromoStatus.initial,
          promoMessage: null,
          appliedPromo: null,
          isPricingStale: false,
        ),
      );
      return;
    }

    emit(
      successState.copyWith(
        promoCodeInput: '',
        promoStatus: SubscriptionPromoStatus.applying,
        promoMessage: null,
        appliedPromo: null,
        isPricingStale: true,
      ),
    );

    add(
      GetSubscriptionQuoteEvent(
        SubscriptionQuoteRequestModel(
          planId: lastQuoteRequest.planId,
          grams: lastQuoteRequest.grams,
          mealsPerDay: lastQuoteRequest.mealsPerDay,
          startDate: lastQuoteRequest.startDate,
          premiumItems: lastQuoteRequest.premiumItems,
          addons: lastQuoteRequest.addons,
          delivery: lastQuoteRequest.delivery,
        ),
        isPromoUpdate: true,
      ),
    );
  }

  SubscriptionPromoStatus _promoStatusFromFailure(dynamic code) {
    final normalizedCode = code?.toString().trim().toUpperCase() ?? '';
    if (normalizedCode.contains('EXPIRED')) {
      return SubscriptionPromoStatus.expired;
    }
    if (normalizedCode.contains('ELIGIBLE') ||
        normalizedCode.contains('APPLICABLE')) {
      return SubscriptionPromoStatus.ineligible;
    }
    if (normalizedCode.contains('PROMO') || normalizedCode.contains('COUPON')) {
      return SubscriptionPromoStatus.invalid;
    }
    return SubscriptionPromoStatus.backendError;
  }

  String? _resolvePromoMessage(
    SubscriptionQuoteModel quote,
    SubscriptionAppliedPromoModel? appliedPromo,
  ) {
    if (appliedPromo == null) {
      return null;
    }

    if (appliedPromo.message.trim().isNotEmpty) {
      return appliedPromo.message;
    }

    if (appliedPromo.label.trim().isNotEmpty) {
      return appliedPromo.label;
    }

    for (final item in quote.summary.lineItems) {
      final kind = item.kind.trim().toLowerCase();
      if (kind == 'discount' || kind == 'promo' || kind == 'promo_code') {
        return item.label;
      }
    }

    return null;
  }

  bool _isPricingStale(
    String currentInput,
    SubscriptionQuoteRequestModel? successfulRequest,
  ) {
    if (successfulRequest == null) return false;
    return _normalizePromoCode(currentInput) !=
        _normalizePromoCode(successfulRequest.promoCode);
  }

  bool _isCheckoutRequestAligned(
    SubscriptionCheckoutRequestModel checkoutRequest,
    SubscriptionQuoteRequestModel quoteRequest,
  ) {
    return checkoutRequest.planId == quoteRequest.planId &&
        checkoutRequest.grams == quoteRequest.grams &&
        checkoutRequest.mealsPerDay == quoteRequest.mealsPerDay &&
        checkoutRequest.startDate == quoteRequest.startDate &&
        _normalizePromoCode(checkoutRequest.promoCode) ==
            _normalizePromoCode(quoteRequest.promoCode) &&
        checkoutRequest.premiumItems.length ==
            quoteRequest.premiumItems.length &&
        checkoutRequest.addons.length == quoteRequest.addons.length &&
        checkoutRequest.delivery.type == quoteRequest.delivery.type &&
        checkoutRequest.delivery.zoneId == quoteRequest.delivery.zoneId &&
        checkoutRequest.delivery.slotId == quoteRequest.delivery.slotId &&
        checkoutRequest.delivery.address == quoteRequest.delivery.address &&
        _premiumItemsAligned(checkoutRequest, quoteRequest) &&
        _addonsAligned(checkoutRequest, quoteRequest);
  }

  bool _premiumItemsAligned(
    SubscriptionCheckoutRequestModel checkoutRequest,
    SubscriptionQuoteRequestModel quoteRequest,
  ) {
    final checkoutItems =
        checkoutRequest.premiumItems
            .map((item) => '${item.proteinId}:${item.qty}')
            .toList()
          ..sort();
    final quoteItems =
        quoteRequest.premiumItems
            .map((item) => '${item.proteinId}:${item.qty}')
            .toList()
          ..sort();
    return _stringListsEqual(checkoutItems, quoteItems);
  }

  bool _addonsAligned(
    SubscriptionCheckoutRequestModel checkoutRequest,
    SubscriptionQuoteRequestModel quoteRequest,
  ) {
    final checkoutAddons = [...checkoutRequest.addons]..sort();
    final quoteAddons = [...quoteRequest.addons]..sort();
    return _stringListsEqual(checkoutAddons, quoteAddons);
  }

  bool _stringListsEqual(List<String> left, List<String> right) {
    if (left.length != right.length) return false;
    for (int index = 0; index < left.length; index++) {
      if (left[index] != right[index]) return false;
    }
    return true;
  }

  bool _totalsMatchQuote(
    SubscriptionCheckoutTotalsModel totals,
    SubscriptionQuoteBreakdownModel breakdown,
  ) {
    return totals.basePlanPriceHalala == breakdown.basePlanPriceHalala &&
        totals.premiumTotalHalala == breakdown.premiumTotalHalala &&
        totals.addonsTotalHalala == breakdown.addonsTotalHalala &&
        totals.deliveryFeeHalala == breakdown.deliveryFeeHalala &&
        totals.vatHalala == breakdown.vatHalala &&
        totals.totalHalala == breakdown.totalHalala &&
        totals.currency == breakdown.currency;
  }

  String? _normalizePromoCode(String? value) {
    final trimmed = value?.trim() ?? '';
    return trimmed.isEmpty ? null : trimmed;
  }
}
