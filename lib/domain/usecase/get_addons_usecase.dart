import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/add_ons_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class GetAddOnsUseCase extends BaseUseCase<void, AddOnsModel> {
  final Repository _repository;

  GetAddOnsUseCase(this._repository);

  @override
  Future<Either<Failure, AddOnsModel>> execute(void input) async {
    return await _repository.getAddOns();
  }
}
