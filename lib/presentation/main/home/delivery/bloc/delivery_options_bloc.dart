import 'package:basic_diet/domain/model/delivery_options_model.dart';
import 'package:basic_diet/domain/usecase/get_delivery_options_usecase.dart';
import 'package:basic_diet/presentation/main/home/delivery/delivery_method_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import 'delivery_options_event.dart';
import 'delivery_options_state.dart';

class DeliveryOptionsBloc
    extends Bloc<DeliveryOptionsEvent, DeliveryOptionsState> {
  final GetDeliveryOptionsUseCase _getDeliveryOptionsUseCase;

  // Controllers for stateless view support
  final streetController = TextEditingController();
  final buildingController = TextEditingController();
  final apartmentController = TextEditingController();
  final notesController = TextEditingController();

  DeliveryOptionsBloc(this._getDeliveryOptionsUseCase)
    : super(const DeliveryOptionsInitial()) {
    on<GetDeliveryOptionsEvent>(_onGetDeliveryOptions);
    on<ChangeDeliveryTypeEvent>(_onChangeDeliveryType);
    on<SelectAreaEvent>(_onSelectArea);
    on<SelectTimeEvent>(_onSelectTime);
    on<SelectStartDateEvent>(_onSelectStartDate);
    on<UpdateAddressFieldsEvent>(_onUpdateAddressFields);
  }

  @override
  Future<void> close() {
    streetController.dispose();
    buildingController.dispose();
    apartmentController.dispose();
    notesController.dispose();
    return super.close();
  }

  Future<void> _onGetDeliveryOptions(
    GetDeliveryOptionsEvent event,
    Emitter<DeliveryOptionsState> emit,
  ) async {
    emit(const DeliveryOptionsLoading());
    final result = await _getDeliveryOptionsUseCase.execute(null);
    result.fold((failure) => emit(DeliveryOptionsError(failure.message)), (
      deliveryOptions,
    ) {
      final defaults = deliveryOptions.defaults;
      final defaultMethod = deliveryOptions.methods.firstWhere(
        (m) => m.type == defaults.type,
        orElse: () => deliveryOptions.methods.first,
      );

      final selectedArea = deliveryOptions.areas
          .cast<DeliveryAreaModel?>()
          .firstWhere(
            (area) => area?.id == defaults.areaId,
            orElse: () => null,
          );

      final selectedTime = defaultMethod.slots
          .cast<DeliverySlotModel?>()
          .firstWhere(
            (slot) => slot?.id == defaults.slotId,
            orElse: () => defaultMethod.slots.isNotEmpty
                ? defaultMethod.slots.first
                : null,
          );

      final selectedPickupLocation = deliveryOptions.pickupLocations
          .cast<PickupLocationModel?>()
          .firstWhere(
            (loc) => loc?.id == defaults.pickupLocationId,
            orElse: () => deliveryOptions.pickupLocations.isNotEmpty
                ? deliveryOptions.pickupLocations.first
                : null,
          );

      emit(
        DeliveryOptionsSuccess(
          deliveryOptionsModel: deliveryOptions,
          selectedType: defaultMethod.type == 'pickup'
              ? DeliveryType.pickup
              : DeliveryType.home,
          selectedArea: selectedArea,
          selectedTime: selectedTime,
          selectedPickupLocation: selectedPickupLocation,
        ),
      );
    });
  }

  void _onChangeDeliveryType(
    ChangeDeliveryTypeEvent event,
    Emitter<DeliveryOptionsState> emit,
  ) {
    if (state is DeliveryOptionsSuccess) {
      emit(
        (state as DeliveryOptionsSuccess).copyWith(
          selectedType: event.deliveryType,
        ),
      );
    }
  }

  void _onSelectArea(
    SelectAreaEvent event,
    Emitter<DeliveryOptionsState> emit,
  ) {
    if (state is DeliveryOptionsSuccess) {
      emit(
        (state as DeliveryOptionsSuccess).copyWith(selectedArea: event.area),
      );
    }
  }

  void _onSelectTime(
    SelectTimeEvent event,
    Emitter<DeliveryOptionsState> emit,
  ) {
    if (state is DeliveryOptionsSuccess) {
      emit(
        (state as DeliveryOptionsSuccess).copyWith(selectedTime: event.time),
      );
    }
  }

  void _onSelectStartDate(
    SelectStartDateEvent event,
    Emitter<DeliveryOptionsState> emit,
  ) {
    if (state is DeliveryOptionsSuccess) {
      emit(
        (state as DeliveryOptionsSuccess).copyWith(
          selectedStartDate: event.date,
        ),
      );
    }
  }

  void _onUpdateAddressFields(
    UpdateAddressFieldsEvent event,
    Emitter<DeliveryOptionsState> emit,
  ) {
    if (state is DeliveryOptionsSuccess) {
      final successState = state as DeliveryOptionsSuccess;
      emit(
        successState.copyWith(
          street: event.street,
          building: event.building,
          apartment: event.apartment,
          notes: event.notes,
        ),
      );
    }
  }
}
