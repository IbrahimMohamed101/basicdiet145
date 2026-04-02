import 'package:equatable/equatable.dart';

abstract class RegisterState extends Equatable {
  final String fullName;
  final String? fullNameError;
  final String phone;
  final String? phoneError;
  final String email;
  final String? emailError;

  const RegisterState({
    this.fullName = '',
    this.fullNameError,
    this.phone = '',
    this.phoneError,
    this.email = '',
    this.emailError,
  });

  RegisterState copyWith({
    String? fullName,
    String? fullNameError,
    String? phone,
    String? phoneError,
    String? email,
    String? emailError,
  });

  @override
  List<Object?> get props => [
    fullName,
    fullNameError ?? '',
    phone,
    phoneError ?? '',
    email,
    emailError ?? '',
  ];
}

class RegisterFormInitialState extends RegisterState {
  const RegisterFormInitialState({
    super.fullName = '',
    super.fullNameError,
    super.phone = '',
    super.phoneError,
    super.email = '',
    super.emailError,
  });

  @override
  RegisterState copyWith({
    String? fullName,
    String? fullNameError,
    String? phone,
    String? phoneError,
    String? email,
    String? emailError,
  }) {
    return RegisterFormInitialState(
      fullName: fullName ?? this.fullName,
      fullNameError: fullNameError,
      phone: phone ?? this.phone,
      phoneError: phoneError,
      email: email ?? this.email,
      emailError: emailError,
    );
  }
}

class RegisterLoadingState extends RegisterState {
  const RegisterLoadingState({
    super.fullName = '',
    super.fullNameError,
    super.phone = '',
    super.phoneError,
    super.email = '',
    super.emailError,
  });

  @override
  RegisterState copyWith({
    String? fullName,
    String? fullNameError,
    String? phone,
    String? phoneError,
    String? email,
    String? emailError,
  }) {
    return RegisterLoadingState(
      fullName: fullName ?? this.fullName,
      fullNameError: fullNameError,
      phone: phone ?? this.phone,
      phoneError: phoneError,
      email: email ?? this.email,
      emailError: emailError,
    );
  }
}

class RegisterSuccessState extends RegisterState {
  final String message;
  const RegisterSuccessState(
    this.message, {
    super.fullName = '',
    super.fullNameError,
    super.phone = '',
    super.phoneError,
    super.email = '',
    super.emailError,
  });

  @override
  RegisterState copyWith({
    String? fullName,
    String? fullNameError,
    String? phone,
    String? phoneError,
    String? email,
    String? emailError,
  }) {
    return RegisterSuccessState(
      message,
      fullName: fullName ?? this.fullName,
      fullNameError: fullNameError,
      phone: phone ?? this.phone,
      phoneError: phoneError,
      email: email ?? this.email,
      emailError: emailError,
    );
  }

  @override
  List<Object?> get props => [
    fullName,
    fullNameError ?? '',
    phone,
    phoneError ?? '',
    email,
    emailError ?? '',
    message,
  ];
}

class RegisterErrorState extends RegisterState {
  final String message;
  const RegisterErrorState(
    this.message, {
    super.fullName = '',
    super.fullNameError,
    super.phone = '',
    super.phoneError,
    super.email = '',
    super.emailError,
  });

  @override
  RegisterState copyWith({
    String? fullName,
    String? fullNameError,
    String? phone,
    String? phoneError,
    String? email,
    String? emailError,
  }) {
    return RegisterErrorState(
      message,
      fullName: fullName ?? this.fullName,
      fullNameError: fullNameError,
      phone: phone ?? this.phone,
      phoneError: phoneError,
      email: email ?? this.email,
      emailError: emailError,
    );
  }

  @override
  List<Object?> get props => [
    fullName,
    fullNameError ?? '',
    phone,
    phoneError ?? '',
    email,
    emailError ?? '',
    message,
  ];
}
