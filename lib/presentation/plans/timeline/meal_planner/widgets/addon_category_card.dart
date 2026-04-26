import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class AddonCategoryCard extends StatelessWidget {
  final String title;
  final String icon;
  final String value;
  final bool isSelected;
  final bool enabled;
  final VoidCallback? onTap;

  const AddonCategoryCard({
    super.key,
    required this.title,
    required this.icon,
    required this.value,
    required this.isSelected,
    required this.enabled,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: enabled ? 1 : 0.7,
      child: InkWell(
        borderRadius: BorderRadius.circular(AppSize.s16.r),
        onTap: enabled ? onTap : null,
        child: Ink(
          padding: EdgeInsets.symmetric(
            horizontal: AppPadding.p14.w,
            vertical: AppPadding.p12.h,
          ),
          decoration: BoxDecoration(
            color:
                isSelected
                    ? ColorManager.brandPrimaryTint
                    : ColorManager.backgroundSurface,
            borderRadius: BorderRadius.circular(AppSize.s16.r),
            border: Border.all(
              color:
                  isSelected
                      ? ColorManager.brandPrimary.withValues(alpha: 0.22)
                      : ColorManager.borderDefault,
            ),
          ),
          child: Row(
            children: [
              Icon(
                Icons.keyboard_arrow_down_rounded,
                color: ColorManager.iconSecondary,
                size: 24.w,
              ),
              Gap(AppSize.s12.w),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.end,
                      style: getBoldTextStyle(
                        color: ColorManager.textPrimary,
                        fontSize: FontSizeManager.s14.sp,
                      ),
                    ),
                    Gap(AppSize.s4.h),
                    Text(
                      value,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.end,
                      style: getRegularTextStyle(
                        color: ColorManager.textSecondary,
                        fontSize: FontSizeManager.s12.sp,
                      ),
                    ),
                  ],
                ),
              ),
              Gap(AppSize.s12.w),
              Container(
                width: 64.w,
                height: 64.w,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: ColorManager.backgroundSubtle,
                  borderRadius: BorderRadius.circular(AppSize.s14.r),
                ),
                child: Text(icon, style: TextStyle(fontSize: 28.sp)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class AddonStatusBadge extends StatelessWidget {
  final String label;
  final bool highlighted;

  const AddonStatusBadge({
    super.key,
    required this.label,
    this.highlighted = false,
  });

  @override
  Widget build(BuildContext context) {
    final background =
        highlighted
            ? ColorManager.stateWarningSurface
            : ColorManager.stateSuccessSurface;
    final textColor =
        highlighted
            ? ColorManager.stateWarningEmphasis
            : ColorManager.stateSuccessEmphasis;
    final border =
        highlighted
            ? ColorManager.stateWarningBorder
            : ColorManager.brandPrimary;

    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: AppPadding.p10.w,
        vertical: AppPadding.p6.h,
      ),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(AppSize.s20.r),
        border: Border.all(color: border),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: getBoldTextStyle(
          color: textColor,
          fontSize: FontSizeManager.s10.sp,
        ),
      ),
    );
  }
}
