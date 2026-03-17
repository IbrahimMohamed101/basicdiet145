import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/popular_packages_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class GetPopularPackagesUseCase implements BaseUseCase<void, PopularPackagesModel> {
  final Repository _repository;

  GetPopularPackagesUseCase(this._repository);

  @override
  Future<Either<Failure, PopularPackagesModel>> execute(void input) async {
    return await _repository.getPopularPackages();
  }
}
