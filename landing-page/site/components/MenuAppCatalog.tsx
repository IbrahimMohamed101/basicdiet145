"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { MenuContactButton } from "./MenuLeadCapture";
import { StoreLinks } from "./StoreLinks";
import { menuArtUrl } from "@/lib/menu-art";

type AppMenuItem = {
  id: string; key: string; name: string; image: string;
  extraPriceHalala: number; isPremium: boolean; type: "product" | "option";
};
type AppSection = { id: string; key: string; title: string; selectionType: string; items: AppMenuItem[] };

// Images are real assets in the restaurant's Drive; the app's own image takes precedence.
const drivePhotoByName: Record<string, string> = {
  "دجاج تكا": "1nV7bXQ6gkvuqujifJExqEI54zDRFq5--",
  "دجاج اسيوي": "16ODUfITCjcKtZXzaKekc6M1ekkbHjNSb",
  "دجاج باربكيو": "1zmxsFVYROw1_3cTpaXKV2GDxX-lHzofQ",
  "دجاج بالزبدة": "1H2InhiMdECMrs8bsf6L_h9yM-rOfYqw6",
  "دجاج بالليمون": "1EQDqVq3zMgYFPR__zwIla8hUGutkmiL_",
  "دجاج كريمة": "1sWQhsJSvuiu016TMwfx-QMwBjpGVHGxs",
  "دجاج بالملوخية": "1Xn_zM9vUEmYx_BNcJOIyRLpGhbyaKz7i",
  "سالمون": "1y1jr9EftvmqVYpckSnuwi7SUwDoBpvzH",
  "جمبري": "1bezXaW35QSvbEV7yEWtShjbltYsN5E1b",
  "سمك فيليه": "1POU5X9gYEz1ohchifjwDVbCR_jTnJ7Bg",
  "لحم استرغانوف": "1gciSqekCnVLdjxl9jv7HAF8mUgAn2sc_",
  "شيش طاووق": "1fw69ZcOyMtusTGj9Cx1tVfvpf6ZyJNAu",
  "رز ابيض": "1J0uWPLXV7sTiQEfZzAf0W0WK_HrYpt5O",
  "رز بالكركم": "1QKGfdTGcXJKk_dk9gpg4dJlb27ibEbcD",
  "بطاطا مشوية": "1Yee9VzPNT76BYe8BwTWrxjsq1Y6qZoBl",
  "بطاطس مشوي": "1Yee9VzPNT76BYe8BwTWrxjsq1Y6qZoBl",
  "باستا الفريدو": "1JR-lQhqRwbwjB9p7nk2n6LNBBiAW1Dne",
  "باستا صوص احمر": "1O54P_hDBopu9POcVVB6XEOYeNdLiYFR5",
  "سلطة بيسك": "1wCFHNOyUeKD87rLuGVvWAWGVLnndI8a5",
  "سلطة خضراء": "1ZBMwQc-yIT1QjphDRNRZLTeXCbUFVRCU",
  "سلطة سيزر": "1IxuZvbSI85kxn9pwF97kGCeScVpz0fdv",
  "سلطة يونانية": "1QSkqR9fYxMC2mR-0cgLGMPaOZ7qJNWT3",
  "سلطة الجولدن": "1Z8g0vsxglmgktkzMSGOoLLMYyQegmC3Q",
};

function photoFor(item: AppMenuItem) {
  if (item.image) return item.image;
  const key = item.name.replace(/[\u064B-\u065F]/g, "").replace(/[أإآ]/g,"ا").trim().replace(/\s+/g," ");
  const id = drivePhotoByName[key];
  return id ? "/api/meal-image?id=" + id : "";
}

function AppMenuPhoto({ item, sectionTitle }: { item: AppMenuItem; sectionTitle: string }) {
  const photo = photoFor(item);
  const [failed, setFailed] = useState(false);
  const illustrative = !photo || failed;
  const src = illustrative ? menuArtUrl(item.name, sectionTitle) : photo;
  return (
    <div className="menu-app-photo">
      <Image key={src} src={src}
        alt={illustrative ? "صورة توضيحية: " + item.name : item.name}
        fill sizes="(max-width:600px) 44vw,190px"
        unoptimized={src.startsWith("https://") || src.startsWith("/api/menu-art")}
        onError={() => setFailed(true)} />
      {illustrative && <span className="menu-photo-disclosure">صورة توضيحية</span>}
    </div>
  );
}

export function MenuAppCatalog() {
  const [sections, setSections] = useState<AppSection[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [activeId, setActiveId] = useState("");
  const [visibleCount, setVisibleCount] = useState(12);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/menu-app-catalog", { cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("CATALOG_UNAVAILABLE");
        const body = await response.json() as { status?: boolean; source?: string; data?: AppSection[] };
        if (body.status !== true || body.source !== "published_subscription_meal_builder"
          || !Array.isArray(body.data) || body.data.length === 0) throw new Error("CATALOG_INVALID");
        if (!cancelled) {
          setSections(body.data);
          setActiveId(body.data[0].id);
          setState("ready");
        }
      })
      .catch(() => { if (!cancelled) setState("unavailable"); });
    return () => { cancelled = true; };
  }, []);

  const activeSection = useMemo(() => sections.find(s => s.id === activeId) || sections[0], [sections, activeId]);
  const items = activeSection?.items || [];
  const total = sections.reduce((sum, section) => sum + section.items.length, 0);
  const sar = new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 2 });

  return (
    <section className="menu-app-catalog-section" id="menu-app-catalog" aria-labelledby="menu-app-catalog-title">
      <div className="page-shell">
        <div className="menu-app-head">
          <div>
            <p className="menu-kicker"><span aria-hidden="true" /> FROM THE BASIC DIET APP</p>
            <h2 id="menu-app-catalog-title">اختيارات الوجبات من التطبيق.</h2>
            <p>دجاج، لحوم، سمك، أرز ومكرونة وخيارات أخرى من المنيو المنشور للاشتراكات. دي مكونات وخيارات داخل الباقة، مش أسعار أطباق منفردة.</p>
          </div>
          {state === "ready" && <span className="menu-app-live">من كتالوج التطبيق الحالي</span>}
        </div>
        {state === "loading" && <div className="menu-app-status" role="status">جاري تحميل خيارات الاشتراكات من التطبيق…</div>}
        {state === "unavailable" && (
          <div className="menu-app-status" role="status">
            تعذر تحميل كتالوج الاشتراكات الآن. تقدر تستعرض الباقات من التطبيق، أو ترجع لمنيو الأصناف وأسعار الكاشير بالأعلى.
            <div className="menu-app-stores"><StoreLinks location="app" /></div>
          </div>
        )}
        {state === "ready" && activeSection && (
          <>
            <div className="menu-app-total">المنيو المنشور: {total} اختيار موزع على {sections.length} أقسام</div>
            <div className="menu-app-section-tabs" role="group" aria-label="أقسام منيو التطبيق">
              {sections.map(section => (
                <button key={section.id} type="button" aria-pressed={section.id === activeSection.id}
                  className={section.id === activeSection.id ? "is-active" : ""}
                  onClick={() => { setActiveId(section.id); setVisibleCount(12); }}>
                  {section.title} <small>{section.items.length}</small>
                </button>
              ))}
            </div>
            <div className="menu-app-grid">
              {items.slice(0, visibleCount).map((item,index) => {
                return <article className="menu-app-card" key={item.id || item.key + "-" + index}>
                  <AppMenuPhoto item={item} sectionTitle={activeSection.title} />
                  <div className="menu-app-card-copy">
                    <h3>{item.name}</h3>
                    {item.extraPriceHalala > 0
                      ? <small>إضافة: {sar.format(item.extraPriceHalala / 100)} ر.س</small>
                      : <small>اختيار داخل الاشتراك</small>}
                    {item.isPremium && <span className="menu-app-premium">بريميوم</span>}
                  </div>
                </article>;
              })}
            </div>
            {visibleCount < items.length &&
              <div className="menu-more-wrap"><button type="button" className="menu-more" onClick={() => setVisibleCount(v => v + 12)}>عرض مزيد من الخيارات <span aria-hidden="true">↓</span></button></div>}
            <p className="menu-app-note">الصور من كتالوج التطبيق أو معرض المطعم، وحين لا توجد صورة مؤكدة نستخدم رسماً توضيحياً مميزاً بوضوح. الأسعار الإضافية تظهر فقط إذا أرجعها النظام.</p>
            <div className="menu-app-cta">
              <MenuContactButton location="final" intent="app_catalog" className="menu-app-contact">
                محتاج مساعدة تختار اشتراكك؟ سيب رقمك <span aria-hidden="true">←</span>
              </MenuContactButton>
              <a href="#menu-download">أو حمّل التطبيق بنفسك</a>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
