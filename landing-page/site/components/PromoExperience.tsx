"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export const PROMO_PERCENT = 15;
export const PROMO_CODE = "BASIC15";

export function openPromoLead(placement: string, plan?: { days: number; grams: number; meals: number; fulfillment: "pickup" | "delivery" }) {
  const isMenu = window.location.pathname === "/menu";
  const detail = {
    location: placement === "header" ? "header" : placement === "hero" ? "hero" : "final",
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
      <div><strong>سجّل بياناتك واستفد من خصم 15% على اشتراكك</strong>
        <small>على قيمة الباقة فقط، عند استيفاء شروط العرض وتطبيق الكود BASIC15.</small>
      </div>
    </div>
  );
}

export function PromoHeaderButton({ className = "" }: { className?: string }) {
  return <button type="button" className={className} onClick={() => openPromoLead("header")}>سجّل لخصم 15%</button>;
}

export function PromoMobileBar() {
  const path = usePathname();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (path !== "/" && path !== "/menu") return;
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
    return () => { window.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [path]);
  if (!visible || (path !== "/" && path !== "/menu")) return null;
  return <div className="bd-offer-mobile-bar" role="region" aria-label="عرض اشتراك بيسك دايت">
    <span><b>15% خصم</b><small>على قيمة الباقة فقط</small></span>
    <button type="button" onClick={() => openPromoLead("mobile")}>سجّل لخصم 15% ←</button>
  </div>;
}
