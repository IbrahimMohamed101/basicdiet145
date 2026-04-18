import 'package:basic_diet/data/response/bulk_selections_response.dart';
import 'package:basic_diet/domain/model/bulk_selections_model.dart';

extension BulkSelectionsResponseMapper on BulkSelectionsResponse {
  BulkSelectionsModel toDomain() {
    return BulkSelectionsModel(
      summary: data?.summary.toDomain() ?? BulkSelectionsSummaryModel(
        totalDates: 0,
        updatedCount: 0,
        idempotentCount: 0,
        failedCount: 0,
      ),
      results: data?.results.map((r) => r.toDomain()).toList() ?? [],
    );
  }
}

extension BulkSelectionsSummaryMapper on BulkSelectionsSummary {
  BulkSelectionsSummaryModel toDomain() {
    return BulkSelectionsSummaryModel(
      totalDates: totalDates,
      updatedCount: updatedCount,
      idempotentCount: idempotentCount,
      failedCount: failedCount,
    );
  }
}

extension BulkSelectionResultMapper on BulkSelectionResult {
  BulkSelectionResultModel toDomain() {
    return BulkSelectionResultModel(
      date: date,
      ok: ok,
      code: code,
      message: message,
    );
  }
}
