import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/base__model.dart';
import 'package:dartz/dartz.dart';

abstract class Repository {
  Future<Either<Failure, BaseModel>> login(String phone);
}
