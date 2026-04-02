// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'subscription_checkout_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SubscriptionCheckoutRequest _$SubscriptionCheckoutRequestFromJson(
  Map<String, dynamic> json,
) => SubscriptionCheckoutRequest(
  idempotencyKey: json['idempotencyKey'] as String,
  planId: json['planId'] as String,
  grams: (json['grams'] as num).toInt(),
  mealsPerDay: (json['mealsPerDay'] as num).toInt(),
  startDate: json['startDate'] as String,
  premiumItems: (json['premiumItems'] as List<dynamic>)
      .map(
        (e) => SubscriptionCheckoutPremiumItemRequest.fromJson(
          e as Map<String, dynamic>,
        ),
      )
      .toList(),
  addons: (json['addons'] as List<dynamic>).map((e) => e as String).toList(),
  delivery: SubscriptionCheckoutDeliveryRequest.fromJson(
    json['delivery'] as Map<String, dynamic>,
  ),
  successUrl: json['successUrl'] as String,
  backUrl: json['backUrl'] as String,
);

Map<String, dynamic> _$SubscriptionCheckoutRequestToJson(
  SubscriptionCheckoutRequest instance,
) => <String, dynamic>{
  'idempotencyKey': instance.idempotencyKey,
  'planId': instance.planId,
  'grams': instance.grams,
  'mealsPerDay': instance.mealsPerDay,
  'startDate': instance.startDate,
  'premiumItems': instance.premiumItems.map((e) => e.toJson()).toList(),
  'addons': instance.addons,
  'delivery': instance.delivery.toJson(),
  'successUrl': instance.successUrl,
  'backUrl': instance.backUrl,
};

SubscriptionCheckoutPremiumItemRequest
_$SubscriptionCheckoutPremiumItemRequestFromJson(Map<String, dynamic> json) =>
    SubscriptionCheckoutPremiumItemRequest(
      premiumMealId: json['premiumMealId'] as String,
      qty: (json['qty'] as num).toInt(),
    );

Map<String, dynamic> _$SubscriptionCheckoutPremiumItemRequestToJson(
  SubscriptionCheckoutPremiumItemRequest instance,
) => <String, dynamic>{
  'premiumMealId': instance.premiumMealId,
  'qty': instance.qty,
};

SubscriptionCheckoutDeliveryRequest
_$SubscriptionCheckoutDeliveryRequestFromJson(Map<String, dynamic> json) =>
    SubscriptionCheckoutDeliveryRequest(
      type: json['type'] as String,
      zoneId: json['zoneId'] as String?,
      slotId: json['slotId'] as String?,
      address: json['address'] == null
          ? null
          : SubscriptionCheckoutAddressRequest.fromJson(
              json['address'] as Map<String, dynamic>,
            ),
    );

Map<String, dynamic> _$SubscriptionCheckoutDeliveryRequestToJson(
  SubscriptionCheckoutDeliveryRequest instance,
) => <String, dynamic>{
  'type': instance.type,
  'zoneId': instance.zoneId,
  'slotId': instance.slotId,
  'address': instance.address?.toJson(),
};

SubscriptionCheckoutAddressRequest _$SubscriptionCheckoutAddressRequestFromJson(
  Map<String, dynamic> json,
) => SubscriptionCheckoutAddressRequest(
  street: json['street'] as String,
  building: json['building'] as String,
  apartment: json['apartment'] as String,
  notes: json['notes'] as String,
  district: json['district'] as String,
  city: json['city'] as String,
);

Map<String, dynamic> _$SubscriptionCheckoutAddressRequestToJson(
  SubscriptionCheckoutAddressRequest instance,
) => <String, dynamic>{
  'street': instance.street,
  'building': instance.building,
  'apartment': instance.apartment,
  'notes': instance.notes,
  'district': instance.district,
  'city': instance.city,
};
