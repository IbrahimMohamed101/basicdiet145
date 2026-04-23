import 'package:basic_diet/app/constants.dart';
import 'package:basic_diet/data/request/subscription_checkout_request.dart';
import 'package:basic_diet/data/response/subscription_checkout_response.dart';
import 'package:basic_diet/domain/model/subscription_checkout_model.dart';
import 'package:basic_diet/domain/model/subscription_quote_model.dart';

extension SubscriptionCheckoutRequestMapper
    on SubscriptionCheckoutRequestModel {
  SubscriptionCheckoutRequest toRequest() {
    return SubscriptionCheckoutRequest(
      idempotencyKey: idempotencyKey,
      planId: planId,
      grams: grams,
      mealsPerDay: mealsPerDay,
      startDate: startDate,
      promoCode: promoCode,
      premiumItems: premiumItems.map((item) => item.toRequest()).toList(),
      addons: addons,
      delivery: delivery.toRequest(),
      successUrl: successUrl,
      backUrl: backUrl,
    );
  }
}

extension SubscriptionCheckoutPremiumItemRequestMapper
    on SubscriptionCheckoutPremiumItemRequestModel {
  SubscriptionCheckoutPremiumItemRequest toRequest() {
    return SubscriptionCheckoutPremiumItemRequest(
      proteinId: proteinId,
      qty: qty,
    );
  }
}

extension SubscriptionCheckoutDeliveryRequestMapper
    on SubscriptionCheckoutDeliveryRequestModel {
  SubscriptionCheckoutDeliveryRequest toRequest() {
    return SubscriptionCheckoutDeliveryRequest(
      type: type,
      zoneId: zoneId,
      slotId: slotId,
      address: address?.toCheckoutRequest(),
    );
  }
}

extension SubscriptionAddressCheckoutRequestMapper on SubscriptionAddressModel {
  SubscriptionCheckoutAddressRequest toCheckoutRequest() {
    return SubscriptionCheckoutAddressRequest(
      street: street,
      building: building,
      apartment: apartment,
      notes: notes,
      district: district,
      city: city,
    );
  }
}

extension SubscriptionQuoteToCheckoutRequestMapper
    on SubscriptionQuoteRequestModel {
  SubscriptionCheckoutRequestModel toCheckoutRequest({
    required String idempotencyKey,
    required String successUrl,
    required String backUrl,
  }) {
    return SubscriptionCheckoutRequestModel(
      idempotencyKey: idempotencyKey,
      planId: planId,
      grams: grams,
      mealsPerDay: mealsPerDay,
      startDate: startDate,
      promoCode: promoCode,
      premiumItems: premiumItems
        .map(
          (item) => SubscriptionCheckoutPremiumItemRequestModel(
              proteinId: item.proteinId,
              qty: item.qty,
            ),
          )
          .toList(),
      addons: addons,
      delivery: SubscriptionCheckoutDeliveryRequestModel(
        type: delivery.type,
        zoneId: delivery.zoneId,
        slotId: delivery.slotId,
        address: delivery.address,
      ),
      successUrl: successUrl,
      backUrl: backUrl,
    );
  }
}

extension SubscriptionCheckoutResponseMapper on SubscriptionCheckoutResponse? {
  SubscriptionCheckoutModel toDomain() {
    return SubscriptionCheckoutModel(
      subscriptionId: this?.data?.subscriptionId,
      draftId: this?.data?.draftId ?? Constants.empty,
      paymentId: this?.data?.paymentId ?? Constants.empty,
      paymentUrl: this?.data?.paymentUrl ?? Constants.empty,
      totals:
          this?.data?.totals.toDomain() ??
          const SubscriptionCheckoutTotalsModel(
            basePlanPriceHalala: Constants.zero,
            premiumTotalHalala: Constants.zero,
            addonsTotalHalala: Constants.zero,
            deliveryFeeHalala: Constants.zero,
            vatHalala: Constants.zero,
            totalHalala: Constants.zero,
            currency: Constants.empty,
          ),
      reused: this?.data?.reused ?? Constants.falseValue,
    );
  }
}

extension SubscriptionCheckoutTotalsResponseMapper
    on SubscriptionCheckoutTotalsResponse? {
  SubscriptionCheckoutTotalsModel toDomain() {
    return SubscriptionCheckoutTotalsModel(
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
