# Screen Contract: 17_RESTAURANT_HOURS

## 1. Screen Purpose
Provides configuration of restaurant operational hours, weekly schedule settings, delivery window slots, cutoff times (ordering deadline), and temporary closure state.

## 2. Dashboard Route
`/restaurant-hours`

## 3. Visible UI Requirements
* Main operating hours (Open Time, Close Time).
* Master switch toggle: Restaurant Open vs Closed (Emergency manual override).
* Delivery windows checklist / editor (e.g. `08:00-11:00`, `12:00-15:00`).
* Cutoff time input (e.g. `14:00`).
* Temporary closure calendar or text configuration.
* Weekly schedule grid (opening/closing hours for Saturday through Friday).

## 4. Backend Endpoints
* `GET /api/dashboard/settings/restaurant-hours` (fetches operating hours and configs)
* `PUT /api/dashboard/settings/restaurant-hours` (updates operating hours, scheduled days, cutoff, and windows)

## 5. Request Parameters
* Body (PUT):
  * `restaurant_open_time` (required, string, `HH:MM` format)
  * `restaurant_close_time` (required, string, `HH:MM` format)
  * `delivery_windows` (optional, array of string patterns)
  * `cutoff_time` (optional, string, `HH:MM`)
  * `restaurant_is_open` (optional, boolean)
  * `weekly_schedule` (optional, array of day schedule objects)
  * `temporary_closure` (optional, object or null)

## 6. Response Fields Required
* `status` (boolean): success status.
* `data` (object):
  * `timezone` (string): e.g. "Asia/Riyadh".
  * `restaurant_open_time` (string)
  * `restaurant_close_time` (string)
  * `restaurant_is_open` (boolean)
  * `delivery_windows` (array of strings)
  * `cutoff_time` (string)
  * `isOpenNow` (boolean): current real-time status calculated by backend.

## 7. Field Dictionary
* `cutoff_time`: Daily deadline (in `HH:MM` Riyadh time) by which subscription changes or self-pickup requests must be placed for next-day fulfillment.
* `isOpenNow`: Computed boolean representing whether the restaurant is currently open based on current time, operating hours, and active temporary closure flags.

## 8. Classification
`OPERATIONAL`

## 9. Frontend Restrictions
* **No Local Current-Status Calculation**: The frontend must consume `isOpenNow` directly rather than matching current local device time against opening hours, to avoid timezone/clock mismatch errors.

## 10. Backend Acceptance Criteria
* Validate all time strings against standard 24-hour time format regex (`^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$`).
* Correctly resolve `isOpenNow` checking emergency override (`restaurant_is_open`), weekly hours, and temporary closure.

## 11. Contract Tests Required
* Get restaurant hours returns computed variables.
* Validate invalid time string format is rejected (returns 400).

## 12. Known Risks
* Customer clock mismatch between phone and server can cause confusion over cutoff times. The server's timezone "Asia/Riyadh" is the single source of truth.

## 13. Status
`READY`
