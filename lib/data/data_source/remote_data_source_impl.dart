import 'package:basic_diet/data/network/app_api.dart';
import 'package:basic_diet/data/response/base_response/base_response.dart';
import 'remote_data_source.dart';

class RemoteDataSourceImpl implements RemoteDataSource {
  final AppServiceClient _appServiceClient;

  RemoteDataSourceImpl(this._appServiceClient);

  @override
  Future<BaseResponse> login(String phone) async {
    return await _appServiceClient.login(phone);
  }
}
