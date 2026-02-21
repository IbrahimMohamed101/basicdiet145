import 'package:equatable/equatable.dart';

abstract class VerifyState extends Equatable {
  final String otpCode;
  final String? otpError;
  final int timerDuration;
  final bool canResend;

  const VerifyState({
    this.otpCode = '',
    this.otpError,
    this.timerDuration = 59,
    this.canResend = false,
  });

  VerifyState copyWith({
    String? otpCode,
    String? otpError,
    int? timerDuration,
    bool? canResend,
  });

  @override
  List<Object?> get props => [
    otpCode,
    otpError ?? '',
    timerDuration,
    canResend,
  ];
}

class VerifyInitialState extends VerifyState {
  const VerifyInitialState({
    super.otpCode = '',
    super.otpError,
    super.timerDuration = 59,
    super.canResend = false,
  });

  @override
  VerifyState copyWith({
    String? otpCode,
    String? otpError,
    int? timerDuration,
    bool? canResend,
  }) {
    return VerifyInitialState(
      otpCode: otpCode ?? this.otpCode,
      otpError: otpError,
      timerDuration: timerDuration ?? this.timerDuration,
      canResend: canResend ?? this.canResend,
    );
  }
}

class VerifyLoadingState extends VerifyState {
  const VerifyLoadingState({
    super.otpCode = '',
    super.otpError,
    super.timerDuration = 59,
    super.canResend = false,
  });

  @override
  VerifyState copyWith({
    String? otpCode,
    String? otpError,
    int? timerDuration,
    bool? canResend,
  }) {
    return VerifyLoadingState(
      otpCode: otpCode ?? this.otpCode,
      otpError: otpError,
      timerDuration: timerDuration ?? this.timerDuration,
      canResend: canResend ?? this.canResend,
    );
  }
}

class VerifySuccessState extends VerifyState {
  const VerifySuccessState({
    super.otpCode = '',
    super.otpError,
    super.timerDuration = 59,
    super.canResend = false,
  });

  @override
  VerifyState copyWith({
    String? otpCode,
    String? otpError,
    int? timerDuration,
    bool? canResend,
  }) {
    return VerifySuccessState(
      otpCode: otpCode ?? this.otpCode,
      otpError: otpError,
      timerDuration: timerDuration ?? this.timerDuration,
      canResend: canResend ?? this.canResend,
    );
  }
}

class VerifyErrorState extends VerifyState {
  final String message;
  const VerifyErrorState(
    this.message, {
    super.otpCode = '',
    super.otpError,
    super.timerDuration = 59,
    super.canResend = false,
  });

  @override
  VerifyState copyWith({
    String? otpCode,
    String? otpError,
    int? timerDuration,
    bool? canResend,
  }) {
    return VerifyErrorState(
      message,
      otpCode: otpCode ?? this.otpCode,
      otpError: otpError,
      timerDuration: timerDuration ?? this.timerDuration,
      canResend: canResend ?? this.canResend,
    );
  }

  @override
  List<Object?> get props => [
    otpCode,
    otpError ?? '',
    timerDuration,
    canResend,
    message,
  ];
}
