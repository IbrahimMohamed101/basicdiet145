import 'package:json_annotation/json_annotation.dart';

part 'subscription_checkout_request.g.dart';

@JsonSerializable(explicitToJson: true)
class SubscriptionCheckoutRequest {
  @JsonKey(name: 'idempotencyKey')
  final String idempotencyKey;
  @JsonKey(name: 'planId')
  final String planId;
  @JsonKey(name: 'grams')
  final int grams;
  @JsonKey(name: 'mealsPerDay')
  final int mealsPerDay;
  @JsonKey(name: 'startDate')
  final String startDate;
  @JsonKey(name: 'premiumItems')
  final List<SubscriptionCheckoutPremiumItemRequest> premiumItems;
  @JsonKey(name: 'addons')
  final List<String> addons;
  @JsonKey(name: 'delivery')
  final SubscriptionCheckoutDeliveryRequest delivery;
  @JsonKey(name: 'successUrl')
  final String successUrl;
  @JsonKey(name: 'backUrl')
  final String backUrl;

  const SubscriptionCheckoutRequest({
    required this.idempotencyKey,
    required this.planId,
    required this.grams,
    required this.mealsPerDay,
    required this.startDate,
    required this.premiumItems,
    required this.addons,
    required this.delivery,
    required this.successUrl,
    required this.backUrl,
  });

  factory SubscriptionCheckoutRequest.fromJson(Map<String, dynamic> json) =>
      _$SubscriptionCheckoutRequestFromJson(json);

  Map<String, dynamic> toJson() => _$SubscriptionCheckoutRequestToJson(this);
}

@JsonSerializable()
class SubscriptionCheckoutPremiumItemRequest {
  @JsonKey(name: 'premiumMealId')
  final String premiumMealId;
  @JsonKey(name: 'qty')
  final int qty;

  const SubscriptionCheckoutPremiumItemRequest({
    required this.premiumMealId,
    required this.qty,
  });

  factory SubscriptionCheckoutPremiumItemRequest.fromJson(
    Map<String, dynamic> json,
  ) => _$SubscriptionCheckoutPremiumItemRequestFromJson(json);

  Map<String, dynamic> toJson() =>
      _$SubscriptionCheckoutPremiumItemRequestToJson(this);
}

@JsonSerializable(explicitToJson: true)
class SubscriptionCheckoutDeliveryRequest {
  @JsonKey(name: 'type')
  final String type;
  @JsonKey(name: 'zoneId')
  final String? zoneId;
  @JsonKey(name: 'slotId')
  final String? slotId;
  @JsonKey(name: 'address')
  final SubscriptionCheckoutAddressRequest? address;

  const SubscriptionCheckoutDeliveryRequest({
    required this.type,
    this.zoneId,
    this.slotId,
    this.address,
  });

  factory SubscriptionCheckoutDeliveryRequest.fromJson(
    Map<String, dynamic> json,
  ) => _$SubscriptionCheckoutDeliveryRequestFromJson(json);

  Map<String, dynamic> toJson() =>
      _$SubscriptionCheckoutDeliveryRequestToJson(this);
}

@JsonSerializable()
class SubscriptionCheckoutAddressRequest {
  @JsonKey(name: 'street')
  final String street;
  @JsonKey(name: 'building')
  final String building;
  @JsonKey(name: 'apartment')
  final String apartment;
  @JsonKey(name: 'notes')
  final String notes;
  @JsonKey(name: 'district')
  final String district;
  @JsonKey(name: 'city')
  final String city;

  const SubscriptionCheckoutAddressRequest({
    required this.street,
    required this.building,
    required this.apartment,
    required this.notes,
    required this.district,
    required this.city,
  });

  factory SubscriptionCheckoutAddressRequest.fromJson(
    Map<String, dynamic> json,
  ) => _$SubscriptionCheckoutAddressRequestFromJson(json);

  Map<String, dynamic> toJson() =>
      _$SubscriptionCheckoutAddressRequestToJson(this);
}
