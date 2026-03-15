import 'package:basic_diet/domain/usecase/get_plans_usecase.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'subscription_event.dart';
import 'subscription_state.dart';

class SubscriptionBloc extends Bloc<SubscriptionEvent, SubscriptionState> {
  final GetPlansUseCase _getPlansUseCase;

  SubscriptionBloc(this._getPlansUseCase) : super(const SubscriptionInitial()) {
    on<GetPlansEvent>(_onGetPlans);
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
}
