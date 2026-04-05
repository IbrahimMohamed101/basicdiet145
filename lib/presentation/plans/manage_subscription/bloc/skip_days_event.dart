import 'package:equatable/equatable.dart';

abstract class SkipDaysEvent extends Equatable {
  const SkipDaysEvent();

  @override
  List<Object?> get props => [];
}

class SkipSingleDayEvent extends SkipDaysEvent {
  final String id;
  final String date;

  const SkipSingleDayEvent(this.id, this.date);

  @override
  List<Object?> get props => [id, date];
}

class SkipDateRangeEvent extends SkipDaysEvent {
  final String id;
  final String startDate;
  final String endDate;

  const SkipDateRangeEvent(this.id, this.startDate, this.endDate);

  @override
  List<Object?> get props => [id, startDate, endDate];
}
