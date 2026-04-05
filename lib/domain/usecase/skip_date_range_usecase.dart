import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/data/request/skip_days_request.dart';
import 'package:basic_diet/data/response/skip_days_response.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class SkipDateRangeUseCase implements BaseUseCase<SkipDateRangeUseCaseInput, SkipDaysResponse> {
  final Repository _repository;

  SkipDateRangeUseCase(this._repository);

  @override
  Future<Either<Failure, SkipDaysResponse>> execute(SkipDateRangeUseCaseInput input) async {
    return await _repository.skipDateRange(
      input.id,
      SkipDateRangeRequest(input.startDate, input.endDate),
    );
  }
}

class SkipDateRangeUseCaseInput {
  String id;
  String startDate;
  String endDate;

  SkipDateRangeUseCaseInput(this.id, this.startDate, this.endDate);
}
