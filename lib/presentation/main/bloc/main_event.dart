import 'package:equatable/equatable.dart';

abstract class MainEvent extends Equatable {
  const MainEvent();

  @override
  List<Object> get props => [];
}

class ChangeBottomNavIndexEvent extends MainEvent {
  final int index;

  const ChangeBottomNavIndexEvent(this.index);

  @override
  List<Object> get props => [index];
}
