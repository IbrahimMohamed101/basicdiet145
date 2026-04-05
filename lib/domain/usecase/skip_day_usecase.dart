import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/data/request/skip_days_request.dart';
import 'package:basic_diet/data/response/skip_days_response.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class SkipDayUseCase implements BaseUseCase<SkipDayUseCaseInput, SkipDaysResponse> {
  final Repository _repository;

  SkipDayUseCase(this._repository);

  @override
  Future<Either<Failure, SkipDaysResponse>> execute(SkipDayUseCaseInput input) async {
    return await _repository.skipDay(
      input.id,
      SkipDayRequest(input.date),
    );
  }
}

class SkipDayUseCaseInput {
  String id;
  String date;

  SkipDayUseCaseInput(this.id, this.date);
}
