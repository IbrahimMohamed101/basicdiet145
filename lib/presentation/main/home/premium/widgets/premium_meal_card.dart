import 'package:basic_diet/domain/model/premium_meals_model.dart';
import 'package:basic_diet/presentation/main/home/premium/widgets/meal_counter.dart';
import 'package:basic_diet/presentation/main/home/premium/widgets/meal_image.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class PremiumMealCard extends StatelessWidget {
  final PremiumMealModel meal;
  final int quantity;
  final VoidCallback onIncrement;
  final VoidCallback onDecrement;

  const PremiumMealCard({
    super.key,
    required this.meal,
    required this.quantity,
    required this.onIncrement,
    required this.onDecrement,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: ColorManager.whiteColor,
        borderRadius: BorderRadius.circular(AppSize.s16.r),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          MealImage(imageUrl: meal.imageUrl),
          Padding(
            padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  meal.ui.title,
                  style: getBoldTextStyle(
                    color: ColorManager.black101828,
                    fontSize: FontSizeManager.s16.sp,
                  ).copyWith(height: 24 / 16),
                ),
                Gap(AppSize.s8.h),
                Text(
                  meal.ui.subtitle,
                  style: getRegularTextStyle(
                    color: ColorManager.grey4A5565,
                    fontSize: FontSizeManager.s14.sp,
                  ).copyWith(height: 22.75 / 14),
                ),
                Gap(AppSize.s16.h),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      meal.priceLabel,
                      style: getBoldTextStyle(
                        color: ColorManager.greenDark,
                        fontSize: FontSizeManager.s24.sp,
                      ).copyWith(height: 32 / 24),
                    ),
                    MealCounter(
                      quantity: quantity,
                      onIncrement: onIncrement,
                      onDecrement: onDecrement,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
