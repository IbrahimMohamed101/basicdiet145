"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { ANDROID_APP_URL, IOS_APP_URL } from "@/lib/app-links";

type LeadLocation = "hero" | "plans" | "final";

type OpenMenuLead = {
  location: LeadLocation;
  intent: string;
  planDays?: number;
  grams?: number;
  mealsPerDay?: number;
  name?: string;
  phone?: string;
};

function normalizeSaudiPhone(raw: string) {
  let value = raw.replace(/[\s()-]/g, "");
  if (value.startsWith("+966")) value = value.slice(4);
  else if (value.startsWith("966")) value = value.slice(3);
  else if (value.startsWith("0")) value = value.slice(1);
  return /^5\d{8}$/.test(value);
}

export function openMenuLead(details: OpenMenuLead) {
  // No personally identifying data is sent in tracking events.
  window.dispatchEvent(new CustomEvent("basicdiet:cta", {
    detail: { location: details.location, entry: "menu", placement: details.intent },
  }));
  window.dispatchEvent(new CustomEvent("basicdiet:open-lead", {
    detail: {
      location: details.location,
      sourceDetail: "menu_" + details.intent,
      fastContact: true,
      planDays: details.planDays,
      grams: details.grams,
      mealsPerDay: details.mealsPerDay,
      name: details.name,
      phone: details.phone,
    },
  }));
}

export function MenuContactButton({
  location, intent, planDays, grams, mealsPerDay, className = "", children,
}: {
  location: LeadLocation;
  intent: string;
  planDays?: number;
  grams?: number;
  mealsPerDay?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button type="button" className={className} onClick={() =>
      openMenuLead({ location, intent, planDays, grams, mealsPerDay })
    }>
      {children}
    </button>
  );
}

export function MenuLeadCapture() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  function startLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim().length < 2 || !normalizeSaudiPhone(phone)) {
      setError("اكتب اسمك ورقم جوال سعودي صحيح عشان نقدر نتواصل معك.");
      return;
    }
    setError("");
    // The shared LeadDialog loads a real sellable plan and asks for consent
    // before submitting through the same /api/leads -> /api/landing/leads path.
    openMenuLead({ location: "final", intent: "footer_form", name: name.trim(), phone });
  }

  return (
    <div className="menu-quick-lead" id="menu-quick-contact">
      <div className="menu-quick-lead-intro">
        <span className="menu-quick-lead-mark" aria-hidden="true">↗</span>
        <div>
          <strong>تبغى نساعدك تختار اشتراكك؟</strong>
          <p>سيب اسمك ورقمك، وفريق Basic Diet يتواصل معك بخصوص طلبك.</p>
        </div>
      </div>
      <form className="menu-quick-lead-form" onSubmit={startLead}>
        <label>
          <span>الاسم</span>
          <input required autoComplete="name" maxLength={70} minLength={2} value={name} onChange={e => setName(e.target.value)} placeholder="اسمك الكريم" />
        </label>
        <label>
          <span>رقم الجوال السعودي</span>
          <input required autoComplete="tel-national" type="tel" inputMode="tel" dir="ltr" maxLength={32} value={phone} onChange={e => setPhone(e.target.value)} placeholder="05xxxxxxxx" />
        </label>
        <button className="menu-quick-lead-submit" type="submit">
          كمّل طلب التواصل <span aria-hidden="true">←</span>
        </button>
      </form>
      {error && <p className="menu-quick-lead-error" role="alert">{error}</p>}
      <p className="menu-quick-lead-privacy">قبل الإرسال النهائي هتراجع اختيارك وتوافق على التواصل معك. مفيش اشتراك أو دفع بيتعمل من النموذج.</p>
      <div className="menu-quick-lead-alternative">
        <span>تفضل تسجّل بنفسك؟</span>
        <a href={IOS_APP_URL} onClick={() => window.dispatchEvent(new CustomEvent("basicdiet:store_click", { detail: { location: "app", store: "app_store", entry: "menu_footer" } }))} aria-label="تحميل Basic Diet من App Store">App Store</a>
        <a href={ANDROID_APP_URL} onClick={() => window.dispatchEvent(new CustomEvent("basicdiet:store_click", { detail: { location: "app", store: "google_play", entry: "menu_hero" } }))} aria-label="تحميل Basic Diet من Google Play">Google Play</a>
      </div>
    </div>
  );
}

export function MenuMobileConversionBar() {
  return (
    <div className="menu-mobile-conversion-bar" aria-label="ابدأ مع Basic Diet">
      <MenuContactButton location="final" intent="mobile_fixed" className="menu-mobile-primary">
        سيب رقمك ونكلمك <span aria-hidden="true">←</span>
      </MenuContactButton>
      <a href="#menu-download" className="menu-mobile-secondary">حمّل التطبيق</a>
    </div>
  );
}
