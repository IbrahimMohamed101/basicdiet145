"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

// Disabled unless a verified Pixel ID and an explicit environment flag are supplied.
const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() || "";
const ENABLED = process.env.NEXT_PUBLIC_META_PIXEL_ENABLED === "true" && /^\d{8,20}$/.test(PIXEL_ID);
const CONSENT_KEY = "basicdiet_meta_tracking_consent_v1";
const SETTINGS_EVENT = "basicdiet:meta-consent-settings";
type Consent = "loading" | "unknown" | "granted" | "denied";
type FacebookPixel = ((...args: unknown[]) => void) & {
  queue: unknown[][];
  callMethod?: (...args: unknown[]) => void;
  push: (...args: unknown[]) => void;
  loaded: boolean;
  version: string;
};
declare global {
  interface Window {
    fbq?: FacebookPixel;
    _fbq?: FacebookPixel;
  }
}
const sentLeads = new Set<string>();

function privacySignal() {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return navigator.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

function loadPixel() {
  if (!ENABLED || window.fbq) return;
  const pixel = ((...args: unknown[]) => {
    if (pixel.callMethod) pixel.callMethod(...args);
    else pixel.queue.push(args);
  }) as FacebookPixel;
  pixel.queue = [];
  pixel.push = (...args: unknown[]) => { pixel.queue.push(args); };
  pixel.loaded = true;
  pixel.version = "2.0";
  window.fbq = pixel;
  window._fbq = pixel;
  // No script or request to Meta is made before explicit opt-in.
  pixel("init", PIXEL_ID);
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);
}

export function MetaPixel() {
  const pathname = usePathname();
  const [consent, setConsent] = useState<Consent>("loading");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!ENABLED) return;
    if (privacySignal()) { setConsent("denied"); return; }
    try {
      const saved = localStorage.getItem(CONSENT_KEY);
      setConsent(saved === "granted" || saved === "denied" ? saved : "unknown");
    } catch { setConsent("unknown"); }
    const open = () => setSettingsOpen(true);
    window.addEventListener(SETTINGS_EVENT, open);
    return () => window.removeEventListener(SETTINGS_EVENT, open);
  }, []);

  const allowed = ENABLED && consent === "granted" && !privacySignal();
  useEffect(() => {
    if (!allowed) return;
    loadPixel();
    if (lastPath.current !== pathname) {
      window.fbq?.("track", "PageView");
      lastPath.current = pathname;
    }
  }, [allowed, pathname]);

  useEffect(() => {
    if (!allowed) return;
    const onLead = (event: Event) => {
      const id = (event as CustomEvent<{ requestId?: string }>).detail?.requestId;
      if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || sentLeads.has(id)) return;
      sentLeads.add(id);
      // Event ID must match the future server CAPI event_id for deduplication.
      // No customer name, phone or other personal details go to the browser pixel.
      window.fbq?.("track", "Lead", {}, { eventID: id });
    };
    window.addEventListener("basicdiet:lead_submitted", onLead);
    return () => window.removeEventListener("basicdiet:lead_submitted", onLead);
  }, [allowed]);

  function choose(value: "granted" | "denied") {
    try { localStorage.setItem(CONSENT_KEY, value); } catch { /* private browsing */ }
    setSettingsOpen(false);
    if (consent === "granted" && value === "denied") {
      // Remove the already loaded third-party script on withdrawal.
      window.location.reload();
      return;
    }
    setConsent(value);
  }

  if (!ENABLED || consent === "loading" || privacySignal() || (consent !== "unknown" && !settingsOpen)) return null;
  return (
    <aside role="dialog" aria-label="إعدادات تتبع الإعلانات" dir="rtl"
      style={{ position: "fixed", zIndex: 9999, bottom: 16, left: 16, right: 16, maxWidth: 460,
        marginInline: "auto", borderRadius: 16, background: "#fff", color: "#153a2b",
        border: "1px solid #cbded4", boxShadow: "0 8px 30px #1038272b", padding: 16 }}>
      <strong style={{ display: "block", marginBottom: 6 }}>خصوصية الإعلانات</strong>
      <p style={{ margin: "0 0 12px", fontSize: 13, lineHeight: 1.7 }}>
        بموافقتك، نستخدم Meta Pixel لقياس زيارات الموقع وطلبات التواصل الناتجة عن إعلاناتنا.
        يمكنك رفض التتبع الإعلاني ومتابعة تصفح الموقع والتسجيل بشكل طبيعي.
        <a href="/privacy" style={{ color: "#107f55", marginInlineStart: 5 }}>سياسة الخصوصية</a>
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => choose("granted")}
          style={{ background: "#107f55", color: "#fff", padding: "10px 18px", border: 0, borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>
          أوافق على التتبع
        </button>
        <button type="button" onClick={() => choose("denied")}
          style={{ background: "#eef3ef", color: "#153a2b", padding: "10px 18px", border: "1px solid #cbded4", borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>
          رفض
        </button>
      </div>
    </aside>
  );
}

export function MetaTrackingSettings() {
  if (!ENABLED) return null;
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(SETTINGS_EVENT))}
      style={{ border: "1px solid #cbded4", borderRadius: 10, padding: "9px 14px", color: "#107f55", background: "#fff", cursor: "pointer" }}>
      إدارة الموافقة على تتبع الإعلانات
    </button>
  );
}
