import 'package:basic_diet/domain/model/popular_packages_model.dart';

abstract class HomeState {}

class HomeInitialState extends HomeState {}

class HomeLoadingState extends HomeState {}

class HomePopularPackagesSuccessState extends HomeState {
  final PopularPackagesModel popularPackages;
  HomePopularPackagesSuccessState(this.popularPackages);
}

class HomeErrorState extends HomeState {
  final String message;
  HomeErrorState(this.message);
}
