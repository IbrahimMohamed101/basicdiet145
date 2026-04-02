import 'package:basic_diet/app/constants.dart';
import 'package:basic_diet/data/request/subscription_quote_request.dart';
import 'package:basic_diet/data/response/subscription_quote_response.dart';
import 'package:basic_diet/domain/model/subscription_quote_model.dart';

extension SubscriptionQuoteRequestMapper on SubscriptionQuoteRequestModel {
  SubscriptionQuoteRequest toRequest() {
    return SubscriptionQuoteRequest(
      planId: planId,
      grams: grams,
      mealsPerDay: mealsPerDay,
      startDate: startDate,
      premiumItems: premiumItems.map((item) => item.toRequest()).toList(),
      addons: addons,
      delivery: delivery.toRequest(),
    );
  }
}

extension SubscriptionQuotePremiumItemRequestMapper
    on SubscriptionQuotePremiumItemRequestModel {
  SubscriptionQuotePremiumItemRequest toRequest() {
    return SubscriptionQuotePremiumItemRequest(
      premiumMealId: premiumMealId,
      qty: qty,
    );
  }
}

extension SubscriptionQuoteDeliveryRequestMapper
    on SubscriptionQuoteDeliveryRequestModel {
  SubscriptionQuoteDeliveryRequest toRequest() {
    return SubscriptionQuoteDeliveryRequest(
      type: type,
      zoneId: zoneId,
      slotId: slotId,
      address: address?.toRequest(),
    );
  }
}

extension SubscriptionAddressRequestMapper on SubscriptionAddressModel {
  SubscriptionQuoteAddressRequest toRequest() {
    return SubscriptionQuoteAddressRequest(
      street: street,
      building: building,
      apartment: apartment,
      notes: notes,
      district: district,
      city: city,
    );
  }
}

extension SubscriptionQuoteResponseMapper on SubscriptionQuoteResponse? {
  SubscriptionQuoteModel toDomain() {
    return SubscriptionQuoteModel(
      breakdown:
          this?.data?.breakdown.toDomain() ??
          const SubscriptionQuoteBreakdownModel(
            basePlanPriceHalala: Constants.zero,
            premiumTotalHalala: Constants.zero,
            addonsTotalHalala: Constants.zero,
            deliveryFeeHalala: Constants.zero,
            vatHalala: Constants.zero,
            totalHalala: Constants.zero,
            currency: Constants.empty,
          ),
      totalSar: this?.data?.totalSar ?? Constants.decimalZero,
      summary:
          this?.data?.summary.toDomain() ??
          const SubscriptionQuoteSummaryModel(
            plan: SubscriptionQuotePlanSummaryModel(
              id: Constants.empty,
              name: Constants.empty,
              daysCount: Constants.zero,
              daysLabel: Constants.empty,
              grams: Constants.zero,
              gramsLabel: Constants.empty,
              mealsPerDay: Constants.zero,
              mealsLabel: Constants.empty,
            ),
            delivery: SubscriptionQuoteDeliverySummaryModel(
              type: Constants.empty,
              label: Constants.empty,
              zoneId: Constants.empty,
              zoneName: Constants.empty,
              feeHalala: Constants.zero,
              feeSar: Constants.decimalZero,
              feeLabel: Constants.empty,
            ),
            premiumItems: [],
            addons: [],
            lineItems: [],
          ),
    );
  }
}

extension SubscriptionQuoteBreakdownResponseMapper
    on SubscriptionQuoteBreakdownResponse? {
  SubscriptionQuoteBreakdownModel toDomain() {
    return SubscriptionQuoteBreakdownModel(
      basePlanPriceHalala: this?.basePlanPriceHalala ?? Constants.zero,
      premiumTotalHalala: this?.premiumTotalHalala ?? Constants.zero,
      addonsTotalHalala: this?.addonsTotalHalala ?? Constants.zero,
      deliveryFeeHalala: this?.deliveryFeeHalala ?? Constants.zero,
      vatHalala: this?.vatHalala ?? Constants.zero,
      totalHalala: this?.totalHalala ?? Constants.zero,
      currency: this?.currency ?? Constants.empty,
    );
  }
}

extension SubscriptionQuoteSummaryResponseMapper
    on SubscriptionQuoteSummaryResponse? {
  SubscriptionQuoteSummaryModel toDomain() {
    return SubscriptionQuoteSummaryModel(
      plan:
          this?.plan.toDomain() ??
          const SubscriptionQuotePlanSummaryModel(
            id: Constants.empty,
            name: Constants.empty,
            daysCount: Constants.zero,
            daysLabel: Constants.empty,
            grams: Constants.zero,
            gramsLabel: Constants.empty,
            mealsPerDay: Constants.zero,
            mealsLabel: Constants.empty,
          ),
      delivery:
          this?.delivery.toDomain() ??
          const SubscriptionQuoteDeliverySummaryModel(
            type: Constants.empty,
            label: Constants.empty,
            zoneId: Constants.empty,
            zoneName: Constants.empty,
            feeHalala: Constants.zero,
            feeSar: Constants.decimalZero,
            feeLabel: Constants.empty,
          ),
      premiumItems:
          this?.premiumItems?.map((item) => item.toDomain()).toList() ?? [],
      addons: this?.addons?.map((item) => item.toDomain()).toList() ?? [],
      lineItems: this?.lineItems?.map((item) => item.toDomain()).toList() ?? [],
    );
  }
}

extension SubscriptionQuotePlanSummaryResponseMapper
    on SubscriptionQuotePlanSummaryResponse? {
  SubscriptionQuotePlanSummaryModel toDomain() {
    return SubscriptionQuotePlanSummaryModel(
      id: this?.id ?? Constants.empty,
      name: this?.name ?? Constants.empty,
      daysCount: this?.daysCount ?? Constants.zero,
      daysLabel: this?.daysLabel ?? Constants.empty,
      grams: this?.grams ?? Constants.zero,
      gramsLabel: this?.gramsLabel ?? Constants.empty,
      mealsPerDay: this?.mealsPerDay ?? Constants.zero,
      mealsLabel: this?.mealsLabel ?? Constants.empty,
      startDate: this?.startDate,
    );
  }
}

extension SubscriptionQuoteDeliverySummaryResponseMapper
    on SubscriptionQuoteDeliverySummaryResponse? {
  SubscriptionQuoteDeliverySummaryModel toDomain() {
    return SubscriptionQuoteDeliverySummaryModel(
      type: this?.type ?? Constants.empty,
      label: this?.label ?? Constants.empty,
      zoneId: this?.zoneId ?? Constants.empty,
      zoneName: this?.zoneName ?? Constants.empty,
      feeHalala: this?.feeHalala ?? Constants.zero,
      feeSar: this?.feeSar ?? Constants.decimalZero,
      feeLabel: this?.feeLabel ?? Constants.empty,
      address: this?.address.toDomain(),
      slot: this?.slot.toDomain(),
    );
  }
}

extension SubscriptionAddressResponseMapper
    on SubscriptionQuoteAddressResponse? {
  SubscriptionAddressModel toDomain() {
    return SubscriptionAddressModel(
      street: this?.street ?? Constants.empty,
      building: this?.building ?? Constants.empty,
      apartment: this?.apartment ?? Constants.empty,
      notes: this?.notes ?? Constants.empty,
      district: this?.district ?? Constants.empty,
      city: this?.city ?? Constants.empty,
    );
  }
}

extension SubscriptionQuoteSlotSummaryResponseMapper
    on SubscriptionQuoteSlotSummaryResponse? {
  SubscriptionQuoteSlotSummaryModel toDomain() {
    return SubscriptionQuoteSlotSummaryModel(
      type: this?.type ?? Constants.empty,
      slotId: this?.slotId ?? Constants.empty,
      window: this?.window ?? Constants.empty,
      label: this?.label ?? Constants.empty,
    );
  }
}

extension SubscriptionQuotePremiumItemResponseMapper
    on SubscriptionQuotePremiumItemResponse? {
  SubscriptionQuotePremiumItemModel toDomain() {
    return SubscriptionQuotePremiumItemModel(
      id: this?.id ?? Constants.empty,
      name: this?.name ?? Constants.empty,
      qty: this?.qty ?? Constants.zero,
      unitPriceHalala: this?.unitPriceHalala ?? Constants.zero,
      unitPriceSar: this?.unitPriceSar ?? Constants.decimalZero,
      totalHalala: this?.totalHalala ?? Constants.zero,
      totalSar: this?.totalSar ?? Constants.decimalZero,
      totalLabel: this?.totalLabel ?? Constants.empty,
    );
  }
}

extension SubscriptionQuoteAddonResponseMapper
    on SubscriptionQuoteAddonResponse? {
  SubscriptionQuoteAddonModel toDomain() {
    return SubscriptionQuoteAddonModel(
      id: this?.id ?? Constants.empty,
      name: this?.name ?? Constants.empty,
      qty: this?.qty ?? Constants.zero,
      type: this?.type ?? Constants.empty,
      pricingModel: this?.pricingModel ?? Constants.empty,
      billingUnit: this?.billingUnit ?? Constants.empty,
      durationDays: this?.durationDays ?? Constants.zero,
      unitPriceHalala: this?.unitPriceHalala ?? Constants.zero,
      unitPriceSar: this?.unitPriceSar ?? Constants.decimalZero,
      unitPriceLabel: this?.unitPriceLabel ?? Constants.empty,
      formulaLabel: this?.formulaLabel ?? Constants.empty,
      totalHalala: this?.totalHalala ?? Constants.zero,
      totalSar: this?.totalSar ?? Constants.decimalZero,
      totalLabel: this?.totalLabel ?? Constants.empty,
    );
  }
}

extension SubscriptionQuoteLineItemResponseMapper
    on SubscriptionQuoteLineItemResponse? {
  SubscriptionQuoteLineItemModel toDomain() {
    return SubscriptionQuoteLineItemModel(
      kind: this?.kind ?? Constants.empty,
      label: this?.label ?? Constants.empty,
      amountHalala: this?.amountHalala ?? Constants.zero,
      amountSar: this?.amountSar ?? Constants.decimalZero,
      amountLabel: this?.amountLabel ?? Constants.empty,
    );
  }
}
