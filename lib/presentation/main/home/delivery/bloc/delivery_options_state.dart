import 'package:basic_diet/domain/model/delivery_options_model.dart';
import 'package:basic_diet/presentation/main/home/delivery/delivery_method_screen.dart';
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
  final DeliveryType selectedType;
  final DeliveryAreaModel? selectedArea;
  final DeliverySlotModel? selectedTime;
  final DateTime? selectedStartDate;
  final PickupLocationModel? selectedPickupLocation;
  final String street;
  final String building;
  final String apartment;
  final String notes;

  const DeliveryOptionsSuccess({
    required this.deliveryOptionsModel,
    this.selectedType = DeliveryType.home,
    this.selectedArea,
    this.selectedTime,
    this.selectedStartDate,
    this.selectedPickupLocation,
    this.street = '',
    this.building = '',
    this.apartment = '',
    this.notes = '',
  });

  bool get isFormValid {
    if (selectedStartDate == null) return false;
    if (selectedType == DeliveryType.home) {
      return selectedArea != null &&
          selectedTime != null &&
          street.isNotEmpty &&
          building.isNotEmpty;
    }
    return true;
  }

  DeliveryOptionsSuccess copyWith({
    DeliveryOptionsModel? deliveryOptionsModel,
    DeliveryType? selectedType,
    DeliveryAreaModel? selectedArea,
    DeliverySlotModel? selectedTime,
    DateTime? selectedStartDate,
    PickupLocationModel? selectedPickupLocation,
    String? street,
    String? building,
    String? apartment,
    String? notes,
  }) {
    return DeliveryOptionsSuccess(
      deliveryOptionsModel: deliveryOptionsModel ?? this.deliveryOptionsModel,
      selectedType: selectedType ?? this.selectedType,
      selectedArea: selectedArea ?? this.selectedArea,
      selectedTime: selectedTime ?? this.selectedTime,
      selectedStartDate: selectedStartDate ?? this.selectedStartDate,
      selectedPickupLocation:
          selectedPickupLocation ?? this.selectedPickupLocation,
      street: street ?? this.street,
      building: building ?? this.building,
      apartment: apartment ?? this.apartment,
      notes: notes ?? this.notes,
    );
  }

  @override
  List<Object?> get props => [
    deliveryOptionsModel,
    selectedType,
    selectedArea,
    selectedTime,
    selectedStartDate,
    selectedPickupLocation,
    street,
    building,
    apartment,
    notes,
  ];
}

class DeliveryOptionsError extends DeliveryOptionsState {
  final String message;

  const DeliveryOptionsError(this.message);

  @override
  List<Object?> get props => [message];
}
