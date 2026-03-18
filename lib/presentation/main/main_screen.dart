import 'package:basic_diet/presentation/resources/assets_manager.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:flutter_svg/flutter_svg.dart';

import 'bloc/main_bloc.dart';
import 'bloc/main_event.dart';
import 'bloc/main_state.dart';
import 'home/home_screen.dart';
import 'menu/menu_screen.dart';
import 'orders_screen.dart';
import 'plans_screen.dart';
import 'profile_screen.dart';

class MainScreen extends StatelessWidget {
  static const String mainRoute = "/main";

  const MainScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => MainBloc(),
      child: const _MainScreenContent(),
    );
  }
}

class _MainScreenContent extends StatefulWidget {
  const _MainScreenContent();

  @override
  State<_MainScreenContent> createState() => _MainScreenContentState();
}

class _MainScreenContentState extends State<_MainScreenContent> {
  late final List<Widget> _pages = [
    const HomeScreen(),
    const MenuScreen(),
    const PlansScreen(),
    const OrdersScreen(),
    const ProfileScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<MainBloc, MainState>(
      builder: (context, state) {
        return Scaffold(
          backgroundColor: ColorManager.whiteColor,
          body: _pages[state.currentIndex],
          bottomNavigationBar: BottomNavBar(
            currentIndex: state.currentIndex,
            onTap: (index) {
              context.read<MainBloc>().add(ChangeBottomNavIndexEvent(index));
            },
          ),
        );
      },
    );
  }
}

class BottomNavBar extends StatelessWidget {
  final int currentIndex;
  final Function(int) onTap;

  const BottomNavBar({
    super.key,
    required this.currentIndex,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: AppSize.s100.h,
      decoration: BoxDecoration(
        color: ColorManager.whiteColor,
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(AppSize.s50.r),
          topRight: Radius.circular(AppSize.s50.r),
        ),
        boxShadow: [
          BoxShadow(
            color: ColorManager.blackColor.withValues(alpha: 0.15),
            spreadRadius: 0,
            blurRadius: 15,
            offset: const Offset(0, 0), // shadow ABOVE the nav bar
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(AppSize.s50.r),
          topRight: Radius.circular(AppSize.s50.r),
        ),
        child: BottomNavigationBar(
          backgroundColor: ColorManager.whiteColor,
          selectedItemColor: ColorManager.greenPrimary,
          unselectedItemColor: ColorManager.grayColor,
          showUnselectedLabels: true,
          type: BottomNavigationBarType.fixed,
          currentIndex: currentIndex,
          onTap: onTap,
          items: [
            BottomNavigationBarItem(
              icon: _buildIcon(
                assetPath: IconAssets.home,
                isSelected: currentIndex == 0,
              ),
              label: Strings.home,
            ),
            BottomNavigationBarItem(
              icon: _buildIcon(
                assetPath: IconAssets.knife,
                isSelected: currentIndex == 1,
              ),
              label: Strings.menu,
            ),
            BottomNavigationBarItem(
              icon: _buildIcon(
                assetPath: IconAssets.plans,
                isSelected: currentIndex == 2,
              ),
              label: Strings.plans,
            ),
            BottomNavigationBarItem(
              icon: _buildIcon(
                assetPath: IconAssets.orders,
                isSelected: currentIndex == 3,
              ),
              label: Strings.orders,
            ),
            BottomNavigationBarItem(
              icon: _buildIcon(
                assetPath: IconAssets.profile,
                isSelected: currentIndex == 4,
              ),
              label: Strings.profile,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildIcon({required String assetPath, required bool isSelected}) {
    if (isSelected) {
      return Container(
        padding: EdgeInsets.all(AppPadding.p8.r),
        decoration: const BoxDecoration(
          color: ColorManager.greenPrimary,
          shape: BoxShape.circle,
        ),
        child: SvgPicture.asset(
          assetPath,
          colorFilter: const ColorFilter.mode(
            ColorManager.whiteColor,
            BlendMode.srcIn,
          ),
          width: AppSize.s24.w,
          height: AppSize.s24.h,
        ),
      );
    } else {
      return Padding(
        padding: EdgeInsets.all(AppPadding.p8.r),
        child: SvgPicture.asset(
          assetPath,
          colorFilter: const ColorFilter.mode(
            ColorManager.grayColor,
            BlendMode.srcIn,
          ),
          width: AppSize.s24.w,
          height: AppSize.s24.h,
        ),
      );
    }
  }
}
