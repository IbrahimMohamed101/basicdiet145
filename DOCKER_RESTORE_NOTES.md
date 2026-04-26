# Docker Restore Notes

## Problem

The previous Dockerfile was a Flutter + nginx configuration which failed on Render because:
1. The project is a Node.js backend, not a Flutter app
2. Flutter SDK version mismatch (requires 3.7.0+ but container had 3.6.1)
3. nginx was only needed for serving Flutter web build

## Solution

Replaced with a proper Node.js Dockerfile:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000
CMD ["npm", "start"]
```

## Render Docker Settings

When using Docker deployment on Render:

- **Dockerfile Path**: `Dockerfile`
- **Port**: `10000` (or use PORT env var)
- **Build Command**: (Leave empty - Docker builds the image)
- **Start Command**: (Leave empty - CMD in Dockerfile handles it)

## Files Changed

- `Dockerfile` - Changed from Flutter/nginx to Node.js
- `.dockerignore` - Node.js specific ignores
- `package.json` - Restored from backend (not changed)
- `src/` - Restored from backend
- `scripts/` - Restored from backend

## Note

This is a Node.js Express backend with MongoDB. The Flutter frontend is a separate project.