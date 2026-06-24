# Screen Contract: Delivery Zones

## 1. Status

Status: `BACKEND_DASHBOARD_CONTRACT_ALIGNED`

## 2. Screen ownership

The Delivery Zones screen owns zone names, ordering, availability, and zone-specific delivery fees. It does not own fallback delivery fees or geographic containment.

## 3. Frontend implementation status

The Dashboard and this contract are aligned. Use `_id` as the backend identifier; normalize it to the table library's `id` locally when required, without changing API payloads.

## 4. Backend authority rules

- The backend is authoritative for IDs, timestamps, persistence, and delivery pricing.
- `deliveryFeeHalala` is an integer in halalas. Display SAR as `deliveryFeeHalala / 100` with two decimals.
- A supplied zone's fee is authoritative for subscription delivery and one-time delivery.
- Delete is a soft disable (`isActive: false`), not permanent deletion.
- Do not calculate or persist city, district, polygon, or fallback-fee data here.

All calls require `Authorization: Bearer <dashboardToken>`. Verified role: `admin` (a `superadmin` token may pass only where deployment role hierarchy maps it to admin; `VERIFY_IN_BACKEND_BEFORE_USE`).

## 5. Active endpoints

| Method | Path | Use |
|---|---|---|
| GET | `/api/dashboard/zones` | List/search/filter |
| GET | `/api/dashboard/zones/:id` | Detail/edit hydration |
| POST | `/api/dashboard/zones` | Create |
| PUT | `/api/dashboard/zones/:id` | Full update |
| PATCH | `/api/dashboard/zones/:id/toggle` | Toggle active state |
| DELETE | `/api/dashboard/zones/:id` | Soft-disable/archive |

## 6. Endpoint details

### GET /api/dashboard/zones

#### Purpose
Return zones sorted by `sortOrder` ascending, then newest first.

#### Auth
Roles:
- admin

#### Query params

| Param | Type | Required | Frontend control | Options | Default | Notes |
|---|---|---:|---|---|---|---|
| `q` | string | No | text | free text | empty | Arabic/English name search |
| `isActive` | boolean | No | select | `true`, `false` | all | Invalid boolean returns 400 |

#### Request body

None.

#### Request example

```http
GET {{baseUrl}}/api/dashboard/zones?q=الرياض&isActive=true
Authorization: Bearer <dashboardToken>
```

#### Success response example

```json
{"status":true,"data":[{"_id":"665000000000000000000001","name":{"ar":"وسط الرياض","en":"Central Riyadh"},"deliveryFeeHalala":1500,"isActive":true,"sortOrder":10,"createdAt":"2026-06-01T09:00:00.000Z","updatedAt":"2026-06-01T09:00:00.000Z"}],"meta":{"filters":{"isActive":true},"totalCount":1}}
```

#### Response fields

| Field | Type | Nullable | Frontend display | Notes |
|---|---|---:|---|---|
| `status` | boolean | No | hidden | Success envelope |
| `data` | zone[] | No | table rows | Empty array = empty state |
| `meta.filters` | object | No | hidden | Effective Mongo-style filter; do not render |
| `meta.totalCount` | integer | No | result count | Count of returned rows; no pagination |

#### Error responses

```json
{"status":false,"message":"isActive must be a boolean"}
```

#### Frontend notes
Empty state: `لا توجد مناطق توصيل مطابقة.` Search is server-side through `q`.

### GET /api/dashboard/zones/:id

#### Purpose
Load one zone for detail or edit.

#### Auth
Roles:
- admin

#### Query params

None.

#### Request body

None.

#### Request example

```http
GET {{baseUrl}}/api/dashboard/zones/665000000000000000000001
Authorization: Bearer <dashboardToken>
```

#### Success response example

```json
{"status":true,"data":{"_id":"665000000000000000000001","name":{"ar":"وسط الرياض","en":"Central Riyadh"},"deliveryFeeHalala":1500,"isActive":true,"sortOrder":10,"createdAt":"2026-06-01T09:00:00.000Z","updatedAt":"2026-06-01T09:00:00.000Z"}}
```

#### Response fields

See the zone DTO in section 9.

#### Error responses

```json
{"status":false,"message":"Zone not found"}
```

#### Frontend notes
Treat an invalid/missing ID as a failed detail route; do not show a blank editable form.

### POST /api/dashboard/zones

#### Purpose
Create a delivery zone.

#### Auth
Roles:
- admin

#### Query params

None.

#### Request body

| Field | Type | Required | Frontend control | Options | Unit | Example | Notes |
|---|---|---:|---|---|---|---|---|
| `name.ar` | string | Conditionally | text | non-empty text | — | `وسط الرياض` | Arabic label `الاسم بالعربية`; at least one of ar/en required |
| `name.en` | string | Conditionally | text | non-empty text | — | `Central Riyadh` | Arabic label `الاسم بالإنجليزية`; at least one of ar/en required |
| `deliveryFeeHalala` | integer | Yes | money-halala | integer >= 0 | halala | `1500` | Arabic label `رسوم التوصيل`; UI shows `15.00 ر.س` |
| `isActive` | boolean | No | switch | `true`, `false` | — | `true` | Arabic label `نشطة`; default `true` |
| `sortOrder` | integer | No | number | integer >= 0 | position | `10` | Arabic label `ترتيب العرض`; default `0` |

#### Request example

```json
{"name":{"ar":"وسط الرياض","en":"Central Riyadh"},"deliveryFeeHalala":1500,"isActive":true,"sortOrder":10}
```

#### Success response example

```json
{"status":true,"data":{"_id":"665000000000000000000001","name":{"ar":"وسط الرياض","en":"Central Riyadh"},"deliveryFeeHalala":1500,"isActive":true,"sortOrder":10,"createdAt":"2026-06-01T09:00:00.000Z","updatedAt":"2026-06-01T09:00:00.000Z"}}
```

#### Response fields

See section 9. HTTP status is 201.

#### Error responses

```json
{"status":false,"message":"deliveryFeeHalala must be an integer >= 0"}
```

#### Frontend notes
Convert the SAR input to halalas with `Math.round(sar * 100)` before submission.

### PUT /api/dashboard/zones/:id

#### Purpose
Replace all editable zone fields.

#### Auth
Roles:
- admin

#### Query params

None.

#### Request body

Same complete body as POST. All fields except defaultable `isActive` and `sortOrder` are validated as described above; because this is replacement-style, submit the complete form.

#### Request example

```json
{"name":{"ar":"شمال الرياض","en":"North Riyadh"},"deliveryFeeHalala":2000,"isActive":true,"sortOrder":20}
```

#### Success response example

```json
{"status":true,"data":{"_id":"665000000000000000000001","name":{"ar":"شمال الرياض","en":"North Riyadh"},"deliveryFeeHalala":2000,"isActive":true,"sortOrder":20,"createdAt":"2026-06-01T09:00:00.000Z","updatedAt":"2026-06-24T10:00:00.000Z"}}
```

#### Response fields

See section 9.

#### Error responses

```json
{"status":false,"message":"Zone not found"}
```

#### Frontend notes
Do not submit `_id`, timestamps, or unowned geographic fields.

### PATCH /api/dashboard/zones/:id/toggle

#### Purpose
Invert the current `isActive` value.

#### Auth
Roles:
- admin

#### Query params

None.

#### Request body

No body; the backend toggles the persisted state.

#### Request example

```json
{}
```

#### Success response example

```json
{"status":true,"data":{"id":"665000000000000000000001","isActive":false}}
```

#### Response fields

| Field | Type | Nullable | Frontend display | Notes |
|---|---|---:|---|---|
| `data.id` | string | No | hidden/row key | Backend ID (note: `id`, not `_id`) |
| `data.isActive` | boolean | No | status badge/switch | Backend result is authoritative |

#### Error responses

```json
{"status":false,"message":"Zone not found"}
```

#### Frontend notes
Disable repeated clicks and replace local state with the returned value.

### DELETE /api/dashboard/zones/:id

#### Purpose
Archive by setting `isActive` to false.

#### Auth
Roles:
- admin

#### Query params

None.

#### Request body

None.

#### Request example

```http
DELETE {{baseUrl}}/api/dashboard/zones/665000000000000000000001
Authorization: Bearer <dashboardToken>
```

#### Success response example

```json
{"status":true,"data":{"id":"665000000000000000000001","isActive":false}}
```

#### Response fields

Same fields as toggle response.

#### Error responses

```json
{"status":false,"message":"Zone not found"}
```

#### Frontend notes
Confirmation text: `سيتم تعطيل المنطقة ولن تُحذف نهائياً. هل تريد المتابعة؟`

## 7. Forms and UI controls

| Backend field | Arabic label | Control | Required | Type/options | Default | Validation/unit/example | Ownership |
|---|---|---|---:|---|---|---|---|
| `name.ar` | الاسم بالعربية | text | Conditional | string | `""` | trim; ar or en required | editable |
| `name.en` | الاسم بالإنجليزية | text | Conditional | string | `""` | trim; ar or en required | editable |
| `deliveryFeeHalala` | رسوم التوصيل | money-halala | Yes | integer | — | >=0; halala; `1500` → `15.00 ر.س` | editable |
| `isActive` | نشطة | switch | No | boolean | `true` | boolean | editable |
| `sortOrder` | ترتيب العرض | number | No | integer | `0` | >=0 | editable |
| `_id` | المعرّف | readonly | — | string | backend | Mongo ObjectId | backend-owned |
| `createdAt`, `updatedAt` | تاريخ الإنشاء/التحديث | readonly | — | ISO datetime | backend | display in `Asia/Riyadh` | backend-owned |

## 8. Tables and detail views

Columns: Arabic name, English name, fee in SAR, active badge, sort order, updated time, actions. Prefer Arabic name; fall back to English. No results: `لا توجد مناطق توصيل.` Detail and edit use the same DTO.

## 9. Response DTO reference

`Zone = { _id: string, name: { ar: string, en: string }, deliveryFeeHalala: integer, isActive: boolean, sortOrder: integer, createdAt: ISO datetime, updatedAt: ISO datetime }`. `name.ar` and `name.en` are non-null strings, though either may be empty. Money conversion: payload `1500` halala; display `15.00 ر.س`; rule `halala / 100`.

## 10. Error responses

Expect 400 invalid input/ID, 401/403 auth failure, 404 missing zone, and 500 unexpected failure. Preserve the backend `message`; Arabic fallback: `تعذر إكمال العملية. حاول مرة أخرى.`

## 11. Business rules

- Zone search covers `name.ar` and `name.en` only.
- List has no pagination.
- A disabled zone remains stored.
- Never derive checkout delivery fees on the frontend.

## 12. Frontend checklist

- [ ] Normalize `_id` to UI row ID only locally.
- [ ] Convert SAR input to integer halalas and halalas back to SAR for display.
- [ ] Send complete PUT bodies.
- [ ] Use `q` and `isActive` exactly.
- [ ] Refetch or apply returned state after toggle/archive.

## 13. Examples

Display helper: `formatSAR(1500) => "15.00 ر.س"`. Payload helper: `toHalala(15) => 1500`.

## 14. Unsupported / future features

- City/district membership and polygon drawing.
- Geocoding or address containment.
- Hard deletion.
- Editing the global fallback delivery fee on this screen.
