import 'package:basic_diet/presentation/resources/assets_manager.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class MealPlannerScreen extends StatefulWidget {
  const MealPlannerScreen({super.key});

  @override
  State<MealPlannerScreen> createState() => _MealPlannerScreenState();
}

class _MealPlannerScreenState extends State<MealPlannerScreen> {
  int _selectedDayIndex = 0;
  int _selectedCategoryIndex = 0;
  final int _maxMeals = 2;
  bool _showSavedBanner = false;
  String _lastAddedMealName = "";

  final Map<int, List<String>> _selectedMealsPerDay = {
    0: [],
    1: [],
    2: [],
    3: [],
  };

  Map<int, List<String>> _savedSelections = {0: [], 1: [], 2: [], 3: []};

  int get _selectedMealsForDay =>
      _selectedMealsPerDay[_selectedDayIndex]?.length ?? 0;

  bool get _isDirty {
    for (int i = 0; i < 4; i++) {
      var current = _selectedMealsPerDay[i] ?? [];
      var saved = _savedSelections[i] ?? [];
      if (current.length != saved.length) return true;
      for (var id in current) {
        if (!saved.contains(id)) return true;
      }
    }
    return false;
  }

  final List<Map<String, dynamic>> _days = [
    {
      "name": "Mon",
      "fullName": "Monday",
      "date": "Apr 6",
      "status": "Planned",
      "locked": false,
      "isComplete": false,
    },
    {
      "name": "Tue",
      "fullName": "Tuesday",
      "date": "Apr 7",
      "status": "Planned",
      "locked": false,
      "isComplete": false,
    },
    {
      "name": "Wed",
      "fullName": "Wednesday",
      "date": "Apr 8",
      "status": "Planned",
      "locked": false,
      "isComplete": false,
    },
    {
      "name": "Thu",
      "fullName": "Thursday",
      "date": "Apr 9",
      "status": "Locked",
      "locked": true,
      "isComplete": false,
    },
  ];

  final List<Map<String, dynamic>> _categories = [
    {
      "name": Strings.lunch,
      "count": 4,
      "icon": ImageAssets.soup,
    }, // using mockup
    {"name": Strings.dinner, "count": 4, "icon": ImageAssets.salad},
    {"name": Strings.snacks, "count": 4, "icon": ImageAssets.snacks},
    {
      "name": Strings.premiumMealsText,
      "count": 4,
      "icon": Icons.star,
      "isPremium": true,
    },
  ];

  final List<Map<String, dynamic>> _meals = [
    {
      "id": "1",
      "name": "Grilled Chicken Salad",
      "description":
          "Fresh mixed greens with grilled chicken breast, cherry tomatoes, and balsamic",
      "protein": "35g",
      "carbs": "12g",
      "fat": "8g",
      "price": "\$12.99",
      "image": ImageAssets.salad,
      "isPremium": false,
      "isSelected": false,
    },
    {
      "id": "2",
      "name": "Quinoa Power Bowl",
      "description":
          "Protein-packed quinoa with roasted vegetables, chickpeas, and tahini dressing",
      "protein": "18g",
      "carbs": "45g",
      "fat": "14g",
      "price": "\$11.99",
      "image": ImageAssets.salad, // reusable
      "isPremium": false,
      "isSelected": false,
    },
    {
      "id": "3",
      "name": "Turkey Club Sandwich",
      "description":
          "Sliced turkey breast, crispy bacon, lettuce, tomato on whole grain bread",
      "protein": "32g",
      "carbs": "38g",
      "fat": "12g",
      "price": "\$10.99",
      "image": ImageAssets.salad,
      "isPremium": false,
      "isSelected": false,
    },
  ];

  final List<Map<String, dynamic>> _premiumMealsList = [
    {
      "id": "p1",
      "name": "Lobster Tail Dinner",
      "description":
          "Butter-poached lobster tail with truffle risotto and grilled asparagus",
      "protein": "38g",
      "carbs": "28g",
      "fat": "24g",
      "price": "\$34.99",
      "image": ImageAssets.salad,
      "isPremium": true,
      "isSelected": false,
    },
    {
      "id": "p2",
      "name": "Wagyu Ribeye",
      "description":
          "10oz Japanese A5 wagyu ribeye with roasted fingerling potatoes",
      "protein": "52g",
      "carbs": "22g",
      "fat": "42g",
      "price": "\$49.99",
      "image": ImageAssets.salad,
      "isPremium": true,
      "isSelected": false,
    },
    {
      "id": "p3",
      "name": "Truffle Pasta",
      "description":
          "Fresh tagliatelle with black truffle shavings, parmesan, and truffle oil",
      "protein": "18g",
      "carbs": "48g",
      "fat": "28g",
      "price": "\$29.99",
      "image": ImageAssets.salad,
      "isPremium": true,
      "isSelected": false,
      "notAvailable": true,
    },
  ];

  void _toggleMeal(Map<String, dynamic> meal) {
    if (meal['notAvailable'] == true) return;

    setState(() {
      final mealId = meal['id'];
      final currentSelected = _selectedMealsPerDay[_selectedDayIndex] ?? [];

      if (currentSelected.contains(mealId)) {
        currentSelected.remove(mealId);
      } else {
        if (currentSelected.length < _maxMeals) {
          currentSelected.add(mealId);
          _showTopBanner(meal['name']);
        }
      }
      _selectedMealsPerDay[_selectedDayIndex] = currentSelected;
      _days[_selectedDayIndex]['isComplete'] =
          currentSelected.length == _maxMeals;
    });
  }

  void _showTopBanner(String mealName) {
    setState(() {
      _lastAddedMealName = mealName;
      _showSavedBanner = true;
    });
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) {
        setState(() {
          _showSavedBanner = false;
        });
      }
    });
  }

  void _saveChanges() {
    setState(() {
      _savedSelections = _selectedMealsPerDay.map(
        (key, value) => MapEntry(key, List.from(value)),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    List<Map<String, dynamic>> activeMeals = _selectedCategoryIndex == 3
        ? _premiumMealsList
        : _meals;
    bool isPremiumCategory = _selectedCategoryIndex == 3;

    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Stack(
          children: [
            SingleChildScrollView(
              padding: EdgeInsets.only(bottom: 120.h),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildHeader(),
                  Gap(AppSize.s16.h),
                  _buildDateSelector(),
                  Gap(AppSize.s16.h),
                  _buildBlueBanner(),
                  Gap(AppSize.s16.h),
                  _buildProgressSection(),
                  Gap(AppSize.s16.h),
                  _buildPremiumBanner(),
                  Gap(AppSize.s16.h),
                  _buildCategorySelector(),
                  Gap(AppSize.s16.h),
                  if (isPremiumCategory) _buildPremiumMealsAvailableBanner(),
                  _buildMealList(activeMeals),
                ],
              ),
            ),
            _buildBottomAction(),
            _buildTopNotificationBanner(),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: AppPadding.p16.w),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            Strings.mealPlanner,
            style: getBoldTextStyle(
              color: ColorManager.black101828,
              fontSize: FontSizeManager.s24.sp,
            ),
          ),
          Gap(AppSize.s4.h),
          Text(
            Strings.planMealsWeekAhead,
            style: getRegularTextStyle(
              color: ColorManager.grey6A7282,
              fontSize: FontSizeManager.s14.sp,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTopNotificationBanner() {
    return AnimatedPositioned(
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeInOut,
      top: _showSavedBanner ? AppPadding.p16.h : -100.h,
      left: AppPadding.p16.w,
      right: AppPadding.p16.w,
      child: Material(
        color: Colors.transparent,
        child: Container(
          padding: EdgeInsets.all(AppPadding.p12.w),
          decoration: BoxDecoration(
            color: const Color(0xFFF0FDF4),
            border: Border.all(color: const Color(0xFFBBF7D0)),
            borderRadius: BorderRadius.circular(AppSize.s8.r),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.05),
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Row(
            children: [
              Container(
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  color: Color(0xFF16A34A),
                ),
                padding: EdgeInsets.all(4.w),
                child: Icon(
                  Icons.check,
                  color: Colors.white,
                  size: AppSize.s14.w,
                ),
              ),
              Gap(AppSize.s12.w),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      Strings.mealAdded,
                      style: getRegularTextStyle(
                        color: const Color(0xFF166534),
                        fontSize: FontSizeManager.s14.sp,
                      ),
                    ),
                    Text(
                      "$_lastAddedMealName ${Strings.addedTo} ${_days[_selectedDayIndex]['fullName']}",
                      style: getRegularTextStyle(
                        color: const Color(0xFF166534),
                        fontSize: FontSizeManager.s14.sp,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDateSelector() {
    return SizedBox(
      height: 100.h,
      child: ListView.separated(
        padding: EdgeInsets.symmetric(
          horizontal: AppPadding.p16.w,
          vertical: 8.h,
        ),
        scrollDirection: Axis.horizontal,
        itemCount: _days.length,
        separatorBuilder: (context, index) => Gap(AppSize.s12.w),
        itemBuilder: (context, index) {
          final day = _days[index];
          final isSelected = index == _selectedDayIndex;
          final isLocked = day['locked'];
          final isComplete = _selectedMealsPerDay[index]?.length == _maxMeals;

          Color borderColor = isSelected
              ? ColorManager.bluePrimary
              : ColorManager.formFieldsBorderColor;
          Color bgColor = isSelected
              ? ColorManager.bluePrimary.withValues(alpha: 0.05)
              : Colors.white;
          Color textColor = isLocked
              ? ColorManager.grey9CA3AF
              : ColorManager.black101828;

          if (isComplete) {
            bgColor = ColorManager.greenPrimary;
            borderColor = Colors.transparent;
            textColor = Colors.white;
          } else if (isLocked) {
            borderColor = ColorManager.formFieldsBorderColor;
            bgColor = Colors.white;
          }

          Color pillBgColor = isLocked
              ? ColorManager.grey9CA3AF
              : ColorManager.bluePrimary;

          return GestureDetector(
            onTap: () {
              if (!isLocked) {
                setState(() {
                  _selectedDayIndex = index;
                });
              }
            },
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  width: 70.w,
                  height: 90.h,
                  decoration: BoxDecoration(
                    color: bgColor,
                    borderRadius: BorderRadius.circular(AppSize.s16.r),
                    border: Border.all(color: borderColor),
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        day['name'],
                        style: getRegularTextStyle(
                          color: textColor,
                          fontSize: FontSizeManager.s12.sp,
                        ),
                      ),
                      Text(
                        day['date'],
                        style: getBoldTextStyle(
                          color: textColor,
                          fontSize: FontSizeManager.s14.sp,
                        ),
                      ),
                      Gap(AppSize.s8.h),
                      Container(
                        padding: EdgeInsets.symmetric(
                          horizontal: 8.w,
                          vertical: 2.h,
                        ),
                        decoration: BoxDecoration(
                          color: pillBgColor,
                          borderRadius: BorderRadius.circular(12.r),
                        ),
                        child: Text(
                          day['status'],
                          style: getRegularTextStyle(
                            color: Colors.white,
                            fontSize: FontSizeManager.s10.sp,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                if (isComplete)
                  Positioned(
                    top: -6.h,
                    right: -6.w,
                    child: Container(
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: ColorManager.greenPrimary,
                        border: Border.all(color: Colors.white, width: 2.w),
                      ),
                      padding: EdgeInsets.all(4.w),
                      child: Icon(Icons.check, color: Colors.white, size: 14.w),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildBlueBanner() {
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: AppPadding.p16.w),
      child: Container(
        padding: EdgeInsets.symmetric(
          horizontal: AppPadding.p16.w,
          vertical: AppPadding.p12.h,
        ),
        decoration: BoxDecoration(
          color: ColorManager.bluePrimary,
          borderRadius: BorderRadius.circular(AppSize.s8.r),
        ),
        child: Row(
          children: [
            Icon(
              Icons.calendar_today,
              color: Colors.white,
              size: AppSize.s18.w,
            ),
            Gap(AppSize.s8.w),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  Strings.planningFor,
                  style: getRegularTextStyle(
                    color: Colors.white70,
                    fontSize: FontSizeManager.s10.sp,
                  ),
                ),
                Text(
                  "${_days[_selectedDayIndex]['fullName']}, ${_days[_selectedDayIndex]['date']}",
                  style: getBoldTextStyle(
                    color: Colors.white,
                    fontSize: FontSizeManager.s14.sp,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildProgressSection() {
    bool isComplete = _selectedMealsForDay == _maxMeals;

    return Padding(
      padding: EdgeInsets.symmetric(horizontal: AppPadding.p16.w),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    Strings.dailyMeals,
                    style: getRegularTextStyle(
                      color: ColorManager.grey6A7282,
                      fontSize: FontSizeManager.s12.sp,
                    ),
                  ),
                  Row(
                    children: [
                      Text(
                        "$_selectedMealsForDay",
                        style: getBoldTextStyle(
                          color: ColorManager.black101828,
                          fontSize: FontSizeManager.s20.sp,
                        ),
                      ),
                      Text(
                        " ${Strings.of} $_maxMeals ${Strings.selected}",
                        style: getBoldTextStyle(
                          color: ColorManager.grey9CA3AF,
                          fontSize: FontSizeManager.s20.sp,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              if (isComplete)
                Container(
                  padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 4.h),
                  decoration: BoxDecoration(
                    color: ColorManager.greenPrimary.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(AppSize.s16.r),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.circle,
                        color: ColorManager.greenPrimary,
                        size: 8.w,
                      ),
                      Gap(4.w),
                      Text(
                        Strings.complete,
                        style: getRegularTextStyle(
                          color: ColorManager.greenPrimary,
                          fontSize: FontSizeManager.s12.sp,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
          Gap(AppSize.s8.h),
          LinearProgressIndicator(
            value: _selectedMealsForDay / _maxMeals,
            backgroundColor: ColorManager.formFieldsBorderColor,
            valueColor: AlwaysStoppedAnimation<Color>(
              isComplete ? ColorManager.greenPrimary : ColorManager.bluePrimary,
            ),
            minHeight: 4.h,
            borderRadius: BorderRadius.circular(4.r),
          ),
          if (isComplete) ...[
            Gap(AppSize.s8.h),
            Container(
              padding: EdgeInsets.all(AppPadding.p12.w),
              decoration: BoxDecoration(
                color: ColorManager.orangePrimary.withValues(alpha: 0.05),
                borderRadius: BorderRadius.circular(AppSize.s8.r),
                border: Border.all(
                  color: ColorManager.orangePrimary.withValues(alpha: 0.2),
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.error_outline,
                    color: ColorManager.orangePrimary,
                    size: 16.w,
                  ),
                  Gap(AppSize.s8.w),
                  Expanded(
                    child: Text(
                      Strings.mealLimitReached,
                      style: getRegularTextStyle(
                        color: ColorManager.orangePrimary,
                        fontSize: FontSizeManager.s12.sp,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildPremiumBanner() {
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: AppPadding.p16.w),
      child: Container(
        padding: EdgeInsets.symmetric(
          horizontal: AppPadding.p16.w,
          vertical: AppPadding.p12.h,
        ),
        decoration: BoxDecoration(
          color: ColorManager.orangeFFF5EC,
          borderRadius: BorderRadius.circular(AppSize.s8.r),
          border: Border.all(color: ColorManager.orangeLight),
        ),
        child: Row(
          children: [
            Container(
              padding: EdgeInsets.all(4.w),
              decoration: BoxDecoration(
                color: ColorManager.orangePrimary,
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.star, color: Colors.white, size: AppSize.s14.w),
            ),
            Gap(AppSize.s12.w),
            Expanded(
              child: Text(
                Strings.premiumMealsRemaining,
                style: getBoldTextStyle(
                  color: ColorManager.black101828,
                  fontSize: FontSizeManager.s14.sp,
                ),
              ),
            ),
            Text(
              "4 ",
              style: getBoldTextStyle(
                color: ColorManager.orangePrimary,
                fontSize: FontSizeManager.s16.sp,
              ),
            ),
            Text(
              Strings.left,
              style: getRegularTextStyle(
                color: ColorManager.orangePrimary,
                fontSize: FontSizeManager.s12.sp,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCategorySelector() {
    return SizedBox(
      height: 40.h,
      child: ListView.separated(
        padding: EdgeInsets.symmetric(horizontal: AppPadding.p16.w),
        scrollDirection: Axis.horizontal,
        itemCount: _categories.length,
        separatorBuilder: (context, index) => Gap(AppSize.s8.w),
        itemBuilder: (context, index) {
          final category = _categories[index];
          final isSelected = index == _selectedCategoryIndex;
          final isPremium = category['isPremium'] == true;

          Color bgColor = ColorManager.greyF3F4F6;
          Color textColor = ColorManager.black101828;
          Color iconColor = ColorManager.grey6A7282;

          if (isSelected) {
            bgColor = isPremium
                ? ColorManager.orangePrimary
                : ColorManager.greenPrimary;
            textColor = Colors.white;
            iconColor = Colors.white;
          }

          return GestureDetector(
            onTap: () {
              setState(() {
                _selectedCategoryIndex = index;
              });
            },
            child: Container(
              padding: EdgeInsets.symmetric(horizontal: AppPadding.p12.w),
              decoration: BoxDecoration(
                color: bgColor,
                borderRadius: BorderRadius.circular(AppSize.s8.r),
              ),
              child: Row(
                children: [
                  if (category['icon'] is IconData)
                    Icon(
                      category['icon'],
                      color: iconColor,
                      size: AppSize.s16.w,
                    )
                  else
                    Image.asset(
                      category['icon'],
                      width: 16.w,
                      height: 16.w,
                      color: isSelected ? Colors.white : null,
                    ),
                  Gap(AppSize.s8.w),
                  Text(
                    category['name'],
                    style: getBoldTextStyle(
                      color: textColor,
                      fontSize: FontSizeManager.s14.sp,
                    ),
                  ),
                  Gap(AppSize.s8.w),
                  Container(
                    padding: EdgeInsets.all(4.w),
                    decoration: BoxDecoration(
                      color: isSelected
                          ? Colors.white.withValues(alpha: 0.2)
                          : Colors.white,
                      shape: BoxShape.circle,
                    ),
                    child: Text(
                      "${category['count']}",
                      style: getRegularTextStyle(
                        color: textColor,
                        fontSize: FontSizeManager.s10.sp,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildPremiumMealsAvailableBanner() {
    return Padding(
      padding: EdgeInsets.only(
        left: AppPadding.p16.w,
        right: AppPadding.p16.w,
        bottom: AppPadding.p16.h,
      ),
      child: Container(
        padding: EdgeInsets.all(AppPadding.p16.w),
        decoration: BoxDecoration(
          color: ColorManager.orangeFFF5EC,
          borderRadius: BorderRadius.circular(AppSize.s8.r),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: EdgeInsets.all(8.w),
              decoration: BoxDecoration(
                color: ColorManager.orangePrimary,
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.star_border,
                color: Colors.white,
                size: AppSize.s24.w,
              ),
            ),
            Gap(AppSize.s12.w),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    Strings.premiumMealsAvailable,
                    style: getBoldTextStyle(
                      color: ColorManager.black101828,
                      fontSize: FontSizeManager.s14.sp,
                    ),
                  ),
                  Gap(AppSize.s4.h),
                  RichText(
                    text: TextSpan(
                      style: getRegularTextStyle(
                        color: ColorManager.grey6A7282,
                        fontSize: FontSizeManager.s12.sp,
                      ),
                      children: [
                        TextSpan(text: "${Strings.youHave} "),
                        TextSpan(
                          text: "4 ${Strings.premiumMealsText.toLowerCase()} ",
                          style: getBoldTextStyle(
                            color: ColorManager.orangePrimary,
                            fontSize: FontSizeManager.s12.sp,
                          ),
                        ),
                        TextSpan(text: Strings.remainingSelectPremium),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMealList(List<Map<String, dynamic>> meals) {
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: AppPadding.p16.w),
      child: Column(
        children: meals
            .map(
              (meal) => Padding(
                padding: EdgeInsets.only(bottom: AppSize.s16.h),
                child: _buildMealCard(meal),
              ),
            )
            .toList(),
      ),
    );
  }

  Widget _buildMealCard(Map<String, dynamic> meal) {
    bool isSelected =
        _selectedMealsPerDay[_selectedDayIndex]?.contains(meal['id']) ?? false;
    bool isPremium = meal['isPremium'];

    bool isMaxReached =
        (_selectedMealsPerDay[_selectedDayIndex]?.length ?? 0) >= _maxMeals;
    bool isNotAvailable =
        meal['notAvailable'] == true || (isMaxReached && !isSelected);

    return GestureDetector(
      onTap: isNotAvailable ? null : () => _toggleMeal(meal),
      child: Opacity(
        opacity: isNotAvailable ? 0.5 : 1.0,
        child: Container(
          decoration: BoxDecoration(
            color: isSelected
                ? ColorManager.greenPrimary.withValues(alpha: 0.05)
                : const Color(0xFFFFFFFF),
            borderRadius: BorderRadius.circular(14.r),
            border: Border.all(
              color: isSelected
                  ? ColorManager.greenPrimary
                  : const Color(0xFFE5E7EB),
              width: 1.25.w,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Stack(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.vertical(
                      top: Radius.circular(AppSize.s14.r),
                    ),
                    child: Image.asset(
                      meal['image'],
                      height: 150.h,
                      width: double.infinity,
                      fit: BoxFit.cover,
                    ),
                  ),
                  if (isPremium)
                    Positioned(
                      top: 12.h,
                      left: 12.w,
                      child: Container(
                        padding: EdgeInsets.symmetric(
                          horizontal: 8.w,
                          vertical: 4.h,
                        ),
                        decoration: BoxDecoration(
                          color: ColorManager.orangePrimary,
                          borderRadius: BorderRadius.circular(16.r),
                        ),
                        child: Text(
                          "PREMIUM",
                          style: getBoldTextStyle(
                            color: Colors.white,
                            fontSize: FontSizeManager.s10.sp,
                          ),
                        ),
                      ),
                    ),
                  if (isSelected)
                    Positioned(
                      top: 12.h,
                      right: 12.w,
                      child: Container(
                        decoration: const BoxDecoration(
                          color: Colors.white,
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          Icons.check_circle,
                          color: ColorManager.greenPrimary,
                          size: 28.w,
                        ),
                      ),
                    ),
                ],
              ),
              Padding(
                padding: EdgeInsets.all(AppPadding.p16.w),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      meal['name'],
                      style: TextStyle(
                        fontFamily: 'Inter',
                        fontWeight: FontWeight.w600,
                        fontSize: 16.sp,
                        height: 24 / 16,
                        color: const Color(0xFF101828),
                      ),
                    ),
                    Gap(AppSize.s8.h),
                    Text(
                      meal['description'],
                      style: TextStyle(
                        fontFamily: 'Inter',
                        fontWeight: FontWeight.w400,
                        fontSize: 14.sp,
                        height: 20 / 14,
                        color: const Color(0xFF4A5565),
                      ),
                    ),
                    Gap(AppSize.s12.h),
                    Row(
                      children: [
                        _buildMacroItem(
                          ColorManager.bluePrimary,
                          "${meal['protein']}",
                          "protein",
                        ),
                        Gap(AppSize.s12.w),
                        _buildMacroItem(
                          ColorManager.orangePrimary,
                          "${meal['carbs']}",
                          "carbs",
                        ),
                        Gap(AppSize.s12.w),
                        _buildMacroItem(
                          ColorManager.greenPrimary,
                          "${meal['fat']}",
                          "fat",
                        ),
                      ],
                    ),
                    Gap(AppSize.s16.h),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          meal['price'],
                          style: TextStyle(
                            fontFamily: 'Inter',
                            fontWeight: FontWeight.w700,
                            fontSize: 18.sp,
                            height: 28 / 18,
                            color: const Color(0xFF101828),
                          ),
                        ),
                        if (isNotAvailable)
                          Text(
                            Strings.notAvailable,
                            style: getRegularTextStyle(
                              color: ColorManager.errorColor,
                              fontSize: FontSizeManager.s12.sp,
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMacroItem(Color color, String value, String label) {
    return Row(
      children: [
        Icon(Icons.circle, color: color, size: 6.w),
        Gap(4.w),
        RichText(
          text: TextSpan(
            children: [
              TextSpan(
                text: value,
                style: TextStyle(
                  fontFamily: 'Inter',
                  fontWeight: FontWeight.w600,
                  fontSize: 12.sp,
                  height: 16 / 12,
                  color: const Color(0xFF4A5565),
                ),
              ),
              TextSpan(
                text: " $label",
                style: TextStyle(
                  fontFamily: 'Inter',
                  fontWeight: FontWeight.w400,
                  fontSize: 12.sp,
                  height: 16 / 12,
                  color: const Color(0xFF4A5565),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildBottomAction() {
    final bool canSave =
        _isDirty && _selectedMealsPerDay.values.any((l) => l.isNotEmpty);

    return Align(
      alignment: Alignment.bottomCenter,
      child: Container(
        padding: EdgeInsets.all(AppPadding.p16.w),
        decoration: BoxDecoration(
          color: Colors.white,
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.05),
              blurRadius: 10,
              offset: const Offset(0, -5),
            ),
          ],
        ),
        child: SafeArea(
          child: SizedBox(
            width: double.infinity,
            height: 50.h,
            child: ElevatedButton(
              onPressed: canSave ? _saveChanges : null,
              style: ElevatedButton.styleFrom(
                backgroundColor: canSave
                    ? ColorManager.greenPrimary
                    : ColorManager.greyF3F4F6,
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppSize.s8.r),
                ),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    canSave ? Icons.save : Icons.save_outlined,
                    color: canSave ? Colors.white : ColorManager.grey9CA3AF,
                    size: AppSize.s20.w,
                  ),
                  Gap(AppSize.s8.w),
                  Text(
                    canSave ? Strings.saveChanges : Strings.noChangesToSave,
                    style: getBoldTextStyle(
                      color: canSave ? Colors.white : ColorManager.grey9CA3AF,
                      fontSize: FontSizeManager.s16.sp,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
