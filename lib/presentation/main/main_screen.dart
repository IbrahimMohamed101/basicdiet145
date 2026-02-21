import 'package:flutter/material.dart';

class MainScreen extends StatelessWidget {
  static const String mainRoute = "/main";
  const MainScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(body: Center(child: Text("Main Screen")));
  }
}
