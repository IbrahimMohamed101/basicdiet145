import 'package:basic_diet/domain/model/delivery_options_model.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class DeliveryLocationSelector extends StatelessWidget {
  final String label;
  final String? value;
  final VoidCallback onTap;

  const DeliveryLocationSelector({
    super.key,
    required this.label,
    this.value,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: EdgeInsetsDirectional.symmetric(
          horizontal: AppPadding.p16.w,
          vertical: AppPadding.p16.h,
        ),
        decoration: BoxDecoration(
          border: Border.all(color: ColorManager.formFieldsBorderColor),
          borderRadius: BorderRadius.circular(AppSize.s12.r),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                value ?? label,
                style: getRegularTextStyle(
                  color: value != null
                      ? ColorManager.black101828
                      : ColorManager.grey6A7282,
                  fontSize: FontSizeManager.s16.sp,
                ),
              ),
            ),
            Icon(
              Icons.arrow_forward_ios,
              size: AppSize.s16.w,
              color: ColorManager.grey6A7282,
            ),
          ],
        ),
      ),
    );
  }
}

class DeliveryTypeCard extends StatelessWidget {
  final DeliveryMethodModel method;
  final IconData icon;
  final bool isSelected;
  final VoidCallback onTap;

  const DeliveryTypeCard({
    super.key,
    required this.method,
    required this.icon,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
        decoration: BoxDecoration(
          color: isSelected
              ? ColorManager.greenPrimary.withValues(alpha: 0.05)
              : Colors.white,
          borderRadius: BorderRadius.circular(AppSize.s16.r),
          border: Border.all(
            color: isSelected
                ? ColorManager.greenPrimary
                : ColorManager.formFieldsBorderColor,
            width: 1.5,
          ),
        ),
        child: Row(
          children: [
            Container(
              padding: EdgeInsetsDirectional.all(AppPadding.p12.w),
              decoration: BoxDecoration(
                color: isSelected
                    ? ColorManager.greenPrimary
                    : ColorManager.greyF3F4F6,
                borderRadius: BorderRadius.circular(AppSize.s12.r),
              ),
              child: Icon(
                icon,
                color: isSelected ? Colors.white : ColorManager.grey6A7282,
              ),
            ),
            Gap(AppSize.s16.w),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    method.title,
                    style: getBoldTextStyle(
                      color: ColorManager.black101828,
                      fontSize: FontSizeManager.s18.sp,
                    ),
                  ),
                  Text(
                    method.subtitle,
                    style: getRegularTextStyle(
                      color: ColorManager.grey6A7282,
                      fontSize: FontSizeManager.s14.sp,
                    ),
                  ),
                  Gap(AppSize.s8.h),
                  Text(
                    method.feeLabel.isNotEmpty
                        ? method.feeLabel
                        : method.helperText,
                    style: getRegularTextStyle(
                      color: isSelected
                          ? ColorManager.greenPrimary
                          : ColorManager.grey6A7282,
                      fontSize: FontSizeManager.s12.sp,
                    ),
                  ),
                ],
              ),
            ),
            if (isSelected)
              Icon(Icons.check_circle, color: ColorManager.greenPrimary),
          ],
        ),
      ),
    );
  }
}
