import 'package:basic_diet/data/data_source/remote_data_source.dart';
import 'package:basic_diet/data/mappers/login_mapper.dart';
import 'package:basic_diet/data/mappers/auth_mapper.dart';
import 'package:basic_diet/data/mappers/error_mapper.dart';
import 'package:basic_diet/data/network/exception_handler.dart';
import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/data/response/base_response/base_response.dart';
import 'package:basic_diet/domain/model/auth_model.dart';
import 'package:basic_diet/domain/model/base__model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:dartz/dartz.dart';

class RepositoryImpl implements Repository {
  final RemoteDataSource _remoteDataSource;

  RepositoryImpl(this._remoteDataSource);

  bool _isSuccessfulResponse(dynamic response) => response.status == true;

  Failure _mapFailureFromResponse(BaseResponse response) {
    return Failure(
      ApiInternalStatus.failure,
      response.message ?? ResponseMessage.defaultError,
    );
  }

  Either<Failure, T> _handleError<T>(dynamic error) {
    try {
      final data = error.response!.data as Map<String, dynamic>;
      final message = data.toDomain();
      return Left(
        Failure(
          error.response!.statusCode ?? ApiInternalStatus.failure,
          message.isNotEmpty ? message : ResponseMessage.defaultError,
        ),
      );
    } catch (_) {}
    return Left(ExceptionHandler.handle(error).failure);
  }

  @override
  Future<Either<Failure, BaseModel>> login(String phone) async {
    try {
      final response = await _remoteDataSource.login(phone);
      if (_isSuccessfulResponse(response)) {
        return Right(response.toDomain());
      } else {
        return Left(_mapFailureFromResponse(response));
      }
    } catch (error) {
      return _handleError(error);
    }
  }

  @override
  Future<Either<Failure, AuthenticationModel>> verifyOtp(
    String phone,
    String otp,
  ) async {
    try {
      final response = await _remoteDataSource.verifyOtp(phone, otp);
      if (_isSuccessfulResponse(response)) {
        return Right(response.toDomain());
      } else {
        return Left(
          Failure(ApiInternalStatus.failure, ResponseMessage.defaultError),
        );
      }
    } catch (error) {
      return _handleError(error);
    }
  }
}
