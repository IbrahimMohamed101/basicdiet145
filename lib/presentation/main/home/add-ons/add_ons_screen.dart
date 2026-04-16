// add_ons_screen.dart
import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/domain/model/add_ons_model.dart';
import 'package:basic_diet/presentation/main/home/add-ons/bloc/add_ons_bloc.dart';
import 'package:basic_diet/presentation/main/home/add-ons/bloc/add_ons_event.dart';
import 'package:basic_diet/presentation/main/home/add-ons/bloc/add_ons_state.dart';
import 'package:basic_diet/presentation/main/home/delivery/delivery_method_screen.dart';
import 'package:basic_diet/presentation/main/home/subscription/bloc/subscription_bloc.dart';
import 'package:basic_diet/presentation/main/home/subscription/bloc/subscription_event.dart';
import 'package:basic_diet/presentation/main/home/subscription/bloc/subscription_state.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';
import 'package:go_router/go_router.dart';

class AddOnsScreen extends StatelessWidget {
  static const String addOnsRoute = '/add_ons';

  const AddOnsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => instance<AddOnsBloc>()..add(const GetAddOnsEvent()),
      child: Scaffold(
        backgroundColor: ColorManager.whiteColor,
        appBar: _buildAppBar(context),
        body: SafeArea(
          child: Column(
            children: [
              Expanded(child: _buildBody()),
              const _BottomActions(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBody() {
    return BlocBuilder<AddOnsBloc, AddOnsState>(
      builder: (context, state) => switch (state) {
        AddOnsLoading() => const _LoadingView(),
        AddOnsError() => _ErrorView(message: state.message),
        AddOnsSuccess() => _AddOnsListView(
          addOns: state.addOnsModel.addOns,
          selectedAddOns: state.selectedAddOns,
        ),
        _ => const SizedBox.shrink(),
      },
    );
  }

  AppBar _buildAppBar(BuildContext context) {
    return AppBar(
      backgroundColor: ColorManager.whiteColor,
      elevation: 0,
      centerTitle: false,
      leading: IconButton(
        onPressed: () => context.pop(),
        icon: Icon(
          Icons.arrow_back_ios_new,
          color: ColorManager.blackColor,
          size: AppSize.s20.sp,
        ),
      ),
      title: Text(
        Strings.addOns.tr(),
        style: getBoldTextStyle(
          color: ColorManager.black101828,
          fontSize: FontSizeManager.s18.sp,
        ),
      ),
      bottom: const _DividerBottom(),
    );
  }
}

// ---------------------------------------------------------------------------
// Small, focused state-view widgets
// ---------------------------------------------------------------------------

class _LoadingView extends StatelessWidget {
  const _LoadingView();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: CircularProgressIndicator(color: ColorManager.greenPrimary),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String message;

  const _ErrorView({required this.message});

  @override
  Widget build(BuildContext context) => Center(child: Text(message));
}

class _DividerBottom extends StatelessWidget implements PreferredSizeWidget {
  const _DividerBottom();

  @override
  Size get preferredSize => const Size.fromHeight(1.0);

  @override
  Widget build(BuildContext context) {
    return Container(color: ColorManager.formFieldsBorderColor, height: 1.0);
  }
}

// ---------------------------------------------------------------------------
// Add-ons list
// ---------------------------------------------------------------------------

class _AddOnsListView extends StatelessWidget {
  final List<AddOnModel> addOns;
  final Set<AddOnModel> selectedAddOns;

  const _AddOnsListView({required this.addOns, required this.selectedAddOns});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: EdgeInsetsDirectional.symmetric(
        horizontal: AppPadding.p20.w,
        vertical: AppPadding.p20.h,
      ),
      child: Column(
        children: [
          _buildHeader(),
          Gap(AppSize.s30.h),
          ..._buildAddOnCards(context),
        ],
      ),
    );
  }

  Widget _buildHeader() {
    return Column(
      children: [
        Text(
          Strings.enhanceYourPlan.tr(),
          style: getBoldTextStyle(
            color: ColorManager.black101828,
            fontSize: FontSizeManager.s18.sp,
          ),
        ),
        Gap(AppSize.s8.h),
        Text(
          Strings.addExtraItemsOptional.tr(),
          textAlign: TextAlign.center,
          style: getRegularTextStyle(
            color: ColorManager.grey6A7282,
            fontSize: FontSizeManager.s14.sp,
          ),
        ),
      ],
    );
  }

  List<Widget> _buildAddOnCards(BuildContext context) {
    return addOns.map((addOn) {
      return Padding(
        padding: EdgeInsetsDirectional.only(bottom: AppSize.s16.h),
        child: _AddOnCard(
          addOn: addOn,
          isSelected: selectedAddOns.contains(addOn),
          onTap: () =>
              context.read<AddOnsBloc>().add(ToggleAddOnSelectionEvent(addOn)),
        ),
      );
    }).toList();
  }
}

// ---------------------------------------------------------------------------
// Add-on card
// ---------------------------------------------------------------------------

class _AddOnCard extends StatelessWidget {
  final AddOnModel addOn;
  final bool isSelected;
  final VoidCallback onTap;

  const _AddOnCard({
    required this.addOn,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: EdgeInsetsDirectional.symmetric(
          horizontal: AppPadding.p12.w,
          vertical: AppPadding.p12.h,
        ),
        decoration: _cardDecoration(),
        child: Row(
          children: [
            // _AddOnImage(addOn: addOn),
            // Gap(AppSize.s8.w),
            Expanded(child: _AddOnInfo(addOn: addOn)),
            Gap(AppSize.s8.w),
            _SelectionIndicator(isSelected: isSelected),
          ],
        ),
      ),
    );
  }

  BoxDecoration _cardDecoration() {
    return BoxDecoration(
      color: ColorManager.whiteColor,
      borderRadius: BorderRadius.circular(AppSize.s16.r),
      border: Border.all(
        color: isSelected
            ? ColorManager.greenPrimary
            : ColorManager.formFieldsBorderColor,
        width: isSelected ? 2 : 1,
      ),
      boxShadow: [_buildShadow()],
    );
  }

  BoxShadow _buildShadow() {
    return isSelected
        ? BoxShadow(
            color: ColorManager.greenPrimary.withValues(alpha: 0.1),
            blurRadius: 10,
            offset: const Offset(0, 4),
          )
        : BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 8,
            offset: const Offset(0, 2),
          );
  }
}

class _AddOnImage extends StatelessWidget {
  final AddOnModel addOn;

  const _AddOnImage({required this.addOn});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: AppSize.s70.w,
      height: AppSize.s70.h,
      child: Stack(
        clipBehavior: Clip.hardEdge,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(AppSize.s12.r),
            child: Image.network(
              addOn.imageUrl,
              width: AppSize.s70.w,
              height: AppSize.s70.h,
              fit: BoxFit.cover,
            ),
          ),
          if (addOn.ui.badge.isNotEmpty)
            Positioned(
              top: 4.h,
              left: 4.w,
              child: _AddOnBadge(badge: addOn.ui.badge),
            ),
        ],
      ),
    );
  }
}

class _AddOnBadge extends StatelessWidget {
  final String badge;

  const _AddOnBadge({required this.badge});

  // Presentation logic isolated here, not scattered in the card widget.
  String get _label =>
      badge.contains('Subscription') ? Strings.daily.tr() : Strings.oneTime.tr();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsetsDirectional.symmetric(horizontal: 6.w, vertical: 2.h),
      decoration: BoxDecoration(
        color: ColorManager.whiteColor,
        borderRadius: BorderRadius.circular(4.r),
      ),
      child: Text(
        _label,
        style: getBoldTextStyle(
          color: ColorManager.greenPrimary,
          fontSize: 8.sp,
        ),
      ),
    );
  }
}

class _AddOnInfo extends StatelessWidget {
  final AddOnModel addOn;

  const _AddOnInfo({required this.addOn});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          addOn.ui.title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: getBoldTextStyle(
            color: ColorManager.black101828,
            fontSize: FontSizeManager.s16.sp,
          ),
        ),
        Gap(AppSize.s4.h),
        Text(
          addOn.ui.subtitle,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: getRegularTextStyle(
            color: ColorManager.grey6A7282,
            fontSize: FontSizeManager.s14.sp,
          ),
        ),
        Gap(AppSize.s5.h),
        Text(
          '${addOn.priceSar.toInt()} ${Strings.sarPerDay.tr()}',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: getBoldTextStyle(
            color: ColorManager.greenPrimary,
            fontSize: FontSizeManager.s14.sp,
          ),
        ),
      ],
    );
  }
}

class _SelectionIndicator extends StatelessWidget {
  final bool isSelected;

  const _SelectionIndicator({required this.isSelected});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: AppSize.s24.w,
      height: AppSize.s24.w,
      decoration: BoxDecoration(
        color: isSelected
            ? ColorManager.greenPrimary
            : ColorManager.greyF3F4F6.withValues(alpha: 0.5),
        shape: BoxShape.circle,
        border: isSelected
            ? null
            : Border.all(color: ColorManager.formFieldsBorderColor),
      ),
      child: isSelected
          ? const Icon(
              Icons.check,
              color: ColorManager.whiteColor,
              size: AppSize.s14, // replace magic 14 with a constant
            )
          : null,
    );
  }
}

// ---------------------------------------------------------------------------
// Bottom actions  (no business logic — only delegates to helpers)
// ---------------------------------------------------------------------------

class _BottomActions extends StatelessWidget {
  const _BottomActions();

  @override
  Widget build(BuildContext context) {
    return Material(
      elevation: 5,
      color: ColorManager.whiteColor,
      child: Padding(
        padding: EdgeInsetsDirectional.symmetric(
          horizontal: AppPadding.p20.w,
          vertical: AppPadding.p16.h,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const _SummaryContainer(),
            Gap(AppSize.s12.h),
            _ContinueButton(onPressed: () => _proceed(context)),
            Gap(AppSize.s8.h),
            _SkipButton(onPressed: () => _proceed(context)),
          ],
        ),
      ),
    );
  }

  /// Single source of truth for saving add-ons and navigating forward.
  void _proceed(BuildContext context) {
    _saveAddOns(context);
    _navigateToDelivery(context);
  }

  void _saveAddOns(BuildContext context) {
    final addOnsState = context.read<AddOnsBloc>().state;
    if (addOnsState is AddOnsSuccess) {
      context.read<SubscriptionBloc>().add(
        SaveAddOnsSelectionEvent(addOnsState.selectedAddOns),
      );
    }
  }

  void _navigateToDelivery(BuildContext context) {
    final subscriptionBloc = context.read<SubscriptionBloc>();
    context.push(
      DeliveryMethodScreen.deliveryMethodRoute,
      extra: subscriptionBloc,
    );
  }
}

class _ContinueButton extends StatelessWidget {
  final VoidCallback onPressed;

  const _ContinueButton({required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return ElevatedButton(
      onPressed: onPressed,
      style: ElevatedButton.styleFrom(
        backgroundColor: ColorManager.greenPrimary,
        minimumSize: Size(double.infinity, 56.h),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSize.s16.r),
        ),
        elevation: 0,
      ),
      child: Text(
        Strings.continueText.tr(),
        style: getBoldTextStyle(
          fontSize: FontSizeManager.s16.sp,
          color: ColorManager.whiteColor,
        ),
      ),
    );
  }
}

class _SkipButton extends StatelessWidget {
  final VoidCallback onPressed;

  const _SkipButton({required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: onPressed,
      style: TextButton.styleFrom(minimumSize: Size(double.infinity, 40.h)),
      child: Text(
        Strings.skipThisStep.tr(),
        style: getBoldTextStyle(
          fontSize: FontSizeManager.s14.sp,
          color: ColorManager.grey6A7282,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Summary container  (pure rendering, computation moved to a helper)
// ---------------------------------------------------------------------------

class _SummaryContainer extends StatelessWidget {
  const _SummaryContainer();

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<SubscriptionBloc, SubscriptionState>(
      builder: (context, subscriptionState) {
        final daysCount = _resolveDaysCount(subscriptionState);

        return BlocBuilder<AddOnsBloc, AddOnsState>(
          builder: (context, addOnsState) {
            if (addOnsState is! AddOnsSuccess ||
                addOnsState.selectedAddOns.isEmpty) {
              return _EmptySummary();
            }

            final summary = _AddOnsSummary.from(
              selectedAddOns: addOnsState.selectedAddOns,
              daysCount: daysCount,
            );

            return _SummaryCard(summary: summary);
          },
        );
      },
    );
  }

  int _resolveDaysCount(SubscriptionState state) {
    return state is SubscriptionSuccess
        ? state.selectedPlan?.daysCount ?? 1
        : 1;
  }
}

class _EmptySummary extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsetsDirectional.symmetric(vertical: 10.h),
      child: Text(
        Strings.noAddOnsSelected.tr(),
        style: getRegularTextStyle(
          color: ColorManager.grey6A7282,
          fontSize: FontSizeManager.s14.sp,
        ),
      ),
    );
  }
}

/// Pure data class — no Flutter dependency; trivially unit-testable.
class _AddOnsSummary {
  final int count;
  final double pricePerDay;
  final double totalPrice;
  final int daysCount;

  const _AddOnsSummary({
    required this.count,
    required this.pricePerDay,
    required this.totalPrice,
    required this.daysCount,
  });

  factory _AddOnsSummary.from({
    required Set<AddOnModel> selectedAddOns,
    required int daysCount,
  }) {
    final pricePerDay = selectedAddOns.fold<double>(
      0,
      (sum, item) => sum + item.priceSar,
    );
    return _AddOnsSummary(
      count: selectedAddOns.length,
      pricePerDay: pricePerDay,
      totalPrice: pricePerDay * daysCount,
      daysCount: daysCount,
    );
  }

  String get countLabel =>
      '$count ${Strings.addOns.tr()}${count > 1 ? 's' : ''} ${Strings.selected.tr()}';

  String get priceBreakdownLabel =>
      '${pricePerDay.toInt()} ${Strings.sar.tr()} × $daysCount ${Strings.days.tr()}';

  String get totalLabel => '${totalPrice.toInt()} ${Strings.sar.tr()}';

  String get appliedLabel => '${Strings.appliedTo.tr()} $daysCount ${Strings.days.tr()}';
}

class _SummaryCard extends StatelessWidget {
  final _AddOnsSummary summary;

  const _SummaryCard({required this.summary});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
      decoration: BoxDecoration(
        color: ColorManager.greyF3F4F6.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(AppSize.s12.r),
      ),
      child: Column(
        children: [
          _SummaryRow(
            left: summary.countLabel,
            right: summary.priceBreakdownLabel,
            style: getRegularTextStyle(
              color: ColorManager.grey6A7282,
              fontSize: FontSizeManager.s12.sp,
            ),
          ),
          Gap(AppSize.s8.h),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                Strings.total.tr(),
                style: getBoldTextStyle(
                  color: ColorManager.black101828,
                  fontSize: FontSizeManager.s16.sp,
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    summary.totalLabel,
                    style: getBoldTextStyle(
                      color: ColorManager.greenPrimary,
                      fontSize: FontSizeManager.s20.sp,
                    ),
                  ),
                  Text(
                    summary.appliedLabel,
                    style: getRegularTextStyle(
                      color: ColorManager.grey6A7282,
                      fontSize: FontSizeManager.s10.sp,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  final String left;
  final String right;
  final TextStyle style;

  const _SummaryRow({
    required this.left,
    required this.right,
    required this.style,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Flexible(child: Text(left, style: style, overflow: TextOverflow.ellipsis)),
        Flexible(child: Text(right, style: style, overflow: TextOverflow.ellipsis, textAlign: TextAlign.end)),
      ],
    );
  }
}
