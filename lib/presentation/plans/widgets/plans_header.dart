import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class PlansHeader extends StatelessWidget {
  const PlansHeader({super.key});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              Strings.mySubscription.tr(),
              style: getBoldTextStyle(
                color: ColorManager.black101828,
                fontSize: FontSizeManager.s22.sp,
              ),
            ),
            Gap(AppSize.s4.h),
            Text(
              Strings.welcomeBack.tr(),
              style: getRegularTextStyle(
                color: ColorManager.grey6A7282,
                fontSize: FontSizeManager.s14.sp,
              ),
            ),
          ],
        ),
        Container(
          padding: const EdgeInsetsDirectional.all(AppPadding.p8),
          decoration: BoxDecoration(
            color: ColorManager.greenPrimary.withValues(alpha: 0.1),
            shape: BoxShape.circle,
          ),
          child: Text(
            '👋',
            style: TextStyle(fontSize: FontSizeManager.s20.sp),
          ),
        ),
      ],
    );
  }
}
