import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';

class HeaderIconButton extends StatelessWidget {
  const HeaderIconButton({super.key, required this.icon, this.onTap});

  final String icon;
  final VoidCallback? onTap;

  static const _backgroundColor = Color(0xFFF9FAFB);

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: EdgeInsetsDirectional.all(AppPadding.p8.w),
        decoration: BoxDecoration(
          color: _backgroundColor,
          borderRadius: BorderRadius.circular(AppSize.s16.r),
        ),
        child: SvgPicture.asset(icon),
      ),
    );
  }
}
