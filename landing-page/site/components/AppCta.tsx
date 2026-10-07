"use client";

import { ANDROID_APP_URL, IOS_APP_URL } from "@/lib/app-links";

type AppCtaProps = {
  location: "header" | "hero";
  className?: string;
  children?: React.ReactNode;
};

function detectPlatform() {
  if (typeof navigator === "undefined") return "desktop";

  const ua = navigator.userAgent.toLowerCase();

  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";

  return "desktop";
}

export function AppCta({
  location,
  className = "",
  children = "ابدأ اشتراكك",
}: AppCtaProps) {
  const handleClick = () => {
    const platform = detectPlatform();

    window.dispatchEvent(
      new CustomEvent("basicdiet:cta", {
        detail: { location, platform },
      }),
    );

    if (platform === "ios") {
      window.location.href = IOS_APP_URL;
      return;
    }

    if (platform === "android" && ANDROID_APP_URL) {
      window.location.href = ANDROID_APP_URL;
      return;
    }

    const appSection = document.getElementById("app");
    if (appSection) {
      appSection.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    window.location.href = IOS_APP_URL;
  };

  return (
    <button type="button" onClick={handleClick} className={className}>
      {children}
    </button>
  );
}
