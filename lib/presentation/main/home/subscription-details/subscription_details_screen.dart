import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/domain/model/subscription_checkout_model.dart';
import 'package:basic_diet/domain/model/subscription_quote_model.dart';
import 'package:basic_diet/presentation/main/home/payment-success/payment_webview_screen.dart';
import 'package:basic_diet/presentation/main/home/subscription/bloc/subscription_bloc.dart';
import 'package:basic_diet/presentation/main/home/subscription/bloc/subscription_event.dart';
import 'package:basic_diet/presentation/main/home/subscription/bloc/subscription_state.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:basic_diet/presentation/widgets/button_widget.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';
import 'package:uuid/uuid.dart';

class SubscriptionDetails extends StatelessWidget {
  static const String subscriptionDetailsRoute = '/subscription_details';
  final SubscriptionQuoteModel quote;
  final SubscriptionQuoteRequestModel quoteRequest;

  const SubscriptionDetails({
    super.key,
    required this.quote,
    required this.quoteRequest,
  });

  @override
  Widget build(BuildContext context) {
    final totalItem = _findLineItemFromQuote(quote, 'total');
    final startDate = _tryParseDate(quote.summary.plan.startDate);
    final endDate = startDate?.add(
      Duration(days: quote.summary.plan.daysCount - 1),
    );
    final deliveryNotes = quote.summary.delivery.address?.notes.trim() ?? '';

    return BlocListener<SubscriptionBloc, SubscriptionState>(
      listenWhen: (previous, current) {
        final previousStatus = previous is SubscriptionSuccess
            ? previous.checkoutStatus
            : SubscriptionCheckoutStatus.initial;
        final currentStatus = current is SubscriptionSuccess
            ? current.checkoutStatus
            : SubscriptionCheckoutStatus.initial;
        return previousStatus != currentStatus;
      },
      listener: (context, state) async {
        if (state is! SubscriptionSuccess) return;

        if (state.checkoutStatus == SubscriptionCheckoutStatus.failure &&
            state.checkoutErrorMessage != null &&
            state.checkoutErrorMessage!.isNotEmpty) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(state.checkoutErrorMessage!)));
        }

        if (state.checkoutStatus == SubscriptionCheckoutStatus.success &&
            state.subscriptionCheckout != null) {
          final result = await Navigator.push<PaymentWebViewResult>(
            context,
            MaterialPageRoute(
              builder: (_) => PaymentWebViewScreen(
                paymentUrl: state.subscriptionCheckout!.paymentUrl,
                draftId: state.subscriptionCheckout!.draftId,
                successUrl: _paymentSuccessUrl,
                backUrl: _paymentCancelUrl,
              ),
            ),
          );

          if (!context.mounted) return;

          if (result == PaymentWebViewResult.cancelled) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(Strings.paymentCancelled.tr())),
            );
          }
        }
      },
      child: Scaffold(
        backgroundColor: ColorManager.greyF3F4F6,
        appBar: _buildAppBar(context),
        bottomNavigationBar: BlocBuilder<SubscriptionBloc, SubscriptionState>(
          builder: (context, state) {
            final isCheckoutLoading =
                state is SubscriptionSuccess &&
                state.checkoutStatus == SubscriptionCheckoutStatus.loading;

            return _BottomActionBar(
              totalLabel: _displayAmount(
                label: totalItem?.amountLabel,
                fallbackAmount: totalItem?.amountSar ?? quote.totalSar,
              ),
              isLoading: isCheckoutLoading,
              onTap: isCheckoutLoading ? null : () => _submitCheckout(context),
            );
          },
        ),
        body: SafeArea(
          top: false,
          child: SingleChildScrollView(
            padding: EdgeInsetsDirectional.fromSTEB(
              AppPadding.p16.w,
              AppPadding.p16.h,
              AppPadding.p16.w,
              AppSize.s140.h,
            ),
            child: Column(
              children: [
                const _HeroBanner(),
                Gap(AppSize.s16.h),
                _PlanSection(quote: quote),
                if (quote.summary.premiumItems.isNotEmpty) ...[
                  Gap(AppSize.s16.h),
                  _PremiumMealsSection(quote: quote),
                ],
                if (quote.summary.addons.isNotEmpty) ...[
                  Gap(AppSize.s16.h),
                  _AddOnsSection(quote: quote),
                ],
                Gap(AppSize.s16.h),
                _DeliveryDetailsSection(quote: quote),
                Gap(AppSize.s16.h),
                _DeliveryScheduleSection(
                  quote: quote,
                  startDate: startDate,
                  endDate: endDate,
                ),
                Gap(AppSize.s16.h),
                _PriceBreakdownSection(quote: quote),
                if (deliveryNotes.isNotEmpty) ...[
                  Gap(AppSize.s16.h),
                  _DeliveryNotesSection(notes: deliveryNotes),
                ],
              ],
            ),
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
          Icons.arrow_back_ios_new_rounded,
          color: ColorManager.black101828,
          size: AppSize.s20.sp,
        ),
      ),
      title: Text(
        Strings.orderSummary.tr(),
        style: getBoldTextStyle(
          color: ColorManager.black101828,
          fontSize: FontSizeManager.s18.sp,
        ),
      ),
      bottom: PreferredSize(
        preferredSize: const Size.fromHeight(1),
        child: Container(height: 1, color: ColorManager.formFieldsBorderColor),
      ),
    );
  }

  void _submitCheckout(BuildContext context) {
    final request = _buildCheckoutRequest(quoteRequest);
    debugPrint('Checkout idempotencyKey: ${request.idempotencyKey}');
    context.read<SubscriptionBloc>().add(CheckoutSubscriptionEvent(request));
  }
}

class _HeroBanner extends StatelessWidget {
  const _HeroBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsetsDirectional.symmetric(
        horizontal: AppPadding.p20.w,
        vertical: AppPadding.p24.h,
      ),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppSize.s24.r),
        gradient: const LinearGradient(
          begin: AlignmentDirectional.topStart,
          end: AlignmentDirectional.bottomEnd,
          colors: [ColorManager.greenDark, ColorManager.greenPrimary],
        ),
        boxShadow: [
          BoxShadow(
            color: ColorManager.greenDark.withValues(alpha: 0.18),
            blurRadius: AppSize.s24.r,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          PositionedDirectional(
            top: -20.h,
            end: -14.w,
            child: _BannerCircle(size: AppSize.s85.w, opacity: 0.08),
          ),
          PositionedDirectional(
            bottom: -28.h,
            start: -22.w,
            child: _BannerCircle(size: AppSize.s70.w, opacity: 0.06),
          ),
          Column(
            children: [
              Container(
                width: AppSize.s60.w,
                height: AppSize.s60.w,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: ColorManager.whiteColor.withValues(alpha: 0.18),
                ),
                child: Icon(
                  Icons.check_rounded,
                  color: ColorManager.whiteColor,
                  size: AppSize.s30.sp,
                ),
              ),
              Gap(AppSize.s12.h),
              Text(
                Strings.reviewYourOrder.tr(),
                textAlign: TextAlign.center,
                style: getBoldTextStyle(
                  color: ColorManager.whiteColor,
                  fontSize: FontSizeManager.s24.sp,
                ),
              ),
              Gap(AppSize.s8.h),
              Text(
                Strings.confirmSubscriptionDetailsBelow.tr(),
                textAlign: TextAlign.center,
                style: getRegularTextStyle(
                  color: ColorManager.whiteColor.withValues(alpha: 0.82),
                  fontSize: FontSizeManager.s14.sp,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _BannerCircle extends StatelessWidget {
  final double size;
  final double opacity;

  const _BannerCircle({required this.size, required this.opacity});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: ColorManager.whiteColor.withValues(alpha: opacity),
      ),
    );
  }
}

class _PlanSection extends StatelessWidget {
  final SubscriptionQuoteModel quote;

  const _PlanSection({required this.quote});

  @override
  Widget build(BuildContext context) {
    final plan = quote.summary.plan;
    final planLineItem = _findLineItemFromQuote(quote, 'plan');

    return _SummarySectionCard(
      title: Strings.subscriptionPlan.tr(),
      icon: Icons.calendar_view_month_rounded,
      child: Padding(
        padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    plan.name,
                    style: getBoldTextStyle(
                      color: ColorManager.black101828,
                      fontSize: FontSizeManager.s17.sp,
                    ),
                  ),
                  Gap(AppSize.s10.h),
                  Wrap(
                    spacing: AppSize.s8.w,
                    runSpacing: AppSize.s8.h,
                    children: [
                      _TagChip(label: plan.daysLabel),
                      _TagChip(label: plan.gramsLabel),
                      _TagChip(label: plan.mealsLabel),
                    ],
                  ),
                ],
              ),
            ),
            Gap(AppSize.s12.w),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  _displayAmount(
                    label: planLineItem?.amountLabel,
                    fallbackAmount:
                        planLineItem?.amountSar ??
                        quote.breakdown.basePlanPriceHalala / 100,
                  ),
                  textAlign: TextAlign.end,
                  style: getBoldTextStyle(
                    color: ColorManager.greenDark,
                    fontSize: FontSizeManager.s22.sp,
                  ),
                ),
                Gap(AppSize.s4.h),
                Text(
                  Strings.basePrice.tr(),
                  style: getRegularTextStyle(
                    color: ColorManager.grey6A7282,
                    fontSize: FontSizeManager.s12.sp,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _PremiumMealsSection extends StatelessWidget {
  final SubscriptionQuoteModel quote;

  const _PremiumMealsSection({required this.quote});

  @override
  Widget build(BuildContext context) {
    final premiumLineItem = _findLineItemFromQuote(quote, 'premium');

    return _SummarySectionCard(
      title: Strings.premiumMeals.tr(),
      icon: Icons.star_border_rounded,
      trailing: premiumLineItem != null
          ? Text(
              _displayAmount(
                label: premiumLineItem.amountLabel,
                fallbackAmount: premiumLineItem.amountSar,
              ),
              style: getRegularTextStyle(
                color: ColorManager.grey6A7282,
                fontSize: FontSizeManager.s12.sp,
              ),
            )
          : null,
      child: Column(
        children: [
          for (
            int index = 0;
            index < quote.summary.premiumItems.length;
            index++
          )
            Column(
              children: [
                if (index > 0)
                  const Divider(
                    height: 1,
                    color: ColorManager.formFieldsBorderColor,
                  ),
                _PremiumMealTile(
                  item: quote.summary.premiumItems[index],
                  index: index,
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class _PremiumMealTile extends StatelessWidget {
  final SubscriptionQuotePremiumItemModel item;
  final int index;

  const _PremiumMealTile({required this.item, required this.index});

  @override
  Widget build(BuildContext context) {
    final isEven = index.isEven;
    final iconColor = isEven
        ? ColorManager.greenPrimary
        : ColorManager.orangePrimary;
    final backgroundColor = isEven
        ? ColorManager.greenPrimary.withValues(alpha: 0.12)
        : ColorManager.orangePrimary.withValues(alpha: 0.12);

    return Padding(
      padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
      child: Row(
        children: [
          Container(
            width: AppSize.s48.w,
            height: AppSize.s48.w,
            decoration: BoxDecoration(
              color: backgroundColor,
              borderRadius: BorderRadius.circular(AppSize.s14.r),
            ),
            child: Icon(
              isEven ? Icons.set_meal_rounded : Icons.restaurant_menu_rounded,
              color: iconColor,
              size: AppSize.s24.sp,
            ),
          ),
          Gap(AppSize.s12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.name,
                  style: getBoldTextStyle(
                    color: ColorManager.black101828,
                    fontSize: FontSizeManager.s14.sp,
                  ),
                ),
                Gap(AppSize.s6.h),
                Container(
                  padding: EdgeInsetsDirectional.symmetric(
                    horizontal: AppPadding.p8.w,
                    vertical: AppPadding.p4.h,
                  ),
                  decoration: BoxDecoration(
                    color: ColorManager.orangeFFF5EC,
                    borderRadius: BorderRadius.circular(AppSize.s20.r),
                  ),
                  child: Text(
                    Strings.premiumTag.tr(),
                    style: getBoldTextStyle(
                      color: ColorManager.orangePrimary,
                      fontSize: FontSizeManager.s10.sp,
                    ),
                  ),
                ),
              ],
            ),
          ),
          Gap(AppSize.s12.w),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                'x${item.qty} | ${_formatSar(item.unitPriceSar)}',
                style: getRegularTextStyle(
                  color: ColorManager.grey6A7282,
                  fontSize: FontSizeManager.s10.sp,
                ),
              ),
              Gap(AppSize.s4.h),
              Text(
                _displayAmount(
                  label: item.totalLabel,
                  fallbackAmount: item.totalSar,
                ),
                style: getBoldTextStyle(
                  color: ColorManager.black101828,
                  fontSize: FontSizeManager.s14.sp,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _AddOnsSection extends StatelessWidget {
  final SubscriptionQuoteModel quote;

  const _AddOnsSection({required this.quote});

  @override
  Widget build(BuildContext context) {
    final addOnsLineItem = _findLineItemFromQuote(quote, 'addons');

    return _SummarySectionCard(
      title: Strings.addOns.tr(),
      icon: Icons.add_circle_outline_rounded,
      trailing: addOnsLineItem != null
          ? Text(
              _displayAmount(
                label: addOnsLineItem.amountLabel,
                fallbackAmount: addOnsLineItem.amountSar,
              ),
              style: getRegularTextStyle(
                color: ColorManager.grey6A7282,
                fontSize: FontSizeManager.s12.sp,
              ),
            )
          : null,
      child: Column(
        children: [
          for (int index = 0; index < quote.summary.addons.length; index++)
            Column(
              children: [
                if (index > 0)
                  const Divider(
                    height: 1,
                    color: ColorManager.formFieldsBorderColor,
                  ),
                _AddOnTile(item: quote.summary.addons[index]),
              ],
            ),
        ],
      ),
    );
  }
}

class _AddOnTile extends StatelessWidget {
  final SubscriptionQuoteAddonModel item;

  const _AddOnTile({required this.item});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: AppSize.s8.w,
            height: AppSize.s8.w,
            margin: EdgeInsetsDirectional.only(top: AppSize.s8.h),
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              color: ColorManager.greenPrimary,
            ),
          ),
          Gap(AppSize.s12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.name,
                  style: getBoldTextStyle(
                    color: ColorManager.black101828,
                    fontSize: FontSizeManager.s14.sp,
                  ),
                ),
                Gap(AppSize.s4.h),
                Text(
                  item.formulaLabel,
                  style: getRegularTextStyle(
                    color: ColorManager.grey6A7282,
                    fontSize: FontSizeManager.s10.sp,
                  ),
                ),
              ],
            ),
          ),
          Gap(AppSize.s12.w),
          Text(
            _displayAmount(
              label: item.totalLabel,
              fallbackAmount: item.totalSar,
            ),
            style: getBoldTextStyle(
              color: ColorManager.black101828,
              fontSize: FontSizeManager.s14.sp,
            ),
          ),
        ],
      ),
    );
  }
}

class _DeliveryDetailsSection extends StatelessWidget {
  final SubscriptionQuoteModel quote;

  const _DeliveryDetailsSection({required this.quote});

  @override
  Widget build(BuildContext context) {
    final delivery = quote.summary.delivery;
    final address = delivery.address;
    final zoneValue = _joinNonEmpty([
      delivery.zoneName,
      address?.district ?? '',
      address?.city ?? '',
    ]);
    final addressValue = _buildAddressSummary(address);

    return _SummarySectionCard(
      title: Strings.deliveryDetails.tr(),
      icon: Icons.local_shipping_outlined,
      child: Column(
        children: [
          _InfoTile(
            icon: Icons.location_on_outlined,
            label: Strings.deliveryZone.tr(),
            value: zoneValue.isNotEmpty ? zoneValue : delivery.label,
          ),
          if (addressValue.isNotEmpty)
            Column(
              children: [
                const Divider(
                  height: 1,
                  color: ColorManager.formFieldsBorderColor,
                ),
                _InfoTile(
                  icon: Icons.home_outlined,
                  label: Strings.address.tr(),
                  value: addressValue,
                ),
              ],
            ),
          const Divider(height: 1, color: ColorManager.formFieldsBorderColor),
          _InfoTile(
            icon: Icons.access_time_rounded,
            label: Strings.deliveryFee.tr(),
            value: delivery.label,
            trailing: Text(
              _displayAmount(
                label: delivery.feeLabel,
                fallbackAmount: delivery.feeSar,
              ),
              style: getBoldTextStyle(
                color: ColorManager.black101828,
                fontSize: FontSizeManager.s14.sp,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DeliveryScheduleSection extends StatelessWidget {
  final SubscriptionQuoteModel quote;
  final DateTime? startDate;
  final DateTime? endDate;

  const _DeliveryScheduleSection({
    required this.quote,
    required this.startDate,
    required this.endDate,
  });

  @override
  Widget build(BuildContext context) {
    final slot = quote.summary.delivery.slot;
    final slotTitle = (slot?.label ?? '').trim().isNotEmpty
        ? slot!.label
        : ((slot?.window ?? '').trim().isNotEmpty ? slot!.window : '--');
    final slotWindow = (slot?.window ?? '').trim();

    return _SummarySectionCard(
      title: Strings.deliverySchedule.tr(),
      icon: Icons.calendar_today_outlined,
      child: Column(
        children: [
          IntrinsicHeight(
            child: Row(
              children: [
                Expanded(
                  child: _ScheduleCell(
                    label: Strings.startDate.tr(),
                    value: _formatDisplayDate(startDate),
                    subtitle: Strings.firstDelivery.tr(),
                  ),
                ),
                Container(width: 1, color: ColorManager.formFieldsBorderColor),
                Expanded(
                  child: _ScheduleCell(
                    label: Strings.endDate.tr(),
                    value: _formatDisplayDate(endDate),
                    subtitle: Strings.lastDelivery.tr(),
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: ColorManager.formFieldsBorderColor),
          Padding(
            padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const _MiniIconBadge(icon: Icons.schedule_rounded),
                Gap(AppSize.s12.w),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        Strings.timeSlot.tr(),
                        style: getRegularTextStyle(
                          color: ColorManager.grey6A7282,
                          fontSize: FontSizeManager.s10.sp,
                        ),
                      ),
                      Gap(AppSize.s4.h),
                      Text(
                        slotTitle,
                        style: getBoldTextStyle(
                          color: ColorManager.black101828,
                          fontSize: FontSizeManager.s14.sp,
                        ),
                      ),
                    ],
                  ),
                ),
                if (slotWindow.isNotEmpty && slotWindow != slotTitle)
                  Container(
                    padding: EdgeInsetsDirectional.symmetric(
                      horizontal: AppPadding.p10.w,
                      vertical: AppPadding.p6.h,
                    ),
                    decoration: BoxDecoration(
                      color: ColorManager.greenPrimary.withValues(alpha: 0.10),
                      borderRadius: BorderRadius.circular(AppSize.s20.r),
                    ),
                    child: Text(
                      slotWindow,
                      style: getBoldTextStyle(
                        color: ColorManager.greenDark,
                        fontSize: FontSizeManager.s10.sp,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PriceBreakdownSection extends StatelessWidget {
  final SubscriptionQuoteModel quote;

  const _PriceBreakdownSection({required this.quote});

  @override
  Widget build(BuildContext context) {
    final totalItem = _findLineItemFromQuote(quote, 'total');
    final otherItems = quote.summary.lineItems
        .where((item) => item.kind != 'total')
        .toList();

    return _SummarySectionCard(
      title: Strings.priceBreakdown.tr(),
      icon: Icons.attach_money_rounded,
      child: Column(
        children: [
          for (int index = 0; index < otherItems.length; index++)
            Column(
              children: [
                _PriceRow(item: otherItems[index]),
                if (index != otherItems.length - 1)
                  const Divider(
                    height: 1,
                    color: ColorManager.formFieldsBorderColor,
                  ),
              ],
            ),
          if (totalItem != null) ...[
            const Divider(height: 1, color: ColorManager.formFieldsBorderColor),
            Container(
              width: double.infinity,
              padding: EdgeInsetsDirectional.symmetric(
                horizontal: AppPadding.p16.w,
                vertical: AppPadding.p16.h,
              ),
              decoration: BoxDecoration(
                color: ColorManager.greenPrimary.withValues(alpha: 0.10),
                borderRadius: BorderRadius.only(
                  bottomLeft: Radius.circular(AppSize.s20.r),
                  bottomRight: Radius.circular(AppSize.s20.r),
                ),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      totalItem.label,
                      style: getBoldTextStyle(
                        color: ColorManager.greenDark,
                        fontSize: FontSizeManager.s16.sp,
                      ),
                    ),
                  ),
                  Text(
                    _displayAmount(
                      label: totalItem.amountLabel,
                      fallbackAmount: totalItem.amountSar,
                    ),
                    style: getBoldTextStyle(
                      color: ColorManager.greenDark,
                      fontSize: FontSizeManager.s24.sp,
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
}

class _DeliveryNotesSection extends StatelessWidget {
  final String notes;

  const _DeliveryNotesSection({required this.notes});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
      decoration: _cardDecoration,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _MiniIconBadge(icon: Icons.description_outlined),
          Gap(AppSize.s12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  Strings.deliveryNotes.tr(),
                  style: getBoldTextStyle(
                    color: ColorManager.black101828,
                    fontSize: FontSizeManager.s15.sp,
                  ),
                ),
                Gap(AppSize.s6.h),
                Text(
                  notes,
                  style: getRegularTextStyle(
                    color: ColorManager.grey6A7282,
                    fontSize: FontSizeManager.s12.sp,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _BottomActionBar extends StatelessWidget {
  final String totalLabel;
  final bool isLoading;
  final VoidCallback? onTap;

  const _BottomActionBar({
    required this.totalLabel,
    required this.isLoading,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsetsDirectional.fromSTEB(
        AppPadding.p20.w,
        AppPadding.p16.h,
        AppPadding.p20.w,
        AppPadding.p24.h,
      ),
      decoration: BoxDecoration(
        color: ColorManager.whiteColor,
        border: const Border(
          top: BorderSide(color: ColorManager.formFieldsBorderColor),
        ),
        boxShadow: [
          BoxShadow(
            color: ColorManager.blackColor.withValues(alpha: 0.06),
            blurRadius: AppSize.s20.r,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: ButtonWidget(
          radius: AppSize.s16,
          text: isLoading
              ? Strings.openingPayment.tr()
              : '${Strings.confirmAndPay.tr()} - $totalLabel',
          onTap: onTap,
        ),
      ),
    );
  }
}

class _SummarySectionCard extends StatelessWidget {
  final String title;
  final IconData icon;
  final Widget child;
  final Widget? trailing;

  const _SummarySectionCard({
    required this.title,
    required this.icon,
    required this.child,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: _cardDecoration,
      child: Column(
        children: [
          Padding(
            padding: EdgeInsetsDirectional.symmetric(
              horizontal: AppPadding.p16.w,
              vertical: AppPadding.p14.h,
            ),
            child: Row(
              children: [
                _MiniIconBadge(icon: icon),
                Gap(AppSize.s10.w),
                Expanded(
                  child: Text(
                    title,
                    style: getBoldTextStyle(
                      color: ColorManager.black101828,
                      fontSize: FontSizeManager.s15.sp,
                    ),
                  ),
                ),
                if (trailing case final Widget trailingWidget) trailingWidget,
              ],
            ),
          ),
          const Divider(height: 1, color: ColorManager.formFieldsBorderColor),
          child,
        ],
      ),
    );
  }
}

class _MiniIconBadge extends StatelessWidget {
  final IconData icon;

  const _MiniIconBadge({required this.icon});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: AppSize.s30.w,
      height: AppSize.s30.w,
      decoration: BoxDecoration(
        color: ColorManager.greenPrimary.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(AppSize.s10.r),
      ),
      child: Icon(icon, color: ColorManager.greenDark, size: AppSize.s16.sp),
    );
  }
}

class _TagChip extends StatelessWidget {
  final String label;

  const _TagChip({required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsetsDirectional.symmetric(
        horizontal: AppPadding.p10.w,
        vertical: AppPadding.p6.h,
      ),
      decoration: BoxDecoration(
        color: ColorManager.greenPrimary.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(AppSize.s20.r),
      ),
      child: Text(
        label,
        style: getBoldTextStyle(
          color: ColorManager.greenDark,
          fontSize: FontSizeManager.s10.sp,
        ),
      ),
    );
  }
}

class _InfoTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Widget? trailing;

  const _InfoTile({
    required this.icon,
    required this.label,
    required this.value,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _MiniIconBadge(icon: icon),
          Gap(AppSize.s12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: getRegularTextStyle(
                    color: ColorManager.grey6A7282,
                    fontSize: FontSizeManager.s10.sp,
                  ),
                ),
                Gap(AppSize.s4.h),
                Text(
                  value,
                  style: getBoldTextStyle(
                    color: ColorManager.black101828,
                    fontSize: FontSizeManager.s14.sp,
                  ),
                ),
              ],
            ),
          ),
          if (trailing != null) ...[Gap(AppSize.s12.w), trailing!],
        ],
      ),
    );
  }
}

class _ScheduleCell extends StatelessWidget {
  final String label;
  final String value;
  final String subtitle;

  const _ScheduleCell({
    required this.label,
    required this.value,
    required this.subtitle,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.schedule_rounded,
                color: ColorManager.greenDark,
                size: AppSize.s12.sp,
              ),
              Gap(AppSize.s4.w),
              Expanded(
                child: Text(
                  label,
                  style: getRegularTextStyle(
                    color: ColorManager.grey6A7282,
                    fontSize: FontSizeManager.s10.sp,
                  ),
                ),
              ),
            ],
          ),
          Gap(AppSize.s8.h),
          Text(
            value,
            style: getBoldTextStyle(
              color: ColorManager.black101828,
              fontSize: FontSizeManager.s16.sp,
            ),
          ),
          Gap(AppSize.s4.h),
          Text(
            subtitle,
            style: getRegularTextStyle(
              color: ColorManager.grey6A7282,
              fontSize: FontSizeManager.s10.sp,
            ),
          ),
        ],
      ),
    );
  }
}

class _PriceRow extends StatelessWidget {
  final SubscriptionQuoteLineItemModel item;

  const _PriceRow({required this.item});

  @override
  Widget build(BuildContext context) {
    final isVat = item.kind == 'vat';

    return Padding(
      padding: EdgeInsetsDirectional.symmetric(
        horizontal: AppPadding.p16.w,
        vertical: AppPadding.p14.h,
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              item.label,
              style: isVat
                  ? getRegularTextStyle(
                      color: ColorManager.grey6A7282,
                      fontSize: FontSizeManager.s12.sp,
                    )
                  : getRegularTextStyle(
                      color: ColorManager.grey4A5565,
                      fontSize: FontSizeManager.s14.sp,
                    ),
            ),
          ),
          Text(
            _displayAmount(
              label: item.amountLabel,
              fallbackAmount: item.amountSar,
            ),
            style: isVat
                ? getRegularTextStyle(
                    color: ColorManager.grey6A7282,
                    fontSize: FontSizeManager.s12.sp,
                  )
                : getBoldTextStyle(
                    color: ColorManager.black101828,
                    fontSize: FontSizeManager.s14.sp,
                  ),
          ),
        ],
      ),
    );
  }
}

BoxDecoration get _cardDecoration => BoxDecoration(
  color: ColorManager.whiteColor,
  borderRadius: BorderRadius.circular(AppSize.s20.r),
  boxShadow: [
    BoxShadow(
      color: ColorManager.blackColor.withValues(alpha: 0.04),
      blurRadius: AppSize.s16.r,
      offset: const Offset(0, 4),
    ),
  ],
);

SubscriptionQuoteLineItemModel? _findLineItemFromQuote(
  SubscriptionQuoteModel quote,
  String kind,
) {
  for (final item in quote.summary.lineItems) {
    if (item.kind == kind) {
      return item;
    }
  }
  return null;
}

DateTime? _tryParseDate(String? value) {
  if (value == null || value.trim().isEmpty) {
    return null;
  }

  return DateTime.tryParse(value);
}

String _formatDisplayDate(DateTime? date) {
  if (date == null) {
    return '--';
  }

  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  return '${months[date.month - 1]} ${date.day}, ${date.year}';
}

String _formatSar(num amount) {
  return '${_formatNumber(amount)} ${Strings.sar.tr()}';
}

String _displayAmount({String? label, required num fallbackAmount}) {
  final normalizedLabel = (label ?? '').trim();
  if (normalizedLabel.isNotEmpty) {
    return normalizedLabel;
  }

  return _formatSar(fallbackAmount);
}

String _formatNumber(num amount) {
  final isWhole = amount == amount.roundToDouble();
  final rawValue = isWhole
      ? amount.round().toString()
      : amount.toStringAsFixed(2);
  final parts = rawValue.split('.');
  final wholeNumber = parts.first;
  final buffer = StringBuffer();

  for (int index = 0; index < wholeNumber.length; index++) {
    final remaining = wholeNumber.length - index;
    buffer.write(wholeNumber[index]);
    if (remaining > 1 && remaining % 3 == 1) {
      buffer.write(',');
    }
  }

  if (parts.length == 1) {
    return buffer.toString();
  }

  return '${buffer.toString()}.${parts.last}';
}

String _joinNonEmpty(List<String> values) {
  return values.where((value) => value.trim().isNotEmpty).join(' - ');
}

String _buildAddressSummary(SubscriptionAddressModel? address) {
  if (address == null) {
    return '';
  }

  return _joinNonEmpty([
    address.street,
    if (address.building.trim().isNotEmpty) 'Building ${address.building}',
    if (address.apartment.trim().isNotEmpty) 'Apt ${address.apartment}',
    address.district,
    address.city,
  ]);
}

const String _paymentSuccessUrl = 'https://app.example.com/payments/success';
const String _paymentCancelUrl = 'https://app.example.com/payments/cancel';
const Uuid _uuid = Uuid();

SubscriptionCheckoutRequestModel _buildCheckoutRequest(
  SubscriptionQuoteRequestModel request,
) {
  return SubscriptionCheckoutRequestModel(
    idempotencyKey: _buildIdempotencyKey(request),
    planId: request.planId,
    grams: request.grams,
    mealsPerDay: request.mealsPerDay,
    startDate: request.startDate,
    premiumItems: request.premiumItems
        .map(
          (item) => SubscriptionCheckoutPremiumItemRequestModel(
            premiumMealId: item.premiumMealId,
            qty: item.qty,
          ),
        )
        .toList(),
    addons: request.addons,
    delivery: SubscriptionCheckoutDeliveryRequestModel(
      type: request.delivery.type,
      zoneId: request.delivery.zoneId,
      slotId: request.delivery.slotId,
      address: request.delivery.address,
    ),
    successUrl: _paymentSuccessUrl,
    backUrl: _paymentCancelUrl,
  );
}

String _buildIdempotencyKey(SubscriptionQuoteRequestModel request) {
  return 'checkout-${_uuid.v4()}';
}
