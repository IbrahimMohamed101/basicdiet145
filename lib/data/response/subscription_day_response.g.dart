// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'subscription_day_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Map<String, dynamic> _$SubscriptionDayResponseToJson(
  SubscriptionDayResponse instance,
) => <String, dynamic>{'status': instance.status, 'data': instance.data};

SubscriptionDayData _$SubscriptionDayDataFromJson(Map<String, dynamic> json) =>
    SubscriptionDayData(
      json['date'] as String,
      json['status'] as String,
      json['plannerState'] as String?,
      (json['mealSlots'] as List<dynamic>?)
              ?.map((e) => MealSlotResponse.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      (json['addonSelections'] as List<dynamic>?)
              ?.map(
                (e) =>
                    AddonSelectionResponse.fromJson(e as Map<String, dynamic>),
              )
              .toList() ??
          [],
      json['plannerMeta'] == null
          ? null
          : PlannerMetaResponse.fromJson(
            json['plannerMeta'] as Map<String, dynamic>,
          ),
      json['planning'] == null
          ? null
          : PlanningResponse.fromJson(json['planning'] as Map<String, dynamic>),
      json['paymentRequirement'] == null
          ? null
          : PaymentRequirementResponse.fromJson(
            json['paymentRequirement'] as Map<String, dynamic>,
          ),
    );

Map<String, dynamic> _$SubscriptionDayDataToJson(
  SubscriptionDayData instance,
) => <String, dynamic>{
  'date': instance.date,
  'status': instance.status,
  'plannerState': instance.plannerState,
  'mealSlots': instance.mealSlots,
  'addonSelections': instance.addonSelections,
  'plannerMeta': instance.plannerMeta,
  'planning': instance.planning,
  'paymentRequirement': instance.paymentRequirement,
};

PlanningResponse _$PlanningResponseFromJson(Map<String, dynamic> json) =>
    PlanningResponse(
      json['version'] as String?,
      json['state'] as String?,
      (json['requiredMealCount'] as num?)?.toInt() ?? 0,
      (json['selectedTotalMealCount'] as num?)?.toInt() ?? 0,
      json['isExactCountSatisfied'] as bool? ?? false,
      json['confirmedAt'] as String?,
      json['confirmedByRole'] as String?,
    );

Map<String, dynamic> _$PlanningResponseToJson(PlanningResponse instance) =>
    <String, dynamic>{
      'version': instance.version,
      'state': instance.state,
      'requiredMealCount': instance.requiredMealCount,
      'selectedTotalMealCount': instance.selectedTotalMealCount,
      'isExactCountSatisfied': instance.isExactCountSatisfied,
      'confirmedAt': instance.confirmedAt,
      'confirmedByRole': instance.confirmedByRole,
    };

AddonSelectionResponse _$AddonSelectionResponseFromJson(
  Map<String, dynamic> json,
) => AddonSelectionResponse(
  json['addonId'] as String?,
  json['category'] as String?,
  json['status'] as String?,
  json['source'] as String?,
  json['name'] as String?,
  (json['priceHalala'] as num?)?.toInt(),
  json['currency'] as String?,
);

Map<String, dynamic> _$AddonSelectionResponseToJson(
  AddonSelectionResponse instance,
) => <String, dynamic>{
  'addonId': instance.addonId,
  'category': instance.category,
  'status': instance.status,
  'source': instance.source,
  'name': instance.name,
  'priceHalala': instance.priceHalala,
  'currency': instance.currency,
};

MealSlotResponse _$MealSlotResponseFromJson(Map<String, dynamic> json) =>
    MealSlotResponse(
      (json['slotIndex'] as num).toInt(),
      json['slotKey'] as String,
      json['status'] as String,
      json['proteinId'] as String?,
      json['carbId'] as String?,
      json['selectionType'] as String?,
      json['sandwichId'] as String?,
      json['customSalad'] == null
          ? null
          : CustomSaladResponse.fromJson(
            json['customSalad'] as Map<String, dynamic>,
          ),
      json['isPremium'] as bool? ?? false,
      json['premiumSource'] as String? ?? 'none',
      json['proteinFamilyKey'] as String?,
    );

Map<String, dynamic> _$MealSlotResponseToJson(MealSlotResponse instance) =>
    <String, dynamic>{
      'slotIndex': instance.slotIndex,
      'slotKey': instance.slotKey,
      'status': instance.status,
      'proteinId': instance.proteinId,
      'carbId': instance.carbId,
      'selectionType': instance.selectionType,
      'sandwichId': instance.sandwichId,
      'customSalad': instance.customSalad,
      'isPremium': instance.isPremium,
      'premiumSource': instance.premiumSource,
      'proteinFamilyKey': instance.proteinFamilyKey,
    };

CustomSaladResponse _$CustomSaladResponseFromJson(
  Map<String, dynamic> json,
) => CustomSaladResponse(
  json['presetKey'] as String?,
  (json['vegetables'] as List<dynamic>?)?.map((e) => e as String).toList() ??
      [],
  (json['addons'] as List<dynamic>?)?.map((e) => e as String).toList() ?? [],
  (json['fruits'] as List<dynamic>?)?.map((e) => e as String).toList() ?? [],
  (json['nuts'] as List<dynamic>?)?.map((e) => e as String).toList() ?? [],
  (json['sauce'] as List<dynamic>?)?.map((e) => e as String).toList() ?? [],
);

Map<String, dynamic> _$CustomSaladResponseToJson(
  CustomSaladResponse instance,
) => <String, dynamic>{
  'presetKey': instance.presetKey,
  'vegetables': instance.vegetables,
  'addons': instance.addons,
  'fruits': instance.fruits,
  'nuts': instance.nuts,
  'sauce': instance.sauce,
};

PlannerMetaResponse _$PlannerMetaResponseFromJson(Map<String, dynamic> json) =>
    PlannerMetaResponse(
      (json['requiredSlotCount'] as num?)?.toInt() ?? 0,
      (json['emptySlotCount'] as num?)?.toInt() ?? 0,
      (json['partialSlotCount'] as num?)?.toInt() ?? 0,
      (json['completeSlotCount'] as num?)?.toInt() ?? 0,
      (json['premiumSlotCount'] as num?)?.toInt() ?? 0,
      (json['premiumPendingPaymentCount'] as num?)?.toInt() ?? 0,
      (json['premiumTotalHalala'] as num?)?.toInt() ?? 0,
      json['isDraftValid'] as bool? ?? true,
      json['isConfirmable'] as bool? ?? false,
    );

Map<String, dynamic> _$PlannerMetaResponseToJson(
  PlannerMetaResponse instance,
) => <String, dynamic>{
  'requiredSlotCount': instance.requiredSlotCount,
  'emptySlotCount': instance.emptySlotCount,
  'partialSlotCount': instance.partialSlotCount,
  'completeSlotCount': instance.completeSlotCount,
  'premiumSlotCount': instance.premiumSlotCount,
  'premiumPendingPaymentCount': instance.premiumPendingPaymentCount,
  'premiumTotalHalala': instance.premiumTotalHalala,
  'isDraftValid': instance.isDraftValid,
  'isConfirmable': instance.isConfirmable,
};

PaymentRequirementResponse _$PaymentRequirementResponseFromJson(
  Map<String, dynamic> json,
) => PaymentRequirementResponse(
  json['status'] as String? ?? 'satisfied',
  json['requiresPayment'] as bool? ?? false,
  (json['premiumSelectedCount'] as num?)?.toInt() ?? 0,
  (json['premiumPendingPaymentCount'] as num?)?.toInt() ?? 0,
  (json['addonSelectedCount'] as num?)?.toInt() ?? 0,
  (json['addonPendingPaymentCount'] as num?)?.toInt() ?? 0,
  (json['amountHalala'] as num?)?.toInt() ?? 0,
  (json['pendingAmountHalala'] as num?)?.toInt() ?? 0,
  json['currency'] as String? ?? 'SAR',
  json['pricingStatus'] as String? ?? 'not_required',
  json['blockingReason'] as String?,
  json['canCreatePayment'] as bool? ?? false,
);

Map<String, dynamic> _$PaymentRequirementResponseToJson(
  PaymentRequirementResponse instance,
) => <String, dynamic>{
  'status': instance.status,
  'requiresPayment': instance.requiresPayment,
  'premiumSelectedCount': instance.premiumSelectedCount,
  'premiumPendingPaymentCount': instance.premiumPendingPaymentCount,
  'addonSelectedCount': instance.addonSelectedCount,
  'addonPendingPaymentCount': instance.addonPendingPaymentCount,
  'amountHalala': instance.amountHalala,
  'pendingAmountHalala': instance.pendingAmountHalala,
  'currency': instance.currency,
  'pricingStatus': instance.pricingStatus,
  'blockingReason': instance.blockingReason,
  'canCreatePayment': instance.canCreatePayment,
};
