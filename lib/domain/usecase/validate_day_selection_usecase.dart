import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/data/request/day_selection_request.dart';
import 'package:basic_diet/domain/model/subscription_day_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class ValidateDaySelectionUseCaseInput {
  final String subscriptionId;
  final String date;
  final DaySelectionRequest request;

  ValidateDaySelectionUseCaseInput(
    this.subscriptionId,
    this.date,
    this.request,
  );
}

class ValidateDaySelectionUseCase
    implements BaseUseCase<ValidateDaySelectionUseCaseInput, ValidationResultModel> {
  final Repository _repository;

  ValidateDaySelectionUseCase(this._repository);

  @override
  Future<Either<Failure, ValidationResultModel>> execute(
    ValidateDaySelectionUseCaseInput input,
  ) async {
    return await _repository.validateDaySelection(
      input.subscriptionId,
      input.date,
      input.request,
    );
  }
}
