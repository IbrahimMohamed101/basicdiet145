import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/presentation/main/home/premium/bloc/premium_meals_bloc.dart';
import 'package:basic_diet/presentation/main/home/premium/bloc/premium_meals_event.dart';
import 'package:basic_diet/presentation/main/home/premium/bloc/premium_meals_state.dart';
import 'package:basic_diet/presentation/main/home/premium/widgets/error_view.dart';
import 'package:basic_diet/presentation/main/home/premium/widgets/loading_view.dart';
import 'package:basic_diet/presentation/main/home/premium/widgets/success_view.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class PremiumMealsScreen extends StatelessWidget {
  static const String premiumRoute = '/premium_meals';

  const PremiumMealsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) =>
          instance<PremiumMealsBloc>()..add(const GetPremiumMealsEvent()),
      child: Scaffold(
        backgroundColor: ColorManager.whiteColor,
        appBar: _buildAppBar(context),
        body: SafeArea(
          child: BlocBuilder<PremiumMealsBloc, PremiumMealsState>(
            builder: (context, state) => switch (state) {
              PremiumMealsLoading() => const PremiumMealsLoadingView(),
              PremiumMealsError() => PremiumMealsErrorView(
                message: state.message,
              ),
              PremiumMealsSuccess() => PremiumMealsSuccessView(state: state),
              _ => const SizedBox.shrink(),
            },
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
      titleSpacing: 0,
      scrolledUnderElevation: 0,
      leading: IconButton(
        onPressed: () => Navigator.pop(context),
        icon: Icon(
          Icons.arrow_back,
          color: ColorManager.blackColor,
          size: AppSize.s24.sp,
        ),
      ),
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            Strings.premiumMeals.tr(),
            style: getBoldTextStyle(
              color: ColorManager.black101828,
              fontSize: FontSizeManager.s18.sp,
            ),
          ),
          Gap(AppSize.s2.h),
          Text(
            Strings.exclusiveProteins.tr(),
            style: getRegularTextStyle(
              color: ColorManager.grey6A7282,
              fontSize: FontSizeManager.s12.sp,
            ),
          ),
        ],
      ),
      actions: [
        Padding(
          padding: EdgeInsetsDirectional.symmetric(
            horizontal: AppPadding.p16.w,
          ),
          child: Container(
            width: AppSize.s40.w,
            height: AppSize.s40.w,
            decoration: const BoxDecoration(
              color: ColorManager.greenDark,
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.star_rounded,
              color: ColorManager.whiteColor,
              size: AppSize.s24.sp,
            ),
          ),
        ),
      ],
    );
  }
}
