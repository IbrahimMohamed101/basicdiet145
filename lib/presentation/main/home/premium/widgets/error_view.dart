import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:flutter/material.dart';

class PremiumMealsErrorView extends StatelessWidget {
  final String message;

  const PremiumMealsErrorView({super.key, required this.message});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Text(
        message,
        style: getRegularTextStyle(color: ColorManager.errorColor),
      ),
    );
  }
}
