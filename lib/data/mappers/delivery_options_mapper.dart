import 'package:basic_diet/app/constants.dart';
import 'package:basic_diet/data/response/delivery_options_response.dart';
import 'package:basic_diet/domain/model/delivery_options_model.dart';

extension DeliveryOptionsResponseMapper on DeliveryOptionsResponse? {
  DeliveryOptionsModel toDomain() {
    return DeliveryOptionsModel(
      methods: this?.data?.methods?.map((method) => method.toDomain()).toList() ?? [],
      areas: this?.data?.areas?.map((area) => area.toDomain()).toList() ?? [],
      pickupLocations:
          this?.data?.pickupLocations
              ?.map((location) => location.toDomain())
              .toList() ??
          [],
      defaults:
          this?.data?.defaults.toDomain() ??
          const DeliveryDefaultsModel(
            type: Constants.empty,
            slotId: Constants.empty,
            window: Constants.empty,
            zoneId: Constants.empty,
            areaId: Constants.empty,
            pickupLocationId: Constants.empty,
          ),
    );
  }
}

extension DeliveryMethodResponseMapper on DeliveryMethodResponse? {
  DeliveryMethodModel toDomain() {
    return DeliveryMethodModel(
      id: this?.id ?? Constants.empty,
      type: this?.type ?? Constants.empty,
      title: this?.title ?? Constants.empty,
      subtitle: this?.subtitle ?? Constants.empty,
      pricingMode: this?.pricingMode ?? Constants.empty,
      feeHalala: this?.feeHalala ?? Constants.zero,
      feeSar: this?.feeSar ?? Constants.decimalZero,
      feeLabel: this?.feeLabel ?? Constants.empty,
      helperText: this?.helperText ?? Constants.empty,
      areaSelectionRequired: this?.areaSelectionRequired ?? false,
      requiresAddress: this?.requiresAddress ?? false,
      slots: this?.slots?.map((slot) => slot.toDomain()).toList() ?? [],
    );
  }
}

extension DeliverySlotResponseMapper on DeliverySlotResponse? {
  DeliverySlotModel toDomain() {
    return DeliverySlotModel(
      id: this?.id ?? Constants.empty,
      type: this?.type ?? Constants.empty,
      window: this?.window ?? Constants.empty,
      label: this?.label ?? Constants.empty,
    );
  }
}

extension DeliveryAreaResponseMapper on DeliveryAreaResponse? {
  DeliveryAreaModel toDomain() {
    return DeliveryAreaModel(
      id: this?.id ?? Constants.empty,
      zoneId: this?.zoneId ?? Constants.empty,
      name: this?.name ?? Constants.empty,
      label: this?.label ?? Constants.empty,
      feeHalala: this?.feeHalala ?? Constants.zero,
      feeSar: this?.feeSar ?? Constants.decimalZero,
      feeLabel: this?.feeLabel ?? Constants.empty,
      isActive: this?.isActive ?? false,
      availability: this?.availability ?? Constants.empty,
      availabilityLabel: this?.availabilityLabel ?? Constants.empty,
    );
  }
}

extension PickupLocationResponseMapper on PickupLocationResponse? {
  PickupLocationModel toDomain() {
    return PickupLocationModel(
      id: this?.id ?? Constants.empty,
      name: this?.name ?? Constants.empty,
      label: this?.label ?? Constants.empty,
      address:
          this?.address.toDomain() ??
          const PickupLocationAddressModel(
            line1: Constants.empty,
            line2: Constants.empty,
            city: Constants.empty,
            district: Constants.empty,
            street: Constants.empty,
            building: Constants.empty,
            apartment: Constants.empty,
            notes: Constants.empty,
          ),
      slots: this?.slots?.map((slot) => slot.toDomain()).toList() ?? [],
    );
  }
}

extension PickupLocationAddressResponseMapper on PickupLocationAddressResponse? {
  PickupLocationAddressModel toDomain() {
    return PickupLocationAddressModel(
      line1: this?.line1 ?? Constants.empty,
      line2: this?.line2 ?? Constants.empty,
      city: this?.city ?? Constants.empty,
      district: this?.district ?? Constants.empty,
      street: this?.street ?? Constants.empty,
      building: this?.building ?? Constants.empty,
      apartment: this?.apartment ?? Constants.empty,
      notes: this?.notes ?? Constants.empty,
    );
  }
}

extension DeliveryDefaultsResponseMapper on DeliveryDefaultsResponse? {
  DeliveryDefaultsModel toDomain() {
    return DeliveryDefaultsModel(
      type: this?.type ?? Constants.empty,
      slotId: this?.slotId ?? Constants.empty,
      window: this?.window ?? Constants.empty,
      zoneId: this?.zoneId ?? Constants.empty,
      areaId: this?.areaId ?? Constants.empty,
      pickupLocationId: this?.pickupLocationId ?? Constants.empty,
    );
  }
}
