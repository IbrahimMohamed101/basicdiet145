"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";

const PIXEL_ID = "2169098140651936";
const CONSENT_KEY = "basicdiet_meta_pixel_consent_v1";
const SETTINGS_EVENT = "basicdiet:meta_pixel_settings";

type Consent = "loading" | "unset" | "accepted" | "declined";
type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[][];
  loaded?: boolean;
  version?: string;
};

declare global {
  interface Window {
    fbq?: Fbq;
  }
}

function initPixel() {
  if (window.fbq) return;
  const fbq = ((...args: unknown[]) => {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue?.push(args);
  }) as Fbq;
  fbq.queue = [];
  fbq.loaded = true;
  fbq.version = "2.0";
  window.fbq = fbq;
  fbq("init", PIXEL_ID);

  const script = document.createElement("script");
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  script.async = true;
  script.dataset.metaPixel = PIXEL_ID;
  document.head.appendChild(script);
}

function saveConsent(value: "accepted" | "declined") {
  try { localStorage.setItem(CONSENT_KEY, value); } catch { /* storage not available */ }
}

export function MetaPixelSettingsButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(SETTINGS_EVENT))}
      className="rounded-full border px-4 py-2 text-sm font-bold"
      style={{ color: "#108055", borderColor: "#dbe9d9" }}
    >
      تغيير تفضيلات التتبع
    </button>
  );
}

export function MetaPixel() {
  const pathname = usePathname();
  const lastTrackedPath = useRef<string | null>(null);
  const [consent, setConsent] = useState<Consent>("loading");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CONSENT_KEY);
      setConsent(stored === "accepted" || stored === "declined" ? stored : "unset");
    } catch {
      setConsent("unset");
    }
    const openSettings = () => setEditing(true);
    window.addEventListener(SETTINGS_EVENT, openSettings);
    return () => window.removeEventListener(SETTINGS_EVENT, openSettings);
  }, []);

  useEffect(() => {
    if (consent !== "accepted" || !pathname) return;
    initPixel();
    if (lastTrackedPath.current === pathname) return;
    lastTrackedPath.current = pathname;
    window.fbq?.("track", "PageView");
    if (pathname === "/menu") {
      window.fbq?.("track", "ViewContent", { content_name: "menu" });
    } else if (pathname === "/jeddah/subscription-prices") {
      window.fbq?.("track", "ViewContent", { content_name: "plans" });
    }
  }, [consent, pathname]);

  useEffect(() => {
    if (consent !== "accepted") return;

    const onLeadSuccess = (event: Event) => {
      const details = (event as CustomEvent<{ offer?: boolean }>).detail;
      window.fbq?.("track", "Lead", {
        content_name: details?.offer ? "discount_15_signup" : "subscription_contact",
      });
    };

    // A single delegated listener covers store and phone links on all pages,
    // including links that do not emit the site's existing analytics events.
    const onLinkClick = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      const link = element?.closest("a[href]") as HTMLAnchorElement | null;
      if (!link) return;
      if (link.protocol === "tel:") {
        window.fbq?.("track", "Contact");
      } else if (link.hostname === "apps.apple.com") {
        window.fbq?.("trackCustom", "AppStoreClick", { store: "ios" });
      } else if (link.hostname === "play.google.com") {
        window.fbq?.("trackCustom", "AppStoreClick", { store: "android" });
      }
    };

    window.addEventListener("basicdiet:lead_submitted", onLeadSuccess);
    document.addEventListener("click", onLinkClick, true);
    return () => {
      window.removeEventListener("basicdiet:lead_submitted", onLeadSuccess);
      document.removeEventListener("click", onLinkClick, true);
    };
  }, [consent]);

  const choose = (value: "accepted" | "declined") => {
    const wasAccepted = consent === "accepted";
    saveConsent(value);
    setEditing(false);
    lastTrackedPath.current = null;
    setConsent(value);
    if (value === "declined" && wasAccepted) {
      window.fbq?.("consent", "revoke");
      // Unload the existing Pixel script to prevent further events.
      window.location.reload();
    }
  };

  if (consent === "loading" || (consent !== "unset" && !editing)) return null;

  return (
    <aside
      aria-label="تفضيلات ملفات الارتباط والإعلانات"
      style={{
        position: "fixed", bottom: "max(12px, env(safe-area-inset-bottom))",
        left: 12, right: 12, zIndex: 9999, maxWidth: 580, margin: "0 auto",
        padding: 16, borderRadius: 16, background: "#173d31", color: "#fff",
        boxShadow: "0 6px 28px rgba(0,0,0,.2)", direction: "rtl",
      }}
    >
      <p style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 12 }}>
        نستخدم Meta Pixel بعد موافقتك لقياس نتائج الإعلانات وزيارات الموقع.
        يمكنك الرفض دون التأثير على الخدمة.{" "}
        <Link href="/privacy" style={{ textDecoration: "underline" }}>تفاصيل الخصوصية</Link>
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => choose("accepted")}
          style={{ padding: "9px 20px", borderRadius: 999, fontWeight: 700, background: "#fff", color: "#173d31" }}
        >
          السماح بالتتبع
        </button>
        <button
          type="button"
          onClick={() => choose("declined")}
          style={{ padding: "9px 20px", borderRadius: 999, border: "1px solid rgba(255,255,255,.65)", fontWeight: 700 }}
        >
          رفض التتبع
        </button>
      </div>
    </aside>
  );
}
