import 'dart:async';

import 'package:basic_diet/domain/model/pickup_status_model.dart';
import 'package:basic_diet/domain/usecase/get_pickup_status_usecase.dart';
import 'package:bloc/bloc.dart';
import 'package:equatable/equatable.dart';
import 'package:intl/intl.dart';

part 'pickup_status_state.dart';

class PickupStatusCubit extends Cubit<PickupStatusState> {
  final GetPickupStatusUseCase _getPickupStatusUseCase;

  Timer? _pollingTimer;
  static const Duration _pollingInterval = Duration(seconds: 30);

  // Statuses that should keep polling
  static const _pollingStatuses = {'locked', 'in_preparation'};

  PickupStatusCubit(this._getPickupStatusUseCase)
      : super(const PickupStatusInitial());

  Future<void> fetch(String subscriptionId) async {
    final today = DateFormat('yyyy-MM-dd').format(DateTime.now());
    await _fetchStatus(subscriptionId, today);
  }

  Future<void> startPolling(String subscriptionId) async {
    _pollingTimer?.cancel();
    final today = DateFormat('yyyy-MM-dd').format(DateTime.now());
    await _fetchStatus(subscriptionId, today);
    _pollingTimer = Timer.periodic(_pollingInterval, (_) {
      _fetchStatus(subscriptionId, today);
    });
  }

  Future<void> _fetchStatus(String subscriptionId, String date) async {
    final result = await _getPickupStatusUseCase.execute(
      GetPickupStatusInput(subscriptionId, date),
    );
    result.fold(
      (failure) {
        if (state is! PickupStatusLoaded) {
          emit(PickupStatusError(failure.message));
        }
      },
      (data) {
        if (data.data != null) {
          emit(PickupStatusLoaded(data.data!));
          // Stop polling once a terminal status is reached
          if (!_pollingStatuses.contains(data.data!.status)) {
            _stopPolling();
          }
        }
      },
    );
  }

  void _stopPolling() {
    _pollingTimer?.cancel();
    _pollingTimer = null;
  }

  @override
  Future<void> close() {
    _pollingTimer?.cancel();
    return super.close();
  }
}
