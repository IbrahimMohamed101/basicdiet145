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
              Expanded(
                child: BlocBuilder<AddOnsBloc, AddOnsState>(
                  builder: (context, state) {
                    if (state is AddOnsLoading) {
                      return const Center(
                        child: CircularProgressIndicator(
                          color: ColorManager.greenPrimary,
                        ),
                      );
                    } else if (state is AddOnsError) {
                      return Center(child: Text(state.message));
                    } else if (state is AddOnsSuccess) {
                      return _AddOnsListView(
                        addOns: state.addOnsModel.addOns,
                        selectedAddOns: state.selectedAddOns,
                      );
                    }
                    return const SizedBox.shrink();
                  },
                ),
              ),
              const _BottomActions(),
            ],
          ),
        ),
      ),
    );
  }

  AppBar _buildAppBar(BuildContext context) {
    return AppBar(
      backgroundColor: ColorManager.whiteColor,
      elevation: 0,
      centerTitle: false,
      leading: IconButton(
        onPressed: () => Navigator.pop(context),
        icon: Icon(
          Icons.arrow_back_ios_new,
          color: ColorManager.blackColor,
          size: AppSize.s20.sp,
        ),
      ),
      title: Text(
        Strings.addOns,
        style: getBoldTextStyle(
          color: ColorManager.black101828,
          fontSize: FontSizeManager.s18.sp,
        ),
      ),
      bottom: PreferredSize(
        preferredSize: const Size.fromHeight(1.0),
        child: Container(
          color: ColorManager.formFieldsBorderColor,
          height: 1.0,
        ),
      ),
    );
  }
}

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
          Text(
            Strings.enhanceYourPlan,
            style: getBoldTextStyle(
              color: ColorManager.black101828,
              fontSize: FontSizeManager.s18.sp,
            ),
          ),
          Gap(AppSize.s8.h),
          Text(
            Strings.addExtraItemsOptional,
            textAlign: TextAlign.center,
            style: getRegularTextStyle(
              color: ColorManager.grey6A7282,
              fontSize: FontSizeManager.s14.sp,
            ),
          ),
          Gap(AppSize.s30.h),
          ...addOns.map((addOn) {
            final isSelected = selectedAddOns.contains(addOn);
            return Padding(
              padding: EdgeInsetsDirectional.only(bottom: AppSize.s16.h),
              child: _AddOnCard(
                addOn: addOn,
                isSelected: isSelected,
                onTap: () {
                  context.read<AddOnsBloc>().add(
                    ToggleAddOnSelectionEvent(addOn),
                  );
                },
              ),
            );
          }),
        ],
      ),
    );
  }
}

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
        padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
        decoration: BoxDecoration(
          color: ColorManager.whiteColor,
          borderRadius: BorderRadius.circular(AppSize.s16.r),
          border: Border.all(
            color: isSelected
                ? ColorManager.greenPrimary
                : ColorManager.formFieldsBorderColor,
            width: isSelected ? 2 : 1,
          ),
          boxShadow: [
            if (isSelected)
              BoxShadow(
                color: ColorManager.greenPrimary.withValues(alpha: 0.1),
                blurRadius: 10,
                offset: const Offset(0, 4),
              )
            else
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.02),
                blurRadius: 8,
                offset: const Offset(0, 2),
              ),
          ],
        ),
        child: Row(
          children: [
            Stack(
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
                    child: Container(
                      padding: EdgeInsetsDirectional.symmetric(
                        horizontal: 6.w,
                        vertical: 2.h,
                      ),
                      decoration: BoxDecoration(
                        color: ColorManager.whiteColor,
                        borderRadius: BorderRadius.circular(4.r),
                      ),
                      child: Text(
                        addOn.ui.badge.contains('Subscription')
                            ? 'Daily'
                            : 'One-time',
                        style: getBoldTextStyle(
                          color: ColorManager.greenPrimary,
                          fontSize: 8.sp,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            Gap(AppSize.s16.w),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    addOn.ui.title,
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
                    '${addOn.priceSar.toInt()} SAR / day',
                    style: getBoldTextStyle(
                      color: ColorManager.greenPrimary,
                      fontSize: FontSizeManager.s14.sp,
                    ),
                  ),
                ],
              ),
            ),
            Gap(AppSize.s8.w),
            _SelectionIndicator(isSelected: isSelected),
          ],
        ),
      ),
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
        border: !isSelected
            ? Border.all(color: ColorManager.formFieldsBorderColor)
            : null,
      ),
      child: isSelected
          ? const Icon(Icons.check, color: ColorManager.whiteColor, size: 14)
          : null,
    );
  }
}

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
          ElevatedButton(
            onPressed: () {
              final subscriptionBloc = context.read<SubscriptionBloc>();
              final addOnsState = context.read<AddOnsBloc>().state;
              if (addOnsState is AddOnsSuccess) {
                subscriptionBloc.add(
                  SaveAddOnsSelectionEvent(addOnsState.selectedAddOns),
                );
              }
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => BlocProvider.value(
                    value: subscriptionBloc,
                    child: const DeliveryMethodScreen(),
                  ),
                ),
              );
            },
            style: ElevatedButton.styleFrom(
                backgroundColor: ColorManager.greenPrimary,
                minimumSize: Size(double.infinity, 56.h),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppSize.s16.r),
                ),
                elevation: 0,
              ),
              child: Text(
                Strings.continueText,
                style: getBoldTextStyle(
                  fontSize: FontSizeManager.s16.sp,
                  color: ColorManager.whiteColor,
                ),
              ),
            ),
            Gap(AppSize.s8.h),
            TextButton(
              onPressed: () {
                final subscriptionBloc = context.read<SubscriptionBloc>();
                final addOnsState = context.read<AddOnsBloc>().state;
                if (addOnsState is AddOnsSuccess) {
                  subscriptionBloc.add(
                    SaveAddOnsSelectionEvent(addOnsState.selectedAddOns),
                  );
                }
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => BlocProvider.value(
                      value: subscriptionBloc,
                      child: const DeliveryMethodScreen(),
                    ),
                  ),
                );
              },
              style: TextButton.styleFrom(
                minimumSize: Size(double.infinity, 40.h),
              ),
              child: Text(
                Strings.skipThisStep,
                style: getBoldTextStyle(
                  fontSize: FontSizeManager.s14.sp,
                  color: ColorManager.grey6A7282,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SummaryContainer extends StatelessWidget {
  const _SummaryContainer();

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<SubscriptionBloc, SubscriptionState>(
      builder: (context, subscriptionState) {
        final daysCount =
            subscriptionState is SubscriptionSuccess
                ? subscriptionState.selectedPlan?.daysCount ?? 1
                : 1;

        return BlocBuilder<AddOnsBloc, AddOnsState>(
          builder: (context, addOnsState) {
            if (addOnsState is! AddOnsSuccess ||
                addOnsState.selectedAddOns.isEmpty) {
              return Padding(
                padding: EdgeInsetsDirectional.symmetric(vertical: 10.h),
                child: Text(
                  'No add-ons selected',
                  style: getRegularTextStyle(
                    color: ColorManager.grey6A7282,
                    fontSize: FontSizeManager.s14.sp,
                  ),
                ),
              );
            }

            final count = addOnsState.selectedAddOns.length;
            final pricePerDay = addOnsState.selectedAddOns.fold<double>(
              0,
              (sum, item) => sum + item.priceSar,
            );
            final totalPrice = pricePerDay * daysCount;

            return Container(
              padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
              decoration: BoxDecoration(
                color: ColorManager.greyF3F4F6.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(AppSize.s12.r),
              ),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '$count add-on${count > 1 ? 's' : ''} selected',
                        style: getRegularTextStyle(
                          color: ColorManager.grey6A7282,
                          fontSize: FontSizeManager.s12.sp,
                        ),
                      ),
                      Text(
                        '${pricePerDay.toInt()} SAR × $daysCount days',
                        style: getRegularTextStyle(
                          color: ColorManager.grey6A7282,
                          fontSize: FontSizeManager.s12.sp,
                        ),
                      ),
                    ],
                  ),
                  Gap(AppSize.s8.h),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Total',
                        style: getBoldTextStyle(
                          color: ColorManager.black101828,
                          fontSize: FontSizeManager.s16.sp,
                        ),
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            '${totalPrice.toInt()} SAR',
                            style: getBoldTextStyle(
                              color: ColorManager.greenPrimary,
                              fontSize: FontSizeManager.s20.sp,
                            ),
                          ),
                          Text(
                            'Applied to $daysCount days',
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
          },
        );
      },
    );
  }
}
