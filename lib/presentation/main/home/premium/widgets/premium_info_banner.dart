import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class PremiumInfoBanner extends StatelessWidget {
  const PremiumInfoBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: ColorManager.orangeFFF5EC,
        borderRadius: BorderRadius.circular(AppSize.s12.r),
      ),
      child: IntrinsicHeight(
        child: Row(
          children: [
            Container(
              width: AppSize.s4.w,
              decoration: BoxDecoration(
                color: ColorManager.greenDark,
                borderRadius: BorderRadius.only(
                  topLeft: Radius.circular(AppSize.s12.r),
                  bottomLeft: Radius.circular(AppSize.s12.r),
                ),
              ),
            ),
            Expanded(
              child: Padding(
                padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: EdgeInsetsDirectional.all(AppSize.s4.w),
                          decoration: const BoxDecoration(
                            color: ColorManager.greenDark,
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            Icons.star_rounded,
                            color: ColorManager.whiteColor,
                            size: AppSize.s16.sp,
                          ),
                        ),
                        Gap(AppSize.s8.w),
                        Text(
                          Strings.premiumProteinSelection,
                          style: getBoldTextStyle(
                            color: ColorManager.black101828,
                            fontSize: FontSizeManager.s14.sp,
                          ),
                        ),
                      ],
                    ),
                    Gap(AppSize.s8.h),
                    Text(
                      Strings.premiumProteinDesc,
                      style: getRegularTextStyle(
                        color: ColorManager.grey6A7282,
                        fontSize: FontSizeManager.s12.sp,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
