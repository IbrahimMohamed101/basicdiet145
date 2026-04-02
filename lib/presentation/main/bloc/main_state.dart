import 'package:equatable/equatable.dart';

abstract class MainState extends Equatable {
  final int currentIndex;

  const MainState({this.currentIndex = 0});

  @override
  List<Object> get props => [currentIndex];
}

class MainInitialState extends MainState {
  const MainInitialState({super.currentIndex = 0});
}

class MainIndexChangedState extends MainState {
  const MainIndexChangedState(int index) : super(currentIndex: index);
}
