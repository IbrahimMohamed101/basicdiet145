# Frontend Daily Accountant Report

## Purpose

The Daily Accountant Report is the backend source of truth for the restaurant accountant dashboard. It combines One-Time Order sales, VAT, payment reconciliation, manual subscription meal deductions, operational counts, and warnings for a selected restaurant business date.

## Endpoints

### View Report

`GET /api/dashboard/accounting/daily-report?date=YYYY-MM-DD`

### Export CSV

`GET /api/dashboard/accounting/daily-report/export?date=YYYY-MM-DD&format=csv`

## Query Params

- `date` is required and must be `YYYY-MM-DD`.
- `fulfillmentMethod` is optional: `pickup`, `delivery`, or `all`. Default is `all`.
- `includeDetails` is optional for JSON: `true` or `false`. Default is `true`.
- `format` is required for export. Currently supported: `csv`.

## Response Shape

The JSON endpoint returns:

```json
{
  "status": true,
  "data": {
    "businessDate": "2026-05-15",
    "timezone": "Asia/Riyadh",
    "period": {
      "start": "2026-05-14T21:00:00.000Z",
      "end": "2026-05-15T20:59:59.999Z"
    },
    "summary": {},
    "money": {},
    "oneTimeOrders": {
      "summary": {},
      "byStatus": [],
      "byFulfillmentMethod": [],
      "items": []
    },
    "subscriptions": {
      "summary": {},
      "manualDeductions": []
    },
    "operations": {},
    "reconciliation": {},
    "warnings": [],
    "generatedAt": "2026-05-15T12:00:00.000Z",
    "generatedBy": {}
  }
}
```

## CSV Export

CSV uses UTF-8 with a BOM for Arabic/customer names. The response sets:

- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename="daily-accountant-report-YYYY-MM-DD.csv"`

The CSV contains section headers for Report, Summary, Money, One-Time Orders, Manual Subscription Deductions, and Warnings.

## Recommended UI Sections

- Top summary cards
- Money and reconciliation cards
- One-Time Orders table
- Subscription manual deductions table
- Warnings/exceptions section
- Download report button

## Frontend Rules

- Do not recalculate VAT if the backend returns it.
- All money values are Halala. Format them to SAR in the UI.
- The backend report is the source of truth for totals.
- Manual subscription deductions are operational meal consumption events and are not necessarily revenue.
- Refresh the report after date, fulfillment method, or detail filters change.
