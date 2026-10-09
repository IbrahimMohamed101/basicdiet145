export const IOS_APP_URL =
  process.env.NEXT_PUBLIC_IOS_APP_URL ??
  "https://apps.apple.com/ar/app/basic-diet/id6775085745";

export const ANDROID_APP_URL =
  process.env.NEXT_PUBLIC_ANDROID_APP_URL?.trim() ||
  "https://play.google.com/store/apps/details?id=com.app.basic_diet&hl=ar";

export const HERO_VIDEO_URL =
  process.env.NEXT_PUBLIC_HERO_VIDEO_URL?.trim() ||
  "https://d2ol7oe51mr4n9.cloudfront.net/user_3KHtpIw8buoAHWUqOhJRx8xmXhb/8b502fee-8e93-48dc-b341-68fc0a5617c3.mp4";

export const HERO_POSTER_URL =
  process.env.NEXT_PUBLIC_HERO_POSTER_URL?.trim() || "/media/hero-poster.webp";
