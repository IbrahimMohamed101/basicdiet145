// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'delivery_options_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DeliveryOptionsResponse _$DeliveryOptionsResponseFromJson(
  Map<String, dynamic> json,
) => DeliveryOptionsResponse(
  status: json['status'] as bool?,
  message: json['message'] as String?,
  data: json['data'] == null
      ? null
      : DeliveryOptionsDataResponse.fromJson(
          json['data'] as Map<String, dynamic>,
        ),
);

Map<String, dynamic> _$DeliveryOptionsResponseToJson(
  DeliveryOptionsResponse instance,
) => <String, dynamic>{
  'status': instance.status,
  'message': instance.message,
  'data': instance.data?.toJson(),
};

DeliveryOptionsDataResponse _$DeliveryOptionsDataResponseFromJson(
  Map<String, dynamic> json,
) => DeliveryOptionsDataResponse(
  methods: (json['methods'] as List<dynamic>?)
      ?.map((e) => DeliveryMethodResponse.fromJson(e as Map<String, dynamic>))
      .toList(),
  areas: (json['areas'] as List<dynamic>?)
      ?.map((e) => DeliveryAreaResponse.fromJson(e as Map<String, dynamic>))
      .toList(),
  pickupLocations: (json['pickupLocations'] as List<dynamic>?)
      ?.map((e) => PickupLocationResponse.fromJson(e as Map<String, dynamic>))
      .toList(),
  defaults: json['defaults'] == null
      ? null
      : DeliveryDefaultsResponse.fromJson(
          json['defaults'] as Map<String, dynamic>,
        ),
);

Map<String, dynamic> _$DeliveryOptionsDataResponseToJson(
  DeliveryOptionsDataResponse instance,
) => <String, dynamic>{
  'methods': instance.methods?.map((e) => e.toJson()).toList(),
  'areas': instance.areas?.map((e) => e.toJson()).toList(),
  'pickupLocations': instance.pickupLocations?.map((e) => e.toJson()).toList(),
  'defaults': instance.defaults?.toJson(),
};

DeliveryMethodResponse _$DeliveryMethodResponseFromJson(
  Map<String, dynamic> json,
) => DeliveryMethodResponse(
  id: json['id'] as String?,
  type: json['type'] as String?,
  title: json['title'] as String?,
  subtitle: json['subtitle'] as String?,
  pricingMode: json['pricingMode'] as String?,
  feeHalala: (json['feeHalala'] as num?)?.toInt(),
  feeSar: (json['feeSar'] as num?)?.toDouble(),
  feeLabel: json['feeLabel'] as String?,
  helperText: json['helperText'] as String?,
  areaSelectionRequired: json['areaSelectionRequired'] as bool?,
  requiresAddress: json['requiresAddress'] as bool?,
  slots: (json['slots'] as List<dynamic>?)
      ?.map((e) => DeliverySlotResponse.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$DeliveryMethodResponseToJson(
  DeliveryMethodResponse instance,
) => <String, dynamic>{
  'id': instance.id,
  'type': instance.type,
  'title': instance.title,
  'subtitle': instance.subtitle,
  'pricingMode': instance.pricingMode,
  'feeHalala': instance.feeHalala,
  'feeSar': instance.feeSar,
  'feeLabel': instance.feeLabel,
  'helperText': instance.helperText,
  'areaSelectionRequired': instance.areaSelectionRequired,
  'requiresAddress': instance.requiresAddress,
  'slots': instance.slots?.map((e) => e.toJson()).toList(),
};

DeliverySlotResponse _$DeliverySlotResponseFromJson(
  Map<String, dynamic> json,
) => DeliverySlotResponse(
  id: json['id'] as String?,
  type: json['type'] as String?,
  window: json['window'] as String?,
  label: json['label'] as String?,
);

Map<String, dynamic> _$DeliverySlotResponseToJson(
  DeliverySlotResponse instance,
) => <String, dynamic>{
  'id': instance.id,
  'type': instance.type,
  'window': instance.window,
  'label': instance.label,
};

DeliveryAreaResponse _$DeliveryAreaResponseFromJson(
  Map<String, dynamic> json,
) => DeliveryAreaResponse(
  id: json['id'] as String?,
  zoneId: json['zoneId'] as String?,
  name: json['name'] as String?,
  label: json['label'] as String?,
  feeHalala: (json['feeHalala'] as num?)?.toInt(),
  feeSar: (json['feeSar'] as num?)?.toDouble(),
  feeLabel: json['feeLabel'] as String?,
  isActive: json['isActive'] as bool?,
  availability: json['availability'] as String?,
  availabilityLabel: json['availabilityLabel'] as String?,
);

Map<String, dynamic> _$DeliveryAreaResponseToJson(
  DeliveryAreaResponse instance,
) => <String, dynamic>{
  'id': instance.id,
  'zoneId': instance.zoneId,
  'name': instance.name,
  'label': instance.label,
  'feeHalala': instance.feeHalala,
  'feeSar': instance.feeSar,
  'feeLabel': instance.feeLabel,
  'isActive': instance.isActive,
  'availability': instance.availability,
  'availabilityLabel': instance.availabilityLabel,
};

PickupLocationResponse _$PickupLocationResponseFromJson(
  Map<String, dynamic> json,
) => PickupLocationResponse(
  id: json['id'] as String?,
  name: json['name'] as String?,
  label: json['label'] as String?,
  address: json['address'] == null
      ? null
      : PickupLocationAddressResponse.fromJson(
          json['address'] as Map<String, dynamic>,
        ),
  slots: (json['slots'] as List<dynamic>?)
      ?.map((e) => DeliverySlotResponse.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$PickupLocationResponseToJson(
  PickupLocationResponse instance,
) => <String, dynamic>{
  'id': instance.id,
  'name': instance.name,
  'label': instance.label,
  'address': instance.address?.toJson(),
  'slots': instance.slots?.map((e) => e.toJson()).toList(),
};

PickupLocationAddressResponse _$PickupLocationAddressResponseFromJson(
  Map<String, dynamic> json,
) => PickupLocationAddressResponse(
  line1: json['line1'] as String?,
  line2: json['line2'] as String?,
  city: json['city'] as String?,
  district: json['district'] as String?,
  street: json['street'] as String?,
  building: json['building'] as String?,
  apartment: json['apartment'] as String?,
  notes: json['notes'] as String?,
);

Map<String, dynamic> _$PickupLocationAddressResponseToJson(
  PickupLocationAddressResponse instance,
) => <String, dynamic>{
  'line1': instance.line1,
  'line2': instance.line2,
  'city': instance.city,
  'district': instance.district,
  'street': instance.street,
  'building': instance.building,
  'apartment': instance.apartment,
  'notes': instance.notes,
};

DeliveryDefaultsResponse _$DeliveryDefaultsResponseFromJson(
  Map<String, dynamic> json,
) => DeliveryDefaultsResponse(
  type: json['type'] as String?,
  slotId: json['slotId'] as String?,
  window: json['window'] as String?,
  zoneId: json['zoneId'] as String?,
  areaId: json['areaId'] as String?,
  pickupLocationId: json['pickupLocationId'] as String?,
);

Map<String, dynamic> _$DeliveryDefaultsResponseToJson(
  DeliveryDefaultsResponse instance,
) => <String, dynamic>{
  'type': instance.type,
  'slotId': instance.slotId,
  'window': instance.window,
  'zoneId': instance.zoneId,
  'areaId': instance.areaId,
  'pickupLocationId': instance.pickupLocationId,
};
