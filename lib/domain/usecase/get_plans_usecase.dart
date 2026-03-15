import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/plans_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class GetPlansUseCase implements BaseUseCase<void, PlansModel> {
  final Repository _repository;

  GetPlansUseCase(this._repository);

  @override
  Future<Either<Failure, PlansModel>> execute(void input) async {
    return await _repository.getPlans();
  }
}
