import 'package:json_annotation/json_annotation.dart';

part 'subscription_quote_request.g.dart';

@JsonSerializable(explicitToJson: true)
class SubscriptionQuoteRequest {
  @JsonKey(name: 'planId')
  final String planId;
  @JsonKey(name: 'grams')
  final int grams;
  @JsonKey(name: 'mealsPerDay')
  final int mealsPerDay;
  @JsonKey(name: 'startDate')
  final String startDate;
  @JsonKey(name: 'promoCode', includeIfNull: false)
  final String? promoCode;
  @JsonKey(name: 'premiumItems')
  final List<SubscriptionQuotePremiumItemRequest> premiumItems;
  @JsonKey(name: 'addons')
  final List<String> addons;
  @JsonKey(name: 'delivery')
  final SubscriptionQuoteDeliveryRequest delivery;

  const SubscriptionQuoteRequest({
    required this.planId,
    required this.grams,
    required this.mealsPerDay,
    required this.startDate,
    this.promoCode,
    required this.premiumItems,
    required this.addons,
    required this.delivery,
  });

  factory SubscriptionQuoteRequest.fromJson(Map<String, dynamic> json) =>
      _$SubscriptionQuoteRequestFromJson(json);

  Map<String, dynamic> toJson() => _$SubscriptionQuoteRequestToJson(this);
}

@JsonSerializable()
class SubscriptionQuotePremiumItemRequest {
  @JsonKey(name: 'proteinId')
  final String proteinId;
  @JsonKey(name: 'qty')
  final int qty;

  const SubscriptionQuotePremiumItemRequest({
    required this.proteinId,
    required this.qty,
  });

  factory SubscriptionQuotePremiumItemRequest.fromJson(
    Map<String, dynamic> json,
  ) => _$SubscriptionQuotePremiumItemRequestFromJson(json);

  Map<String, dynamic> toJson() =>
      _$SubscriptionQuotePremiumItemRequestToJson(this);
}

@JsonSerializable(explicitToJson: true)
class SubscriptionQuoteDeliveryRequest {
  @JsonKey(name: 'type')
  final String type;
  @JsonKey(name: 'zoneId')
  final String? zoneId;
  @JsonKey(name: 'slotId')
  final String? slotId;
  @JsonKey(name: 'address')
  final SubscriptionQuoteAddressRequest? address;

  const SubscriptionQuoteDeliveryRequest({
    required this.type,
    this.zoneId,
    this.slotId,
    this.address,
  });

  factory SubscriptionQuoteDeliveryRequest.fromJson(
    Map<String, dynamic> json,
  ) => _$SubscriptionQuoteDeliveryRequestFromJson(json);

  Map<String, dynamic> toJson() =>
      _$SubscriptionQuoteDeliveryRequestToJson(this);
}

@JsonSerializable()
class SubscriptionQuoteAddressRequest {
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

  const SubscriptionQuoteAddressRequest({
    required this.street,
    required this.building,
    required this.apartment,
    required this.notes,
    required this.district,
    required this.city,
  });

  factory SubscriptionQuoteAddressRequest.fromJson(Map<String, dynamic> json) =>
      _$SubscriptionQuoteAddressRequestFromJson(json);

  Map<String, dynamic> toJson() =>
      _$SubscriptionQuoteAddressRequestToJson(this);
}
