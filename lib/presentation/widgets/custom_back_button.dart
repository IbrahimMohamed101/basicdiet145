import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';
import 'package:go_router/go_router.dart';

class CustomBackButton extends StatelessWidget {
  const CustomBackButton({super.key});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => context.pop(),
      borderRadius: BorderRadius.circular(AppSize.s8.r),
      child: Padding(
        padding: EdgeInsetsDirectional.symmetric(
          vertical: AppPadding.p8.h,
          horizontal: AppPadding.p8.w,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons
                  .arrow_back, // or arrow_back_ios_new if iOS style is preferred
              color: ColorManager.blackColor,
              size: AppSize.s24.sp,
            ),
            Gap(AppSize.s4.w),
            Text(
              Strings.back,
              style: getRegularTextStyle(
                color: ColorManager.blackColor,
                fontSize: FontSizeManager.s16.sp,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
