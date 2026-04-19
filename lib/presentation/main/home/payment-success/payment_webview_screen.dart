import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/presentation/main/home/payment-success/payment_successful_screen.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:webview_flutter/webview_flutter.dart';

enum PaymentWebViewResult { cancelled }

class PaymentWebViewScreen extends StatefulWidget {
  final String paymentUrl;
  final String successUrl;
  final String backUrl;
  final String draftId;
  /// Optional override for success behavior.
  /// When provided, called instead of navigating to PaymentSuccessfulScreen.
  final VoidCallback? onSuccess;

  const PaymentWebViewScreen({
    super.key,
    required this.paymentUrl,
    required this.successUrl,
    required this.backUrl,
    required this.draftId,
    this.onSuccess,
  });

  @override
  State<PaymentWebViewScreen> createState() => _PaymentWebViewScreenState();
}

class _PaymentWebViewScreenState extends State<PaymentWebViewScreen> {
  late final WebViewController _controller;
  int _progress = 0;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(ColorManager.whiteColor)
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (progress) {
            if (!mounted) return;
            setState(() => _progress = progress);
          },
          onNavigationRequest: (request) {
            print("+++${request.url}====++${widget.successUrl}==${_matchesCallback(request.url, widget.successUrl)}");
            if (_matchesCallback(request.url, widget.successUrl)) {
              _openSuccessScreen();
              return NavigationDecision.prevent;
            }

            if (_matchesCallback(request.url, widget.backUrl)) {
              _closeWithCancelled();
              return NavigationDecision.prevent;
            }

            return NavigationDecision.navigate;
          },
        ),
      )
      ..loadRequest(Uri.parse(widget.paymentUrl));
  }

  void _closeWithCancelled() {
    if (!mounted) return;
    Navigator.of(context).pop(PaymentWebViewResult.cancelled);
  }

  void _openSuccessScreen() {
    if (!mounted) return;
    if (widget.onSuccess != null) {
      widget.onSuccess!();
      return;
    }
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => PaymentSuccessfulScreen(draftId: widget.draftId),
      ),
    );
  }

  bool _matchesCallback(String currentUrl, String callbackUrl) {
    final current = Uri.tryParse(currentUrl);
    final callback = Uri.tryParse(callbackUrl);

    if (current == null || callback == null) {
      return currentUrl == callbackUrl;
    }

    // Compare path only (ignore query parameters and hostname differences)
    // Normalize paths and check for matching segments
    final currentPath = current.path.toLowerCase();
    final callbackPath = callback.path.toLowerCase();
    
    // Direct match
    if (currentPath == callbackPath) return true;
    
    // Check if paths share the same ending (e.g., both end with /success or /cancel)
    final currentSegments = currentPath.split('/').where((s) => s.isNotEmpty).toList();
    final callbackSegments = callbackPath.split('/').where((s) => s.isNotEmpty).toList();
    
    if (currentSegments.isEmpty || callbackSegments.isEmpty) return false;
    
    // Match if last segment is the same (e.g., both 'success' or both 'cancel')
    return currentSegments.last == callbackSegments.last;
  }

  @override
  Widget build(BuildContext context) {
    return PopScope<PaymentWebViewResult>(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        _closeWithCancelled();
      },
      child: Scaffold(
        backgroundColor: ColorManager.whiteColor,
        appBar: AppBar(
          backgroundColor: ColorManager.whiteColor,
          elevation: 0,
          leading: IconButton(
            onPressed: _closeWithCancelled,
            icon: Icon(
              Icons.close_rounded,
              color: ColorManager.black101828,
              size: 22.sp,
            ),
          ),
          title: Text(
            Strings.securePayment.tr(),
            style: getBoldTextStyle(
              color: ColorManager.black101828,
              fontSize: FontSizeManager.s18.sp,
            ),
          ),
          bottom: PreferredSize(
            preferredSize: Size.fromHeight(3.h),
            child: _progress < 100
                ? LinearProgressIndicator(
                    value: _progress / 100,
                    backgroundColor: ColorManager.formFieldsBorderColor,
                    color: ColorManager.greenPrimary,
                    minHeight: 3.h,
                  )
                : SizedBox(height: 3.h),
          ),
        ),
        body: WebViewWidget(controller: _controller),
      ),
    );
  }
}
