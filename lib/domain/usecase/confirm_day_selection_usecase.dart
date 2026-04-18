import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/base__model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class ConfirmDaySelectionUseCaseInput {
  final String subscriptionId;
  final String date;

  ConfirmDaySelectionUseCaseInput(this.subscriptionId, this.date);
}

class ConfirmDaySelectionUseCase
    implements BaseUseCase<ConfirmDaySelectionUseCaseInput, BaseModel> {
  final Repository _repository;

  ConfirmDaySelectionUseCase(this._repository);

  @override
  Future<Either<Failure, BaseModel>> execute(
    ConfirmDaySelectionUseCaseInput input,
  ) async {
    return await _repository.confirmDaySelection(
      input.subscriptionId,
      input.date,
    );
  }
}
