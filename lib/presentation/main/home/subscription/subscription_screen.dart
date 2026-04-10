import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/presentation/main/home/subscription/bloc/subscription_bloc.dart';
import 'package:basic_diet/presentation/main/home/subscription/bloc/subscription_event.dart';
import 'package:basic_diet/presentation/main/home/subscription/bloc/subscription_state.dart';
import 'package:basic_diet/presentation/main/home/subscription/widgets/subscription_content_view.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:basic_diet/presentation/main/home/premium/premium_meals_screen.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';
import 'package:go_router/go_router.dart';

class SubscriptionScreen extends StatelessWidget {
  static const String subscriptionRoute = '/subscription';

  const SubscriptionScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => instance<SubscriptionBloc>()..add(const GetPlansEvent()),
      child: Scaffold(
        backgroundColor: ColorManager.whiteColor,
        appBar: _buildAppBar(context),
        body: SafeArea(
          child: Column(
            children: [
              Expanded(child: _SubscriptionStateView()),
              const _ProceedButton(),
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
      centerTitle: true,
      scrolledUnderElevation: 0,
      leading: IconButton(
        onPressed: () => context.pop(),
        icon: Icon(
          Icons.keyboard_arrow_left,
          color: ColorManager.blackColor,
          size: AppSize.s30.sp,
        ),
      ),
      title: Text(
        Strings.subscriptionPackages,
        style: getBoldTextStyle(
          color: ColorManager.black101828,
          fontSize: FontSizeManager.s20.sp,
        ),
      ),
    );
  }
}

// ─── widgets/_SubscriptionStateView (inline in subscription_screen.dart) ─────

class _SubscriptionStateView extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return BlocBuilder<SubscriptionBloc, SubscriptionState>(
      builder: (context, state) => switch (state) {
        SubscriptionLoading() => const _LoadingView(),
        SubscriptionSuccess() => SubscriptionContentView(
          plansModel: state.plansModel,
        ),
        SubscriptionError() => _ErrorView(message: state.message),
        _ => const SizedBox.shrink(),
      },
    );
  }
}

class _LoadingView extends StatelessWidget {
  const _LoadingView();

  @override
  Widget build(BuildContext context) => const Center(
    child: CircularProgressIndicator(color: ColorManager.greenPrimary),
  );
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(message),
          Gap(AppSize.s16.h),
          ElevatedButton(
            onPressed: () =>
                context.read<SubscriptionBloc>().add(const GetPlansEvent()),
            child: const Text(Strings.tryAgain),
          ),
        ],
      ),
    );
  }
}

// ─── widgets/_ProceedButton (inline in subscription_screen.dart) ─────────────

/// Lives inside the BlocProvider subtree so it can later read plan selection.
class _ProceedButton extends StatelessWidget {
  const _ProceedButton();

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<SubscriptionBloc, SubscriptionState>(
      builder: (context, state) {
        final isEnabled =
            state is SubscriptionSuccess && state.selectedMealOption != null;

        return Container(
          padding: EdgeInsetsDirectional.all(AppPadding.p20.w),
          color: ColorManager.whiteColor,
          child: ElevatedButton(
            onPressed: isEnabled
                ? () {
                    context.push(
                      PremiumMealsScreen.premiumRoute,
                      extra: context.read<SubscriptionBloc>(),
                    );
                  }
                : null,
            style: ElevatedButton.styleFrom(
              backgroundColor: isEnabled
                  ? ColorManager.greenPrimary
                  : ColorManager.greenPrimary.withValues(alpha: 0.5),
              minimumSize: Size(double.infinity, AppSize.s55.h),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppSize.s16.r),
              ),
              elevation: 0,
            ),
            child: Text(
              Strings.choosePackageProceed,
              style: getBoldTextStyle(
                fontSize: FontSizeManager.s16.sp,
                color: ColorManager.whiteColor,
              ),
            ),
          ),
        );
      },
    );
  }
}
