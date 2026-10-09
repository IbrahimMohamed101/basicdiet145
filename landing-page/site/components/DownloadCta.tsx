"use client";

import { type MouseEvent, type ReactNode } from "react";
import { ANDROID_APP_URL, IOS_APP_URL } from "@/lib/app-links";

type DownloadLocation = "header" | "hero" | "plans" | "app" | "final";

export function DownloadCta({
  location,
  className = "button",
  children = "حمّل التطبيق",
}: {
  location: DownloadLocation;
  className?: string;
  children?: ReactNode;
}) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const ua = navigator.userAgent.toLowerCase();
    const platform = /iphone|ipad|ipod/.test(ua) ? "ios" : /android/.test(ua) ? "android" : "desktop";
    window.dispatchEvent(new CustomEvent("basicdiet:cta", { detail: { location, platform, intent: "download" } }));
    if (platform !== "desktop") {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent("basicdiet:store_click", {
        detail: { location, store: platform === "ios" ? "app_store" : "google_play" },
      }));
      window.location.assign(platform === "ios" ? IOS_APP_URL : ANDROID_APP_URL);
    }
  };

  return <a className={className} href="#app" onClick={handleClick}>{children}</a>;
}
