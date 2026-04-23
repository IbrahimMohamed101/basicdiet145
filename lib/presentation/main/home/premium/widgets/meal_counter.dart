import 'package:basic_diet/presentation/main/home/premium/widgets/counter_button.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

class MealCounter extends StatelessWidget {
  final int quantity;
  final VoidCallback onIncrement;
  final VoidCallback onDecrement;

  const MealCounter({
    super.key,
    required this.quantity,
    required this.onIncrement,
    required this.onDecrement,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        CounterButton(
          icon: Icons.remove,
          onPressed: quantity > 0 ? onDecrement : null,
          backgroundColor: ColorManager.backgroundSubtle,
          iconColor: ColorManager.textPrimary,
        ),
        SizedBox(
          width: AppSize.s34.w,
          child: Text(
            quantity.toString(),
            textAlign: TextAlign.center,
            style: getBoldTextStyle(
              color: ColorManager.textPrimary,
              fontSize: FontSizeManager.s18.sp,
            ).copyWith(height: 28 / 18),
          ),
        ),
        CounterButton(
          icon: Icons.add,
          onPressed: onIncrement,
          backgroundColor: ColorManager.stateSuccessEmphasis,
          iconColor: ColorManager.backgroundSurface,
        ),
      ],
    );
  }
}
