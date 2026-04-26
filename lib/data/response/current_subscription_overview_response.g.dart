// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'current_subscription_overview_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MetaResponse _$MetaResponseFromJson(Map<String, dynamic> json) =>
    MetaResponse(json['testScenario'] as String?);

Map<String, dynamic> _$MetaResponseToJson(MetaResponse instance) =>
    <String, dynamic>{'testScenario': instance.testScenario};

ContractResponse _$ContractResponseFromJson(Map<String, dynamic> json) =>
    ContractResponse(
      json['isCanonical'] as bool?,
      json['isGrandfathered'] as bool?,
      json['version'] as String?,
    );

Map<String, dynamic> _$ContractResponseToJson(ContractResponse instance) =>
    <String, dynamic>{
      'isCanonical': instance.isCanonical,
      'isGrandfathered': instance.isGrandfathered,
      'version': instance.version,
    };

PickupPreparationResponse _$PickupPreparationResponseFromJson(
  Map<String, dynamic> json,
) => PickupPreparationResponse(
  json['flowStatus'] as String?,
  json['reason'] as String?,
  json['buttonLabel'] as String?,
  json['message'] as String?,
  json['canRequestPrepare'] as bool?,
  json['canBePrepared'] as bool?,
  json['planningReady'] as bool?,
  json['showMealPlannerCta'] as bool?,
  json['mealPlannerCtaLabelAr'] as String?,
  json['mealPlannerCtaLabelEn'] as String?,
  json['messageAr'] as String?,
  json['messageEn'] as String?,
  json['businessDate'] as String?,
  json['pickupRequested'] as bool?,
  json['pickupPrepared'] as bool?,
);

Map<String, dynamic> _$PickupPreparationResponseToJson(
  PickupPreparationResponse instance,
) => <String, dynamic>{
  'flowStatus': instance.flowStatus,
  'reason': instance.reason,
  'buttonLabel': instance.buttonLabel,
  'message': instance.message,
  'canRequestPrepare': instance.canRequestPrepare,
  'canBePrepared': instance.canBePrepared,
  'planningReady': instance.planningReady,
  'showMealPlannerCta': instance.showMealPlannerCta,
  'mealPlannerCtaLabelAr': instance.mealPlannerCtaLabelAr,
  'mealPlannerCtaLabelEn': instance.mealPlannerCtaLabelEn,
  'messageAr': instance.messageAr,
  'messageEn': instance.messageEn,
  'businessDate': instance.businessDate,
  'pickupRequested': instance.pickupRequested,
  'pickupPrepared': instance.pickupPrepared,
};

OverviewDeliverySlotResponse _$OverviewDeliverySlotResponseFromJson(
  Map<String, dynamic> json,
) => OverviewDeliverySlotResponse(
  json['slotId'] as String?,
  json['type'] as String?,
  json['window'] as String?,
);

Map<String, dynamic> _$OverviewDeliverySlotResponseToJson(
  OverviewDeliverySlotResponse instance,
) => <String, dynamic>{
  'slotId': instance.slotId,
  'type': instance.type,
  'window': instance.window,
};

AddonSubscriptionResponse _$AddonSubscriptionResponseFromJson(
  Map<String, dynamic> json,
) => AddonSubscriptionResponse(
  json['addonId'] as String?,
  json['category'] as String?,
  (json['includedCount'] as num?)?.toInt(),
  (json['maxPerDay'] as num?)?.toInt(),
  json['status'] as String?,
);

Map<String, dynamic> _$AddonSubscriptionResponseToJson(
  AddonSubscriptionResponse instance,
) => <String, dynamic>{
  'addonId': instance.addonId,
  'category': instance.category,
  'includedCount': instance.includedCount,
  'maxPerDay': instance.maxPerDay,
  'status': instance.status,
};

PremiumSummaryResponse _$PremiumSummaryResponseFromJson(
  Map<String, dynamic> json,
) => PremiumSummaryResponse(
  json['premiumMealId'] as String?,
  json['name'] as String?,
  (json['purchasedQtyTotal'] as num?)?.toInt(),
  (json['remainingQtyTotal'] as num?)?.toInt(),
  (json['consumedQtyTotal'] as num?)?.toInt(),
);

Map<String, dynamic> _$PremiumSummaryResponseToJson(
  PremiumSummaryResponse instance,
) => <String, dynamic>{
  'premiumMealId': instance.premiumMealId,
  'name': instance.name,
  'purchasedQtyTotal': instance.purchasedQtyTotal,
  'remainingQtyTotal': instance.remainingQtyTotal,
  'consumedQtyTotal': instance.consumedQtyTotal,
};

AddonSummaryResponse _$AddonSummaryResponseFromJson(
  Map<String, dynamic> json,
) => AddonSummaryResponse(
  json['addonId'] as String?,
  json['name'] as String?,
  (json['purchasedQtyTotal'] as num?)?.toInt(),
  (json['remainingQtyTotal'] as num?)?.toInt(),
  (json['consumedQtyTotal'] as num?)?.toInt(),
);

Map<String, dynamic> _$AddonSummaryResponseToJson(
  AddonSummaryResponse instance,
) => <String, dynamic>{
  'addonId': instance.addonId,
  'name': instance.name,
  'purchasedQtyTotal': instance.purchasedQtyTotal,
  'remainingQtyTotal': instance.remainingQtyTotal,
  'consumedQtyTotal': instance.consumedQtyTotal,
};

CurrentSubscriptionOverviewDataResponse
_$CurrentSubscriptionOverviewDataResponseFromJson(
  Map<String, dynamic> json,
) => CurrentSubscriptionOverviewDataResponse(
  json['_id'] as String?,
  json['businessDate'] as String?,
  json['status'] as String?,
  json['startDate'] as String?,
  json['endDate'] as String?,
  (json['totalMeals'] as num?)?.toInt(),
  (json['remainingMeals'] as num?)?.toInt(),
  (json['premiumRemaining'] as num?)?.toInt(),
  (json['addonSubscriptions'] as List<dynamic>?)
      ?.map(
        (e) => AddonSubscriptionResponse.fromJson(e as Map<String, dynamic>),
      )
      .toList(),
  (json['selectedMealsPerDay'] as num?)?.toInt(),
  json['deliveryMode'] as String?,
  (json['premiumSummary'] as List<dynamic>?)
      ?.map((e) => PremiumSummaryResponse.fromJson(e as Map<String, dynamic>))
      .toList(),
  (json['addonsSummary'] as List<dynamic>?)
      ?.map((e) => AddonSummaryResponse.fromJson(e as Map<String, dynamic>))
      .toList(),
  json['statusLabel'] as String?,
  json['deliveryModeLabel'] as String?,
  json['validityEndDate'] as String?,
  (json['skipDaysUsed'] as num?)?.toInt(),
  (json['skipDaysLimit'] as num?)?.toInt(),
  (json['remainingSkipDays'] as num?)?.toInt(),
  json['meta'] == null
      ? null
      : MetaResponse.fromJson(json['meta'] as Map<String, dynamic>),
  json['contract'] == null
      ? null
      : ContractResponse.fromJson(json['contract'] as Map<String, dynamic>),
  json['pickupPreparation'] == null
      ? null
      : PickupPreparationResponse.fromJson(
        json['pickupPreparation'] as Map<String, dynamic>,
      ),
  json['deliverySlot'] == null
      ? null
      : OverviewDeliverySlotResponse.fromJson(
        json['deliverySlot'] as Map<String, dynamic>,
      ),
);

Map<String, dynamic> _$CurrentSubscriptionOverviewDataResponseToJson(
  CurrentSubscriptionOverviewDataResponse instance,
) => <String, dynamic>{
  '_id': instance.id,
  'businessDate': instance.businessDate,
  'status': instance.status,
  'startDate': instance.startDate,
  'endDate': instance.endDate,
  'totalMeals': instance.totalMeals,
  'remainingMeals': instance.remainingMeals,
  'premiumRemaining': instance.premiumRemaining,
  'addonSubscriptions': instance.addonSubscriptions,
  'selectedMealsPerDay': instance.selectedMealsPerDay,
  'deliveryMode': instance.deliveryMode,
  'premiumSummary': instance.premiumSummary,
  'addonsSummary': instance.addonsSummary,
  'statusLabel': instance.statusLabel,
  'deliveryModeLabel': instance.deliveryModeLabel,
  'validityEndDate': instance.validityEndDate,
  'skipDaysUsed': instance.skipDaysUsed,
  'skipDaysLimit': instance.skipDaysLimit,
  'remainingSkipDays': instance.remainingSkipDays,
  'meta': instance.meta,
  'contract': instance.contract,
  'pickupPreparation': instance.pickupPreparation,
  'deliverySlot': instance.deliverySlot,
};

CurrentSubscriptionOverviewResponse
_$CurrentSubscriptionOverviewResponseFromJson(Map<String, dynamic> json) =>
    CurrentSubscriptionOverviewResponse(
        json['data'] == null
            ? null
            : CurrentSubscriptionOverviewDataResponse.fromJson(
              json['data'] as Map<String, dynamic>,
            ),
      )
      ..status = json['status']
      ..message = json['message'] as String?;

Map<String, dynamic> _$CurrentSubscriptionOverviewResponseToJson(
  CurrentSubscriptionOverviewResponse instance,
) => <String, dynamic>{
  'status': instance.status,
  'message': instance.message,
  'data': instance.data,
};
