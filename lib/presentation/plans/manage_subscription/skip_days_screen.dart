import 'package:flutter/material.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';
import 'package:intl/intl.dart';

enum SkipTypeSelection { singleDay, dateRange }

class SkipDaysScreen extends StatefulWidget {
  final int skipDaysUsed;
  final int skipDaysLimit;
  final int remainingSkipDays;

  const SkipDaysScreen({
    super.key,
    required this.skipDaysUsed,
    required this.skipDaysLimit,
    required this.remainingSkipDays,
  });

  @override
  State<SkipDaysScreen> createState() => _SkipDaysScreenState();
}

class _SkipDaysScreenState extends State<SkipDaysScreen> {
  SkipTypeSelection _skipType = SkipTypeSelection.dateRange;
  
  DateTime? _startDate;
  DateTime? _endDate;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        centerTitle: false,
        titleSpacing: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.black),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Text(
          Strings.skipDays,
          style: getRegularTextStyle(
            color: Colors.black,
            fontSize: FontSizeManager.s20.sp,
          ),
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1.0),
          child: Container(
            color: ColorManager.formFieldsBorderColor,
            height: 1.0,
          ),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppPadding.p16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildLimitInfoCard(),
            Gap(AppSize.s16.h),
            _buildSkipTypeSelection(),
            Gap(AppSize.s16.h),
            _buildDateSelection(),
            Gap(AppSize.s16.h),
            _buildImportantInfoCard(),
            Gap(AppSize.s24.h),
            _buildActionButtons(context),
          ],
        ),
      ),
    );
  }

  Widget _buildLimitInfoCard() {
    return Container(
      padding: const EdgeInsets.all(AppPadding.p16),
      decoration: BoxDecoration(
        color: const Color(0xFFEFF6FF), // Light blue background
        border: Border.all(color: const Color(0xFFBFDBFE)), // Light blue border
        borderRadius: BorderRadius.circular(AppSize.s12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.warning_amber_rounded,
            color: Color(0xFF3B82F6),
            size: AppSize.s20,
          ),
          Gap(AppSize.s12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "${Strings.skipLimit} ${widget.skipDaysUsed}/${widget.skipDaysLimit}",
                  style: getRegularTextStyle(
                    color: const Color(0xFF1E3A8A), // Dark blue
                    fontSize: FontSizeManager.s14.sp,
                  ),
                ),
                Gap(AppSize.s4.h),
                Text(
                  "You have ${widget.remainingSkipDays} ${Strings.skipsRemaining}",
                  style: getRegularTextStyle(
                    color: const Color(0xFF3B82F6), // Slightly lighter blue text
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

  Widget _buildSkipTypeSelection() {
    return Container(
      padding: const EdgeInsets.all(AppPadding.p16),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: ColorManager.formFieldsBorderColor),
        borderRadius: BorderRadius.circular(AppSize.s12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            Strings.skipType,
            style: getRegularTextStyle(
              color: Colors.black,
              fontSize: FontSizeManager.s16.sp,
            ),
          ),
          Gap(AppSize.s16.h),
          Row(
            children: [
              Expanded(
                child: _buildTypeCard(
                  type: SkipTypeSelection.singleDay,
                  title: Strings.singleDay,
                  subtitle: Strings.skipOneDay,
                ),
              ),
              Gap(AppSize.s12.w),
              Expanded(
                child: _buildTypeCard(
                  type: SkipTypeSelection.dateRange,
                  title: Strings.dateRange,
                  subtitle: Strings.skipMultipleDays,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildTypeCard({
    required SkipTypeSelection type,
    required String title,
    required String subtitle,
  }) {
    final isSelected = _skipType == type;
    return InkWell(
      onTap: () {
        setState(() {
          _skipType = type;
        });
      },
      borderRadius: BorderRadius.circular(AppSize.s12),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: AppPadding.p16, horizontal: AppPadding.p8),
        decoration: BoxDecoration(
          color: isSelected ? ColorManager.greenPrimary.withValues(alpha: 0.05) : Colors.white,
          border: Border.all(
            color: isSelected ? ColorManager.greenPrimary : ColorManager.formFieldsBorderColor,
          ),
          borderRadius: BorderRadius.circular(AppSize.s12),
        ),
        child: Column(
          children: [
            Text(
              title,
              textAlign: TextAlign.center,
              style: getRegularTextStyle(
                color: Colors.black,
                fontSize: FontSizeManager.s14.sp,
              ),
            ),
            Gap(AppSize.s4.h),
            Text(
              subtitle,
              textAlign: TextAlign.center,
              style: getRegularTextStyle(
                color: ColorManager.grey6A7282,
                fontSize: FontSizeManager.s12.sp,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDateSelection() {
    return Container(
      padding: const EdgeInsets.all(AppPadding.p16),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: ColorManager.formFieldsBorderColor),
        borderRadius: BorderRadius.circular(AppSize.s12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_skipType == SkipTypeSelection.singleDay) ...[
            Text(
              Strings.startDate, // Reusing Start Date string for standard Date label
              style: getRegularTextStyle(
                color: Colors.black,
                fontSize: FontSizeManager.s16.sp,
              ),
            ),
            Gap(AppSize.s8.h),
            _buildDatePicker(
              date: _startDate,
              onDateChanged: (date) {
                setState(() => _startDate = date);
              },
            ),
          ] else ...[
            Text(
              Strings.startDate,
              style: getRegularTextStyle(
                color: Colors.black,
                fontSize: FontSizeManager.s16.sp,
              ),
            ),
            Gap(AppSize.s8.h),
            _buildDatePicker(
              date: _startDate,
              onDateChanged: (date) {
                setState(() => _startDate = date);
              },
            ),
            Gap(AppSize.s16.h),
            Text(
              Strings.endDate,
              style: getRegularTextStyle(
                color: Colors.black,
                fontSize: FontSizeManager.s16.sp,
              ),
            ),
            Gap(AppSize.s8.h),
            _buildDatePicker(
              date: _endDate,
              onDateChanged: (date) {
                setState(() => _endDate = date);
              },
              firstDate: _startDate, // End date cannot be before start date
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildDatePicker({
    required DateTime? date,
    required ValueChanged<DateTime?> onDateChanged,
    DateTime? firstDate,
  }) {
    return InkWell(
      onTap: () async {
        final picked = await showDatePicker(
          context: context,
          initialDate: date ?? firstDate ?? DateTime.now(),
          firstDate: firstDate ?? DateTime.now(),
          lastDate: DateTime.now().add(const Duration(days: 365)),
        );
        if (picked != null) {
          onDateChanged(picked);
        }
      },
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppPadding.p16,
          vertical: AppPadding.p12,
        ),
        decoration: BoxDecoration(
          color: ColorManager.greyF3F4F6,
          borderRadius: BorderRadius.circular(AppSize.s8),
          border: Border.all(color: ColorManager.formFieldsBorderColor), // subtle border like in image
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              date != null ? DateFormat('MMMM d, yyyy').format(date) : '',
              style: getRegularTextStyle(
                color: Colors.black,
                fontSize: FontSizeManager.s16.sp,
              ),
            ),
            const Icon(
              Icons.calendar_today_outlined,
              color: ColorManager.grey6A7282,
              size: AppSize.s20,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildImportantInfoCard() {
    return Container(
      padding: const EdgeInsets.all(AppPadding.p16),
      decoration: BoxDecoration(
        color: const Color(0xFFFAFAFA), // slightly greyish or just white, wait the image is white with border
        border: Border.all(color: ColorManager.formFieldsBorderColor),
        borderRadius: BorderRadius.circular(AppSize.s12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            Strings.importantInformation,
            style: getRegularTextStyle(
              color: Colors.black,
              fontSize: FontSizeManager.s16.sp,
            ),
          ),
          Gap(AppSize.s12.h),
          _buildInfoBullet(Strings.skipInfo1),
          Gap(AppSize.s8.h),
          _buildInfoBullet(Strings.skipInfo2),
          Gap(AppSize.s8.h),
          _buildInfoBullet(Strings.skipInfo3),
        ],
      ),
    );
  }

  Widget _buildInfoBullet(String text) {
    return Text(
      text,
      style: getRegularTextStyle(
        color: ColorManager.grey6A7282,
        fontSize: FontSizeManager.s14.sp,
      ),
    );
  }

  Widget _buildActionButtons(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: OutlinedButton(
            onPressed: () => Navigator.of(context).pop(),
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: AppPadding.p16),
              side: const BorderSide(color: ColorManager.formFieldsBorderColor),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppSize.s12),
              ),
            ),
            child: Text(
              Strings.cancel,
              style: getRegularTextStyle(
                color: Colors.black,
                fontSize: FontSizeManager.s16.sp,
              ),
            ),
          ),
        ),
        Gap(AppSize.s12.w),
        Expanded(
          child: ElevatedButton(
            onPressed: () {
              // TODO: Integrate endpoint
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF86E2BB), // A lighter mint green color matching the image vs Freeze Button
              padding: const EdgeInsets.symmetric(vertical: AppPadding.p16),
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppSize.s12),
              ),
            ),
            child: Text(
              Strings.skipDays,
              style: getRegularTextStyle(
                color: Colors.white,
                fontSize: FontSizeManager.s16.sp,
              ),
            ),
          ),
        ),
      ],
    );
  }
}
