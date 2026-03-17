import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/auth_model.dart';
import 'package:basic_diet/domain/model/base__model.dart';
import 'package:basic_diet/domain/model/plans_model.dart';
import 'package:dartz/dartz.dart';

abstract class Repository {
  Future<Either<Failure, BaseModel>> login(String phone);
  Future<Either<Failure, AuthenticationModel>> verifyOtp(
    String phone,
    String otp,
  );
  Future<Either<Failure, BaseModel>> register(
    String fullName,
    String phone,
    String? email,
  );
  Future<Either<Failure, PlansModel>> getPlans();
}
