// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'subscription_day_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SubscriptionDayResponse _$SubscriptionDayResponseFromJson(
  Map<String, dynamic> json,
) => SubscriptionDayResponse(
  json['ok'] as bool?,
  json['data'] == null
      ? null
      : SubscriptionDayData.fromJson(json['data'] as Map<String, dynamic>),
);

Map<String, dynamic> _$SubscriptionDayResponseToJson(
  SubscriptionDayResponse instance,
) => <String, dynamic>{'ok': instance.status, 'data': instance.data};

SubscriptionDayData _$SubscriptionDayDataFromJson(Map<String, dynamic> json) =>
    SubscriptionDayData(
      json['date'] as String,
      json['status'] as String,
      json['plannerState'] as String?,
      (json['mealSlots'] as List<dynamic>)
          .map((e) => MealSlotResponse.fromJson(e as Map<String, dynamic>))
          .toList(),
      json['plannerMeta'] == null
          ? null
          : PlannerMetaResponse.fromJson(
            json['plannerMeta'] as Map<String, dynamic>,
          ),
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
  'plannerMeta': instance.plannerMeta,
  'paymentRequirement': instance.paymentRequirement,
};

MealSlotResponse _$MealSlotResponseFromJson(Map<String, dynamic> json) =>
    MealSlotResponse(
      (json['slotIndex'] as num).toInt(),
      json['slotKey'] as String,
      json['status'] as String,
      json['proteinId'] as String?,
      json['carbId'] as String?,
      json['isPremium'] as bool,
      json['premiumSource'] as String,
      json['proteinFamilyKey'] as String?,
    );

Map<String, dynamic> _$MealSlotResponseToJson(MealSlotResponse instance) =>
    <String, dynamic>{
      'slotIndex': instance.slotIndex,
      'slotKey': instance.slotKey,
      'status': instance.status,
      'proteinId': instance.proteinId,
      'carbId': instance.carbId,
      'isPremium': instance.isPremium,
      'premiumSource': instance.premiumSource,
      'proteinFamilyKey': instance.proteinFamilyKey,
    };

PlannerMetaResponse _$PlannerMetaResponseFromJson(Map<String, dynamic> json) =>
    PlannerMetaResponse(
      (json['requiredSlotCount'] as num).toInt(),
      (json['emptySlotCount'] as num).toInt(),
      (json['partialSlotCount'] as num).toInt(),
      (json['completeSlotCount'] as num).toInt(),
      (json['premiumSlotCount'] as num).toInt(),
      (json['premiumPendingPaymentCount'] as num).toInt(),
      (json['premiumTotalHalala'] as num).toInt(),
      json['isDraftValid'] as bool,
      json['isConfirmable'] as bool,
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
  json['requiresPayment'] as bool,
  (json['premiumSelectedCount'] as num).toInt(),
  (json['premiumPendingPaymentCount'] as num).toInt(),
  (json['amountHalala'] as num).toInt(),
  json['currency'] as String,
);

Map<String, dynamic> _$PaymentRequirementResponseToJson(
  PaymentRequirementResponse instance,
) => <String, dynamic>{
  'requiresPayment': instance.requiresPayment,
  'premiumSelectedCount': instance.premiumSelectedCount,
  'premiumPendingPaymentCount': instance.premiumPendingPaymentCount,
  'amountHalala': instance.amountHalala,
  'currency': instance.currency,
};
