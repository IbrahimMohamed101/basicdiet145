# Railway Deployment Checklist

This document provides a comprehensive checklist for deploying the `basicdiet145` backend to Railway Hobby.

## 1. Services Required
- **Backend Service**: Deploy the main Github repository.
- **MongoDB Service**: Provision a Railway MongoDB database (with the 5GB volume).

## 2. Environment Variables Configuration

Use the `.env.railway.example` file as a reference.

### Critical Database Mapping
Railway provides `MONGO_URL`. Your app expects `MONGODB_URI` or `MONGO_URI`. 
* Action: Add a variable `MONGODB_URI` and reference Railway's variable: `\${MONGO_URL}`

### Webhook Secret
Moyasar requires a webhook secret in production.
* Action: Generate a secure string, set it as `MOYASAR_WEBHOOK_SECRET` in Railway.
* Action: Configure the same secret in the Moyasar Dashboard.

### Authentication Secrets
You MUST generate new, strong random strings for:
- `JWT_SECRET`
- `JWT_ACCESS_SECRET`
- `DASHBOARD_JWT_SECRET`
- `REFRESH_TOKEN_HASH_SECRET`
- `OTP_HASH_SECRET`

## 3. Post-Deployment Steps

1. **Run Database Indexes**: Since you have a production index script, run it once manually using the Railway command palette or Railway CLI:
   `npm run indexes:production`
2. **Configure Moyasar Webhook**: Set the webhook URL in Moyasar to `https://<YOUR-RAILWAY-DOMAIN>/webhooks/moyasar`.
3. **Monitor Logs**: Railway Hobby only retains 7 days of logs. Monitor the logs heavily in the first week, especially during the daily cutoff job.

## 4. Scaling Warnings

> [!CAUTION]
> **DO NOT scale beyond 1 replica.**
> The background jobs (`src/jobs/index.js`) use in-memory guards. If you scale to 2+ replicas, jobs like `processDailyCutoff` will run multiple times, causing duplicate processing.

> [!WARNING]
> **5GB Storage Limit:**
> Railway's 5GB volume will eventually fill up. Set up automated backups or migrate to MongoDB Atlas if storage exceeds 3GB.
