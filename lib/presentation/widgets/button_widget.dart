import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

class ButtonWidget extends StatelessWidget {
  final double radius, width, height;
  final String text;
  final void Function()? onTap;
  final Color color;
  final Color textColor;

  const ButtonWidget({
    super.key,
    required this.radius,
    this.width = double.infinity,
    this.height = AppSize.s50,
    this.color = ColorManager.greenPrimary,
    required this.text,
    this.onTap,
    this.textColor = ColorManager.whiteColor,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(radius.r),
      splashColor: Colors.transparent,
      highlightColor: Colors.transparent,
      child: Container(
        height: height.h,
        width: width.w,
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(radius.r),
        ),
        child: Center(
          child: Text(
            text,
            style: getBoldTextStyle(color: textColor, fontSize: AppSize.s18.sp),
          ),
        ),
      ),
    );
  }
}
