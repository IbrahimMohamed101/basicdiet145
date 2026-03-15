import 'package:basic_diet/app/app.dart';
import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/domain/bloc_observer.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initAppModule();
  Bloc.observer = MyBlocObserver();
  runApp(MyApp());
}
