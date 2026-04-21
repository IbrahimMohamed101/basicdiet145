import 'package:basic_diet/app/app.dart';
import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/domain/bloc_observer.dart';
import 'package:basic_diet/firebase_options.dart';
import 'package:basic_diet/presentation/resources/language_manager.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_phoenix/flutter_phoenix.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  await dotenv.load(fileName: ".env");
  await EasyLocalization.ensureInitialized();
  await initAppModule();
  Bloc.observer = MyBlocObserver();
  runApp(
    EasyLocalization(
      supportedLocales: [englishLocale, arabicLocale],
      path: assetPathLocalization,
      fallbackLocale: arabicLocale,
      child: Phoenix(child: MyApp()),
    ),
  );
}
