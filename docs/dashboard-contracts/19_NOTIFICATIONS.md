# Screen Contract: 19_NOTIFICATIONS

## 1. Screen Purpose
Provides operator interfaces for viewing recent notifications summary aggregates, recent dashboard administrative activity logs, and detailed notification execution logs (SMS, push notifications, etc.) with support for filtering by user or entity.

## 2. Dashboard Route
`/notifications`

## 3. Visible UI Requirements
* Count cards showing unread/sent notifications count in the last 24 hours.
* Recent activity log feed.
* Search/Filter table showing execution logs of sent notifications.

## 4. Backend Endpoints
* `GET /api/dashboard/notifications/summary` (provides unread/failed counts, recent notifications list, and recent admin activity log)
* `GET /api/dashboard/notification-logs` (lists paginated notification execution logs)

## 5. Request Parameters
* **Notification Summary (`GET /api/dashboard/notifications/summary`):**
  * `limit` (optional, integer, default 5, min 1, max 20)
* **Notification Logs (`GET /api/dashboard/notification-logs`):**
  * `userId` (optional, string, ObjectId format)
  * `entityId` (optional, string, ObjectId format)
  * `from` (optional, date string)
  * `to` (optional, date string)
  * `page` (optional, integer, default 1)
  * `limit` (optional, integer, default 10)

## 6. Response Fields Required
* **Summary Response (`GET /api/dashboard/notifications/summary`):**
  * `status` (boolean): `true`
  * `data` (object):
    * `unreadCount` (number)
    * `unreadWindowHours` (number)
    * `failedCount` (number)
    * `processingCount` (number)
    * `recent` (array of objects):
      * `id` (string)
      * `title` (string)
      * `body` (string)
      * `type` (string or null)
      * `status` (string)
      * `entityType` (string or null)
      * `entityId` (string or null)
      * `createdAt` (string, ISO date)
    * `recentActivity` (array of objects):
      * `id` (string)
      * `action` (string)
      * `entityType` (string)
      * `entityId` (string)
      * `byRole` (string or null)
      * `createdAt` (string, ISO date)
* **Logs List Response (`GET /api/dashboard/notification-logs`):**
  * `status` (boolean): `true`
  * `data` (array of objects):
    * `_id` (string, ObjectId)
    * `userId` (string, ObjectId)
    * `type` (string)
    * `status` (string)
    * `title` (string)
    * `body` (string)
    * `createdAt` (string, ISO date)
  * `meta` (object): `{ page, limit, total }`

## 7. Status
`NEEDS_TESTS` (The endpoints exist on the backend but lack dedicated automated contract tests in the test suite).
