"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { SITE_OFFER_CTA, SITE_OFFER_PERCENT } from "@/lib/site-offer";
export const PROMO_PERCENT = SITE_OFFER_PERCENT;
// The offer identifier is internal attribution only; never display a coupon code.

export function openPromoLead(placement: string, plan?: { days: number; grams: number; meals: number; fulfillment: "pickup" | "delivery" }) {
  const isMenu = window.location.pathname === "/menu";
  const detail = {
    location: placement === "header" ? "header" : placement.includes("hero") ? "hero" : "final",
    sourceDetail: (isMenu ? "menu_" : "home_") + "basic15_" + placement,
    fastContact: true,
    promoIntent: "BASIC15",
    planOptional: !plan,
    ...(plan ? { planDays: plan.days, grams: plan.grams, mealsPerDay: plan.meals, fulfillmentMethod: plan.fulfillment } : {}),
  };
  window.dispatchEvent(new CustomEvent("basicdiet:cta", { detail: { location: detail.location, promotion: "BASIC15", placement } }));
  window.dispatchEvent(new CustomEvent("basicdiet:open-lead", { detail }));
}

export function PromoOfferText({ location = "hero" }: { location?: "hero" | "menu" }) {
  return (
    <div className={"bd-offer-copy bd-offer-copy--" + location}>
      <span className="bd-offer-percent" aria-hidden="true">15%</span>
      <div className="bd-offer-body">
        <strong>سجّل من الموقع ووفّر 15% على اشتراكك</strong>
        <small>سجّل اسمك وجوالك، ونساعدك تختار باقتك. بدون دفع الآن.</small>
        <PromoOfferButton className="bd-offer-register-link" placement={location === "menu" ? "menu_hero" : "hero"}>{SITE_OFFER_CTA} <span aria-hidden="true">←</span></PromoOfferButton>
      </div>
    </div>
  );
}

export function PromoOfferButton({ placement, className = "", children }: { placement: string; className?: string; children: ReactNode }) {
  return <button type="button" className={className} onClick={() => openPromoLead(placement)}>{children}</button>;
}

export function PromoHeaderButton({ className = "" }: { className?: string }) {
  return <button type="button" className={className} onClick={() => openPromoLead("header")}>{SITE_OFFER_CTA}</button>;
}

export function PromoMobileBar() {
  const path = usePathname();
  const [visible, setVisible] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  useEffect(() => {
    if (path !== "/" && path !== "/menu") return;
    const dialog = document.querySelector<HTMLDialogElement>(".lead-dialog");
    const syncDialog = () => setDialogOpen(Boolean(dialog?.open || document.querySelector(".menu-dialog-backdrop")));
    const observer = new MutationObserver(syncDialog);
    observer.observe(document.body, { attributes: true, attributeFilter: ["open"], childList: true, subtree: true });
    syncDialog();
    const update = () => {
      const form = document.getElementById("menu-quick-contact");
      const calculator = document.querySelector(".bd-calculator-section");
      const inView = (element: Element | null) => {
        if (!element) return false;
        const bounds = element.getBoundingClientRect();
        return bounds.top < window.innerHeight - 90 && bounds.bottom > 115;
      };
      setVisible(window.scrollY > 220 && !inView(form) && !inView(calculator));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update); window.removeEventListener("resize", update); observer?.disconnect(); };
  }, [path]);
  if (!visible || dialogOpen || (path !== "/" && path !== "/menu")) return null;
  return <div className="bd-offer-mobile-bar" role="region" aria-label="عرض اشتراك بيسك دايت">
    <span><b>15% خصم</b><small>على قيمة الباقة فقط</small></span>
    <button type="button" onClick={() => openPromoLead("mobile")}>{SITE_OFFER_CTA} ←</button>
  </div>;
}
