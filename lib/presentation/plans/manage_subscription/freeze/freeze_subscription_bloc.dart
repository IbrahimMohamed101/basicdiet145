import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:basic_diet/domain/usecase/freeze_subscription_usecase.dart';
import 'package:basic_diet/domain/model/freeze_subscription_model.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/freeze/freeze_subscription_event.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/freeze/freeze_subscription_state.dart';

class FreezeSubscriptionBloc
    extends Bloc<FreezeSubscriptionEvent, FreezeSubscriptionState> {
  final FreezeSubscriptionUseCase _freezeSubscriptionUseCase;

  FreezeSubscriptionBloc(this._freezeSubscriptionUseCase)
    : super(FreezeSubscriptionInitial()) {
    on<SubmitFreezeSubscriptionEvent>(_onSubmitFreezeSubscription);
  }

  Future<void> _onSubmitFreezeSubscription(
    SubmitFreezeSubscriptionEvent event,
    Emitter<FreezeSubscriptionState> emit,
  ) async {
    emit(FreezeSubscriptionLoading());

    final request = FreezeSubscriptionRequestModel(event.startDate, event.days);
    final result = await _freezeSubscriptionUseCase.execute(
      FreezeSubscriptionUseCaseInput(event.subscriptionId, request),
    );

    result.fold(
      (failure) {
        emit(FreezeSubscriptionError(failure.message));
      },
      (data) {
        emit(FreezeSubscriptionSuccess(data));
      },
    );
  }
}
