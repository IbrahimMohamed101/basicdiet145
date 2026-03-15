import 'package:basic_diet/domain/model/base__model.dart';
import 'package:dartz/dartz.dart';
import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';

class LoginUseCase implements BaseUseCase<String, BaseModel> {
  final Repository _repository;
  LoginUseCase(this._repository);

  @override
  Future<Either<Failure, BaseModel>> execute(String phone) async {
    return await _repository.login(phone);
  }
}
