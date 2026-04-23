import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

class SectionHeader extends StatelessWidget {
  const SectionHeader({super.key, required this.title, this.onSeeAll});

  final String title;
  final VoidCallback? onSeeAll;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          title,
          style: getBoldTextStyle(
            fontSize: FontSizeManager.s18,
            color: ColorManager.textPrimary,
          ),
        ),
        GestureDetector(
          onTap: onSeeAll,
          child: Text(
            Strings.seeAll.tr(),
            style: getBoldTextStyle(
              fontSize: FontSizeManager.s12.sp,
              color: ColorManager.stateSuccessEmphasis,
            ).copyWith(letterSpacing: 1),
          ),
        ),
      ],
    );
  }
}
