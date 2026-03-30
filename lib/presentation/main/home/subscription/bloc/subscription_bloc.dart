import 'package:basic_diet/domain/model/add_ons_model.dart';
import 'package:basic_diet/domain/usecase/get_plans_usecase.dart';
import 'package:basic_diet/domain/usecase/get_subscription_quote_usecase.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'subscription_event.dart';
import 'subscription_state.dart';

class SubscriptionBloc extends Bloc<SubscriptionEvent, SubscriptionState> {
  final GetPlansUseCase _getPlansUseCase;
  final GetSubscriptionQuoteUseCase _getSubscriptionQuoteUseCase;

  SubscriptionBloc(this._getPlansUseCase, this._getSubscriptionQuoteUseCase)
    : super(const SubscriptionInitial()) {
    on<GetPlansEvent>(_onGetPlans);
    on<SelectMealOptionEvent>(_onSelectMealOption);
    on<SavePremiumMealsSelectionEvent>(_onSavePremiumMealsSelection);
    on<SaveAddOnsSelectionEvent>(_onSaveAddOnsSelection);
    on<GetSubscriptionQuoteEvent>(_onGetSubscriptionQuote);
  }

  Future<void> _onGetPlans(
    GetPlansEvent event,
    Emitter<SubscriptionState> emit,
  ) async {
    emit(const SubscriptionLoading());
    final result = await _getPlansUseCase.execute(null);
    result.fold(
      (failure) => emit(SubscriptionError(failure.message)),
      (plansModel) => emit(SubscriptionSuccess(plansModel)),
    );
  }

  void _onSelectMealOption(
    SelectMealOptionEvent event,
    Emitter<SubscriptionState> emit,
  ) {
    if (state is SubscriptionSuccess) {
      final successState = state as SubscriptionSuccess;
      emit(
        successState.copyWith(
          selectedPlan: event.plan,
          selectedGramOption: event.gramOption,
          selectedMealOption: event.option,
          quoteStatus: SubscriptionQuoteStatus.initial,
          subscriptionQuote: null,
          quoteErrorMessage: null,
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
      ),
    );

    final result = await _getSubscriptionQuoteUseCase.execute(event.request);
    result.fold(
      (failure) => emit(
        successState.copyWith(
          quoteStatus: SubscriptionQuoteStatus.failure,
          subscriptionQuote: null,
          quoteErrorMessage: failure.message,
        ),
      ),
      (quote) => emit(
        successState.copyWith(
          quoteStatus: SubscriptionQuoteStatus.success,
          subscriptionQuote: quote,
          quoteErrorMessage: null,
        ),
      ),
    );
  }
}
