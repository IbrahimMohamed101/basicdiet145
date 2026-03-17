import 'package:basic_diet/domain/usecase/get_popular_packages_usecase.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'home_event.dart';
import 'home_state.dart';

class HomeBloc extends Bloc<HomeEvent, HomeState> {
  final GetPopularPackagesUseCase _getPopularPackagesUseCase;

  HomeBloc(this._getPopularPackagesUseCase) : super(HomeInitialState()) {
    on<GetPopularPackagesEvent>((event, emit) async {
      emit(HomeLoadingState());
      (await _getPopularPackagesUseCase.execute(null)).fold(
        (failure) => emit(HomeErrorState(failure.message)),
        (data) => emit(HomePopularPackagesSuccessState(data)),
      );
    });
  }
}
