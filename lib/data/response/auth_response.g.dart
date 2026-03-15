// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'auth_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AuthenticationResponse _$AuthenticationResponseFromJson(
  Map<String, dynamic> json,
) => AuthenticationResponse(
  status: json['status'] as bool?,
  token: json['token'] as String?,
);

Map<String, dynamic> _$AuthenticationResponseToJson(
  AuthenticationResponse instance,
) => <String, dynamic>{'status': instance.status, 'token': instance.token};
