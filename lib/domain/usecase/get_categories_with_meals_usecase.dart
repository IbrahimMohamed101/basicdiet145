import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/categories_with_meals_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class GetCategoriesWithMealsUseCase implements BaseUseCase<void, CategoriesWithMealsModel> {
  final Repository _repository;

  GetCategoriesWithMealsUseCase(this._repository);

  @override
  Future<Either<Failure, CategoriesWithMealsModel>> execute(void input) async {
    return await _repository.getCategoriesWithMeals();
  }
}
