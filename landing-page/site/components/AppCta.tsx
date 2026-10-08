"use client";

import type { ReactNode } from "react";
import { ANDROID_APP_URL, IOS_APP_URL } from "@/lib/app-links";
import { scrollIntoViewWithMotion } from "@/lib/motion";

type AppCtaProps = {
  location: "header" | "hero" | "app" | "plans" | "final";
  className?: string;
  planDays?: number;
  children?: ReactNode;
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
  planDays,
  children = "ابدأ اشتراكك",
}: AppCtaProps) {
  const handleClick = () => {
    const platform = detectPlatform();

    window.dispatchEvent(
      new CustomEvent("basicdiet:cta", {
        detail: { location, platform, planDays },
      }),
    );

    if (platform === "ios") {
      window.dispatchEvent(new CustomEvent("basicdiet:store_click", { detail: { location, store: "app_store" } }));
      window.location.assign(IOS_APP_URL);
      return;
    }

    if (platform === "android" && ANDROID_APP_URL) {
      window.dispatchEvent(new CustomEvent("basicdiet:store_click", { detail: { location, store: "google_play" } }));
      window.location.assign(ANDROID_APP_URL);
      return;
    }

    const appSection = document.getElementById("app");
    if (appSection) {
      scrollIntoViewWithMotion(appSection);
      return;
    }

    window.location.assign(IOS_APP_URL);
  };

  return (
    <button type="button" onClick={handleClick} className={className}>
      {children}
    </button>
  );
}
