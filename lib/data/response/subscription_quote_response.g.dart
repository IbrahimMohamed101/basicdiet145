// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'subscription_quote_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SubscriptionQuoteResponse _$SubscriptionQuoteResponseFromJson(
  Map<String, dynamic> json,
) => SubscriptionQuoteResponse(
  status: json['status'],
  message: json['message'] as String?,
  data:
      json['data'] == null
          ? null
          : SubscriptionQuoteDataResponse.fromJson(
            json['data'] as Map<String, dynamic>,
          ),
);

Map<String, dynamic> _$SubscriptionQuoteResponseToJson(
  SubscriptionQuoteResponse instance,
) => <String, dynamic>{
  'status': instance.status,
  'message': instance.message,
  'data': instance.data?.toJson(),
};

SubscriptionQuoteDataResponse _$SubscriptionQuoteDataResponseFromJson(
  Map<String, dynamic> json,
) => SubscriptionQuoteDataResponse(
  breakdown:
      json['breakdown'] == null
          ? null
          : SubscriptionQuoteBreakdownResponse.fromJson(
            json['breakdown'] as Map<String, dynamic>,
          ),
  totalSar: (json['totalSar'] as num?)?.toDouble(),
  summary:
      json['summary'] == null
          ? null
          : SubscriptionQuoteSummaryResponse.fromJson(
            json['summary'] as Map<String, dynamic>,
          ),
);

Map<String, dynamic> _$SubscriptionQuoteDataResponseToJson(
  SubscriptionQuoteDataResponse instance,
) => <String, dynamic>{
  'breakdown': instance.breakdown?.toJson(),
  'totalSar': instance.totalSar,
  'summary': instance.summary?.toJson(),
};

SubscriptionQuoteBreakdownResponse _$SubscriptionQuoteBreakdownResponseFromJson(
  Map<String, dynamic> json,
) => SubscriptionQuoteBreakdownResponse(
  basePlanPriceHalala: (json['basePlanPriceHalala'] as num?)?.toInt(),
  premiumTotalHalala: (json['premiumTotalHalala'] as num?)?.toInt(),
  addonsTotalHalala: (json['addonsTotalHalala'] as num?)?.toInt(),
  deliveryFeeHalala: (json['deliveryFeeHalala'] as num?)?.toInt(),
  vatHalala: (json['vatHalala'] as num?)?.toInt(),
  totalHalala: (json['totalHalala'] as num?)?.toInt(),
  currency: json['currency'] as String?,
);

Map<String, dynamic> _$SubscriptionQuoteBreakdownResponseToJson(
  SubscriptionQuoteBreakdownResponse instance,
) => <String, dynamic>{
  'basePlanPriceHalala': instance.basePlanPriceHalala,
  'premiumTotalHalala': instance.premiumTotalHalala,
  'addonsTotalHalala': instance.addonsTotalHalala,
  'deliveryFeeHalala': instance.deliveryFeeHalala,
  'vatHalala': instance.vatHalala,
  'totalHalala': instance.totalHalala,
  'currency': instance.currency,
};

SubscriptionQuoteSummaryResponse _$SubscriptionQuoteSummaryResponseFromJson(
  Map<String, dynamic> json,
) => SubscriptionQuoteSummaryResponse(
  plan:
      json['plan'] == null
          ? null
          : SubscriptionQuotePlanSummaryResponse.fromJson(
            json['plan'] as Map<String, dynamic>,
          ),
  delivery:
      json['delivery'] == null
          ? null
          : SubscriptionQuoteDeliverySummaryResponse.fromJson(
            json['delivery'] as Map<String, dynamic>,
          ),
  premiumItems:
      (json['premiumItems'] as List<dynamic>?)
          ?.map(
            (e) => SubscriptionQuotePremiumItemResponse.fromJson(
              e as Map<String, dynamic>,
            ),
          )
          .toList(),
  addons:
      (json['addons'] as List<dynamic>?)
          ?.map(
            (e) => SubscriptionQuoteAddonResponse.fromJson(
              e as Map<String, dynamic>,
            ),
          )
          .toList(),
  lineItems:
      (json['lineItems'] as List<dynamic>?)
          ?.map(
            (e) => SubscriptionQuoteLineItemResponse.fromJson(
              e as Map<String, dynamic>,
            ),
          )
          .toList(),
);

Map<String, dynamic> _$SubscriptionQuoteSummaryResponseToJson(
  SubscriptionQuoteSummaryResponse instance,
) => <String, dynamic>{
  'plan': instance.plan?.toJson(),
  'delivery': instance.delivery?.toJson(),
  'premiumItems': instance.premiumItems?.map((e) => e.toJson()).toList(),
  'addons': instance.addons?.map((e) => e.toJson()).toList(),
  'lineItems': instance.lineItems?.map((e) => e.toJson()).toList(),
};

SubscriptionQuotePlanSummaryResponse
_$SubscriptionQuotePlanSummaryResponseFromJson(Map<String, dynamic> json) =>
    SubscriptionQuotePlanSummaryResponse(
      id: json['id'] as String?,
      name: json['name'] as String?,
      daysCount: (json['daysCount'] as num?)?.toInt(),
      daysLabel: json['daysLabel'] as String?,
      grams: (json['grams'] as num?)?.toInt(),
      gramsLabel: json['gramsLabel'] as String?,
      mealsPerDay: (json['mealsPerDay'] as num?)?.toInt(),
      mealsLabel: json['mealsLabel'] as String?,
      startDate: json['startDate'] as String?,
    );

Map<String, dynamic> _$SubscriptionQuotePlanSummaryResponseToJson(
  SubscriptionQuotePlanSummaryResponse instance,
) => <String, dynamic>{
  'id': instance.id,
  'name': instance.name,
  'daysCount': instance.daysCount,
  'daysLabel': instance.daysLabel,
  'grams': instance.grams,
  'gramsLabel': instance.gramsLabel,
  'mealsPerDay': instance.mealsPerDay,
  'mealsLabel': instance.mealsLabel,
  'startDate': instance.startDate,
};

SubscriptionQuoteDeliverySummaryResponse
_$SubscriptionQuoteDeliverySummaryResponseFromJson(Map<String, dynamic> json) =>
    SubscriptionQuoteDeliverySummaryResponse(
      type: json['type'] as String?,
      label: json['label'] as String?,
      zoneId: json['zoneId'] as String?,
      zoneName: json['zoneName'] as String?,
      feeHalala: (json['feeHalala'] as num?)?.toInt(),
      feeSar: (json['feeSar'] as num?)?.toDouble(),
      feeLabel: json['feeLabel'] as String?,
      address:
          json['address'] == null
              ? null
              : SubscriptionQuoteAddressResponse.fromJson(
                json['address'] as Map<String, dynamic>,
              ),
      slot:
          json['slot'] == null
              ? null
              : SubscriptionQuoteSlotSummaryResponse.fromJson(
                json['slot'] as Map<String, dynamic>,
              ),
    );

Map<String, dynamic> _$SubscriptionQuoteDeliverySummaryResponseToJson(
  SubscriptionQuoteDeliverySummaryResponse instance,
) => <String, dynamic>{
  'type': instance.type,
  'label': instance.label,
  'zoneId': instance.zoneId,
  'zoneName': instance.zoneName,
  'feeHalala': instance.feeHalala,
  'feeSar': instance.feeSar,
  'feeLabel': instance.feeLabel,
  'address': instance.address?.toJson(),
  'slot': instance.slot?.toJson(),
};

SubscriptionQuoteAddressResponse _$SubscriptionQuoteAddressResponseFromJson(
  Map<String, dynamic> json,
) => SubscriptionQuoteAddressResponse(
  street: json['street'] as String?,
  building: json['building'] as String?,
  apartment: json['apartment'] as String?,
  notes: json['notes'] as String?,
  district: json['district'] as String?,
  city: json['city'] as String?,
);

Map<String, dynamic> _$SubscriptionQuoteAddressResponseToJson(
  SubscriptionQuoteAddressResponse instance,
) => <String, dynamic>{
  'street': instance.street,
  'building': instance.building,
  'apartment': instance.apartment,
  'notes': instance.notes,
  'district': instance.district,
  'city': instance.city,
};

SubscriptionQuoteSlotSummaryResponse
_$SubscriptionQuoteSlotSummaryResponseFromJson(Map<String, dynamic> json) =>
    SubscriptionQuoteSlotSummaryResponse(
      type: json['type'] as String?,
      slotId: json['slotId'] as String?,
      window: json['window'] as String?,
      label: json['label'] as String?,
    );

Map<String, dynamic> _$SubscriptionQuoteSlotSummaryResponseToJson(
  SubscriptionQuoteSlotSummaryResponse instance,
) => <String, dynamic>{
  'type': instance.type,
  'slotId': instance.slotId,
  'window': instance.window,
  'label': instance.label,
};

SubscriptionQuotePremiumItemResponse
_$SubscriptionQuotePremiumItemResponseFromJson(Map<String, dynamic> json) =>
    SubscriptionQuotePremiumItemResponse(
      id: json['id'] as String?,
      name: json['name'] as String?,
      qty: (json['qty'] as num?)?.toInt(),
      unitPriceHalala: (json['unitPriceHalala'] as num?)?.toInt(),
      unitPriceSar: (json['unitPriceSar'] as num?)?.toDouble(),
      totalHalala: (json['totalHalala'] as num?)?.toInt(),
      totalSar: (json['totalSar'] as num?)?.toDouble(),
      totalLabel: json['totalLabel'] as String?,
    );

Map<String, dynamic> _$SubscriptionQuotePremiumItemResponseToJson(
  SubscriptionQuotePremiumItemResponse instance,
) => <String, dynamic>{
  'id': instance.id,
  'name': instance.name,
  'qty': instance.qty,
  'unitPriceHalala': instance.unitPriceHalala,
  'unitPriceSar': instance.unitPriceSar,
  'totalHalala': instance.totalHalala,
  'totalSar': instance.totalSar,
  'totalLabel': instance.totalLabel,
};

SubscriptionQuoteAddonResponse _$SubscriptionQuoteAddonResponseFromJson(
  Map<String, dynamic> json,
) => SubscriptionQuoteAddonResponse(
  id: json['id'] as String?,
  name: json['name'] as String?,
  qty: (json['qty'] as num?)?.toInt(),
  type: json['type'] as String?,
  pricingModel: json['pricingModel'] as String?,
  billingUnit: json['billingUnit'] as String?,
  durationDays: (json['durationDays'] as num?)?.toInt(),
  unitPriceHalala: (json['unitPriceHalala'] as num?)?.toInt(),
  unitPriceSar: (json['unitPriceSar'] as num?)?.toDouble(),
  unitPriceLabel: json['unitPriceLabel'] as String?,
  formulaLabel: json['formulaLabel'] as String?,
  totalHalala: (json['totalHalala'] as num?)?.toInt(),
  totalSar: (json['totalSar'] as num?)?.toDouble(),
  totalLabel: json['totalLabel'] as String?,
);

Map<String, dynamic> _$SubscriptionQuoteAddonResponseToJson(
  SubscriptionQuoteAddonResponse instance,
) => <String, dynamic>{
  'id': instance.id,
  'name': instance.name,
  'qty': instance.qty,
  'type': instance.type,
  'pricingModel': instance.pricingModel,
  'billingUnit': instance.billingUnit,
  'durationDays': instance.durationDays,
  'unitPriceHalala': instance.unitPriceHalala,
  'unitPriceSar': instance.unitPriceSar,
  'unitPriceLabel': instance.unitPriceLabel,
  'formulaLabel': instance.formulaLabel,
  'totalHalala': instance.totalHalala,
  'totalSar': instance.totalSar,
  'totalLabel': instance.totalLabel,
};

SubscriptionQuoteLineItemResponse _$SubscriptionQuoteLineItemResponseFromJson(
  Map<String, dynamic> json,
) => SubscriptionQuoteLineItemResponse(
  kind: json['kind'] as String?,
  label: json['label'] as String?,
  amountHalala: (json['amountHalala'] as num?)?.toInt(),
  amountSar: (json['amountSar'] as num?)?.toDouble(),
  amountLabel: json['amountLabel'] as String?,
);

Map<String, dynamic> _$SubscriptionQuoteLineItemResponseToJson(
  SubscriptionQuoteLineItemResponse instance,
) => <String, dynamic>{
  'kind': instance.kind,
  'label': instance.label,
  'amountHalala': instance.amountHalala,
  'amountSar': instance.amountSar,
  'amountLabel': instance.amountLabel,
};
