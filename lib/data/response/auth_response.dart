import 'package:json_annotation/json_annotation.dart';

part 'auth_response.g.dart';

@JsonSerializable()
class AuthenticationResponse {
  @JsonKey(name: "status")
  dynamic status;
  @JsonKey(name: "token")
  String? token;

  AuthenticationResponse({this.status, this.token});

  factory AuthenticationResponse.fromJson(Map<String, dynamic> json) =>
      _$AuthenticationResponseFromJson(json);

  Map<String, dynamic> toJson() => _$AuthenticationResponseToJson(this);
}
