import 'package:equatable/equatable.dart';

class SubscriptionQuoteRequestModel extends Equatable {
  final String planId;
  final int grams;
  final int mealsPerDay;
  final String startDate;
  final List<SubscriptionQuotePremiumItemRequestModel> premiumItems;
  final List<String> addons;
  final SubscriptionQuoteDeliveryRequestModel delivery;

  const SubscriptionQuoteRequestModel({
    required this.planId,
    required this.grams,
    required this.mealsPerDay,
    required this.startDate,
    required this.premiumItems,
    required this.addons,
    required this.delivery,
  });

  @override
  List<Object?> get props => [
    planId,
    grams,
    mealsPerDay,
    startDate,
    premiumItems,
    addons,
    delivery,
  ];
}

class SubscriptionQuotePremiumItemRequestModel extends Equatable {
  final String premiumMealId;
  final int qty;

  const SubscriptionQuotePremiumItemRequestModel({
    required this.premiumMealId,
    required this.qty,
  });

  @override
  List<Object?> get props => [premiumMealId, qty];
}

class SubscriptionQuoteDeliveryRequestModel extends Equatable {
  final String type;
  final String? zoneId;
  final String? slotId;
  final SubscriptionAddressModel? address;

  const SubscriptionQuoteDeliveryRequestModel({
    required this.type,
    this.zoneId,
    this.slotId,
    this.address,
  });

  @override
  List<Object?> get props => [type, zoneId, slotId, address];
}

class SubscriptionAddressModel extends Equatable {
  final String street;
  final String building;
  final String apartment;
  final String notes;
  final String district;
  final String city;

  const SubscriptionAddressModel({
    required this.street,
    required this.building,
    required this.apartment,
    required this.notes,
    required this.district,
    required this.city,
  });

  @override
  List<Object?> get props => [
    street,
    building,
    apartment,
    notes,
    district,
    city,
  ];
}

class SubscriptionQuoteModel extends Equatable {
  final SubscriptionQuoteBreakdownModel breakdown;
  final double totalSar;
  final SubscriptionQuoteSummaryModel summary;

  const SubscriptionQuoteModel({
    required this.breakdown,
    required this.totalSar,
    required this.summary,
  });

  @override
  List<Object?> get props => [breakdown, totalSar, summary];
}

class SubscriptionQuoteBreakdownModel extends Equatable {
  final int basePlanPriceHalala;
  final int premiumTotalHalala;
  final int addonsTotalHalala;
  final int deliveryFeeHalala;
  final int vatHalala;
  final int totalHalala;
  final String currency;

  const SubscriptionQuoteBreakdownModel({
    required this.basePlanPriceHalala,
    required this.premiumTotalHalala,
    required this.addonsTotalHalala,
    required this.deliveryFeeHalala,
    required this.vatHalala,
    required this.totalHalala,
    required this.currency,
  });

  @override
  List<Object?> get props => [
    basePlanPriceHalala,
    premiumTotalHalala,
    addonsTotalHalala,
    deliveryFeeHalala,
    vatHalala,
    totalHalala,
    currency,
  ];
}

class SubscriptionQuoteSummaryModel extends Equatable {
  final SubscriptionQuotePlanSummaryModel plan;
  final SubscriptionQuoteDeliverySummaryModel delivery;
  final List<SubscriptionQuotePremiumItemModel> premiumItems;
  final List<SubscriptionQuoteAddonModel> addons;
  final List<SubscriptionQuoteLineItemModel> lineItems;

  const SubscriptionQuoteSummaryModel({
    required this.plan,
    required this.delivery,
    required this.premiumItems,
    required this.addons,
    required this.lineItems,
  });

  @override
  List<Object?> get props => [plan, delivery, premiumItems, addons, lineItems];
}

class SubscriptionQuotePlanSummaryModel extends Equatable {
  final String id;
  final String name;
  final int daysCount;
  final String daysLabel;
  final int grams;
  final String gramsLabel;
  final int mealsPerDay;
  final String mealsLabel;
  final String? startDate;

  const SubscriptionQuotePlanSummaryModel({
    required this.id,
    required this.name,
    required this.daysCount,
    required this.daysLabel,
    required this.grams,
    required this.gramsLabel,
    required this.mealsPerDay,
    required this.mealsLabel,
    this.startDate,
  });

  @override
  List<Object?> get props => [
    id,
    name,
    daysCount,
    daysLabel,
    grams,
    gramsLabel,
    mealsPerDay,
    mealsLabel,
    startDate,
  ];
}

class SubscriptionQuoteDeliverySummaryModel extends Equatable {
  final String type;
  final String label;
  final String zoneId;
  final String zoneName;
  final int feeHalala;
  final double feeSar;
  final String feeLabel;
  final SubscriptionAddressModel? address;
  final SubscriptionQuoteSlotSummaryModel? slot;

  const SubscriptionQuoteDeliverySummaryModel({
    required this.type,
    required this.label,
    required this.zoneId,
    required this.zoneName,
    required this.feeHalala,
    required this.feeSar,
    required this.feeLabel,
    this.address,
    this.slot,
  });

  @override
  List<Object?> get props => [
    type,
    label,
    zoneId,
    zoneName,
    feeHalala,
    feeSar,
    feeLabel,
    address,
    slot,
  ];
}

class SubscriptionQuoteSlotSummaryModel extends Equatable {
  final String type;
  final String slotId;
  final String window;
  final String label;

  const SubscriptionQuoteSlotSummaryModel({
    required this.type,
    required this.slotId,
    required this.window,
    required this.label,
  });

  @override
  List<Object?> get props => [type, slotId, window, label];
}

class SubscriptionQuotePremiumItemModel extends Equatable {
  final String id;
  final String name;
  final int qty;
  final int unitPriceHalala;
  final double unitPriceSar;
  final int totalHalala;
  final double totalSar;
  final String totalLabel;

  const SubscriptionQuotePremiumItemModel({
    required this.id,
    required this.name,
    required this.qty,
    required this.unitPriceHalala,
    required this.unitPriceSar,
    required this.totalHalala,
    required this.totalSar,
    required this.totalLabel,
  });

  @override
  List<Object?> get props => [
    id,
    name,
    qty,
    unitPriceHalala,
    unitPriceSar,
    totalHalala,
    totalSar,
    totalLabel,
  ];
}

class SubscriptionQuoteAddonModel extends Equatable {
  final String id;
  final String name;
  final int qty;
  final String type;
  final String pricingModel;
  final String billingUnit;
  final int durationDays;
  final int unitPriceHalala;
  final double unitPriceSar;
  final String unitPriceLabel;
  final String formulaLabel;
  final int totalHalala;
  final double totalSar;
  final String totalLabel;

  const SubscriptionQuoteAddonModel({
    required this.id,
    required this.name,
    required this.qty,
    required this.type,
    required this.pricingModel,
    required this.billingUnit,
    required this.durationDays,
    required this.unitPriceHalala,
    required this.unitPriceSar,
    required this.unitPriceLabel,
    required this.formulaLabel,
    required this.totalHalala,
    required this.totalSar,
    required this.totalLabel,
  });

  @override
  List<Object?> get props => [
    id,
    name,
    qty,
    type,
    pricingModel,
    billingUnit,
    durationDays,
    unitPriceHalala,
    unitPriceSar,
    unitPriceLabel,
    formulaLabel,
    totalHalala,
    totalSar,
    totalLabel,
  ];
}

class SubscriptionQuoteLineItemModel extends Equatable {
  final String kind;
  final String label;
  final int amountHalala;
  final double amountSar;
  final String amountLabel;

  const SubscriptionQuoteLineItemModel({
    required this.kind,
    required this.label,
    required this.amountHalala,
    required this.amountSar,
    required this.amountLabel,
  });

  @override
  List<Object?> get props => [
    kind,
    label,
    amountHalala,
    amountSar,
    amountLabel,
  ];
}
