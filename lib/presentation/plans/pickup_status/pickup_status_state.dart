part of 'pickup_status_cubit.dart';

abstract class PickupStatusState extends Equatable {
  const PickupStatusState();

  @override
  List<Object?> get props => [];
}

class PickupStatusInitial extends PickupStatusState {
  const PickupStatusInitial();
}

class PickupStatusLoading extends PickupStatusState {
  const PickupStatusLoading();
}

class PickupStatusLoaded extends PickupStatusState {
  final PickupStatusDataModel data;
  const PickupStatusLoaded(this.data);

  @override
  List<Object?> get props => [data.status, data.pickupCode];
}

class PickupStatusError extends PickupStatusState {
  final String message;
  const PickupStatusError(this.message);

  @override
  List<Object?> get props => [message];
}
