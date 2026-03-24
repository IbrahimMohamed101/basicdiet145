import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/premium_meals_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class GetPremiumMealsUseCase
    implements BaseUseCase<void, PremiumMealsModel> {
  final Repository _repository;

  GetPremiumMealsUseCase(this._repository);

  @override
  Future<Either<Failure, PremiumMealsModel>> execute(void input) async {
    return await _repository.getPremiumMeals();
  }
}
