# Screen Contract: Restaurant Hours

## 1. Status

Status: `BACKEND_READY_DASHBOARD_PENDING` (backend-only compatibility contract; not a claim of Dashboard implementation).

## 2. Screen ownership

Owns global restaurant open/close times, manual open switch, weekly schedule, temporary closure, delivery windows, and subscription cutoff time. It does not own pickup-location windows.

## 3. Frontend implementation status

Backend-only. The controls below are a future structured UI contract.

## 4. Backend authority rules

- Canonical route: `/api/dashboard/settings/restaurant-hours`.
- `/api/dashboard/restaurant-hours` is a legacy alias.
- Canonical persisted schedule field: `restaurant_hours`; accepted aliases: `weekly_schedule`, `weeklySchedule`.
- Canonical temporary closure: `temporary_closure`; compatibility alias: `temporaryClosure`.
- `isOpenNow` is readonly, computed, and backend-owned in timezone `Asia/Riyadh`.
- All times use 24-hour `HH:mm`. Delivery windows use `HH:mm-HH:mm`.

All calls require `Authorization: Bearer <dashboardToken>` and verified role `admin`.

## 5. Active endpoints

| Method | Path | Classification |
|---|---|---|
| GET | `/api/dashboard/settings/restaurant-hours` | canonical |
| PUT | `/api/dashboard/settings/restaurant-hours` | canonical |
| GET | `/api/dashboard/restaurant-hours` | legacy alias |
| PUT | `/api/dashboard/restaurant-hours` | legacy alias |
| PATCH | `/api/dashboard/restaurant-hours/toggle-open` | compatibility toggle |

## 6. Endpoint details

### GET /api/dashboard/settings/restaurant-hours

#### Purpose
Read the canonical global hours configuration and computed open state.

#### Auth
Roles:
- admin

#### Query params

None.

#### Request body

None.

#### Request example

```http
GET {{baseUrl}}/api/dashboard/settings/restaurant-hours
Authorization: Bearer <dashboardToken>
```

#### Success response example

```json
{"status":true,"data":{"timezone":"Asia/Riyadh","restaurant_open_time":"10:00","restaurant_close_time":"23:00","restaurant_is_open":true,"restaurant_hours":[{"dayOfWeek":0,"isClosed":false,"openTime":"10:00","closeTime":"23:00"}],"weekly_schedule":[{"dayOfWeek":0,"isClosed":false,"openTime":"10:00","closeTime":"23:00"}],"delivery_windows":["12:00-14:00","18:00-20:00"],"cutoff_time":"22:00","temporary_closure":{"isActive":false},"temporaryClosure":{"isActive":false},"isOpenNow":true}}
```

#### Response fields

| Field | Type | Nullable | Frontend display | Notes |
|---|---|---:|---|---|
| `timezone` | string | No | readonly | Always `Asia/Riyadh` in current controller |
| `restaurant_open_time` | string | No | time | `HH:mm`; fallback `00:00` |
| `restaurant_close_time` | string | No | time | `HH:mm`; fallback `23:59` |
| `restaurant_is_open` | boolean | No | switch/badge | Global manual switch |
| `restaurant_hours` | schedule[] | Yes | day-grid | Canonical; may be null when unset |
| `weekly_schedule` | schedule[] | Yes | hidden compatibility | Same persisted value |
| `delivery_windows` | string[] | No | chips/time ranges | Empty array when unset |
| `cutoff_time` | string | Yes | time | `HH:mm` or null |
| `temporary_closure` | object/boolean | Yes | closure badge | Canonical persisted value |
| `temporaryClosure` | object/boolean | Yes | hidden compatibility | Same value |
| `isOpenNow` | boolean | No | readonly badge | computed/backend-owned |

#### Error responses

```json
{"status":false,"message":"Unauthorized"}
```

#### Frontend notes
Do not derive `isOpenNow`. Empty schedule means show global hours, not “closed all week.”

### PUT /api/dashboard/settings/restaurant-hours

#### Purpose
Write the canonical global configuration.

#### Auth
Roles:
- admin

#### Query params

None.

#### Request body

| Field | Type | Required | Frontend control | Options | Unit | Example | Notes |
|---|---|---:|---|---|---|---|---|
| `restaurant_open_time` | string | Yes | time | valid 24-hour time | `HH:mm`, Riyadh | `10:00` | Alias `openTime`; required by controller |
| `restaurant_close_time` | string | Yes | time | valid 24-hour time | `HH:mm`, Riyadh | `23:00` | Alias `closeTime`; required by controller |
| `restaurant_is_open` | boolean | No | switch | `true`, `false` | — | `true` | Alias `isOpen`; omit to leave unchanged |
| `cutoff_time` | string | No | time | valid 24-hour time | `HH:mm`, Riyadh | `22:00` | Alias `cutoffTime`; omit to leave unchanged |
| `delivery_windows` | string[] | No | array-editor | unique `HH:mm-HH:mm` strings | Riyadh time range | `["12:00-14:00"]` | Alias `deliveryWindows`; add/remove rows; empty array is valid |
| `restaurant_hours` | schedule[] | No | array-editor | day rows 0–6 | Riyadh | see below | Canonical; aliases accepted |
| `temporary_closure` | boolean/object/string | No | object-editor | boolean or `{isActive:boolean}` | — | `{"isActive":true}` | JSON string accepted; no dates |

#### Request example

```json
{"restaurant_open_time":"10:00","restaurant_close_time":"23:00","restaurant_is_open":true,"cutoff_time":"22:00","delivery_windows":["12:00-14:00","18:00-20:00"],"restaurant_hours":[{"dayOfWeek":0,"isClosed":false,"openTime":"10:00","closeTime":"23:00"}],"temporary_closure":{"isActive":false}}
```

#### Success response example

```json
{"status":true,"data":{"timezone":"Asia/Riyadh","restaurant_open_time":"10:00","restaurant_close_time":"23:00","restaurant_is_open":true,"restaurant_hours":[{"dayOfWeek":0,"isClosed":false,"openTime":"10:00","closeTime":"23:00"}],"weekly_schedule":[{"dayOfWeek":0,"isClosed":false,"openTime":"10:00","closeTime":"23:00"}],"delivery_windows":["12:00-14:00","18:00-20:00"],"cutoff_time":"22:00","temporary_closure":{"isActive":false},"temporaryClosure":{"isActive":false},"isOpenNow":true}}
```

#### Response fields

Same fields as GET. Important: optional fields omitted from the request can appear as `undefined`/be omitted in the immediate PUT response; refetch GET for fully hydrated state.

#### Error responses

```json
{"status":false,"message":"Each window must match HH:mm-HH:mm"}
```

#### Frontend notes
Submit canonical names. Prevent duplicate windows. A closed day still carries normalized open/close strings.

### GET /api/dashboard/restaurant-hours

#### Purpose
Legacy read alias with the same behavior and DTO as canonical GET.

#### Auth
Roles:
- admin

#### Query params

None.

#### Request body

None.

#### Request example

```http
GET {{baseUrl}}/api/dashboard/restaurant-hours
Authorization: Bearer <dashboardToken>
```

#### Success response example

```json
{"status":true,"data":{"timezone":"Asia/Riyadh","restaurant_open_time":"10:00","restaurant_close_time":"23:00","restaurant_is_open":true,"restaurant_hours":[],"weekly_schedule":[],"delivery_windows":[],"cutoff_time":"22:00","temporary_closure":null,"temporaryClosure":null,"isOpenNow":true}}
```

#### Response fields

Same as canonical GET.

#### Error responses

```json
{"status":false,"message":"Unauthorized"}
```

#### Frontend notes
New integrations should use the canonical settings path.

### PUT /api/dashboard/restaurant-hours

#### Purpose
Legacy write alias and compatibility-field example.

#### Auth
Roles:
- admin

#### Query params

None.

#### Request body

Same validation as canonical PUT. Compatibility names accepted: `openTime`, `closeTime`, `isOpen`, `cutoffTime`, `deliveryWindows`, `weekly_schedule`, `weeklySchedule`, and `temporaryClosure`.

#### Request example

```json
{"openTime":"10:00","closeTime":"23:00","isOpen":true,"weeklySchedule":[{"dayOfWeek":1,"isClosed":false,"openTime":"10:00","closeTime":"23:00"}],"temporaryClosure":"{\"isActive\":false}"}
```

#### Success response example

```json
{"status":true,"data":{"timezone":"Asia/Riyadh","restaurant_open_time":"10:00","restaurant_close_time":"23:00","restaurant_is_open":true,"restaurant_hours":[{"dayOfWeek":1,"isClosed":false,"openTime":"10:00","closeTime":"23:00"}],"weekly_schedule":[{"dayOfWeek":1,"isClosed":false,"openTime":"10:00","closeTime":"23:00"}],"temporary_closure":{"isActive":false},"temporaryClosure":{"isActive":false},"isOpenNow":true}}
```

#### Response fields

Same as canonical PUT.

#### Error responses

```json
{"status":false,"message":"Invalid weekly schedule JSON format"}
```

#### Frontend notes
Compatibility acceptance is for old clients; do not mix canonical and alias keys in new payloads.

### PATCH /api/dashboard/restaurant-hours/toggle-open

#### Purpose
Set (not invert) the global open switch.

#### Auth
Roles:
- admin

#### Query params

None.

#### Request body

| Field | Type | Required | Frontend control | Options | Unit | Example | Notes |
|---|---|---:|---|---|---|---|---|
| `restaurant_is_open` | boolean | No | switch | `true`, `false` | — | `false` | Canonical; alias `isOpen`; if both absent backend defaults true |

#### Request example

```json
{"restaurant_is_open":false}
```

#### Success response example

```json
{"status":true,"data":{"restaurant_is_open":false,"isOpen":false}}
```

#### Response fields

| Field | Type | Nullable | Frontend display | Notes |
|---|---|---:|---|---|
| `data.restaurant_is_open` | boolean | No | switch | Canonical returned state |
| `data.isOpen` | boolean | No | hidden compatibility | Alias of same state |

#### Error responses

```json
{"status":false,"message":"Unauthorized"}
```

#### Frontend notes
Always send an explicit boolean; endpoint name is misleading because it sets rather than toggles.

## 7. Forms and UI controls

| Backend field | Arabic label | Control | Required | Default | Validation | Ownership |
|---|---|---|---:|---|---|---|
| `restaurant_open_time` | وقت فتح المطعم | time | Yes | GET value | `HH:mm`, Asia/Riyadh | editable |
| `restaurant_close_time` | وقت إغلاق المطعم | time | Yes | GET value | `HH:mm`, Asia/Riyadh | editable |
| `restaurant_is_open` | المطعم مفتوح | switch | No | true if unset | boolean | editable |
| `cutoff_time` | وقت إقفال تعديلات الاشتراك | time | No | null | `HH:mm`, Asia/Riyadh | editable |
| `delivery_windows` | نوافذ التوصيل | array-editor | No | `[]` | unique `HH:mm-HH:mm`; add/remove rows | editable |
| `restaurant_hours` | الجدول الأسبوعي | array-editor | No | null/`[]` | schedule rows | editable |
| `temporary_closure` | إغلاق مؤقت | switch/object-editor | No | null | boolean or `{isActive}` only | editable |
| `isOpenNow` | مفتوح الآن | readonly | — | computed | boolean | computed/backend-owned |
| `timezone` | المنطقة الزمنية | readonly | — | `Asia/Riyadh` | string | backend-owned |

## 8. Tables and detail views

Weekly day grid:

| dayOfWeek | Arabic | English |
|---:|---|---|
| 0 | الأحد | Sunday |
| 1 | الاثنين | Monday |
| 2 | الثلاثاء | Tuesday |
| 3 | الأربعاء | Wednesday |
| 4 | الخميس | Thursday |
| 5 | الجمعة | Friday |
| 6 | السبت | Saturday |

Render an “open now/closed now” badge from `isOpenNow`. Empty windows: `لا توجد نوافذ توصيل محددة.` Empty schedule: `يُستخدم وقت الفتح والإغلاق العام.`

## 9. Response DTO reference

Canonical schedule item: `{ dayOfWeek: integer 0..6, isClosed: boolean, openTime: "HH:mm", closeTime: "HH:mm" }`. The backend also accepts input day `7` and normalizes it to Sunday (`0`), but the UI should emit 0–6. Arrays are editable by adding/removing day/window rows. Temporary closure accepts boolean, `{ "isActive": true }`, or a JSON string that parses to either; it normalizes to `{isActive:boolean}`.

## 10. Error responses

Expect 400 for missing/invalid time, invalid schedule/window JSON, or duplicate windows; 401/403 for auth; 500 otherwise. Show backend message plus `راجع تنسيق الوقت (HH:mm).`

## 11. Business rules

- One-time checkout checks restaurant open state.
- Subscription checkout is not blocked by `isOpenNow`.
- Subscription pickup-request creation checks open state.
- Cutoff affects subscription changes.
- Temporary closure is boolean state only; there is no date range.
- Hours are global; there are no branch-specific schedules.
- Pickup windows are owned elsewhere.

## 12. Frontend checklist

- [ ] Use canonical route and field names.
- [ ] Use `HH:mm` and `HH:mm-HH:mm` exactly.
- [ ] Render `isOpenNow` without local calculation.
- [ ] Refetch after PUT for fully hydrated state.
- [ ] Send explicit boolean to toggle-open.

## 13. Examples

Closed Friday row: `{"dayOfWeek":5,"isClosed":true,"openTime":"00:00","closeTime":"23:59"}`.

## 14. Unsupported / future features

- Date-range temporary closures and holiday calendars.
- Multiple opening intervals per day in the canonical output.
- Branch-specific hours.
- Pickup-location windows.
- Dashboard readiness (integration remains pending).
