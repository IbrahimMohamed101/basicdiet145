import 'package:json_annotation/json_annotation.dart';

part 'subscription_quote_response.g.dart';

@JsonSerializable(explicitToJson: true)
class SubscriptionQuoteResponse {
  @JsonKey(name: 'status')
  bool? status;
  @JsonKey(name: 'message')
  String? message;
  @JsonKey(name: 'data')
  SubscriptionQuoteDataResponse? data;

  SubscriptionQuoteResponse({this.status, this.message, this.data});

  factory SubscriptionQuoteResponse.fromJson(Map<String, dynamic> json) =>
      _$SubscriptionQuoteResponseFromJson(json);

  Map<String, dynamic> toJson() => _$SubscriptionQuoteResponseToJson(this);
}

@JsonSerializable(explicitToJson: true)
class SubscriptionQuoteDataResponse {
  @JsonKey(name: 'breakdown')
  SubscriptionQuoteBreakdownResponse? breakdown;
  @JsonKey(name: 'totalSar')
  double? totalSar;
  @JsonKey(name: 'summary')
  SubscriptionQuoteSummaryResponse? summary;

  SubscriptionQuoteDataResponse({this.breakdown, this.totalSar, this.summary});

  factory SubscriptionQuoteDataResponse.fromJson(Map<String, dynamic> json) =>
      _$SubscriptionQuoteDataResponseFromJson(json);

  Map<String, dynamic> toJson() => _$SubscriptionQuoteDataResponseToJson(this);
}

@JsonSerializable()
class SubscriptionQuoteBreakdownResponse {
  @JsonKey(name: 'basePlanPriceHalala')
  int? basePlanPriceHalala;
  @JsonKey(name: 'premiumTotalHalala')
  int? premiumTotalHalala;
  @JsonKey(name: 'addonsTotalHalala')
  int? addonsTotalHalala;
  @JsonKey(name: 'deliveryFeeHalala')
  int? deliveryFeeHalala;
  @JsonKey(name: 'vatHalala')
  int? vatHalala;
  @JsonKey(name: 'totalHalala')
  int? totalHalala;
  @JsonKey(name: 'currency')
  String? currency;

  SubscriptionQuoteBreakdownResponse({
    this.basePlanPriceHalala,
    this.premiumTotalHalala,
    this.addonsTotalHalala,
    this.deliveryFeeHalala,
    this.vatHalala,
    this.totalHalala,
    this.currency,
  });

  factory SubscriptionQuoteBreakdownResponse.fromJson(
    Map<String, dynamic> json,
  ) => _$SubscriptionQuoteBreakdownResponseFromJson(json);

  Map<String, dynamic> toJson() =>
      _$SubscriptionQuoteBreakdownResponseToJson(this);
}

@JsonSerializable(explicitToJson: true)
class SubscriptionQuoteSummaryResponse {
  @JsonKey(name: 'plan')
  SubscriptionQuotePlanSummaryResponse? plan;
  @JsonKey(name: 'delivery')
  SubscriptionQuoteDeliverySummaryResponse? delivery;
  @JsonKey(name: 'premiumItems')
  List<SubscriptionQuotePremiumItemResponse>? premiumItems;
  @JsonKey(name: 'addons')
  List<SubscriptionQuoteAddonResponse>? addons;
  @JsonKey(name: 'lineItems')
  List<SubscriptionQuoteLineItemResponse>? lineItems;

  SubscriptionQuoteSummaryResponse({
    this.plan,
    this.delivery,
    this.premiumItems,
    this.addons,
    this.lineItems,
  });

  factory SubscriptionQuoteSummaryResponse.fromJson(
    Map<String, dynamic> json,
  ) => _$SubscriptionQuoteSummaryResponseFromJson(json);

  Map<String, dynamic> toJson() =>
      _$SubscriptionQuoteSummaryResponseToJson(this);
}

@JsonSerializable()
class SubscriptionQuotePlanSummaryResponse {
  @JsonKey(name: 'id')
  String? id;
  @JsonKey(name: 'name')
  String? name;
  @JsonKey(name: 'daysCount')
  int? daysCount;
  @JsonKey(name: 'daysLabel')
  String? daysLabel;
  @JsonKey(name: 'grams')
  int? grams;
  @JsonKey(name: 'gramsLabel')
  String? gramsLabel;
  @JsonKey(name: 'mealsPerDay')
  int? mealsPerDay;
  @JsonKey(name: 'mealsLabel')
  String? mealsLabel;
  @JsonKey(name: 'startDate')
  String? startDate;

  SubscriptionQuotePlanSummaryResponse({
    this.id,
    this.name,
    this.daysCount,
    this.daysLabel,
    this.grams,
    this.gramsLabel,
    this.mealsPerDay,
    this.mealsLabel,
    this.startDate,
  });

  factory SubscriptionQuotePlanSummaryResponse.fromJson(
    Map<String, dynamic> json,
  ) => _$SubscriptionQuotePlanSummaryResponseFromJson(json);

  Map<String, dynamic> toJson() =>
      _$SubscriptionQuotePlanSummaryResponseToJson(this);
}

@JsonSerializable(explicitToJson: true)
class SubscriptionQuoteDeliverySummaryResponse {
  @JsonKey(name: 'type')
  String? type;
  @JsonKey(name: 'label')
  String? label;
  @JsonKey(name: 'zoneId')
  String? zoneId;
  @JsonKey(name: 'zoneName')
  String? zoneName;
  @JsonKey(name: 'feeHalala')
  int? feeHalala;
  @JsonKey(name: 'feeSar')
  double? feeSar;
  @JsonKey(name: 'feeLabel')
  String? feeLabel;
  @JsonKey(name: 'address')
  SubscriptionQuoteAddressResponse? address;
  @JsonKey(name: 'slot')
  SubscriptionQuoteSlotSummaryResponse? slot;

  SubscriptionQuoteDeliverySummaryResponse({
    this.type,
    this.label,
    this.zoneId,
    this.zoneName,
    this.feeHalala,
    this.feeSar,
    this.feeLabel,
    this.address,
    this.slot,
  });

  factory SubscriptionQuoteDeliverySummaryResponse.fromJson(
    Map<String, dynamic> json,
  ) => _$SubscriptionQuoteDeliverySummaryResponseFromJson(json);

  Map<String, dynamic> toJson() =>
      _$SubscriptionQuoteDeliverySummaryResponseToJson(this);
}

@JsonSerializable()
class SubscriptionQuoteAddressResponse {
  @JsonKey(name: 'street')
  String? street;
  @JsonKey(name: 'building')
  String? building;
  @JsonKey(name: 'apartment')
  String? apartment;
  @JsonKey(name: 'notes')
  String? notes;
  @JsonKey(name: 'district')
  String? district;
  @JsonKey(name: 'city')
  String? city;

  SubscriptionQuoteAddressResponse({
    this.street,
    this.building,
    this.apartment,
    this.notes,
    this.district,
    this.city,
  });

  factory SubscriptionQuoteAddressResponse.fromJson(
    Map<String, dynamic> json,
  ) => _$SubscriptionQuoteAddressResponseFromJson(json);

  Map<String, dynamic> toJson() =>
      _$SubscriptionQuoteAddressResponseToJson(this);
}

@JsonSerializable()
class SubscriptionQuoteSlotSummaryResponse {
  @JsonKey(name: 'type')
  String? type;
  @JsonKey(name: 'slotId')
  String? slotId;
  @JsonKey(name: 'window')
  String? window;
  @JsonKey(name: 'label')
  String? label;

  SubscriptionQuoteSlotSummaryResponse({
    this.type,
    this.slotId,
    this.window,
    this.label,
  });

  factory SubscriptionQuoteSlotSummaryResponse.fromJson(
    Map<String, dynamic> json,
  ) => _$SubscriptionQuoteSlotSummaryResponseFromJson(json);

  Map<String, dynamic> toJson() =>
      _$SubscriptionQuoteSlotSummaryResponseToJson(this);
}

@JsonSerializable()
class SubscriptionQuotePremiumItemResponse {
  @JsonKey(name: 'id')
  String? id;
  @JsonKey(name: 'name')
  String? name;
  @JsonKey(name: 'qty')
  int? qty;
  @JsonKey(name: 'unitPriceHalala')
  int? unitPriceHalala;
  @JsonKey(name: 'unitPriceSar')
  double? unitPriceSar;
  @JsonKey(name: 'totalHalala')
  int? totalHalala;
  @JsonKey(name: 'totalSar')
  double? totalSar;
  @JsonKey(name: 'totalLabel')
  String? totalLabel;

  SubscriptionQuotePremiumItemResponse({
    this.id,
    this.name,
    this.qty,
    this.unitPriceHalala,
    this.unitPriceSar,
    this.totalHalala,
    this.totalSar,
    this.totalLabel,
  });

  factory SubscriptionQuotePremiumItemResponse.fromJson(
    Map<String, dynamic> json,
  ) => _$SubscriptionQuotePremiumItemResponseFromJson(json);

  Map<String, dynamic> toJson() =>
      _$SubscriptionQuotePremiumItemResponseToJson(this);
}

@JsonSerializable()
class SubscriptionQuoteAddonResponse {
  @JsonKey(name: 'id')
  String? id;
  @JsonKey(name: 'name')
  String? name;
  @JsonKey(name: 'qty')
  int? qty;
  @JsonKey(name: 'type')
  String? type;
  @JsonKey(name: 'pricingModel')
  String? pricingModel;
  @JsonKey(name: 'billingUnit')
  String? billingUnit;
  @JsonKey(name: 'durationDays')
  int? durationDays;
  @JsonKey(name: 'unitPriceHalala')
  int? unitPriceHalala;
  @JsonKey(name: 'unitPriceSar')
  double? unitPriceSar;
  @JsonKey(name: 'unitPriceLabel')
  String? unitPriceLabel;
  @JsonKey(name: 'formulaLabel')
  String? formulaLabel;
  @JsonKey(name: 'totalHalala')
  int? totalHalala;
  @JsonKey(name: 'totalSar')
  double? totalSar;
  @JsonKey(name: 'totalLabel')
  String? totalLabel;

  SubscriptionQuoteAddonResponse({
    this.id,
    this.name,
    this.qty,
    this.type,
    this.pricingModel,
    this.billingUnit,
    this.durationDays,
    this.unitPriceHalala,
    this.unitPriceSar,
    this.unitPriceLabel,
    this.formulaLabel,
    this.totalHalala,
    this.totalSar,
    this.totalLabel,
  });

  factory SubscriptionQuoteAddonResponse.fromJson(Map<String, dynamic> json) =>
      _$SubscriptionQuoteAddonResponseFromJson(json);

  Map<String, dynamic> toJson() => _$SubscriptionQuoteAddonResponseToJson(this);
}

@JsonSerializable()
class SubscriptionQuoteLineItemResponse {
  @JsonKey(name: 'kind')
  String? kind;
  @JsonKey(name: 'label')
  String? label;
  @JsonKey(name: 'amountHalala')
  int? amountHalala;
  @JsonKey(name: 'amountSar')
  double? amountSar;
  @JsonKey(name: 'amountLabel')
  String? amountLabel;

  SubscriptionQuoteLineItemResponse({
    this.kind,
    this.label,
    this.amountHalala,
    this.amountSar,
    this.amountLabel,
  });

  factory SubscriptionQuoteLineItemResponse.fromJson(
    Map<String, dynamic> json,
  ) => _$SubscriptionQuoteLineItemResponseFromJson(json);

  Map<String, dynamic> toJson() =>
      _$SubscriptionQuoteLineItemResponseToJson(this);
}
