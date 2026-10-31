"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

// The checkout/contact dialog and menu stay immediately interactive. Only the
// below-the-fold home calculator is deferred until it is nearly in view.
// Public package prices are still server-rendered by PlanPriceHighlights.
const Calculator = dynamic(
  () => import("./PlanCalculator").then((module) => module.PlanCalculator),
  {
    ssr: false,
    loading: () => <CalculatorPlaceholder />,
  },
);

function CalculatorPlaceholder() {
  return (
    <section id="plans" className="bd-calculator-section bd-calculator-home"
      aria-labelledby="plans-heading" aria-busy="true">
      <div className="page-shell" style={{ minHeight: 440, paddingBlock: 72 }}>
        <h2 id="plans-heading">احسب باقتك.</h2>
        <p>اختر مدة الاشتراك وحجم وجباتك وعددها اليومي.</p>
        <p>جاري تجهيز حاسبة الاشتراكات...</p>
        <a href="/jeddah/subscription-prices">شاهد أسعار الاشتراكات الحالية</a>
      </div>
    </section>
  );
}

export function DeferredPlanCalculator() {
  const marker = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (window.location.hash === "#plans" || !("IntersectionObserver" in window)) {
      setActive(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setActive(true);
      observer.disconnect();
    }, { rootMargin: "900px 0px" });
    if (marker.current) observer.observe(marker.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={marker} data-deferred-calculator="">
      {active ? <Calculator sectionId="plans" context="home" /> : <CalculatorPlaceholder />}
    </div>
  );
}
