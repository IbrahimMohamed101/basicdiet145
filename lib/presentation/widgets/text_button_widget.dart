import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

class TextButtonWidget extends StatelessWidget {
  final String text;
  final Color color;
  final double fontSize;
  final void Function()? onPressed;

  const TextButtonWidget(
    this.text,
    this.color,
    this.fontSize,
    this.onPressed, {
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    return TextButton(
      style: TextButton.styleFrom(
        foregroundColor: color,
        padding: EdgeInsetsDirectional.zero,
        minimumSize: Size.zero,
      ),
      onPressed: onPressed,
      child: Text(
        text,
        style: getRegularTextStyle(
          color: onPressed != null ? color : ColorManager.stateDisabled,
          fontSize: fontSize.sp,
        ),
      ),
    );
  }
}
