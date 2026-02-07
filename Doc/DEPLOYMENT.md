# BasicDiet145 - Deployment Guide

This guide provides step-by-step instructions for deploying the BasicDiet145 backend to production.

---

## Prerequisites

Before deploying, ensure you have:

- [ ] MongoDB Atlas cluster
- [ ] Firebase project with Auth and Cloud Messaging enabled
- [ ] Moyasar account with API keys
- [ ] Domain name with HTTPS/TLS certificate
- [ ] Server or cloud platform (AWS, GCP, Azure, DigitalOcean, Render, etc.)
- [ ] Node.js 20+ runtime environment

---

## Deployment Options

### Option 1: Docker Deployment (Recommended)

### Option 2: Platform-as-a-Service (Render, Heroku, Railway)

### Option 3: Cloud Platforms (AWS ECS, GCP Cloud Run, Azure App Service)

### Option 4: VPS (DigitalOcean, Linode, AWS EC2)

---

## Option 1: Docker Deployment

### Step 1: Build Docker Image

```bash
# Build the image
docker build -t basicdiet145-backend:latest .

# Test locally
docker run -p 3000:3000 --env-file .env basicdiet145-backend:latest
```

### Step 2: Push to Registry

```bash
# Tag for registry (example: Docker Hub)
docker tag basicdiet145-backend:latest yourusername/basicdiet145-backend:latest

# Push
docker push yourusername/basicdiet145-backend:latest
```

### Step 3: Deploy with Docker Compose

**Production docker-compose:**

```yaml
version: '3.8'
services:
  api:
    image: yourusername/basicdiet145-backend:latest
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/basicdiet145?retryWrites=true&w=majority&appName=basicdiet145
      - MONGO_DB=basicdiet145
      - NODE_ENV=production
    env_file:
      - .env.production
    restart: unless-stopped
```

```bash
docker-compose -f docker-compose.prod.yml up -d
```

---

## Option 2: Platform-as-a-Service Deployment

### Render.com Example

#### Step 1: Create `render.yaml`

```yaml
services:
  - type: web
    name: basicdiet145-api
    env: node
    plan: starter
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 3000
      - key: MONGO_URI
        sync: false
      - key: JWT_SECRET
        generateValue: true
      - key: FIREBASE_PROJECT_ID
        sync: false
      - key: FIREBASE_CLIENT_EMAIL
        sync: false
      - key: FIREBASE_PRIVATE_KEY
        sync: false
      - key: MOYASAR_SECRET_KEY
        sync: false
      - key: MOYASAR_WEBHOOK_SECRET
        sync: false
```

#### Step 2: Connect Repository

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click "New" -> "Web Service"
3. Connect your GitHub/GitLab repository
4. Render will detect `render.yaml` and create the service

#### Step 3: Configure Environment Variables

Set all required environment variables in the Render dashboard.

#### Step 4: Deploy

Render will automatically deploy on every push to your main branch.

---

## Option 3: AWS Deployment

### Using AWS Elastic Beanstalk

#### Step 1: Install EB CLI

```bash
pip install awsebcli
```

#### Step 2: Initialize EB Application

```bash
eb init -p node.js-20 basicdiet145-backend --region us-east-1
```

#### Step 3: Create Environment

```bash
eb create basicdiet145-prod --instance-type t3.small
```

#### Step 4: Set Environment Variables

```bash
eb setenv \
  MONGO_URI="mongodb+srv://..." \
  JWT_SECRET="..." \
  FIREBASE_PROJECT_ID="..." \
  # ... (add all variables)
```

#### Step 5: Deploy

```bash
eb deploy
```

#### Step 6: Configure HTTPS

1. Go to EC2 -> Load Balancers
2. Add HTTPS listener with SSL certificate
3. Update security groups

---

## Option 4: VPS Deployment (Ubuntu 22.04)

### Step 1: Connect to Server

```bash
ssh root@your-server-ip
```

### Step 2: Install Prerequisites

```bash
# Update system
apt update && apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install PM2 (process manager)
npm install -g pm2

# Install nginx (reverse proxy)
apt install -y nginx

# Install certbot (SSL)
apt install -y certbot python3-certbot-nginx
```

### Step 3: Setup Application

```bash
# Create app directory
mkdir -p /var/www/basicdiet145
cd /var/www/basicdiet145

# Clone repository
git clone https://github.com/yourusername/basicdiet145-backend.git .

# Install dependencies
npm install --production

# Create .env file
nano .env
# (paste your production environment variables)
```

### Step 4: Start with PM2

```bash
# Start application
pm2 start src/index.js --name basicdiet145

# Save PM2 process list
pm2 save

# Setup PM2 to start on boot
pm2 startup systemd
# (run the command it outputs)
```

### Step 5: Configure Nginx

```bash
nano /etc/nginx/sites-available/basicdiet145
```

**Nginx configuration:**

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Enable site
ln -s /etc/nginx/sites-available/basicdiet145 /etc/nginx/sites-enabled/

# Test configuration
nginx -t

# Restart nginx
systemctl restart nginx
```

### Step 6: Setup SSL with Let's Encrypt

```bash
certbot --nginx -d api.yourdomain.com
```

Follow the prompts. Certbot will automatically configure HTTPS.

### Step 7: Configure Firewall

```bash
ufw allow 'Nginx Full'
ufw allow OpenSSH
ufw enable
```

---

## MongoDB Setup

### Option A: MongoDB Atlas (Recommended)

1. Create account at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a cluster (Free tier available)
3. Create database user
4. Whitelist your application IP (or `0.0.0.0/0` for testing)
5. Get connection string:
   ```
   mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/basicdiet145?retryWrites=true&w=majority
   ```

## Environment Variables Setup

Create `.env.production` with production values:

```env
# Server
NODE_ENV=production
PORT=3000
TRUST_PROXY=1

# Database
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/basicdiet145?retryWrites=true&w=majority
MONGO_DB=basicdiet145

# Timezone
APP_TIMEZONE=Asia/Riyadh

# Security
JWT_SECRET=GENERATE_STRONG_SECRET_64_CHARS_MINIMUM

# Firebase
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"

# Moyasar
MOYASAR_SECRET_KEY=sk_live_xxxxxxxxxxxxx
MOYASAR_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx

# CORS
CORS_ORIGINS=https://app.yourdomain.com,https://dashboard.yourdomain.com

# Rate Limiting
OTP_RATE_LIMIT_WINDOW_MS=900000
OTP_RATE_LIMIT_MAX=5
CHECKOUT_RATE_LIMIT_WINDOW_MS=3600000
CHECKOUT_RATE_LIMIT_MAX=10

# Logging
LOG_LEVEL=info
LOG_FILE=logs/app.log
```

**Security Notes:**

- Use strong, randomly generated `JWT_SECRET` (64+ characters)
- Never commit `.env.production` to git
- Use environment variable management tools (AWS Secrets Manager, HashiCorp Vault)

---

## Production Checklist

### Security

- [ ] Set strong `JWT_SECRET` (minimum 64 characters)
- [ ] Configure CORS with specific allowed origins
- [ ] Enable HTTPS/TLS
- [ ] Configure firewall (only ports 80, 443, 22 open)
- [ ] Set `TRUST_PROXY=1` if behind load balancer
- [ ] Disable verbose error messages in production
- [ ] Use MongoDB authentication
- [ ] Restrict MongoDB network access
- [ ] Configure rate limiting appropriately
- [ ] Set up security headers (Helmet is already configured)

### Monitoring

- [ ] Set up application monitoring (New Relic, Datadog, Sentry)
- [ ] Configure log aggregation (CloudWatch, Papertrail, Loggly)
- [ ] Set up uptime monitoring (UptimeRobot, Pingdom)
- [ ] Configure alerts for errors and performance issues
- [ ] Monitor MongoDB performance and disk usage

### Performance

- [ ] Enable MongoDB indexes:
  ```javascript
  db.users.createIndex({ phone: 1 }, { unique: true });
  db.subscriptions.createIndex({ userId: 1, status: 1 });
  db.subscriptionDays.createIndex({ subscriptionId: 1, date: 1 });
  db.subscriptionDays.createIndex({ date: 1, status: 1 });
  db.payments.createIndex({ userId: 1, type: 1 });
  db.activityLogs.createIndex({ createdAt: -1 });
  ```
- [ ] Configure Node.js memory limits
- [ ] Enable MongoDB connection pooling (already configured in Mongoose)
- [ ] Consider Redis for session storage (Better Auth supports this)
- [ ] Implement caching for frequently accessed data (plans, settings)

### Backup & Recovery

- [ ] Set up automated MongoDB backups
- [ ] Test backup restoration process
- [ ] Document disaster recovery procedures
- [ ] Set up database replication (MongoDB replica sets)

### Testing

- [ ] Test all critical flows in staging environment
- [ ] Verify payment webhook integration with Moyasar
- [ ] Test Firebase authentication from production domain
- [ ] Verify daily cutoff job runs correctly
- [ ] Test FCM notifications from production

### Documentation

- [ ] Update API documentation with production URL
- [ ] Document deployment process for team
- [ ] Create runbook for common issues
- [ ] Document environment variables

---

## Post-Deployment

### Verify Deployment

```bash
# Health check
curl https://api.yourdomain.com/health

# Expected response:
# {"ok":true,"db":{"state":"up"}}
```

### Monitor Logs

```bash
# PM2 logs
pm2 logs basicdiet145

# Follow logs in real-time
pm2 logs --lines 100
```

### Test Endpoints

Visit: `https://api.yourdomain.com/api-docs`

### Setup Moyasar Webhook

1. Go to Moyasar Dashboard -> Webhooks
2. Add webhook URL: `https://api.yourdomain.com/webhooks/moyasar`
3. Select events: `payment.paid`, `payment.failed`
4. Save webhook secret to `MOYASAR_WEBHOOK_SECRET`

### Setup Database Indexes

Connect to MongoDB and run:

```javascript
use basicdiet145;

db.users.createIndex({ phone: 1 }, { unique: true });
db.dashboardUsers.createIndex({ email: 1 }, { unique: true });
db.subscriptions.createIndex({ userId: 1, status: 1 });
db.subscriptionDays.createIndex({ subscriptionId: 1, date: 1 });
db.subscriptionDays.createIndex({ date: 1, status: 1 });
db.orders.createIndex({ userId: 1, status: 1 });
db.payments.createIndex({ userId: 1, type: 1, status: 1 });
db.activityLogs.createIndex({ createdAt: -1 });
db.activityLogs.createIndex({ entityType: 1, entityId: 1 });
db.notificationLogs.createIndex({ userId: 1, createdAt: -1 });
```

---

## Scaling Considerations

### Horizontal Scaling

- Deploy multiple instances behind load balancer
- Use shared session store (Redis) for Better Auth
- Ensure daily cutoff job runs on single instance only (use leader election or cron service)

### Database Scaling

- Enable MongoDB replica sets for read scaling
- Consider sharding for very large datasets
- Use MongoDB connection pooling (already configured)

### Caching

- Implement Redis for:
  - Session storage
  - Frequently accessed data (plans, settings)
  - Rate limiting counters

---

## Troubleshooting

### Application won't start

```bash
# Check logs
pm2 logs basicdiet145 --err

# Common issues:
# - Missing environment variables
# - MongoDB connection failure
# - Port already in use
```

### MongoDB connection issues

```bash
# Test connection
mongosh "mongodb+srv://cluster.mongodb.net/basicdiet145" --username youruser

# Check network access in MongoDB Atlas
# Verify IP whitelist includes your server IP
```

### Webhook not receiving events

- Verify webhook URL is accessible from internet
- Check Moyasar dashboard for webhook delivery logs
- Verify `MOYASAR_WEBHOOK_SECRET` is correct
- Check application logs for webhook errors

---

## Maintenance

### Update Application

```bash
# Pull latest code
cd /var/www/basicdiet145
git pull origin main

# Install dependencies
npm install --production

# Restart application
pm2 restart basicdiet145
```

### Database Backup

```bash
# Manual backup
mongodump --uri="mongodb+srv://..." --out=./backup-$(date +%Y%m%d)

# Restore
mongorestore --uri="mongodb+srv://..." ./backup-20260206
```

### View Metrics

```bash
# PM2 monitoring
pm2 monit

# List processes
pm2 list

# Restart all
pm2 restart all

# Stop all
pm2 stop all
```

---

## Support & Resources

- **Documentation:** `DOCUMENTATION.md`
- **Architecture:** `ARCHITECTURE.md`
- **API Guide:** `API_GUIDE.md`
- **Health Check:** `https://api.yourdomain.com/health`
- **API Docs:** `https://api.yourdomain.com/api-docs`

---

This deployment guide should enable you to successfully deploy BasicDiet145 to production. For specific platform integrations or advanced configurations, consult the platform's documentation.