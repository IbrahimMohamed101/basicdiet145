import 'dart:developer' as developer;

import 'package:basic_diet/data/data_source/remote_data_source.dart';
import 'package:basic_diet/data/mappers/login_mapper.dart';
import 'package:basic_diet/data/mappers/auth_mapper.dart';
import 'package:basic_diet/data/mappers/plans_mapper.dart';
import 'package:basic_diet/data/mappers/popular_packages_mapper.dart';
import 'package:basic_diet/data/mappers/premium_meals_mapper.dart';
import 'package:basic_diet/data/mappers/delivery_options_mapper.dart';
import 'package:basic_diet/data/mappers/subscription_checkout_mapper.dart';
import 'package:basic_diet/data/mappers/subscription_quote_mapper.dart';
import 'package:basic_diet/data/mappers/error_mapper.dart';
import 'package:basic_diet/data/network/exception_handler.dart';
import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/data/response/subscription_checkout_response.dart';
import 'package:basic_diet/domain/model/auth_model.dart';
import 'package:basic_diet/domain/model/base__model.dart';
import 'package:basic_diet/domain/model/delivery_options_model.dart';
import 'package:basic_diet/domain/model/plans_model.dart';
import 'package:basic_diet/domain/model/popular_packages_model.dart';
import 'package:basic_diet/domain/model/premium_meals_model.dart';
import 'package:basic_diet/domain/model/subscription_checkout_model.dart';
import 'package:basic_diet/domain/model/subscription_quote_model.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:dartz/dartz.dart';
import 'package:dio/dio.dart';

import 'package:basic_diet/data/mappers/addons_mapper.dart';
import 'package:basic_diet/domain/model/add_ons_model.dart';
import 'package:basic_diet/data/mappers/current_subscription_overview_mapper.dart';
import 'package:basic_diet/domain/model/current_subscription_overview_model.dart';
import 'package:basic_diet/data/request/skip_days_request.dart';
import 'package:basic_diet/data/response/skip_days_response.dart';
import 'package:basic_diet/data/mappers/freeze_subscription_mapper.dart';
import 'package:basic_diet/domain/model/freeze_subscription_model.dart';
import 'package:basic_diet/data/mappers/timeline_mapper.dart';
import 'package:basic_diet/domain/model/timeline_model.dart';
import 'package:basic_diet/data/mappers/categories_with_meals_mapper.dart';
import 'package:basic_diet/domain/model/categories_with_meals_model.dart';

class RepositoryImpl implements Repository {
  final RemoteDataSource _remoteDataSource;
  static const int _checkoutRetryCount = 5;
  static const Duration _checkoutRetryDelay = Duration(seconds: 1);
  static const String _checkoutInProgressCode = 'CHECKOUT_IN_PROGRESS';

  RepositoryImpl(this._remoteDataSource);

  bool _isSuccessfulResponse(dynamic response) {
    if (response.status is bool) return response.status == true;
    if (response.status is num) return response.status >= 200 && response.status < 300;
    if (response.status is String) return response.status.toString().toLowerCase() == 'true';
    return false;
  }

  Failure _mapFailureFromResponse(dynamic response) {
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

  bool _isCheckoutInProgressError(DioException error) {
    final data = error.response?.data;
    if (error.response?.statusCode != 409 || data is! Map<String, dynamic>) {
      return false;
    }

    final errorPayload = data['error'];
    return errorPayload is Map<String, dynamic> &&
        errorPayload['code'] == _checkoutInProgressCode;
  }

  Future<SubscriptionCheckoutResponse> _checkoutWithRetry(
    SubscriptionCheckoutRequestModel request,
  ) async {
    int retryAttempt = 0;

    while (true) {
      try {
        developer.log(
          'Sending checkout request with idempotencyKey: ${request.idempotencyKey}',
          name: 'checkout',
        );
        return await _remoteDataSource.checkoutSubscription(
          request.toRequest(),
        );
      } on DioException catch (error) {
        final canRetry =
            _isCheckoutInProgressError(error) &&
            retryAttempt < _checkoutRetryCount;

        if (!canRetry) {
          rethrow;
        }

        retryAttempt++;
        developer.log(
          'Checkout still in progress. Retrying with same idempotencyKey: ${request.idempotencyKey} (attempt $retryAttempt/$_checkoutRetryCount)',
          name: 'checkout',
        );
        await Future<void>.delayed(_checkoutRetryDelay);
      }
    }
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
  Future<Either<Failure, BaseModel>> register(
    String fullName,
    String phone,
    String? email,
  ) async {
    try {
      final response = await _remoteDataSource.register(fullName, phone, email);
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

  @override
  Future<Either<Failure, PlansModel>> getPlans() async {
    try {
      final response = await _remoteDataSource.getPlans();
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

  @override
  Future<Either<Failure, PopularPackagesModel>> getPopularPackages() async {
    try {
      final response = await _remoteDataSource.getPopularPackages();
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

  @override
  Future<Either<Failure, PremiumMealsModel>> getPremiumMeals() async {
    try {
      final response = await _remoteDataSource.getPremiumMeals();
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

  @override
  Future<Either<Failure, AddOnsModel>> getAddOns() async {
    try {
      final response = await _remoteDataSource.getAddOns();
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

  @override
  Future<Either<Failure, DeliveryOptionsModel>> getDeliveryOptions() async {
    try {
      final response = await _remoteDataSource.getDeliveryOptions();
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
  Future<Either<Failure, SubscriptionQuoteModel>> getSubscriptionQuote(
    SubscriptionQuoteRequestModel request,
  ) async {
    try {
      final response = await _remoteDataSource.getSubscriptionQuote(
        request.toRequest(),
      );
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
  Future<Either<Failure, SubscriptionCheckoutModel>> checkoutSubscription(
    SubscriptionCheckoutRequestModel request,
  ) async {
    try {
      final response = await _checkoutWithRetry(request);
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
  Future<Either<Failure, CurrentSubscriptionOverviewModel>> getCurrentSubscriptionOverview() async {
    try {
      final response = await _remoteDataSource.getCurrentSubscriptionOverview();
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
  Future<Either<Failure, FreezeSubscriptionModel>> freezeSubscription(
    String id,
    FreezeSubscriptionRequestModel request,
  ) async {
    try {
      final response = await _remoteDataSource.freezeSubscription(
        id,
        request.toRequest(),
      );
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
  Future<Either<Failure, SkipDaysResponse>> skipDay(
    String id,
    SkipDayRequest request,
  ) async {
    try {
      final response = await _remoteDataSource.skipDay(id, request);
      if (_isSuccessfulResponse(response)) {
        return Right(response);
      } else {
        return Left(_mapFailureFromResponse(response));
      }
    } catch (error) {
      return _handleError(error);
    }
  }

  @override
  Future<Either<Failure, SkipDaysResponse>> skipDateRange(
    String id,
    SkipDateRangeRequest request,
  ) async {
    try {
      final response = await _remoteDataSource.skipDateRange(id, request);
      if (_isSuccessfulResponse(response)) {
        return Right(response);
      } else {
        return Left(_mapFailureFromResponse(response));
      }
    } catch (error) {
      return _handleError(error);
    }
  }

  @override
  Future<Either<Failure, TimelineModel>> getSubscriptionTimeline(
    String id,
  ) async {
    try {
      final response = await _remoteDataSource.getSubscriptionTimeline(id);
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
  Future<Either<Failure, CategoriesWithMealsModel>> getCategoriesWithMeals() async {
    try {
      final response = await _remoteDataSource.getCategoriesWithMeals();
      if (_isSuccessfulResponse(response)) {
        return Right(response.toDomain());
      } else {
        return Left(_mapFailureFromResponse(response));
      }
    } catch (error) {
      return _handleError(error);
    }
  }
}
