import 'package:easy_localization/easy_localization.dart';
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
  const MealOptionCard({
    super.key,
    required this.option,
    this.isSelected = false,
    this.onTap,
  });

  final MealOptionModel option;
  final bool isSelected;
  final VoidCallback? onTap;

  String get _mealLabel {
    final count = option.mealsPerDay;
    return '$count ${count > 1 ? Strings.meals.tr() : Strings.meal.tr()}';
  }

  Color get _backgroundColor =>
      isSelected ? ColorManager.stateSelected : ColorManager.backgroundSurface;

  Color get _borderColor =>
      isSelected ? ColorManager.brandPrimary : ColorManager.borderDefault;

  Color get _titleColor =>
      isSelected
          ? ColorManager.stateSuccessEmphasis
          : ColorManager.textSecondary;

  Color get _priceColor =>
      isSelected ? ColorManager.brandPrimary : ColorManager.textPrimary;

  List<BoxShadow> get _boxShadow => [
    BoxShadow(
      color:
          isSelected
              ? ColorManager.brandPrimaryGlow
              : ColorManager.textPrimary.withValues(alpha: 0.05),
      blurRadius: isSelected ? 22 : 12,
      spreadRadius: isSelected ? 1.5 : 0,
      offset: Offset(0, isSelected ? 12 : 6),
    ),
  ];

  @override
  Widget build(BuildContext context) {
    assert(() {
      debugPrint('Card ${option.mealsPerDay} selected: $isSelected');
      return true;
    }());

    final borderRadius = BorderRadius.circular(AppSize.s18.r);

    return AnimatedScale(
      duration: const Duration(milliseconds: 220),
      scale: isSelected ? 1.0 : 0.985,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOutCubic,
        decoration: BoxDecoration(
          color: _backgroundColor,
          borderRadius: borderRadius,
          border: Border.all(
            color: _borderColor,
            width: isSelected ? 2.2 : 1.1,
          ),
          boxShadow: _boxShadow,
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onTap,
            borderRadius: borderRadius,
            splashColor: ColorManager.brandPrimaryGlow,
            highlightColor: ColorManager.brandPrimary.withValues(alpha: 0.05),
            child: Padding(
              padding: EdgeInsetsDirectional.fromSTEB(
                AppPadding.p14.w,
                AppPadding.p14.h,
                AppPadding.p14.w,
                AppPadding.p16.h,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          _mealLabel,
                          style: getRegularTextStyle(
                            fontSize: FontSizeManager.s16.sp,
                            color: _titleColor,
                          ),
                        ),
                      ),
                      AnimatedOpacity(
                        duration: const Duration(milliseconds: 180),
                        opacity: isSelected ? 1 : 0,
                        child: Container(
                          width: AppSize.s28.w,
                          height: AppSize.s28.h,
                          decoration: BoxDecoration(
                            color: ColorManager.brandPrimary,
                            shape: BoxShape.circle,
                            boxShadow: [
                              BoxShadow(
                                color: ColorManager.brandPrimaryGlow,
                                blurRadius: 10,
                                offset: const Offset(0, 4),
                              ),
                            ],
                          ),
                          child: Icon(
                            Icons.check,
                            color: ColorManager.textInverse,
                            size: AppSize.s16.sp,
                          ),
                        ),
                      ),
                    ],
                  ),
                  Gap(AppSize.s10.h),
                  _PriceRow(
                    amount: option.priceSar.toStringAsFixed(0),
                    isStrikethrough: false,
                    color: _priceColor,
                    amountFontSize: FontSizeManager.s26.sp,
                    labelFontSize: FontSizeManager.s14.sp,
                  ),
                  Gap(AppSize.s6.h),
                  _PriceRow(
                    amount: option.compareAtSar.toStringAsFixed(0),
                    isStrikethrough: true,
                    color: ColorManager.textMuted,
                    amountFontSize: FontSizeManager.s16.sp,
                    labelFontSize: FontSizeManager.s12.sp,
                  ),
                  if (isSelected) ...[
                    Gap(AppSize.s10.h),
                    Container(
                      padding: EdgeInsetsDirectional.symmetric(
                        horizontal: AppPadding.p8.w,
                        vertical: AppPadding.p4.h,
                      ),
                      decoration: BoxDecoration(
                        color: ColorManager.brandPrimary.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(AppSize.s30.r),
                      ),
                      child: Text(
                        Strings.selected.tr(),
                        style: getRegularTextStyle(
                          fontSize: FontSizeManager.s10.sp,
                          color: ColorManager.stateSuccessEmphasis,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
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
    final base =
        isStrikethrough
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
        Text(Strings.sar.tr(), style: _style(labelFontSize)),
      ],
    );
  }
}
