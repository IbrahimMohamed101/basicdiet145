import 'package:basic_diet/app/app_pref.dart';
import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/presentation/register/register_screen.dart';
import 'package:basic_diet/presentation/resources/assets_manager.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:basic_diet/presentation/widgets/button_widget.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';
import 'package:go_router/go_router.dart';

// Models - Single Responsibility: Data representation
class OnboardingPageContent {
  final String title;
  final String subtitle;
  final String imagePath;

  const OnboardingPageContent({
    required this.title,
    required this.subtitle,
    required this.imagePath,
  });
}

// Main Screen
class OnboardingScreen extends StatefulWidget {
  static const String routeName = "/onboarding";

  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  late final PageController _pageController;
  int _currentPageIndex = 0;

  final List<OnboardingPageContent> _onboardingPages = const [
    OnboardingPageContent(
      title: Strings.slide1FullTitle,
      subtitle: Strings.slide1Description,
      imagePath: ImageAssets.onBoarding1,
    ),
    OnboardingPageContent(
      title: Strings.slide2FullTitle,
      subtitle: Strings.slide2Description,
      imagePath: ImageAssets.onBoarding2,
    ),
  ];

  @override
  void initState() {
    super.initState();
    _pageController = PageController();
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  bool get _isLastPage => _currentPageIndex == _onboardingPages.length - 1;

  void _handlePageChanged(int pageIndex) {
    setState(() {
      _currentPageIndex = pageIndex;
    });
  }

  void _handleContinueButtonPressed() {
    if (_isLastPage) {
      _navigateToRegister();
    } else {
      _navigateToNextPage();
    }
  }

  void _navigateToNextPage() {
    _pageController.animateToPage(
      _currentPageIndex + 1,
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeIn,
    );
  }

  void _navigateToRegister() async {
    final appPreferences = instance<AppPreferences>();
    await appPreferences.setOnboardingScreenViewed();
    if (mounted) {
      context.push(RegisterScreen.registerRoute);
    }
  }

  String get _buttonText => _isLastPage
      ? Strings.buttonGetStartedWithArrow
      : Strings.buttonContinueWithArrow;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: ColorManager.whiteColor,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(child: _buildPageView()),
            Gap(AppSize.s10.h),
            _buildPageIndicator(),
            Gap(AppSize.s40.h),
            _buildContinueButton(),
            Gap(AppSize.s20.h),
          ],
        ),
      ),
    );
  }

  Widget _buildPageView() {
    return PageView.builder(
      controller: _pageController,
      itemCount: _onboardingPages.length,
      onPageChanged: _handlePageChanged,
      itemBuilder: (context, index) {
        return OnboardingPageView(pageContent: _onboardingPages[index]);
      },
    );
  }

  Widget _buildPageIndicator() {
    return OnboardingPageIndicator(
      pageCount: _onboardingPages.length,
      currentPageIndex: _currentPageIndex,
    );
  }

  Widget _buildContinueButton() {
    return Padding(
      padding: EdgeInsetsDirectional.symmetric(horizontal: AppPadding.p20.w),
      child: ButtonWidget(
        radius: AppSize.s12,
        text: _buttonText,
        onTap: _handleContinueButtonPressed,
      ),
    );
  }
}

// Extracted Widget - Single Responsibility: Display page indicator
class OnboardingPageIndicator extends StatelessWidget {
  final int pageCount;
  final int currentPageIndex;

  const OnboardingPageIndicator({
    super.key,
    required this.pageCount,
    required this.currentPageIndex,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(
        pageCount,
        (index) => _PageIndicatorDot(isActive: currentPageIndex == index),
      ),
    );
  }
}

class _PageIndicatorDot extends StatelessWidget {
  final bool isActive;

  const _PageIndicatorDot({required this.isActive});

  static const Duration _animationDuration = Duration(milliseconds: 300);
  static const double _inactiveSize = AppSize.s8;
  static const double _activeWidth = AppSize.s25;
  static const Color _inactiveColor = Color(0xffD9D9D9);

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: _animationDuration,
      margin: EdgeInsetsDirectional.symmetric(horizontal: AppSize.s4.w),
      height: _inactiveSize.h,
      width: isActive ? _activeWidth.w : _inactiveSize.w,
      decoration: BoxDecoration(
        color: isActive ? ColorManager.greenPrimary : _inactiveColor,
        borderRadius: BorderRadius.circular(AppSize.s10),
      ),
    );
  }
}

// Extracted Widget - Single Responsibility: Display individual page content
class OnboardingPageView extends StatelessWidget {
  final OnboardingPageContent pageContent;

  const OnboardingPageView({super.key, required this.pageContent});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.start,
        children: [
          Gap(AppSize.s20.h),
          _buildPageImage(),
          Gap(AppSize.s40.h),
          _buildTitle(),
          Gap(AppSize.s20.h),
          _buildSubtitle(),
        ],
      ),
    );
  }

  Widget _buildPageImage() {
    return Padding(
      padding: EdgeInsetsDirectional.symmetric(horizontal: AppPadding.p20.w),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppSize.s20),
        child: Image.asset(pageContent.imagePath),
      ),
    );
  }

  Widget _buildTitle() {
    return Text(
      pageContent.title,
      textAlign: TextAlign.center,
      style: getBoldTextStyle(
        color: ColorManager.blackColor,
        fontSize: AppSize.s24.sp,
      ),
    );
  }

  Widget _buildSubtitle() {
    return Padding(
      padding: EdgeInsetsDirectional.all(AppPadding.p8.w),
      child: Text(
        pageContent.subtitle,
        textAlign: TextAlign.center,
        style: getRegularTextStyle(
          color: ColorManager.grayColor,
          fontSize: AppSize.s16.sp,
        ),
      ),
    );
  }
}
