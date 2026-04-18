// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'bulk_selections_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

BulkSelectionsResponse _$BulkSelectionsResponseFromJson(
  Map<String, dynamic> json,
) => BulkSelectionsResponse(
  status: json['status'] as bool,
  data:
      json['data'] == null
          ? null
          : BulkSelectionsData.fromJson(json['data'] as Map<String, dynamic>),
);

Map<String, dynamic> _$BulkSelectionsResponseToJson(
  BulkSelectionsResponse instance,
) => <String, dynamic>{'status': instance.status, 'data': instance.data};

BulkSelectionsData _$BulkSelectionsDataFromJson(Map<String, dynamic> json) =>
    BulkSelectionsData(
      summary: BulkSelectionsSummary.fromJson(
        json['summary'] as Map<String, dynamic>,
      ),
      results:
          (json['results'] as List<dynamic>)
              .map(
                (e) => BulkSelectionResult.fromJson(e as Map<String, dynamic>),
              )
              .toList(),
    );

Map<String, dynamic> _$BulkSelectionsDataToJson(BulkSelectionsData instance) =>
    <String, dynamic>{'summary': instance.summary, 'results': instance.results};

BulkSelectionsSummary _$BulkSelectionsSummaryFromJson(
  Map<String, dynamic> json,
) => BulkSelectionsSummary(
  totalDates: (json['totalDates'] as num).toInt(),
  updatedCount: (json['updatedCount'] as num).toInt(),
  idempotentCount: (json['idempotentCount'] as num).toInt(),
  failedCount: (json['failedCount'] as num).toInt(),
);

Map<String, dynamic> _$BulkSelectionsSummaryToJson(
  BulkSelectionsSummary instance,
) => <String, dynamic>{
  'totalDates': instance.totalDates,
  'updatedCount': instance.updatedCount,
  'idempotentCount': instance.idempotentCount,
  'failedCount': instance.failedCount,
};

BulkSelectionResult _$BulkSelectionResultFromJson(Map<String, dynamic> json) =>
    BulkSelectionResult(
      date: json['date'] as String,
      ok: json['ok'] as bool,
      code: json['code'] as String?,
      message: json['message'] as String?,
    );

Map<String, dynamic> _$BulkSelectionResultToJson(
  BulkSelectionResult instance,
) => <String, dynamic>{
  'date': instance.date,
  'ok': instance.ok,
  'code': instance.code,
  'message': instance.message,
};
