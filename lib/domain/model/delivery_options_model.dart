import 'package:equatable/equatable.dart';

class DeliveryOptionsModel extends Equatable {
  final List<DeliveryMethodModel> methods;
  final List<DeliveryAreaModel> areas;
  final List<PickupLocationModel> pickupLocations;
  final DeliveryDefaultsModel defaults;

  const DeliveryOptionsModel({
    required this.methods,
    required this.areas,
    required this.pickupLocations,
    required this.defaults,
  });

  @override
  List<Object?> get props => [methods, areas, pickupLocations, defaults];
}

class DeliveryMethodModel extends Equatable {
  final String id;
  final String type;
  final String title;
  final String subtitle;
  final String pricingMode;
  final int feeHalala;
  final double feeSar;
  final String feeLabel;
  final String helperText;
  final bool areaSelectionRequired;
  final bool requiresAddress;
  final List<DeliverySlotModel> slots;

  const DeliveryMethodModel({
    required this.id,
    required this.type,
    required this.title,
    required this.subtitle,
    required this.pricingMode,
    required this.feeHalala,
    required this.feeSar,
    required this.feeLabel,
    required this.helperText,
    required this.areaSelectionRequired,
    required this.requiresAddress,
    required this.slots,
  });

  @override
  List<Object?> get props => [
    id,
    type,
    title,
    subtitle,
    pricingMode,
    feeHalala,
    feeSar,
    feeLabel,
    helperText,
    areaSelectionRequired,
    requiresAddress,
    slots,
  ];
}

class DeliverySlotModel extends Equatable {
  final String id;
  final String type;
  final String window;
  final String label;

  const DeliverySlotModel({
    required this.id,
    required this.type,
    required this.window,
    required this.label,
  });

  @override
  List<Object?> get props => [id, type, window, label];
}

class DeliveryAreaModel extends Equatable {
  final String id;
  final String zoneId;
  final String name;
  final String label;
  final int feeHalala;
  final double feeSar;
  final String feeLabel;
  final bool isActive;
  final String availability;
  final String availabilityLabel;

  const DeliveryAreaModel({
    required this.id,
    required this.zoneId,
    required this.name,
    required this.label,
    required this.feeHalala,
    required this.feeSar,
    required this.feeLabel,
    required this.isActive,
    required this.availability,
    required this.availabilityLabel,
  });

  bool get isAvailable => isActive && availability == 'available';

  @override
  List<Object?> get props => [
    id,
    zoneId,
    name,
    label,
    feeHalala,
    feeSar,
    feeLabel,
    isActive,
    availability,
    availabilityLabel,
  ];
}

class PickupLocationModel extends Equatable {
  final String id;
  final String name;
  final String label;
  final PickupLocationAddressModel address;
  final List<DeliverySlotModel> slots;

  const PickupLocationModel({
    required this.id,
    required this.name,
    required this.label,
    required this.address,
    required this.slots,
  });

  @override
  List<Object?> get props => [id, name, label, address, slots];
}

class PickupLocationAddressModel extends Equatable {
  final String line1;
  final String line2;
  final String city;
  final String district;
  final String street;
  final String building;
  final String apartment;
  final String notes;

  const PickupLocationAddressModel({
    required this.line1,
    required this.line2,
    required this.city,
    required this.district,
    required this.street,
    required this.building,
    required this.apartment,
    required this.notes,
  });

  @override
  List<Object?> get props => [
    line1,
    line2,
    city,
    district,
    street,
    building,
    apartment,
    notes,
  ];
}

class DeliveryDefaultsModel extends Equatable {
  final String type;
  final String slotId;
  final String window;
  final String zoneId;
  final String areaId;
  final String pickupLocationId;

  const DeliveryDefaultsModel({
    required this.type,
    required this.slotId,
    required this.window,
    required this.zoneId,
    required this.areaId,
    required this.pickupLocationId,
  });

  @override
  List<Object?> get props => [
    type,
    slotId,
    window,
    zoneId,
    areaId,
    pickupLocationId,
  ];
}
