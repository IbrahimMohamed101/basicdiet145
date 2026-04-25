class BulkSelectionsModel {
  final BulkSelectionsSummaryModel summary;
  final List<BulkSelectionResultModel> results;

  BulkSelectionsModel({required this.summary, required this.results});
}

class BulkSelectionsSummaryModel {
  final int totalDates;
  final int updatedCount;
  final int idempotentCount;
  final int failedCount;

  BulkSelectionsSummaryModel({
    required this.totalDates,
    required this.updatedCount,
    required this.idempotentCount,
    required this.failedCount,
  });
}

class BulkSelectionResultModel {
  final String date;
  final bool ok;
  final String? code;
  final String? message;

  BulkSelectionResultModel({
    required this.date,
    required this.ok,
    this.code,
    this.message,
  });
}
