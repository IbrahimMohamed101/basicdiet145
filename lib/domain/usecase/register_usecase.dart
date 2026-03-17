import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/base__model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/base_usecase.dart';
import 'package:dartz/dartz.dart';

class RegisterUseCase implements BaseUseCase<RegisterUseCaseInput, BaseModel> {
  final Repository _repository;

  RegisterUseCase(this._repository);

  @override
  Future<Either<Failure, BaseModel>> execute(RegisterUseCaseInput input) async {
    return await _repository.register(input.fullName, input.phone, input.email);
  }
}

class RegisterUseCaseInput {
  String fullName;
  String phone;
  String? email;

  RegisterUseCaseInput(this.fullName, this.phone, this.email);
}
