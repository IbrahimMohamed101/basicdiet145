import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/domain/model/pickup_preparation_enums.dart';
import 'package:basic_diet/domain/model/pickup_status_model.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

/// Shown for terminal states: [PickupDayStatus.noShow] and
/// [PickupDayStatus.consumedWithoutPreparation].
class PickupTerminalCard extends StatelessWidget {
  final PickupStatusDataModel data;

  const PickupTerminalCard({super.key, required this.data});

  @override
  Widget build(BuildContext context) {
    final dayStatus = PickupDayStatus.fromString(data.status);
    final isNoShow = dayStatus == PickupDayStatus.noShow;

    final title = isNoShow
        ? Strings.noShowTitle.tr()
        : Strings.consumedWithoutPrepTitle.tr();

    final message = data.message.isNotEmpty
        ? data.message
        : (isNoShow
              ? Strings.noShowMessage.tr()
              : Strings.consumedWithoutPrepMessage.tr());

    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(AppPadding.p24.w),
      decoration: BoxDecoration(
        color: ColorManager.greyF3F4F6,
        borderRadius: BorderRadius.circular(AppSize.s24.r),
        border: Border.all(color: ColorManager.formFieldsBorderColor),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: EdgeInsets.all(AppPadding.p10.w),
            decoration: BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
              border: Border.all(color: ColorManager.formFieldsBorderColor),
            ),
            child: Icon(
              isNoShow
                  ? Icons.person_off_outlined
                  : Icons.hourglass_disabled_outlined,
              color: ColorManager.grey6A7282,
              size: AppSize.s20.sp,
            ),
          ),
          Gap(AppSize.s12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: getBoldTextStyle(
                    color: ColorManager.black101828,
                    fontSize: FontSizeManager.s16.sp,
                  ),
                ),
                Gap(AppSize.s4.h),
                Text(
                  message,
                  style: getRegularTextStyle(
                    color: ColorManager.grey6A7282,
                    fontSize: FontSizeManager.s14.sp,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
