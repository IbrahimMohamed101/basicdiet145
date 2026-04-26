import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/domain/model/popular_packages_model.dart';
import 'package:basic_diet/presentation/main/home/bloc/home_bloc.dart';
import 'package:basic_diet/presentation/main/home/bloc/home_event.dart';
import 'package:basic_diet/presentation/main/home/bloc/home_state.dart';
import 'package:basic_diet/presentation/main/home/widgets/category_item.dart';
import 'package:basic_diet/presentation/main/home/widgets/header_icon_button.dart';
import 'package:basic_diet/presentation/main/home/widgets/package_card.dart';
import 'package:basic_diet/presentation/main/home/widgets/section_header.dart';
import 'package:basic_diet/presentation/main/home/widgets/subscribe_card.dart';
import 'package:basic_diet/presentation/resources/assets_manager.dart';
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

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => instance<HomeBloc>()..add(GetPopularPackagesEvent()),
      child: Scaffold(
        backgroundColor: ColorManager.backgroundSurface,
        body: SafeArea(
          child: SingleChildScrollView(
            padding: EdgeInsetsDirectional.all(AppPadding.p20.w),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const _HomeHeader(),
                Gap(AppSize.s30.h),
                const _CardsRow(),
                Gap(AppSize.s30.h),
                const _QuickBrowseSection(),
                Gap(AppSize.s30.h),
                const _PopularPackagesSection(),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ─── widgets/_HomeHeader ─────────────────────────────────────────────────────

class _HomeHeader extends StatelessWidget {
  const _HomeHeader();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              Strings.goodMorning.tr(),
              style: getBoldTextStyle(
                fontSize: FontSizeManager.s24,
                color: ColorManager.textPrimary,
              ),
            ),
            Gap(AppSize.s4.h),
            Text(
              Strings.eatHealthy.tr(),
              style: getRegularTextStyle(
                fontSize: FontSizeManager.s14,
                color: ColorManager.textSecondary,
              ),
            ),
          ],
        ),
        const Spacer(),
        HeaderIconButton(icon: IconAssets.notification),
        Gap(AppSize.s12.w),
        const _CartButton(),
      ],
    );
  }
}

class _CartButton extends StatelessWidget {
  const _CartButton();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsetsDirectional.all(AppPadding.p8.w),
      decoration: BoxDecoration(
        color: ColorManager.stateSuccessEmphasis,
        borderRadius: BorderRadius.circular(AppSize.s16.r),
      ),
      child: const Icon(
        Icons.shopping_cart_outlined,
        color: ColorManager.backgroundSurface,
        size: AppSize.s24,
      ),
    );
  }
}

// ─── widgets/_CardsRow ───────────────────────────────────────────────────────

class _CardsRow extends StatelessWidget {
  const _CardsRow();

  @override
  Widget build(BuildContext context) {
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Expanded(child: SubscribeCard()),
          Gap(AppSize.s16.w),
          const Expanded(child: _ImageCard()),
        ],
      ),
    );
  }
}

class _ImageCard extends StatelessWidget {
  const _ImageCard();

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppSize.s16.r),
      child: Stack(
        fit: StackFit.expand,
        children: [
          const Image(image: AssetImage(ImageAssets.salad), fit: BoxFit.cover),
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.centerLeft,
                end: Alignment.centerRight,
                colors: [
                  ColorManager.textPrimary.withValues(alpha: 0.8),
                  ColorManager.textPrimary.withValues(alpha: 0.4),
                  ColorManager.textPrimary.withValues(alpha: 0.0),
                ],
                stops: const [0.0, 0.6, 1.0],
              ),
            ),
          ),
          Padding(
            padding: EdgeInsetsDirectional.fromSTEB(
              AppPadding.p20.w,
              AppPadding.p40.h,
              AppPadding.p16.w,
              AppPadding.p20.h,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  Strings.buildMeal.tr(),
                  style: getBoldTextStyle(
                    fontSize: FontSizeManager.s24.sp,
                    color: ColorManager.backgroundSurface,
                  ).copyWith(height: 1.05),
                ),
                Gap(AppSize.s12.h),
                Text(
                  Strings.nutritionControl.tr(),
                  style: getRegularTextStyle(
                    fontSize: FontSizeManager.s14.sp,
                    color: ColorManager.backgroundSurface.withValues(
                      alpha: 0.78,
                    ),
                  ).copyWith(height: 1.25),
                ),
                const Spacer(),
                Row(
                  children: [
                    Text(
                      Strings.explore.tr(),
                      style: getBoldTextStyle(
                        fontSize: FontSizeManager.s16.sp,
                        color: ColorManager.brandAccent,
                      ).copyWith(letterSpacing: 1.2),
                    ),
                    Gap(AppSize.s4.w),
                    Icon(
                      Icons.arrow_forward_rounded,
                      color: ColorManager.brandAccent,
                      size: AppSize.s20.w,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ─── widgets/_QuickBrowseSection ─────────────────────────────────────────────

// Define categories as data, not hard-coded widgets
class _CategoryData {
  const _CategoryData({required this.title, required this.imagePath});
  final String title;
  final String imagePath;
}

class _QuickBrowseSection extends StatelessWidget {
  const _QuickBrowseSection();

  static const _categories = [
    _CategoryData(title: Strings.readyMeals, imagePath: ImageAssets.soup),
    _CategoryData(title: Strings.snacks, imagePath: ImageAssets.snacks),
    _CategoryData(title: Strings.desserts, imagePath: ImageAssets.desserts),
    _CategoryData(title: Strings.drinks, imagePath: ImageAssets.drinks),
  ];

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        SectionHeader(title: Strings.quickBrowse.tr()),
        Gap(AppSize.s20.h),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: _categories
              .map(
                (c) =>
                    CategoryItem(title: c.title.tr(), imagePath: c.imagePath),
              )
              .toList(),
        ),
      ],
    );
  }
}

// ─── widgets/_PopularPackagesSection ─────────────────────────────────────────

class _PopularPackagesSection extends StatelessWidget {
  const _PopularPackagesSection();

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<HomeBloc, HomeState>(
      builder: (context, state) => switch (state) {
        HomePopularPackagesSuccessState() => _PackageList(
          state.popularPackages.packages,
        ),
        HomeLoadingState() => const _LoadingIndicator(),
        HomeErrorState() => _ErrorMessage(state.message),
        _ => const SizedBox.shrink(),
      },
    );
  }
}

class _LoadingIndicator extends StatelessWidget {
  const _LoadingIndicator();

  @override
  Widget build(BuildContext context) => const Center(
    child: CircularProgressIndicator(color: ColorManager.brandPrimary),
  );
}

class _ErrorMessage extends StatelessWidget {
  const _ErrorMessage(this.message);

  final String message;

  @override
  Widget build(BuildContext context) => Center(
    child: Text(
      message,
      style: getRegularTextStyle(
        color: ColorManager.stateError,
        fontSize: FontSizeManager.s14.sp,
      ),
    ),
  );
}

class _PackageList extends StatelessWidget {
  const _PackageList(this.packages);

  final List<PopularPackageModel> packages;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(title: Strings.popularPackages.tr()),
        Gap(AppSize.s20.h),
        ...packages.map(
          (package) => Padding(
            padding: EdgeInsetsDirectional.only(bottom: AppSize.s16.h),
            child: PackageCard(package: package),
          ),
        ),
      ],
    );
  }
}
