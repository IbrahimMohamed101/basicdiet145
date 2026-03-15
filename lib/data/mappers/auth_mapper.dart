import 'package:basic_diet/data/response/auth_response.dart';
import 'package:basic_diet/domain/model/auth_model.dart';
import 'package:basic_diet/app/constants.dart';

extension AuthenticationResponseMapper on AuthenticationResponse? {
  AuthenticationModel toDomain() {
    return AuthenticationModel(
      status: this?.status ?? false,
      token: this?.token ?? Constants.empty,
    );
  }
}
