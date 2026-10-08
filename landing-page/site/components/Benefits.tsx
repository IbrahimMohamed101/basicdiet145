"use client";

import { useState } from "react";
import Image from "next/image";

export function Benefits() {
  const [grams, setGrams] = useState("150");
  const [meals, setMeals] = useState("3");
  const [delivery, setDelivery] = useState("توصيل");
  const groups = [
    { name: "grams", label: "حجم الوجبة", options: ["100", "150", "200"], value: grams, set: setGrams, unit: "g" },
    { name: "meals", label: "عدد الوجبات يوميًا", options: ["1", "2", "3", "4", "5"], value: meals, set: setMeals },
    { name: "delivery", label: "طريقة الاستلام", options: ["توصيل", "استلام"], value: delivery, set: setDelivery },
  ];

  const handleSubscriptionRequest = () => {
    const details = {
      location: "benefits" as const,
      grams: Number(grams),
      mealsPerDay: Number(meals),
      fulfillmentMethod: delivery === "توصيل" ? "delivery" as const : "pickup" as const,
    };
    const ua = navigator.userAgent.toLowerCase();
    const platform = /iphone|ipad|ipod/.test(ua) ? "ios" : /android/.test(ua) ? "android" : "desktop";
    window.dispatchEvent(new CustomEvent("basicdiet:cta", { detail: { location: details.location, platform } }));
    window.dispatchEvent(new CustomEvent("basicdiet:open-lead", { detail: details }));
  };

  return (
    <section className="benefits-section" aria-labelledby="benefits-title">
      <div className="page-shell benefits-shell">
        <div className="benefits-intro">
          <p className="eyebrow"><span />الاشتراك على مقاسك</p>
          <h2 id="benefits-title">مرونة حقيقية،<br /><span>على مقاس يومك.</span></h2>
          <p>أنت تختار التفاصيل. وتدير اشتراكك من التطبيق.</p>
          <div className="flexibility-controls" aria-label="جرّب خيارات اشتراكك">
            {groups.map((group) => (
              <fieldset key={group.name}>
                <legend>{group.label}</legend>
                <div className="flexibility-options">
                  {group.options.map((option) => (
                    <label key={option}>
                      <input type="radio" name={group.name} value={option} checked={group.value === option} onChange={() => group.set(option)} />
                      <span dir={group.unit ? "ltr" : undefined}>{option}{group.unit && <small> {group.unit}</small>}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <div className="flexibility-submit-row">
            <button type="button" className="button flexibility-submit-button" onClick={handleSubscriptionRequest}>
              اطلب اشتراكك <span aria-hidden="true">←</span>
            </button>
            <p className="flexibility-note">اختياراتك هتنتقل لطلب التواصل مباشرة.</p>
          </div>
        </div>
        <div className="flexibility-visual">
          <div className="flexibility-photo">
            <Image src="/api/meal-image?id=1y1jr9EftvmqVYpckSnuwi7SUwDoBpvzH" alt="سلمون من قائمة Basic Diet" fill sizes="(max-width: 800px) 95vw, 620px" loading="lazy" />
          </div>
          <div className="flexibility-receipt" role="status" aria-live="polite" aria-atomic="true">
            <span>تصوّر يومك</span>
            <div><strong dir="ltr">{grams}<small>g</small></strong><i aria-hidden="true" /><p><b>{meals}</b> {meals === "1" ? "وجبة" : "وجبات"}<br /><small>يوميًا · {delivery}</small></p></div>
            <small>مثال للتخصيص · الصورة للتعريف بالوجبة</small>
          </div>
        </div>
      </div>
      <noscript><style>{`.flexibility-receipt { display: none; } .flexibility-visual { padding-bottom: 0; }`}</style></noscript>
    </section>
  );
}
