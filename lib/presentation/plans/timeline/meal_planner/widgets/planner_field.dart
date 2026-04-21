import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class PlannerField extends StatelessWidget {
  final String title;
  final String value;
  final bool isSelected;
  final bool isPremium;
  final VoidCallback onTap;
  final bool isDisabled;

  const PlannerField({
    super.key,
    required this.title,
    required this.value,
    required this.isSelected,
    required this.isPremium,
    required this.onTap,
    this.isDisabled = false,
  });

  @override
  Widget build(BuildContext context) {
    final bgColor = isSelected
        ? (isPremium
            ? ColorManager.orangeFFF5EC
            : ColorManager.bluePrimary.withValues(alpha: 0.06))
        : ColorManager.greyF3F4F6.withValues(alpha: 0.8);

    final borderColor = isSelected
        ? (isPremium
            ? ColorManager.orangeLight
            : ColorManager.bluePrimary.withValues(alpha: 0.25))
        : Colors.transparent;

    return Opacity(
      opacity: isDisabled ? 0.5 : 1.0,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: getRegularTextStyle(
              color: ColorManager.grey6A7282,
              fontSize: FontSizeManager.s12.sp,
            ),
          ),
          Gap(8.h),
          GestureDetector(
            onTap: isDisabled ? null : onTap,
            child: Container(
              width: double.infinity,
              padding: EdgeInsets.symmetric(
                horizontal: AppPadding.p16.w,
                vertical: AppPadding.p14.h,
              ),
              decoration: BoxDecoration(
                color: bgColor,
                borderRadius: BorderRadius.circular(AppSize.s14.r),
                border: Border.all(color: borderColor),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      value,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: getBoldTextStyle(
                        color: isSelected
                            ? ColorManager.black101828
                            : ColorManager.grey6A7282,
                        fontSize: FontSizeManager.s14.sp,
                      ),
                    ),
                  ),
                  Icon(
                    Icons.keyboard_arrow_down,
                    color: ColorManager.grey6A7282,
                    size: 22.w,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
