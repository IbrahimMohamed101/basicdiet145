// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'subscription_quote_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SubscriptionQuoteRequest _$SubscriptionQuoteRequestFromJson(
  Map<String, dynamic> json,
) => SubscriptionQuoteRequest(
  planId: json['planId'] as String,
  grams: (json['grams'] as num).toInt(),
  mealsPerDay: (json['mealsPerDay'] as num).toInt(),
  premiumItems: (json['premiumItems'] as List<dynamic>)
      .map(
        (e) => SubscriptionQuotePremiumItemRequest.fromJson(
          e as Map<String, dynamic>,
        ),
      )
      .toList(),
  addons: (json['addons'] as List<dynamic>).map((e) => e as String).toList(),
  delivery: SubscriptionQuoteDeliveryRequest.fromJson(
    json['delivery'] as Map<String, dynamic>,
  ),
);

Map<String, dynamic> _$SubscriptionQuoteRequestToJson(
  SubscriptionQuoteRequest instance,
) => <String, dynamic>{
  'planId': instance.planId,
  'grams': instance.grams,
  'mealsPerDay': instance.mealsPerDay,
  'premiumItems': instance.premiumItems.map((e) => e.toJson()).toList(),
  'addons': instance.addons,
  'delivery': instance.delivery.toJson(),
};

SubscriptionQuotePremiumItemRequest
_$SubscriptionQuotePremiumItemRequestFromJson(Map<String, dynamic> json) =>
    SubscriptionQuotePremiumItemRequest(
      premiumMealId: json['premiumMealId'] as String,
      qty: (json['qty'] as num).toInt(),
    );

Map<String, dynamic> _$SubscriptionQuotePremiumItemRequestToJson(
  SubscriptionQuotePremiumItemRequest instance,
) => <String, dynamic>{
  'premiumMealId': instance.premiumMealId,
  'qty': instance.qty,
};

SubscriptionQuoteDeliveryRequest _$SubscriptionQuoteDeliveryRequestFromJson(
  Map<String, dynamic> json,
) => SubscriptionQuoteDeliveryRequest(
  type: json['type'] as String,
  zoneId: json['zoneId'] as String?,
  slotId: json['slotId'] as String?,
  address: json['address'] == null
      ? null
      : SubscriptionQuoteAddressRequest.fromJson(
          json['address'] as Map<String, dynamic>,
        ),
);

Map<String, dynamic> _$SubscriptionQuoteDeliveryRequestToJson(
  SubscriptionQuoteDeliveryRequest instance,
) => <String, dynamic>{
  'type': instance.type,
  'zoneId': instance.zoneId,
  'slotId': instance.slotId,
  'address': instance.address?.toJson(),
};

SubscriptionQuoteAddressRequest _$SubscriptionQuoteAddressRequestFromJson(
  Map<String, dynamic> json,
) => SubscriptionQuoteAddressRequest(
  street: json['street'] as String,
  building: json['building'] as String,
  apartment: json['apartment'] as String,
  notes: json['notes'] as String,
  district: json['district'] as String,
  city: json['city'] as String,
);

Map<String, dynamic> _$SubscriptionQuoteAddressRequestToJson(
  SubscriptionQuoteAddressRequest instance,
) => <String, dynamic>{
  'street': instance.street,
  'building': instance.building,
  'apartment': instance.apartment,
  'notes': instance.notes,
  'district': instance.district,
  'city': instance.city,
};
