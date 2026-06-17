# Screen Contract: 03_ACCOUNTING

## 1. Screen Purpose
Generates accounting and reconciliation daily reports. Highlights cash expected, online sales, inclusive VAT breakdowns, manual deductions, and potential validation warnings (e.g. paid orders not fulfilled).

## 2. Dashboard Route
`/accounting`

## 3. Visible UI Requirements
* Date picker to select the business day for reporting.
* Filter dropdowns: Fulfillment Method (All, Pickup, Delivery).
* Summary stats for gross sales, net sales, VAT halalas, manual deductions, pickup vs delivery counts, and expected cash collections.
* Warnings panel displaying data validation warnings.
* "Export CSV" trigger button.

## 4. Backend Endpoints
* `GET /api/dashboard/accounting/daily-report` (fetches daily JSON report)
* `GET /api/dashboard/accounting/daily-report/export` (downloads daily report in CSV format)

## 5. Request Parameters
* Query:
  * `date` (required, string, `YYYY-MM-DD` format)
  * `fulfillmentMethod` (optional, string, default "all", values: `all`, `pickup`, `delivery`)
  * `includeDetails` (optional, boolean, default `true`)
  * `format` (for export only, required, string, value: `csv`)

## 6. Response Fields Required
* `status` (boolean): `true` if succeeded.
* `data.businessDate` (string): e.g. "2026-06-17".
* `data.summary` (object): gross sales, net sales, VAT, and counts.
* `data.money` (object): financial aggregates with payment status and method.
* `data.oneTimeOrders.items` (array of objects)
* `data.subscriptions.manualDeductions` (array of objects)
* `data.reconciliation` (object): `cashExpectedHalala`, `onlineExpectedHalala`, `totalExpectedHalala`.
* `data.warnings` (array of objects): lists anomalies like `PAID_ORDER_NOT_FULFILLED` or `FULFILLED_ORDER_MISSING_PAYMENT`.

## 7. Field Dictionary
* `grossSalesHalala`: Total inclusive revenue collected in Halalas.
* `netSalesHalala`: Revenue excluding the 16% inclusive VAT.
* `vatHalala`: Extracted 16% inclusive VAT.
* `cashExpectedHalala`: Cash/COD expected collections.

## 8. Classification
`FINANCIAL_CRITICAL`

## 9. Frontend Restrictions
* **No Calculation**: The frontend must not compute sums, net amounts, or tax extractions. It must read the response directly.
* **No Mutation**: Read-only endpoint.

## 10. Backend Acceptance Criteria
* Correctly resolves the business day start and end times based on `restaurant_open_time` and `restaurant_close_time`.
* Applies the flat 16% inclusive VAT extraction formula accurately.

## 11. Contract Tests Required
* Endpoint returns the complete daily report shape and warning/summary nodes.

## 12. Known Risks
* High database load if querying days with tens of thousands of orders. Heavy use of indexed queries on `createdAt`.

## 13. Status
`READY`
