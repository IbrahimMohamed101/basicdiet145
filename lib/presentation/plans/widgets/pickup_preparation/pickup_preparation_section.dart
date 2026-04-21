import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/domain/model/current_subscription_overview_model.dart';
import 'package:basic_diet/domain/model/pickup_preparation_enums.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_bloc.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_event.dart';
import 'package:basic_diet/presentation/plans/pickup_status/pickup_status_cubit.dart';
import 'package:basic_diet/presentation/plans/widgets/pickup_preparation/pickup_preparation_view_state.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class PickupPreparationSection extends StatelessWidget {
  final CurrentSubscriptionOverviewDataModel data;

  const PickupPreparationSection({super.key, required this.data});

  @override
  Widget build(BuildContext context) {
    final flowStatus = PickupFlowStatus.fromString(
      data.pickupPreparation!.flowStatus,
    );

    if (flowStatus == PickupFlowStatus.hidden) return const SizedBox.shrink();

    if (flowStatus == PickupFlowStatus.inProgress) {
      final pollingBusinessDate =
          data.pickupPreparation!.businessDate.isNotEmpty
              ? data.pickupPreparation!.businessDate
              : data.businessDate;
      return Column(
        children: [
          Gap(AppSize.s16.h),
          _PollingSection(
            overview: data,
            subscriptionId: data.id,
            businessDate: pollingBusinessDate,
          ),
        ],
      );
    }

    final viewState = PickupPreparationViewState.fromData(
      data,
      isArabic: context.locale.languageCode == 'ar',
    );

    return Column(
      children: [
        Gap(AppSize.s16.h),
        _PickupJourneyCard(data: data, viewState: viewState),
      ],
    );
  }
}

class _PollingSection extends StatelessWidget {
  final CurrentSubscriptionOverviewDataModel overview;
  final String subscriptionId;
  final String businessDate;

  const _PollingSection({
    required this.overview,
    required this.subscriptionId,
    required this.businessDate,
  });

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) {
        initPickupStatusModule();
        return instance<PickupStatusCubit>()
          ..startPolling(subscriptionId, businessDate);
      },
      child: BlocBuilder<PickupStatusCubit, PickupStatusState>(
        builder: (_, state) {
          final status = state is PickupStatusLoaded ? state.data : null;
          final viewState = PickupPreparationViewState.fromData(
            overview,
            pickupStatus: status,
            isArabic: context.locale.languageCode == 'ar',
          );

          return _PickupJourneyCard(data: overview, viewState: viewState);
        },
      ),
    );
  }
}

class _PickupJourneyCard extends StatelessWidget {
  final CurrentSubscriptionOverviewDataModel data;
  final PickupPreparationViewState viewState;

  const _PickupJourneyCard({required this.data, required this.viewState});

  void _showConfirmDialog(BuildContext context) {
    final bloc = context.read<PlansBloc>();
    showDialog<void>(
      context: context,
      builder:
          (_) => AlertDialog(
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppSize.s24.r),
            ),
            title: Text(
              Strings.confirmPrepareTitle.tr(),
              style: getBoldTextStyle(
                color: ColorManager.black101828,
                fontSize: FontSizeManager.s18.sp,
              ),
            ),
            content: Text(
              Strings.confirmPrepareMessage.tr(),
              style: getRegularTextStyle(
                color: ColorManager.grey6A7282,
                fontSize: FontSizeManager.s14.sp,
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: Text(
                  Strings.cancel.tr(),
                  style: getRegularTextStyle(
                    color: ColorManager.grey6A7282,
                    fontSize: FontSizeManager.s14.sp,
                  ),
                ),
              ),
              ElevatedButton(
                onPressed: () {
                  Navigator.of(context).pop();
                  bloc.add(PreparePickupEvent(data.id, viewState.businessDate));
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: ColorManager.greenPrimary,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppSize.s100.r),
                  ),
                  elevation: 0,
                ),
                child: Text(
                  Strings.confirmPrepareAction.tr(),
                  style: getBoldTextStyle(
                    color: Colors.white,
                    fontSize: FontSizeManager.s14.sp,
                  ),
                ),
              ),
            ],
          ),
    );
  }

  void _handlePrimaryAction(BuildContext context) {
    switch (viewState.primaryAction) {
      case PickupJourneyAction.openPlanner:
        context.read<PlansBloc>().add(
          FetchTimelineAndOpenPlannerEvent(
            data.id,
            preferredDate: viewState.businessDate,
          ),
        );
        return;
      case PickupJourneyAction.prepareOrder:
        _showConfirmDialog(context);
        return;
      case PickupJourneyAction.none:
        return;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(AppPadding.p24.w),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: _backgroundColors(),
        ),
        borderRadius: BorderRadius.circular(AppSize.s28.r),
        border: Border.all(color: _borderColor()),
        boxShadow: [
          BoxShadow(
            color: _borderColor().withValues(alpha: 0.18),
            blurRadius: 24,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            Strings.pickupJourneyTitle.tr(),
            style: getBoldTextStyle(
              color: ColorManager.black101828,
              fontSize: FontSizeManager.s22.sp,
            ),
          ),
          Gap(AppSize.s6.h),
          Text(
            Strings.pickupJourneySubtitle.tr(),
            style: getRegularTextStyle(
              color: ColorManager.grey6A7282,
              fontSize: FontSizeManager.s15.sp,
            ),
          ),
          Gap(AppSize.s20.h),
          _StepRow(steps: viewState.steps),
          Gap(AppSize.s20.h),
          _HeroSection(viewState: viewState),
          if (viewState.showProgressTimeline) ...[
            Gap(AppSize.s20.h),
            _ProgressTimeline(items: viewState.progressItems),
          ],
          if (viewState.showPickupCode) ...[
            Gap(AppSize.s20.h),
            _PickupCodeCard(code: viewState.pickupCode ?? ''),
          ],
          if (viewState.primaryActionLabel != null) ...[
            Gap(AppSize.s20.h),
            SizedBox(
              width: double.infinity,
              height: AppSize.s55.h,
              child: ElevatedButton(
                onPressed: () => _handlePrimaryAction(context),
                style: ElevatedButton.styleFrom(
                  backgroundColor: ColorManager.greenPrimary,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppSize.s100.r),
                  ),
                  elevation: 0,
                ),
                child: Text(
                  viewState.primaryActionLabel!,
                  style: getBoldTextStyle(
                    color: Colors.white,
                    fontSize: FontSizeManager.s18.sp,
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  List<Color> _backgroundColors() {
    return switch (viewState.visualState) {
      PickupJourneyVisualState.progress => [
        const Color(0xFFFFFBF3),
        const Color(0xFFFFFFFF),
      ],
      PickupJourneyVisualState.completion => [
        const Color(0xFFF3FBF7),
        const Color(0xFFFFFFFF),
      ],
      PickupJourneyVisualState.idle => [
        const Color(0xFFF9FAFB),
        const Color(0xFFFFFFFF),
      ],
    };
  }

  Color _borderColor() {
    return switch (viewState.visualState) {
      PickupJourneyVisualState.progress => const Color(0xFFF3D6A5),
      PickupJourneyVisualState.completion => const Color(0xFFA7E2C2),
      PickupJourneyVisualState.idle => ColorManager.formFieldsBorderColor,
    };
  }
}

class _HeroSection extends StatelessWidget {
  final PickupPreparationViewState viewState;

  const _HeroSection({required this.viewState});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(AppPadding.p18.w),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.92),
        borderRadius: BorderRadius.circular(AppSize.s22.r),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: AppSize.s50.w,
            height: AppSize.s50.w,
            decoration: BoxDecoration(
              color: _iconBackground(),
              borderRadius: BorderRadius.circular(AppSize.s18.r),
            ),
            child: Icon(_icon(), color: _iconColor(), size: AppSize.s28.sp),
          ),
          Gap(AppSize.s14.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  viewState.title,
                  style: getBoldTextStyle(
                    color: ColorManager.black101828,
                    fontSize: FontSizeManager.s20.sp,
                  ),
                ),
                Gap(AppSize.s8.h),
                Text(
                  viewState.subtitle,
                  style: getRegularTextStyle(
                    color: ColorManager.grey6A7282,
                    fontSize: FontSizeManager.s15.sp,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  IconData _icon() {
    return switch (viewState.visualState) {
      PickupJourneyVisualState.progress => Icons.delivery_dining_outlined,
      PickupJourneyVisualState.completion => Icons.check_circle_outline,
      PickupJourneyVisualState.idle => switch (viewState.primaryAction) {
        PickupJourneyAction.openPlanner => Icons.restaurant_menu_outlined,
        PickupJourneyAction.prepareOrder => Icons.shopping_bag_outlined,
        PickupJourneyAction.none => Icons.receipt_long_outlined,
      },
    };
  }

  Color _iconColor() {
    return switch (viewState.visualState) {
      PickupJourneyVisualState.progress => const Color(0xFFB45309),
      PickupJourneyVisualState.completion => ColorManager.greenPrimary,
      PickupJourneyVisualState.idle => ColorManager.black101828,
    };
  }

  Color _iconBackground() {
    return switch (viewState.visualState) {
      PickupJourneyVisualState.progress => const Color(0xFFFFEAD1),
      PickupJourneyVisualState.completion => ColorManager.greenPrimary
          .withValues(alpha: 0.12),
      PickupJourneyVisualState.idle => const Color(0xFFF3F4F6),
    };
  }
}

class _StepRow extends StatelessWidget {
  final List<PickupJourneyStepViewState> steps;

  const _StepRow({required this.steps});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: List.generate(steps.length * 2 - 1, (index) {
        if (index.isOdd) {
          final prevState = steps[index ~/ 2].state;
          return Expanded(
            child: Container(
              height: 2.h,
              color:
                  prevState == PickupJourneyStepState.locked
                      ? const Color(0xFFD0D5DD)
                      : ColorManager.greenPrimary,
            ),
          );
        }

        final step = steps[index ~/ 2];
        return _StepPill(step: step);
      }),
    );
  }
}

class _StepPill extends StatelessWidget {
  final PickupJourneyStepViewState step;

  const _StepPill({required this.step});

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(minWidth: 82.w),
      padding: EdgeInsets.symmetric(
        horizontal: AppPadding.p10.w,
        vertical: AppPadding.p8.h,
      ),
      decoration: BoxDecoration(
        color: _backgroundColor(),
        borderRadius: BorderRadius.circular(AppSize.s100.r),
        border: Border.all(color: _borderColor()),
      ),
      child: Column(
        children: [
          Icon(_icon(), color: _iconColor(), size: AppSize.s18.sp),
          Gap(AppSize.s4.h),
          Text(
            step.label,
            textAlign: TextAlign.center,
            style: getRegularTextStyle(
              color: _textColor(),
              fontSize: FontSizeManager.s10.sp,
            ),
          ),
        ],
      ),
    );
  }

  IconData _icon() {
    return switch (step.state) {
      PickupJourneyStepState.completed => Icons.check_circle,
      PickupJourneyStepState.active => Icons.radio_button_checked,
      PickupJourneyStepState.locked => Icons.lock_outline,
    };
  }

  Color _backgroundColor() {
    return switch (step.state) {
      PickupJourneyStepState.completed => ColorManager.greenPrimary.withValues(
        alpha: 0.12,
      ),
      PickupJourneyStepState.active => const Color(0xFFFFF4E5),
      PickupJourneyStepState.locked => const Color(0xFFF2F4F7),
    };
  }

  Color _borderColor() {
    return switch (step.state) {
      PickupJourneyStepState.completed => ColorManager.greenPrimary,
      PickupJourneyStepState.active => const Color(0xFFF59E0B),
      PickupJourneyStepState.locked => const Color(0xFFD0D5DD),
    };
  }

  Color _iconColor() {
    return switch (step.state) {
      PickupJourneyStepState.completed => ColorManager.greenPrimary,
      PickupJourneyStepState.active => const Color(0xFFB45309),
      PickupJourneyStepState.locked => const Color(0xFF98A2B3),
    };
  }

  Color _textColor() {
    return switch (step.state) {
      PickupJourneyStepState.completed => ColorManager.greenPrimary,
      PickupJourneyStepState.active => const Color(0xFF92400E),
      PickupJourneyStepState.locked => const Color(0xFF667085),
    };
  }
}

class _ProgressTimeline extends StatelessWidget {
  final List<PickupJourneyProgressItemViewState> items;

  const _ProgressTimeline({required this.items});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(AppPadding.p16.w),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.88),
        borderRadius: BorderRadius.circular(AppSize.s20.r),
      ),
      child: Column(children: items.map(_buildItem).toList()),
    );
  }

  Widget _buildItem(PickupJourneyProgressItemViewState item) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: AppPadding.p6.h),
      child: Row(
        children: [
          Container(
            width: AppSize.s28.w,
            height: AppSize.s28.w,
            decoration: BoxDecoration(
              color: _dotColor(item.state).withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: Icon(
              _dotIcon(item.state),
              color: _dotColor(item.state),
              size: AppSize.s16.sp,
            ),
          ),
          Gap(AppSize.s12.w),
          Expanded(
            child: Text(
              item.title,
              style: getRegularTextStyle(
                color: ColorManager.black101828,
                fontSize: FontSizeManager.s14.sp,
              ),
            ),
          ),
          Text(
            _statusLabel(item.state),
            style: getRegularTextStyle(
              color: _dotColor(item.state),
              fontSize: FontSizeManager.s12.sp,
            ),
          ),
        ],
      ),
    );
  }

  IconData _dotIcon(PickupJourneyStepState state) {
    return switch (state) {
      PickupJourneyStepState.completed => Icons.check,
      PickupJourneyStepState.active => Icons.more_horiz,
      PickupJourneyStepState.locked => Icons.lock_outline,
    };
  }

  Color _dotColor(PickupJourneyStepState state) {
    return switch (state) {
      PickupJourneyStepState.completed => ColorManager.greenPrimary,
      PickupJourneyStepState.active => const Color(0xFFB45309),
      PickupJourneyStepState.locked => const Color(0xFF98A2B3),
    };
  }

  String _statusLabel(PickupJourneyStepState state) {
    return switch (state) {
      PickupJourneyStepState.completed => Strings.pickupStatusDone.tr(),
      PickupJourneyStepState.active => Strings.pickupStatusCurrent.tr(),
      PickupJourneyStepState.locked => Strings.pickupStatusLocked.tr(),
    };
  }
}

class _PickupCodeCard extends StatelessWidget {
  final String code;

  const _PickupCodeCard({required this.code});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.symmetric(
        horizontal: AppPadding.p18.w,
        vertical: AppPadding.p16.h,
      ),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF068453), Color(0xFF12B76A)],
        ),
        borderRadius: BorderRadius.circular(AppSize.s22.r),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            Strings.pickupCode.tr(),
            style: getRegularTextStyle(
              color: Colors.white.withValues(alpha: 0.82),
              fontSize: FontSizeManager.s12.sp,
            ),
          ),
          Gap(AppSize.s6.h),
          Text(
            code,
            style: getBoldTextStyle(
              color: Colors.white,
              fontSize: FontSizeManager.s38.sp,
            ),
          ),
        ],
      ),
    );
  }
}
