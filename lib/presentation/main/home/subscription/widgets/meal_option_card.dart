import 'package:basic_diet/domain/model/plans_model.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class MealOptionCard extends StatelessWidget {
  const MealOptionCard({super.key, required this.option});

  final MealOptionModel option;

  static const _borderColor = Color(0xFFF2F4F7);

  // Presentation logic as getters — unit-testable without rendering
  String get _mealLabel {
    final count = option.mealsPerDay;
    return '$count ${count > 1 ? Strings.meals : Strings.meal}';
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsetsDirectional.all(AppPadding.p12.w),
      decoration: BoxDecoration(
        color: ColorManager.whiteColor,
        borderRadius: BorderRadius.circular(AppSize.s12.r),
        border: Border.all(color: _borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _mealLabel,
            style: getRegularTextStyle(
              fontSize: FontSizeManager.s12.sp,
              color: ColorManager.grey6A7282,
            ),
          ),
          Gap(AppSize.s8.h),
          _PriceRow(
            amount: option.priceSar.toStringAsFixed(0),
            isStrikethrough: false,
            color: ColorManager.greenPrimary,
            amountFontSize: FontSizeManager.s18.sp,
            labelFontSize: FontSizeManager.s10.sp,
          ),
          Gap(AppSize.s4.h),
          _PriceRow(
            amount: option.compareAtSar.toStringAsFixed(0),
            isStrikethrough: true,
            color: ColorManager.grayColor.withValues(alpha: 0.6),
            amountFontSize: FontSizeManager.s12.sp,
            labelFontSize: FontSizeManager.s10.sp,
          ),
        ],
      ),
    );
  }
}

/// Reusable price row: amount + currency label, with optional strikethrough.
class _PriceRow extends StatelessWidget {
  const _PriceRow({
    required this.amount,
    required this.isStrikethrough,
    required this.color,
    required this.amountFontSize,
    required this.labelFontSize,
  });

  final String amount;
  final bool isStrikethrough;
  final Color color;
  final double amountFontSize;
  final double labelFontSize;

  TextStyle _style(double fontSize) {
    final base = isStrikethrough
        ? getRegularTextStyle(fontSize: fontSize, color: color)
        : getBoldTextStyle(fontSize: fontSize, color: color);
    return isStrikethrough
        ? base.copyWith(decoration: TextDecoration.lineThrough)
        : base;
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.baseline,
      textBaseline: TextBaseline.alphabetic,
      children: [
        Text(amount, style: _style(amountFontSize)),
        Gap(AppSize.s4.w),
        Text(Strings.sar, style: _style(labelFontSize)),
      ],
    );
  }
}
