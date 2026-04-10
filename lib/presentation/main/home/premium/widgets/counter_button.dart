import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

class CounterButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onPressed;
  final Color backgroundColor;
  final Color iconColor;

  const CounterButton({
    super.key,
    required this.icon,
    this.onPressed,
    required this.backgroundColor,
    required this.iconColor,
  });

  bool get _isEnabled => onPressed != null;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onPressed,
      child: Container(
        width: AppSize.s34.w,
        height: AppSize.s34.w,
        decoration: BoxDecoration(
          color: _isEnabled
              ? backgroundColor
              : backgroundColor.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(AppSize.s10.r),
        ),
        child: Icon(
          icon,
          color: _isEnabled ? iconColor : iconColor.withValues(alpha: 0.5),
          size: AppSize.s20.sp,
        ),
      ),
    );
  }
}
