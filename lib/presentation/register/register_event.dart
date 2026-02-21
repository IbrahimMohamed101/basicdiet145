import 'package:equatable/equatable.dart';

abstract class RegisterEvent extends Equatable {
  const RegisterEvent();

  @override
  List<Object?> get props => [];
}

class RegisterFullNameChanged extends RegisterEvent {
  final String fullName;
  const RegisterFullNameChanged(this.fullName);

  @override
  List<Object?> get props => [fullName];
}

class RegisterPhoneChanged extends RegisterEvent {
  final String phone;
  const RegisterPhoneChanged(this.phone);

  @override
  List<Object?> get props => [phone];
}

class RegisterEmailChanged extends RegisterEvent {
  final String email;
  const RegisterEmailChanged(this.email);

  @override
  List<Object?> get props => [email];
}

class RegisterSubmitted extends RegisterEvent {
  const RegisterSubmitted();
}
