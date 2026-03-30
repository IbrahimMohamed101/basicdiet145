import 'package:json_annotation/json_annotation.dart';

part 'delivery_options_response.g.dart';

@JsonSerializable(explicitToJson: true)
class DeliveryOptionsResponse {
  @JsonKey(name: 'status')
  bool? status;
  @JsonKey(name: 'message')
  String? message;
  @JsonKey(name: 'data')
  DeliveryOptionsDataResponse? data;

  DeliveryOptionsResponse({this.status, this.message, this.data});

  factory DeliveryOptionsResponse.fromJson(Map<String, dynamic> json) =>
      _$DeliveryOptionsResponseFromJson(json);

  Map<String, dynamic> toJson() => _$DeliveryOptionsResponseToJson(this);
}

@JsonSerializable(explicitToJson: true)
class DeliveryOptionsDataResponse {
  @JsonKey(name: 'methods')
  List<DeliveryMethodResponse>? methods;
  @JsonKey(name: 'areas')
  List<DeliveryAreaResponse>? areas;
  @JsonKey(name: 'pickupLocations')
  List<PickupLocationResponse>? pickupLocations;
  @JsonKey(name: 'defaults')
  DeliveryDefaultsResponse? defaults;

  DeliveryOptionsDataResponse({
    this.methods,
    this.areas,
    this.pickupLocations,
    this.defaults,
  });

  factory DeliveryOptionsDataResponse.fromJson(Map<String, dynamic> json) =>
      _$DeliveryOptionsDataResponseFromJson(json);

  Map<String, dynamic> toJson() => _$DeliveryOptionsDataResponseToJson(this);
}

@JsonSerializable(explicitToJson: true)
class DeliveryMethodResponse {
  @JsonKey(name: 'id')
  String? id;
  @JsonKey(name: 'type')
  String? type;
  @JsonKey(name: 'title')
  String? title;
  @JsonKey(name: 'subtitle')
  String? subtitle;
  @JsonKey(name: 'pricingMode')
  String? pricingMode;
  @JsonKey(name: 'feeHalala')
  int? feeHalala;
  @JsonKey(name: 'feeSar')
  double? feeSar;
  @JsonKey(name: 'feeLabel')
  String? feeLabel;
  @JsonKey(name: 'helperText')
  String? helperText;
  @JsonKey(name: 'areaSelectionRequired')
  bool? areaSelectionRequired;
  @JsonKey(name: 'requiresAddress')
  bool? requiresAddress;
  @JsonKey(name: 'slots')
  List<DeliverySlotResponse>? slots;

  DeliveryMethodResponse({
    this.id,
    this.type,
    this.title,
    this.subtitle,
    this.pricingMode,
    this.feeHalala,
    this.feeSar,
    this.feeLabel,
    this.helperText,
    this.areaSelectionRequired,
    this.requiresAddress,
    this.slots,
  });

  factory DeliveryMethodResponse.fromJson(Map<String, dynamic> json) =>
      _$DeliveryMethodResponseFromJson(json);

  Map<String, dynamic> toJson() => _$DeliveryMethodResponseToJson(this);
}

@JsonSerializable()
class DeliverySlotResponse {
  @JsonKey(name: 'id')
  String? id;
  @JsonKey(name: 'type')
  String? type;
  @JsonKey(name: 'window')
  String? window;
  @JsonKey(name: 'label')
  String? label;

  DeliverySlotResponse({this.id, this.type, this.window, this.label});

  factory DeliverySlotResponse.fromJson(Map<String, dynamic> json) =>
      _$DeliverySlotResponseFromJson(json);

  Map<String, dynamic> toJson() => _$DeliverySlotResponseToJson(this);
}

@JsonSerializable()
class DeliveryAreaResponse {
  @JsonKey(name: 'id')
  String? id;
  @JsonKey(name: 'zoneId')
  String? zoneId;
  @JsonKey(name: 'name')
  String? name;
  @JsonKey(name: 'label')
  String? label;
  @JsonKey(name: 'feeHalala')
  int? feeHalala;
  @JsonKey(name: 'feeSar')
  double? feeSar;
  @JsonKey(name: 'feeLabel')
  String? feeLabel;
  @JsonKey(name: 'isActive')
  bool? isActive;
  @JsonKey(name: 'availability')
  String? availability;
  @JsonKey(name: 'availabilityLabel')
  String? availabilityLabel;

  DeliveryAreaResponse({
    this.id,
    this.zoneId,
    this.name,
    this.label,
    this.feeHalala,
    this.feeSar,
    this.feeLabel,
    this.isActive,
    this.availability,
    this.availabilityLabel,
  });

  factory DeliveryAreaResponse.fromJson(Map<String, dynamic> json) =>
      _$DeliveryAreaResponseFromJson(json);

  Map<String, dynamic> toJson() => _$DeliveryAreaResponseToJson(this);
}

@JsonSerializable(explicitToJson: true)
class PickupLocationResponse {
  @JsonKey(name: 'id')
  String? id;
  @JsonKey(name: 'name')
  String? name;
  @JsonKey(name: 'label')
  String? label;
  @JsonKey(name: 'address')
  PickupLocationAddressResponse? address;
  @JsonKey(name: 'slots')
  List<DeliverySlotResponse>? slots;

  PickupLocationResponse({
    this.id,
    this.name,
    this.label,
    this.address,
    this.slots,
  });

  factory PickupLocationResponse.fromJson(Map<String, dynamic> json) =>
      _$PickupLocationResponseFromJson(json);

  Map<String, dynamic> toJson() => _$PickupLocationResponseToJson(this);
}

@JsonSerializable()
class PickupLocationAddressResponse {
  @JsonKey(name: 'line1')
  String? line1;
  @JsonKey(name: 'line2')
  String? line2;
  @JsonKey(name: 'city')
  String? city;
  @JsonKey(name: 'district')
  String? district;
  @JsonKey(name: 'street')
  String? street;
  @JsonKey(name: 'building')
  String? building;
  @JsonKey(name: 'apartment')
  String? apartment;
  @JsonKey(name: 'notes')
  String? notes;

  PickupLocationAddressResponse({
    this.line1,
    this.line2,
    this.city,
    this.district,
    this.street,
    this.building,
    this.apartment,
    this.notes,
  });

  factory PickupLocationAddressResponse.fromJson(Map<String, dynamic> json) =>
      _$PickupLocationAddressResponseFromJson(json);

  Map<String, dynamic> toJson() => _$PickupLocationAddressResponseToJson(this);
}

@JsonSerializable()
class DeliveryDefaultsResponse {
  @JsonKey(name: 'type')
  String? type;
  @JsonKey(name: 'slotId')
  String? slotId;
  @JsonKey(name: 'window')
  String? window;
  @JsonKey(name: 'zoneId')
  String? zoneId;
  @JsonKey(name: 'areaId')
  String? areaId;
  @JsonKey(name: 'pickupLocationId')
  String? pickupLocationId;

  DeliveryDefaultsResponse({
    this.type,
    this.slotId,
    this.window,
    this.zoneId,
    this.areaId,
    this.pickupLocationId,
  });

  factory DeliveryDefaultsResponse.fromJson(Map<String, dynamic> json) =>
      _$DeliveryDefaultsResponseFromJson(json);

  Map<String, dynamic> toJson() => _$DeliveryDefaultsResponseToJson(this);
}
