import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:flutter/material.dart';

class PremiumMealsLoadingView extends StatelessWidget {
  const PremiumMealsLoadingView({super.key});

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: CircularProgressIndicator(color: ColorManager.brandPrimary),
    );
  }
}
