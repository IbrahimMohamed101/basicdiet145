import 'package:basic_diet/domain/model/delivery_options_model.dart';
import 'package:equatable/equatable.dart';

abstract class DeliveryOptionsState extends Equatable {
  const DeliveryOptionsState();

  @override
  List<Object?> get props => [];
}

class DeliveryOptionsInitial extends DeliveryOptionsState {
  const DeliveryOptionsInitial();
}

class DeliveryOptionsLoading extends DeliveryOptionsState {
  const DeliveryOptionsLoading();
}

class DeliveryOptionsSuccess extends DeliveryOptionsState {
  final DeliveryOptionsModel deliveryOptionsModel;

  const DeliveryOptionsSuccess(this.deliveryOptionsModel);

  @override
  List<Object?> get props => [deliveryOptionsModel];
}

class DeliveryOptionsError extends DeliveryOptionsState {
  final String message;

  const DeliveryOptionsError(this.message);

  @override
  List<Object?> get props => [message];
}
