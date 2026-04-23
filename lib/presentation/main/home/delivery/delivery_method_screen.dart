import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/presentation/main/home/delivery/bloc/delivery_options_bloc.dart';
import 'package:basic_diet/presentation/main/home/delivery/bloc/delivery_options_event.dart';
import 'package:basic_diet/presentation/main/home/delivery/bloc/delivery_options_state.dart';
import 'package:basic_diet/presentation/main/home/delivery/widgets/delivery_method_content_view.dart';
import 'package:basic_diet/presentation/main/home/subscription-details/subscription_details_screen.dart';
import 'package:basic_diet/presentation/main/home/subscription/bloc/subscription_bloc.dart';
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

enum DeliveryType { home, pickup }

class DeliveryMethodScreen extends StatelessWidget {
  static const String deliveryMethodRoute = '/delivery_method';

  const DeliveryMethodScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) =>
          instance<DeliveryOptionsBloc>()..add(const GetDeliveryOptionsEvent()),
      child: const _DeliveryMethodListener(child: _DeliveryMethodScaffold()),
    );
  }
}

class _DeliveryMethodListener extends StatelessWidget {
  final Widget child;
  const _DeliveryMethodListener({required this.child});

  @override
  Widget build(BuildContext context) {
    return MultiBlocListener(
      listeners: [
        BlocListener<SubscriptionBloc, SubscriptionState>(
          listenWhen: (prev, curr) =>
              (prev is SubscriptionSuccess ? prev.quoteStatus : null) !=
              (curr is SubscriptionSuccess ? curr.quoteStatus : null),
          listener: (context, state) {
            if (state is! SubscriptionSuccess) return;

            if (state.quoteStatus == SubscriptionQuoteStatus.failure &&
                state.quoteErrorMessage?.isNotEmpty == true) {
              ScaffoldMessenger.of(
                context,
              ).showSnackBar(SnackBar(content: Text(state.quoteErrorMessage!)));
            }

            if (state.quoteStatus == SubscriptionQuoteStatus.success &&
                state.subscriptionQuote != null &&
                state.lastQuoteRequest != null) {
              context.push(
                SubscriptionDetails.subscriptionDetailsRoute,
                extra: {
                  'bloc': context.read<SubscriptionBloc>(),
                  'quote': state.subscriptionQuote!,
                  'quoteRequest': state.lastQuoteRequest!,
                  'subscriptionId':
                      state.lastQuoteRequest!.planId, // example mapping
                },
              );
            }
          },
        ),
      ],
      child: child,
    );
  }
}

class _DeliveryMethodScaffold extends StatelessWidget {
  const _DeliveryMethodScaffold();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: ColorManager.backgroundSurface,
      appBar: _buildAppBar(),
      body: BlocBuilder<DeliveryOptionsBloc, DeliveryOptionsState>(
        builder: (context, state) => switch (state) {
          DeliveryOptionsLoading() ||
          DeliveryOptionsInitial() => const _LoadingView(),
          DeliveryOptionsError() => _ErrorView(message: state.message),
          DeliveryOptionsSuccess() => DeliveryMethodContentView(
            state: state,
            deliveryOptions: state.deliveryOptionsModel,
          ),
          _ => const SizedBox.shrink(),
        },
      ),
    );
  }

  AppBar _buildAppBar() {
    return AppBar(
      title: Text(
        Strings.deliveryMethod.tr(),
        style: getBoldTextStyle(
          color: ColorManager.textPrimary,
          fontSize: FontSizeManager.s20.sp,
        ),
      ),
      scrolledUnderElevation: 0,
      bottom: PreferredSize(
        preferredSize: Size.fromHeight(40.h),
        child: Padding(
          padding: EdgeInsetsDirectional.only(
            start: AppPadding.p16.w,
            bottom: AppPadding.p16.h,
          ),
          child: Align(
            alignment: AlignmentDirectional.centerStart,
            child: Text(
              Strings.howWouldYouLikeToReceiveYourMeals.tr(),
              style: getRegularTextStyle(
                color: ColorManager.textSecondary,
                fontSize: FontSizeManager.s14.sp,
              ),
            ),
          ),
        ),
      ),
      elevation: 0,
      backgroundColor: ColorManager.backgroundSurface,
      leading: const BackButton(color: ColorManager.textPrimary),
    );
  }
}

class _LoadingView extends StatelessWidget {
  const _LoadingView();
  @override
  Widget build(BuildContext context) => const Center(
    child: CircularProgressIndicator(color: ColorManager.brandPrimary),
  );
}

class _ErrorView extends StatelessWidget {
  final String message;
  const _ErrorView({required this.message});
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(message),
          Gap(AppSize.s16.h),
          ElevatedButton(
            onPressed: () => context.read<DeliveryOptionsBloc>().add(
              const GetDeliveryOptionsEvent(),
            ),
            child: Text(Strings.tryAgain.tr()),
          ),
        ],
      ),
    );
  }
}
