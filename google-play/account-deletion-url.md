# Account Deletion URL

Host the backend account deletion page publicly:

`GET /account-deletion`

Final production URL:

`https://basicdiet145.onrender.com/account-deletion`

In Google Play Console:

- Open App content.
- Open Data deletion.
- Add the public account deletion URL.

This URL must work outside the app, without requiring login. Public requests are stored as pending and must be manually verified. Authenticated in-app requests can be sent to `POST /api/app/account-deletion/request`.
