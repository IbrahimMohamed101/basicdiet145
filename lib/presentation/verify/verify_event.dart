import 'package:equatable/equatable.dart';

abstract class VerifyEvent extends Equatable {
  const VerifyEvent();

  @override
  List<Object?> get props => [];
}

class VerifyCodeChanged extends VerifyEvent {
  final String code;
  const VerifyCodeChanged(this.code);

  @override
  List<Object?> get props => [code];
}

class VerifySubmitted extends VerifyEvent {
  const VerifySubmitted();
}

class VerifyResendCode extends VerifyEvent {
  const VerifyResendCode();
}

class VerifyTimerStarted extends VerifyEvent {
  const VerifyTimerStarted();
}

class VerifyTimerTicked extends VerifyEvent {
  final int duration;
  const VerifyTimerTicked(this.duration);

  @override
  List<Object?> get props => [duration];
}
