"use client";

import type { ReactNode } from "react";

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

    window.dispatchEvent(new CustomEvent("basicdiet:open-lead", { detail: { location, planDays } }));
  };

  return (
    <button type="button" onClick={handleClick} className={className}>
      {children}
    </button>
  );
}
