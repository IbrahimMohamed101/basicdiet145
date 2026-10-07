export const IOS_APP_URL =
  process.env.NEXT_PUBLIC_IOS_APP_URL ??
  "https://apps.apple.com/ar/app/basic-diet/id6775085745";

export const ANDROID_APP_URL =
  process.env.NEXT_PUBLIC_ANDROID_APP_URL?.trim() ?? "";

export const HERO_VIDEO_URL =
  process.env.NEXT_PUBLIC_HERO_VIDEO_URL?.trim() ||
  "/media/basicdiet-hero-v1.mp4";

export const HERO_POSTER_URL =
  process.env.NEXT_PUBLIC_HERO_POSTER_URL?.trim() ||
  "/media/basicdiet-hero-poster-v1.jpg";
