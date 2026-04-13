import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:flutter/material.dart';

class OrdersScreen extends StatelessWidget {
  const OrdersScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(body: Center(child: Text(Strings.orders.tr())));
  }
}
