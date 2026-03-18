import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class CategoryItem extends StatelessWidget {
  const CategoryItem({super.key, required this.title, required this.imagePath});

  final String title;
  final String imagePath;

  static const _backgroundColor = Color(
    0xFFF9FAFB,
  ); // shared with HeaderIconButton

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          width: AppSize.s70.w,
          height: AppSize.s70.h,
          decoration: BoxDecoration(
            color: _backgroundColor,
            borderRadius: BorderRadius.circular(AppSize.s16.r),
          ),
          child: Center(
            child: Image.asset(
              imagePath,
              width: AppSize.s30.w,
              height: AppSize.s30.h,
              fit: BoxFit.contain,
            ),
          ),
        ),
        Gap(AppSize.s8.h),
        Text(
          title,
          style: getBoldTextStyle(
            fontSize: FontSizeManager.s12.sp,
            color: ColorManager.grayColor,
          ),
        ),
      ],
    );
  }
}
