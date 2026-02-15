import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

bool isTextNotEmpty(String text) => text.isNotEmpty;

bool isPasswordValid(String password) => password.isNotEmpty;

bool isPhoneValid(String phone) => phone.isNotEmpty;

bool isNumberNotZero(int number) => number != 0;

Future<void> openUrl(String link) async {
  final Uri url = Uri.parse(link);
  if (!await launchUrl(url)) throw 'Could not launch $url';
}

final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();
