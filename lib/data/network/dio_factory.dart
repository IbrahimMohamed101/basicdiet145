import 'package:basic_diet/app/app_pref.dart';
import 'package:basic_diet/app/constants.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:pretty_dio_logger/pretty_dio_logger.dart';

const String APPLICATION_JSON = "application/json";
const String CONTENT_TYPE = "content-type";
const String ACCEPT = "accept";
const String AUTHORIZATION = "authorization";
const String LANGUAGE = "Accept-Language";

class DioFactory {
  final AppPreferences _appPreferences;

  DioFactory(this._appPreferences);

  Future<Dio> createConfiguredDio() async {
    // Base configuration for Dio
    final baseDioOptions = BaseOptions(
      baseUrl: Constants.baseUrl,
      headers: {ACCEPT: APPLICATION_JSON, CONTENT_TYPE: APPLICATION_JSON},
      receiveDataWhenStatusError: true,
      sendTimeout: const Duration(seconds: Constants.timeout),
      receiveTimeout: const Duration(seconds: Constants.timeout),
      validateStatus: (status) =>
          status != null && status >= 200 && status < 400,
    );

    final dioInstance = Dio(baseDioOptions);

    dioInstance.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          await _addAuthorizationHeaderIfLoggedIn(options);
          await _addLanguageHeader(options);
          handler.next(options);
        },
        // onError: (DioException error, ErrorInterceptorHandler handler) async {
        //   if (_isUnauthorizedError(error)) {
        //     if (_isSessionExpired(error)) {
        //       await _handleUnauthorizedError(error, handler);
        //     } else {
        //       handler.next(error);
        //     }
        //   } else {
        //     handler.next(error);
        //   }
        // },
      ),
    );

    // Add pretty logging for development
    if (!kReleaseMode) {
      dioInstance.interceptors.add(
        PrettyDioLogger(
          requestHeader: true,
          requestBody: true,
          responseHeader: true,
          responseBody: true,
        ),
      );
    }

    return dioInstance;
  }

  Future<void> _addAuthorizationHeaderIfLoggedIn(RequestOptions options) async {
    try {
      final accessToken = await _appPreferences.getUserToken("login");

      if (_isUserLoggedIn(accessToken)) {
        options.headers["Authorization"] = "Bearer $accessToken";
        // options.headers["Authorization"] = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OWRjMjI2NThhZDc5N2U2MGVlYjRmNjMiLCJyb2xlIjoiY2xpZW50IiwidG9rZW5UeXBlIjoiYXBwX2FjY2VzcyIsImlhdCI6MTc3NjAzNDQyMiwiZXhwIjoxNzc4NzEyODIyfQ.ulgPpaLhSMHKpDiRXRE6_F4OGVzrzVUkYHuRD3tLbEw";
      } else {
        options.headers.remove("Authorization");
      }
    } catch (error) {
      debugPrint("⚠️ Failed to attach authorization header: $error");
    }
  }

  bool _isUserLoggedIn(String token) => token.isNotEmpty;

  Future<void> _addLanguageHeader(RequestOptions options) async {
    final language = await _appPreferences.getAppLanguage();
    options.headers[LANGUAGE] = language;
  }
}
