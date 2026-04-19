# CI/CD Setup Guide - Firebase App Distribution

## Overview
This project uses GitHub Actions to automatically build and distribute APK to Firebase App Distribution when code is pushed or a PR is created targeting the `main` branch.

## Workflow Triggers
- ✅ **Push to main**: Builds APK and uploads to Firebase
- ✅ **Pull Request to main**: Builds APK (for validation) but does NOT upload to Firebase
- 📦 **Artifact Storage**: All builds are stored as GitHub artifacts for 30 days

## Required GitHub Secrets

You need to configure the following secrets in your GitHub repository:

### 1. `FIREBASE_APP_ID`
Your Firebase App ID (found in Firebase Console → Project Settings → General → Your apps)

**Format**: `1:XXXXXXXXXXXX:android:XXXXXXXXXXXXXXXXXXXXXX`

### 2. `FIREBASE_SERVICE_ACCOUNT_JSON`
Service account key JSON for Firebase App Distribution API.

#### How to create it:

1. **Enable Firebase App Distribution API**:
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Select your project
   - Navigate to **App Distribution** in the left menu
   - Click **Get Started** if not already enabled

2. **Create Service Account**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Select your Firebase project
   - Navigate to **APIs & Services** → **Credentials**
   - Click **Create Credentials** → **Service Account**
   - Fill in the details and click **Create**
   - Go to the **Keys** tab
   - Click **Add Key** → **Create new key**
   - Select **JSON** format
   - Download the JSON file

3. **Add as GitHub Secret**:
   - Go to your GitHub repository
   - Navigate to **Settings** → **Secrets and variables** → **Actions**
   - Click **New repository secret**
   - Name: `FIREBASE_SERVICE_ACCOUNT_JSON`
   - Value: Paste the entire JSON content
   - Click **Add secret**

## Workflow Features

### Build Process
1. ✅ Checkout code
2. ✅ Setup Java 17 with Gradle caching
3. ✅ Setup Flutter with dependency caching
4. ✅ Install dependencies (`flutter pub get`)
5. ✅ Build release APK
6. ✅ Upload APK as GitHub artifact (30 days retention)
7. ✅ Upload to Firebase App Distribution (push to main only)

### Conditional Distribution
- **Push to main**: Full build + Firebase upload
- **Pull Request**: Build only (for testing/validation)

### Release Notes
Automatic release notes include:
- Build number
- Commit SHA

## Monitoring Builds

### GitHub Actions
- Navigate to **Actions** tab in your repository
- View workflow runs, logs, and artifacts
- Download APK directly from artifacts if needed

### Firebase Console
- Go to **App Distribution** section
- View all distributed builds
- Manage testers and groups
- Track download status

## Managing Testers

### Add Testers
1. Firebase Console → App Distribution → Testers & Groups
2. Add individual testers or create groups
3. Testers will receive email invitations

### Default Configuration
The workflow uses the `testers` group by default. You can change this in the workflow file:
```yaml
--groups "testers"  # Change to your group name
```

## Troubleshooting

### Common Issues

**1. "FIREBASE_APP_ID not found"**
- Ensure `FIREBASE_APP_ID` secret is set correctly
- Verify the App ID format matches Firebase Console

**2. "Service account permission denied"**
- Ensure the service account has Firebase App Distribution Admin role
- Go to Google Cloud Console → IAM → Verify roles

**3. "Build failed"**
- Check the Actions logs for specific errors
- Ensure all dependencies are properly configured
- Verify Flutter SDK compatibility

**4. "APK not uploading"**
- Check if workflow has correct triggers
- Verify you're pushing to `main` branch
- Check Firebase API is enabled

### Manual Trigger
To manually trigger a build:
1. Go to **Actions** tab
2. Select **Firebase App Distribution** workflow
3. Click **Run workflow**
4. Select branch and click **Run workflow**

## Customization

### Change Tester Group
Edit `.github/workflows/firebase-distribution.yml`:
```yaml
--groups "your-group-name"
```

### Add Slack/Discord Notifications
Add a step after Firebase upload:
```yaml
- name: Notify Slack
  if: success()
  uses: slackapi/slack-github-action@v1.24.0
  with:
    channel-id: 'your-channel'
    slack-message: 'New build deployed!'
  env:
    SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
```

### Build AAB (Android App Bundle)
Add this step to build AAB for Play Store:
```yaml
- name: Build AAB
  run: flutter build appbundle --release
```

## Best Practices

1. ✅ Keep secrets secure - never commit them
2. ✅ Test with PR builds before merging to main
3. ✅ Monitor build times and optimize caching
4. ✅ Clean up old artifacts periodically
5. ✅ Document release notes for testers
6. ✅ Use semantic versioning for releases

## Support

For issues with:
- **GitHub Actions**: Check [GitHub Actions Documentation](https://docs.github.com/en/actions)
- **Firebase App Distribution**: Check [Firebase Documentation](https://firebase.google.com/docs/app-distribution)
- **Flutter Builds**: Check [Flutter Deployment Guide](https://docs.flutter.dev/deployment/android)
