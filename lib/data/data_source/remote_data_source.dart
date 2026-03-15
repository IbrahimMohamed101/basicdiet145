import 'package:basic_diet/data/response/base_response/base_response.dart';

abstract class RemoteDataSource {
  Future<BaseResponse> login(String phone);
}
