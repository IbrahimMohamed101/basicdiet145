import 'package:basic_diet/data/response/subscription_day_response.dart';
import 'package:basic_diet/data/response/validation_response.dart';
import 'package:basic_diet/domain/model/subscription_day_model.dart';

extension SubscriptionDayResponseMapper on SubscriptionDayResponse {
  SubscriptionDayModel toDomain() {
    return SubscriptionDayModel(
      date: data?.date ?? '',
      status: data?.status ?? 'open',
      plannerState: data?.plannerState,
      mealSlots: data?.mealSlots.map((s) => s.toDomain()).toList() ?? [],
      plannerMeta: data?.plannerMeta?.toDomain(),
      paymentRequirement: data?.paymentRequirement?.toDomain(),
    );
  }
}

extension MealSlotResponseMapper on MealSlotResponse {
  MealSlotModel toDomain() {
    return MealSlotModel(
      slotIndex: slotIndex,
      slotKey: slotKey,
      status: status,
      proteinId: proteinId,
      carbId: carbId,
      isPremium: isPremium,
      premiumSource: premiumSource,
      proteinFamilyKey: proteinFamilyKey,
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
      requiresPayment: requiresPayment,
      premiumSelectedCount: premiumSelectedCount,
      premiumPendingPaymentCount: premiumPendingPaymentCount,
      amountHalala: amountHalala,
      currency: currency,
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
