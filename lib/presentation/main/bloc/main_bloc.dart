import 'package:flutter_bloc/flutter_bloc.dart';
import 'main_event.dart';
import 'main_state.dart';

class MainBloc extends Bloc<MainEvent, MainState> {
  MainBloc() : super(const MainInitialState()) {
    on<ChangeBottomNavIndexEvent>(_onChangeBottomNavIndex);
  }

  void _onChangeBottomNavIndex(
    ChangeBottomNavIndexEvent event,
    Emitter<MainState> emit,
  ) {
    emit(MainIndexChangedState(event.index));
  }
}
