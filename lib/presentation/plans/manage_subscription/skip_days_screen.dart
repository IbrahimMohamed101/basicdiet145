import 'package:basic_diet/app/dependency_injection.dart';
import 'package:flutter/material.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';
import 'package:intl/intl.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/bloc/skip_days_bloc.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/bloc/skip_days_event.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/bloc/skip_days_state.dart';

enum SkipTypeSelection { singleDay, dateRange }

class SkipDaysScreen extends StatefulWidget {
  final String subscriptionId;
  final int skipDaysUsed;
  final int skipDaysLimit;
  final int remainingSkipDays;

  const SkipDaysScreen({
    super.key,
    required this.subscriptionId,
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
    return BlocProvider(
      create: (context) {
        initSkipDaysModule();
        return instance<SkipDaysBloc>();
      },
      child: BlocConsumer<SkipDaysBloc, SkipDaysState>(
        listener: (context, state) {
          if (state is SkipDaysSuccess) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(state.message),
                backgroundColor: ColorManager.greenPrimary,
              ),
            );
            Navigator.of(context).pop();
          } else if (state is SkipDaysError) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(state.message),
                backgroundColor: ColorManager.errorColor,
              ),
            );
          }
        },
        builder: (context, state) {
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
                  _buildActionButtons(context, state),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildLimitInfoCard() {
    return Container(
      padding: const EdgeInsets.all(AppPadding.p16),
      decoration: BoxDecoration(
        color: const Color(0xFFEFF6FF),
        border: Border.all(color: const Color(0xFFBFDBFE)),
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
                    color: const Color(0xFF1E3A8A),
                    fontSize: FontSizeManager.s14.sp,
                  ),
                ),
                Gap(AppSize.s4.h),
                Text(
                  "You have ${widget.remainingSkipDays} ${Strings.skipsRemaining}",
                  style: getRegularTextStyle(
                    color: const Color(0xFF3B82F6),
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
        padding: const EdgeInsets.symmetric(
          vertical: AppPadding.p16,
          horizontal: AppPadding.p8,
        ),
        decoration: BoxDecoration(
          color: isSelected
              ? ColorManager.greenPrimary.withValues(alpha: 0.05)
              : Colors.white,
          border: Border.all(
            color: isSelected
                ? ColorManager.greenPrimary
                : ColorManager.formFieldsBorderColor,
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
              firstDate: _startDate,
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
          border: Border.all(color: ColorManager.formFieldsBorderColor),
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
        color: const Color(0xFFFAFAFA),
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

  Widget _buildActionButtons(BuildContext context, SkipDaysState state) {
    final isLoading = state is SkipDaysLoading;
    return Row(
      children: [
        Expanded(
          child: OutlinedButton(
            onPressed: isLoading ? null : () => Navigator.of(context).pop(),
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
            onPressed: isLoading
                ? null
                : () {
                    if (_skipType == SkipTypeSelection.singleDay) {
                      if (_startDate != null) {
                        context.read<SkipDaysBloc>().add(
                          SkipSingleDayEvent(
                            widget.subscriptionId,
                            DateFormat('yyyy-MM-dd').format(_startDate!),
                          ),
                        );
                      } else {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text("Please select a date")),
                        );
                      }
                    } else {
                      if (_startDate != null && _endDate != null) {
                        context.read<SkipDaysBloc>().add(
                          SkipDateRangeEvent(
                            widget.subscriptionId,
                            DateFormat('yyyy-MM-dd').format(_startDate!),
                            DateFormat('yyyy-MM-dd').format(_endDate!),
                          ),
                        );
                      } else {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text("Please select start and end dates"),
                          ),
                        );
                      }
                    }
                  },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF86E2BB),
              padding: const EdgeInsets.symmetric(vertical: AppPadding.p16),
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppSize.s12),
              ),
            ),
            child: isLoading
                ? SizedBox(
                    height: AppSize.s20.h,
                    width: AppSize.s20.w,
                    child: CircularProgressIndicator(
                      color: Colors.white,
                      strokeWidth: 2,
                    ),
                  )
                : Text(
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
