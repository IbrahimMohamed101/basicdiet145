class SubscriptionDayModel {
  final String date;
  final String status;
  final String? plannerState;
  final List<MealSlotModel> mealSlots;
  final List<AddonSelectionModel> addonSelections;
  final PlannerMetaModel? plannerMeta;
  final PaymentRequirementModel? paymentRequirement;

  SubscriptionDayModel({
    required this.date,
    required this.status,
    this.plannerState,
    required this.mealSlots,
    this.addonSelections = const [],
    this.plannerMeta,
    this.paymentRequirement,
  });
}

class AddonSelectionModel {
  final String addonId;
  final String category;
  final String status;
  final String name;
  final int priceHalala;
  final String currency;

  const AddonSelectionModel({
    required this.addonId,
    required this.category,
    required this.status,
    this.name = '',
    this.priceHalala = 0,
    this.currency = 'SAR',
  });

  bool get isIncluded => status == 'included' || status == 'subscription';
  bool get isPendingPayment => status == 'pending_payment';
  bool get isPaid => status == 'paid';
}

class MealSlotModel {
  final int slotIndex;
  final String slotKey;
  final String status;
  final String? proteinId;
  final String? carbId;
  final bool isPremium;
  final String premiumSource;
  final String? proteinFamilyKey;

  MealSlotModel({
    required this.slotIndex,
    required this.slotKey,
    required this.status,
    this.proteinId,
    this.carbId,
    required this.isPremium,
    required this.premiumSource,
    this.proteinFamilyKey,
  });
}

class PlannerMetaModel {
  final int requiredSlotCount;
  final int emptySlotCount;
  final int partialSlotCount;
  final int completeSlotCount;
  final int premiumSlotCount;
  final int premiumPendingPaymentCount;
  final int premiumTotalHalala;
  final bool isDraftValid;
  final bool isConfirmable;

  PlannerMetaModel({
    required this.requiredSlotCount,
    required this.emptySlotCount,
    required this.partialSlotCount,
    required this.completeSlotCount,
    required this.premiumSlotCount,
    required this.premiumPendingPaymentCount,
    required this.premiumTotalHalala,
    required this.isDraftValid,
    required this.isConfirmable,
  });
}

class PaymentRequirementModel {
  final bool requiresPayment;
  final int premiumSelectedCount;
  final int premiumPendingPaymentCount;
  final int addonSelectedCount;
  final int addonPendingPaymentCount;
  final int amountHalala;
  final int pendingAmountHalala;
  final String currency;
  final String status;
  final String pricingStatus;
  final String? blockingReason;
  final bool canCreatePayment;

  PaymentRequirementModel({
    required this.requiresPayment,
    required this.premiumSelectedCount,
    required this.premiumPendingPaymentCount,
    this.addonSelectedCount = 0,
    this.addonPendingPaymentCount = 0,
    required this.amountHalala,
    this.pendingAmountHalala = 0,
    required this.currency,
    this.status = 'satisfied',
    this.pricingStatus = 'not_required',
    this.blockingReason,
    this.canCreatePayment = false,
  });
}

class ValidationResultModel {
  final bool valid;
  final List<MealSlotModel>? mealSlots;
  final PlannerMetaModel? plannerMeta;
  final PaymentRequirementModel? paymentRequirement;
  final List<SlotErrorModel>? slotErrors;

  ValidationResultModel({
    required this.valid,
    this.mealSlots,
    this.plannerMeta,
    this.paymentRequirement,
    this.slotErrors,
  });
}

class SlotErrorModel {
  final int slotIndex;
  final String field;
  final String code;
  final String message;

  SlotErrorModel({
    required this.slotIndex,
    required this.field,
    required this.code,
    required this.message,
  });
}
