import 'package:basic_diet/domain/usecase/get_delivery_options_usecase.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import 'delivery_options_event.dart';
import 'delivery_options_state.dart';

class DeliveryOptionsBloc
    extends Bloc<DeliveryOptionsEvent, DeliveryOptionsState> {
  final GetDeliveryOptionsUseCase _getDeliveryOptionsUseCase;

  DeliveryOptionsBloc(this._getDeliveryOptionsUseCase)
    : super(const DeliveryOptionsInitial()) {
    on<GetDeliveryOptionsEvent>(_onGetDeliveryOptions);
  }

  Future<void> _onGetDeliveryOptions(
    GetDeliveryOptionsEvent event,
    Emitter<DeliveryOptionsState> emit,
  ) async {
    emit(const DeliveryOptionsLoading());
    final result = await _getDeliveryOptionsUseCase.execute(null);
    result.fold(
      (failure) => emit(DeliveryOptionsError(failure.message)),
      (deliveryOptions) => emit(DeliveryOptionsSuccess(deliveryOptions)),
    );
  }
}
