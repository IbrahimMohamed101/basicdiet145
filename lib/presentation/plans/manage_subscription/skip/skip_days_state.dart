import 'package:equatable/equatable.dart';

abstract class SkipDaysState extends Equatable {
  const SkipDaysState();

  @override
  List<Object?> get props => [];
}

class SkipDaysInitial extends SkipDaysState {}

class SkipDaysLoading extends SkipDaysState {}

class SkipDaysSuccess extends SkipDaysState {
  final String message;
  const SkipDaysSuccess(this.message);

  @override
  List<Object?> get props => [message];
}

class SkipDaysError extends SkipDaysState {
  final String message;
  const SkipDaysError(this.message);

  @override
  List<Object?> get props => [message];
}
