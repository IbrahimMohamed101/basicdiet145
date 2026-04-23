import 'dart:io';
import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

class ExceptionHandler implements Exception {
  late Failure failure;

  ExceptionHandler.handle(dynamic exception) {
    if (exception is DioException) {
      failure = _handleException(exception);
    } else {
      failure = DataSource.DEFAULT.getFailure();
    }
  }
}

Failure _handleException(DioException exception) {
  switch (exception.type) {
    case DioExceptionType.connectionTimeout:
      return DataSource.CONNECT_TIMEOUT.getFailure();
    case DioExceptionType.sendTimeout:
      return DataSource.SEND_TIMEOUT.getFailure();
    case DioExceptionType.receiveTimeout:
      return DataSource.RECEIVE_TIMEOUT.getFailure();
    case DioExceptionType.badCertificate:
      return DataSource.BAD_REQUEST.getFailure();
    case DioExceptionType.badResponse:
      if (exception.response != null &&
          exception.response?.statusCode != null &&
          exception.response?.statusMessage != null) {
        return Failure(
          exception.response!.statusCode!,
          exception.response!.statusMessage!,
        );
      } else {
        return DataSource.DEFAULT.getFailure();
      }
    case DioExceptionType.cancel:
      return DataSource.CANCEL.getFailure();
    case DioExceptionType.connectionError:
      return DataSource.NO_INTERNET_CONNECTION.getFailure();
    case DioExceptionType.unknown:
      debugPrint("Unknown DioException: ${exception.error}");
      if (exception.error is SocketException) {
        return DataSource.NO_INTERNET_CONNECTION.getFailure();
      }
      return DataSource.DEFAULT.getFailure();
  }
}

enum DataSource {
  SUCCESS,
  NO_CONTENT,
  BAD_REQUEST,
  FORBIDDEN,
  UNAUTHORISED,
  NOT_FOUND,
  INTERNAL_SERVER_ERROR,
  CONNECT_TIMEOUT,
  CANCEL,
  RECEIVE_TIMEOUT,
  SEND_TIMEOUT,
  CACHE_ERROR,
  NO_INTERNET_CONNECTION,
  DEFAULT,
}

extension DataSourceExtension on DataSource {
  Failure getFailure() {
    switch (this) {
      case DataSource.SUCCESS:
        return Failure(ResponseCode.success, ResponseMessage.success);
      case DataSource.NO_CONTENT:
        return Failure(ResponseCode.noContent, ResponseMessage.noContent);
      case DataSource.BAD_REQUEST:
        return Failure(ResponseCode.badRequest, ResponseMessage.badRequest);
      case DataSource.FORBIDDEN:
        return Failure(ResponseCode.forbidden, ResponseMessage.forbidden);
      case DataSource.UNAUTHORISED:
        return Failure(ResponseCode.unauthorised, ResponseMessage.unauthorised);
      case DataSource.NOT_FOUND:
        return Failure(ResponseCode.noContent, ResponseMessage.notFound);
      case DataSource.INTERNAL_SERVER_ERROR:
        return Failure(
          ResponseCode.internalServerError,
          ResponseMessage.internalServerError,
        );
      case DataSource.CONNECT_TIMEOUT:
        return Failure(
          ResponseCode.connectTimeout,
          ResponseMessage.connectTimeout,
        );
      case DataSource.CANCEL:
        return Failure(ResponseCode.cancel, ResponseMessage.cancel);
      case DataSource.RECEIVE_TIMEOUT:
        return Failure(
          ResponseCode.receiveTimeout,
          ResponseMessage.receiveTimeout,
        );
      case DataSource.SEND_TIMEOUT:
        return Failure(ResponseCode.sendTimeout, ResponseMessage.sendTimeout);
      case DataSource.CACHE_ERROR:
        return Failure(ResponseCode.cacheError, ResponseMessage.cacheError);
      case DataSource.NO_INTERNET_CONNECTION:
        return Failure(
          ResponseCode.noInternetConnection,
          ResponseMessage.noInternetConnection,
        );
      case DataSource.DEFAULT:
        return Failure(ResponseCode.defaultError, ResponseMessage.defaultError);
    }
  }
}

class ResponseCode {
  static const int success = 200;
  static const int noContent = 201;
  static const int badRequest = 400;
  static const int unauthorised = 401;
  static const int forbidden = 403;
  static const int internalServerError = 500;
  static const int notFound = 404;

  // local status codes
  static const int connectTimeout = -1;
  static const int cancel = -2;
  static const int receiveTimeout = -3;
  static const int sendTimeout = -4;
  static const int cancelError = -5;
  static const int cacheError = -6;
  static const int noInternetConnection = -7;
  static const int defaultError = -8;
}

class ResponseMessage {
  static String success = Strings.success;
  static String noContent = Strings.noContent;
  static String badRequest = Strings.badRequest;
  static String unauthorised = Strings.unauthorized;
  static String forbidden = Strings.forbidden;
  static String internalServerError = Strings.internalServerError;
  static String notFound = Strings.notFound;

  // local status codes
  static String connectTimeout = Strings.timeout;
  static String cancel = Strings.defaultError;
  static String receiveTimeout = Strings.timeout;
  static String sendTimeout = Strings.timeout;
  static String cancelError = Strings.defaultError;
  static String cacheError = Strings.cacheError;
  static String noInternetConnection = Strings.noInternet;
  static String defaultError = Strings.defaultError;
}

class ApiInternalStatus {
  static const int success = 0, failure = 1;
}
