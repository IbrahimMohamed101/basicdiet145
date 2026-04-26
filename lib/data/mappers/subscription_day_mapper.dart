import 'package:basic_diet/data/response/subscription_day_response.dart';
import 'package:basic_diet/data/response/validation_response.dart';
import 'package:basic_diet/domain/model/subscription_day_model.dart';

extension SubscriptionDayResponseMapper on SubscriptionDayResponse {
  SubscriptionDayModel toDomain() {
    return SubscriptionDayModel(
      date: data?.date ?? '',
      status: data?.status ?? 'open',
      plannerState: data?.plannerState ?? data?.planning?.state,
      mealSlots: data?.mealSlots.map((s) => s.toDomain()).toList() ?? [],
      addonSelections:
          data?.addonSelections
              .map((selection) => selection.toDomain())
              .toList() ??
          [],
      plannerMeta:
          data?.plannerMeta?.toDomain() ?? data?.planning?.toPlannerMetaDomain(),
      paymentRequirement: data?.paymentRequirement?.toDomain(),
    );
  }
}

extension PlanningResponseMapper on PlanningResponse {
  PlannerMetaModel toPlannerMetaDomain() {
    return PlannerMetaModel(
      requiredSlotCount: requiredMealCount,
      emptySlotCount: requiredMealCount - selectedTotalMealCount,
      partialSlotCount: 0,
      completeSlotCount: selectedTotalMealCount,
      premiumSlotCount: 0,
      premiumPendingPaymentCount: 0,
      premiumTotalHalala: 0,
      isDraftValid: isExactCountSatisfied,
      isConfirmable: isExactCountSatisfied,
    );
  }
}

extension AddonSelectionResponseMapper on AddonSelectionResponse {
  AddonSelectionModel toDomain() {
    final rawStatus = status ?? source ?? 'pending_payment';
    return AddonSelectionModel(
      addonId: addonId ?? '',
      category: category ?? '',
      status: rawStatus == 'subscription' ? 'included' : rawStatus,
      name: name ?? '',
      priceHalala: priceHalala ?? 0,
      currency: currency ?? 'SAR',
    );
  }
}

extension MealSlotResponseMapper on MealSlotResponse {
  MealSlotModel toDomain() {
    return MealSlotModel(
      slotIndex: slotIndex,
      slotKey: slotKey,
      status: status,
      selectionType: selectionType,
      proteinId: proteinId,
      carbId: carbId,
      sandwichId: sandwichId,
      customSalad: customSalad?.toDomain(),
      isPremium: isPremium,
      premiumSource: premiumSource,
      proteinFamilyKey: proteinFamilyKey,
    );
  }
}

extension CustomSaladResponseMapper on CustomSaladResponse {
  CustomSaladModel toDomain() {
    return CustomSaladModel(
      presetKey: presetKey,
      vegetables: vegetables,
      addons: addons,
      fruits: fruits,
      nuts: nuts,
      sauce: sauce,
    );
  }
}

extension PlannerMetaResponseMapper on PlannerMetaResponse {
  PlannerMetaModel toDomain() {
    return PlannerMetaModel(
      requiredSlotCount: requiredSlotCount,
      emptySlotCount: emptySlotCount,
      partialSlotCount: partialSlotCount,
      completeSlotCount: completeSlotCount,
      premiumSlotCount: premiumSlotCount,
      premiumPendingPaymentCount: premiumPendingPaymentCount,
      premiumTotalHalala: premiumTotalHalala,
      isDraftValid: isDraftValid,
      isConfirmable: isConfirmable,
    );
  }
}

extension PaymentRequirementResponseMapper on PaymentRequirementResponse {
  PaymentRequirementModel toDomain() {
    return PaymentRequirementModel(
      status: status,
      requiresPayment: requiresPayment,
      premiumSelectedCount: premiumSelectedCount,
      premiumPendingPaymentCount: premiumPendingPaymentCount,
      addonSelectedCount: addonSelectedCount,
      addonPendingPaymentCount: addonPendingPaymentCount,
      amountHalala: amountHalala,
      pendingAmountHalala: pendingAmountHalala,
      currency: currency,
      pricingStatus: pricingStatus,
      blockingReason: blockingReason,
      canCreatePayment: canCreatePayment,
    );
  }
}

extension ValidationResponseMapper on ValidationResponse {
  ValidationResultModel toDomain() {
    return ValidationResultModel(
      valid: valid,
      mealSlots: mealSlots?.map((s) => s.toDomain()).toList(),
      plannerMeta: plannerMeta?.toDomain(),
      paymentRequirement: paymentRequirement?.toDomain(),
      slotErrors: slotErrors?.map((e) => e.toDomain()).toList(),
    );
  }
}

extension SlotErrorResponseMapper on SlotErrorResponse {
  SlotErrorModel toDomain() {
    return SlotErrorModel(
      slotIndex: slotIndex,
      field: field,
      code: code,
      message: message,
    );
  }
}
