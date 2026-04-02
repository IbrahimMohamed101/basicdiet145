import 'package:basic_diet/domain/usecase/get_premium_meals_usecase.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'premium_meals_event.dart';
import 'premium_meals_state.dart';

class PremiumMealsBloc extends Bloc<PremiumMealsEvent, PremiumMealsState> {
  final GetPremiumMealsUseCase _getPremiumMealsUseCase;

  PremiumMealsBloc(this._getPremiumMealsUseCase)
    : super(const PremiumMealsInitial()) {
    on<GetPremiumMealsEvent>(_onGetPremiumMeals);
    on<UpdateMealCounterEvent>(_onUpdateMealCounter);
  }

  Future<void> _onGetPremiumMeals(
    GetPremiumMealsEvent event,
    Emitter<PremiumMealsState> emit,
  ) async {
    emit(const PremiumMealsLoading());
    final result = await _getPremiumMealsUseCase.execute(null);
    result.fold((failure) => emit(PremiumMealsError(failure.message)), (
      premiumMealsModel,
    ) {
      final initialCounters = <String, int>{};
      for (var meal in premiumMealsModel.meals) {
        initialCounters[meal.id] = 0;
      }
      emit(
        PremiumMealsSuccess(premiumMealsModel, mealCounters: initialCounters),
      );
    });
  }

  void _onUpdateMealCounter(
    UpdateMealCounterEvent event,
    Emitter<PremiumMealsState> emit,
  ) {
    if (state is PremiumMealsSuccess) {
      final currentState = state as PremiumMealsSuccess;
      final newCounters = Map<String, int>.from(currentState.mealCounters);
      newCounters[event.id] = event.quantity;
      emit(currentState.copyWith(mealCounters: newCounters));
    }
  }
}
