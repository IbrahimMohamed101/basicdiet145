import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/pickup_status_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class GetPickupStatusUseCase
    implements BaseUseCase<GetPickupStatusInput, PickupStatusModel> {
  final Repository _repository;

  GetPickupStatusUseCase(this._repository);

  @override
  Future<Either<Failure, PickupStatusModel>> execute(
    GetPickupStatusInput input,
  ) async {
    return await _repository.getPickupStatus(input.id, input.date);
  }
}

class GetPickupStatusInput {
  final String id;
  final String date;

  GetPickupStatusInput(this.id, this.date);
}
