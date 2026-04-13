import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/pickup_prepare_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class PreparePickupUseCase
    implements BaseUseCase<PreparePickupUseCaseInput, PickupPrepareModel> {
  final Repository _repository;

  PreparePickupUseCase(this._repository);

  @override
  Future<Either<Failure, PickupPrepareModel>> execute(
    PreparePickupUseCaseInput input,
  ) async {
    return await _repository.preparePickup(input.id, input.date);
  }
}

class PreparePickupUseCaseInput {
  String id;
  String date;

  PreparePickupUseCaseInput(this.id, this.date);
}
