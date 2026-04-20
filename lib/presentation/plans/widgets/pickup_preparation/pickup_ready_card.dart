import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/domain/model/pickup_status_model.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

/// Shown when status is ready_for_pickup or fulfilled.
class PickupReadyCard extends StatelessWidget {
  final PickupStatusDataModel data;

  const PickupReadyCard({super.key, required this.data});

  @override
  Widget build(BuildContext context) {
    final isCompleted = data.isCompleted;
    final code = data.pickupCode ?? '';

    return Container(
      width: double.infinity,
      padding: EdgeInsets.symmetric(
        horizontal: AppPadding.p28.w,
        vertical: AppPadding.p24.h,
      ),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF068453), Color(0xFF10B981)],
        ),
        borderRadius: BorderRadius.circular(AppSize.s24.r),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF068453).withValues(alpha: 0.35),
            blurRadius: 24,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(child: _buildCodeSection()),
              Gap(AppSize.s16.w),
              _buildStatusSection(isCompleted),
            ],
          ),
          if (isCompleted) _buildCompletedFooter(),
        ],
      ),
    );
  }

  Widget _buildCodeSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          Strings.pickupCode.tr(),
          style: getRegularTextStyle(
            color: Colors.white.withValues(alpha: 0.75),
            fontSize: FontSizeManager.s12.sp,
          ),
        ),
        Gap(AppSize.s4.h),
        Text(
          data.pickupCode ?? '',
          style: getBoldTextStyle(
            color: Colors.white,
            fontSize: AppSize.s48.sp,
          ),
        ),
      ],
    );
  }

  Widget _buildStatusSection(bool isCompleted) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Text(
          isCompleted
              ? Strings.orderPickedUp.tr()
              : Strings.yourOrderIsReady.tr(),
          style: getBoldTextStyle(
            color: Colors.white,
            fontSize: FontSizeManager.s18.sp,
          ),
        ),
        Row(
          children: [
            Text(
              isCompleted ? Strings.successfully.tr() : Strings.isReady.tr(),
              style: getBoldTextStyle(
                color: Colors.white,
                fontSize: FontSizeManager.s18.sp,
              ),
            ),
            Gap(AppSize.s6.w),
            Container(
              padding: EdgeInsets.all(AppPadding.p2.w),
              decoration: const BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.check_circle,
                color: const Color(0xFF068453),
                size: AppSize.s20.sp,
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildCompletedFooter() {
    return Column(
      children: [
        Gap(AppSize.s16.h),
        Divider(color: Colors.white.withValues(alpha: 0.25)),
        Gap(AppSize.s8.h),
        Row(
          children: [
            Icon(
              Icons.schedule,
              color: Colors.white.withValues(alpha: 0.75),
              size: AppSize.s16.sp,
            ),
            Gap(AppSize.s6.w),
            Text(
              data.statusLabel,
              style: getRegularTextStyle(
                color: Colors.white.withValues(alpha: 0.85),
                fontSize: FontSizeManager.s14.sp,
              ),
            ),
          ],
        ),
      ],
    );
  }
}
