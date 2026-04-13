import 'package:flutter/material.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';
import 'package:intl/intl.dart';
import 'package:easy_localization/easy_localization.dart';

import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/freeze/freeze_subscription_bloc.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/freeze/freeze_subscription_event.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/freeze/freeze_subscription_state.dart';

class FreezeSubscriptionScreen extends StatefulWidget {
  final String subscriptionId;
  final String validityEndDate;

  const FreezeSubscriptionScreen({
    super.key,
    required this.subscriptionId,
    required this.validityEndDate,
  });

  @override
  State<FreezeSubscriptionScreen> createState() =>
      _FreezeSubscriptionScreenState();
}

class _FreezeSubscriptionScreenState extends State<FreezeSubscriptionScreen> {
  late DateTime _startDate;
  int _days = 5;
  late DateTime _currentEndDate;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _startDate = DateTime(
      now.year,
      now.month,
      now.day,
    ).add(const Duration(days: 1));

    try {
      _currentEndDate = DateTime.parse(widget.validityEndDate);
    } catch (e) {
      _currentEndDate = now.add(const Duration(days: 30));
    }
  }

  @override
  Widget build(BuildContext context) {
    final newEndDate = _currentEndDate.add(Duration(days: _days));

    return BlocProvider(
      create: (context) {
        initFreezeSubscriptionModule();
        return instance<FreezeSubscriptionBloc>();
      },
      child: BlocConsumer<FreezeSubscriptionBloc, FreezeSubscriptionState>(
        listener: (context, state) {
          if (state is FreezeSubscriptionSuccess) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(Strings.subscriptionFrozenSuccessfully.tr()),
                backgroundColor: ColorManager.greenPrimary,
              ),
            );
            Navigator.of(context).pop();
          } else if (state is FreezeSubscriptionError) {
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
                Strings.freezeSubscription.tr(),
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
                  _buildInfoCard(),
                  Gap(AppSize.s16.h),
                  _buildSelectionCard(),
                  Gap(AppSize.s16.h),
                  _buildImpactSummaryCard(_currentEndDate, newEndDate),
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

  Widget _buildInfoCard() {
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
            Icons.info_outline,
            color: Color(0xFF3B82F6),
            size: AppSize.s20,
          ),
          Gap(AppSize.s12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  Strings.freezingYourSubscriptionWill.tr(),
                  style: getRegularTextStyle(
                    color: const Color(0xFF1E3A8A), // Dark blue text
                    fontSize: FontSizeManager.s14.sp,
                  ),
                ),
                Gap(AppSize.s8.h),
                _buildInfoBulletItem(Strings.pauseAllMealDeliveries.tr()),
                Gap(AppSize.s4.h),
                _buildInfoBulletItem(
                  Strings.extendYourSubscriptionEndDate.tr(),
                ),
                Gap(AppSize.s4.h),
                _buildInfoBulletItem(Strings.keepYourMealCreditsIntact.tr()),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInfoBulletItem(String text) {
    return Text(
      text,
      style: getRegularTextStyle(
        color: const Color(0xFF1E3A8A),
        fontSize: FontSizeManager.s14.sp,
      ),
    );
  }

  Widget _buildSelectionCard() {
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
            Strings.startDate.tr(),
            style: getRegularTextStyle(
              color: Colors.black,
              fontSize: FontSizeManager.s16.sp,
            ),
          ),
          Gap(AppSize.s8.h),
          InkWell(
            onTap: () async {
              final date = await showDatePicker(
                context: context,
                initialDate: _startDate,
                firstDate: DateTime.now().add(const Duration(days: 1)),
                lastDate: DateTime.now().add(const Duration(days: 365)),
              );
              if (date != null) {
                setState(() {
                  _startDate = date;
                });
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
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    DateFormat(
                      'MMMM d, yyyy',
                      context.locale.toString(),
                    ).format(_startDate),
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
          ),
          Gap(AppSize.s24.h),
          Text(
            Strings.numberOfDays.tr(),
            style: getRegularTextStyle(
              color: Colors.black,
              fontSize: FontSizeManager.s16.sp,
            ),
          ),
          Gap(AppSize.s8.h),
          Row(
            children: [
              _buildCounterButton(
                icon: Icons.remove,
                onTap: () {
                  if (_days > 1) setState(() => _days--);
                },
              ),
              Gap(AppSize.s16.w),
              Expanded(
                child: Column(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        vertical: AppPadding.p12,
                      ),
                      decoration: BoxDecoration(
                        color: ColorManager.greyF3F4F6,
                        borderRadius: BorderRadius.circular(AppSize.s8),
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        '$_days',
                        style: getRegularTextStyle(
                          color: Colors.black,
                          fontSize: FontSizeManager.s20.sp,
                        ),
                      ),
                    ),
                    Gap(AppSize.s4.h),
                    Text(
                      Strings.days.tr().toLowerCase(),
                      style: getRegularTextStyle(
                        color: ColorManager.grey6A7282,
                        fontSize: FontSizeManager.s12.sp,
                      ),
                    ),
                  ],
                ),
              ),
              Gap(AppSize.s16.w),
              _buildCounterButton(
                icon: Icons.add,
                onTap: () {
                  if (_days < 30) setState(() => _days++);
                },
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildCounterButton({
    required IconData icon,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppSize.s8),
      child: Container(
        width: AppSize.s40.w,
        height: AppSize.s40.h,
        decoration: BoxDecoration(
          color: ColorManager.greyF3F4F6,
          borderRadius: BorderRadius.circular(AppSize.s8),
        ),
        child: Icon(icon, color: Colors.black, size: AppSize.s20),
      ),
    );
  }

  Widget _buildImpactSummaryCard(DateTime currentEndDate, DateTime newEndDate) {
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
            Strings.impactSummary.tr(),
            style: getRegularTextStyle(
              color: Colors.black,
              fontSize: FontSizeManager.s16.sp,
            ),
          ),
          Gap(AppSize.s16.h),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                Strings.freezePeriod.tr(),
                style: getRegularTextStyle(
                  color: ColorManager.grey6A7282,
                  fontSize: FontSizeManager.s14.sp,
                ),
              ),
              Text(
                '$_days ${Strings.days.tr().toLowerCase()}',
                style: getRegularTextStyle(
                  color: Colors.black,
                  fontSize: FontSizeManager.s14.sp,
                ),
              ),
            ],
          ),
          Gap(AppSize.s12.h),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                Strings.currentEndDate.tr(),
                style: getRegularTextStyle(
                  color: ColorManager.grey6A7282,
                  fontSize: FontSizeManager.s14.sp,
                ),
              ),
              Text(
                DateFormat(
                  'MMM d',
                  context.locale.toString(),
                ).format(currentEndDate),
                style: getRegularTextStyle(
                  color: Colors.black,
                  fontSize: FontSizeManager.s14.sp,
                ),
              ),
            ],
          ),
          Gap(AppSize.s12.h),
          const Divider(color: ColorManager.formFieldsBorderColor, height: 1),
          Gap(AppSize.s12.h),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                Strings.newEndDate.tr(),
                style: getRegularTextStyle(
                  color: Colors.black,
                  fontSize: FontSizeManager.s14.sp,
                ),
              ),
              Text(
                DateFormat(
                  'MMM d, yyyy',
                  context.locale.toString(),
                ).format(newEndDate),
                style: getRegularTextStyle(
                  color: ColorManager.greenPrimary,
                  fontSize: FontSizeManager.s14.sp,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildActionButtons(
    BuildContext context,
    FreezeSubscriptionState state,
  ) {
    final isLoading = state is FreezeSubscriptionLoading;

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
              Strings.cancel.tr(),
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
                    final formattedDate =
                        "${_startDate.year}-${_startDate.month.toString().padLeft(2, '0')}-${_startDate.day.toString().padLeft(2, '0')}";
                    context.read<FreezeSubscriptionBloc>().add(
                      SubmitFreezeSubscriptionEvent(
                        subscriptionId: widget.subscriptionId,
                        startDate: formattedDate,
                        days: _days,
                      ),
                    );
                  },
            style: ElevatedButton.styleFrom(
              backgroundColor: ColorManager.greenPrimary,
              padding: const EdgeInsets.symmetric(vertical: AppPadding.p16),
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppSize.s12),
              ),
            ),
            child: isLoading
                ? const SizedBox(
                    width: AppSize.s24,
                    height: AppSize.s24,
                    child: CircularProgressIndicator(color: Colors.white),
                  )
                : Text(
                    Strings.freezeSubscription.tr(),
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
