import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:basic_diet/domain/usecase/cancel_subscription_usecase.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/cancel/cancel_subscription_event.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/cancel/cancel_subscription_state.dart';

class CancelSubscriptionBloc
    extends Bloc<CancelSubscriptionEvent, CancelSubscriptionState> {
  final CancelSubscriptionUseCase _cancelSubscriptionUseCase;

  CancelSubscriptionBloc(this._cancelSubscriptionUseCase)
      : super(CancelSubscriptionInitial()) {
    on<SubmitCancelSubscriptionEvent>(_onSubmitCancelSubscription);
  }

  Future<void> _onSubmitCancelSubscription(
    SubmitCancelSubscriptionEvent event,
    Emitter<CancelSubscriptionState> emit,
  ) async {
    emit(CancelSubscriptionLoading());

    final result = await _cancelSubscriptionUseCase.execute(
      event.subscriptionId,
    );

    if (isClosed) return;

    result.fold(
      (failure) => emit(CancelSubscriptionError(failure.message)),
      (data) => emit(CancelSubscriptionSuccess(data)),
    );
  }
}
