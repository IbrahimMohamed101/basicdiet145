// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'current_subscription_overview_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AddonSubscriptionResponse _$AddonSubscriptionResponseFromJson(
  Map<String, dynamic> json,
) => AddonSubscriptionResponse(
  json['addonId'] as String?,
  json['name'] as String?,
  (json['price'] as num?)?.toInt(),
);

Map<String, dynamic> _$AddonSubscriptionResponseToJson(
  AddonSubscriptionResponse instance,
) => <String, dynamic>{
  'addonId': instance.addonId,
  'name': instance.name,
  'price': instance.price,
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
_$CurrentSubscriptionOverviewDataResponseFromJson(Map<String, dynamic> json) =>
    CurrentSubscriptionOverviewDataResponse(
      json['_id'] as String?,
      json['status'] as String?,
      json['startDate'] as String?,
      json['endDate'] as String?,
      (json['totalMeals'] as num?)?.toInt(),
      (json['remainingMeals'] as num?)?.toInt(),
      (json['premiumRemaining'] as num?)?.toInt(),
      (json['addonSubscriptions'] as List<dynamic>?)
          ?.map(
            (e) =>
                AddonSubscriptionResponse.fromJson(e as Map<String, dynamic>),
          )
          .toList(),
      (json['selectedMealsPerDay'] as num?)?.toInt(),
      json['deliveryMode'] as String?,
      (json['premiumSummary'] as List<dynamic>?)
          ?.map(
            (e) => PremiumSummaryResponse.fromJson(e as Map<String, dynamic>),
          )
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
    );

Map<String, dynamic> _$CurrentSubscriptionOverviewDataResponseToJson(
  CurrentSubscriptionOverviewDataResponse instance,
) => <String, dynamic>{
  '_id': instance.id,
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
      ..status = json['status'] as bool?
      ..message = json['message'] as String?;

Map<String, dynamic> _$CurrentSubscriptionOverviewResponseToJson(
  CurrentSubscriptionOverviewResponse instance,
) => <String, dynamic>{
  'status': instance.status,
  'message': instance.message,
  'data': instance.data,
};
