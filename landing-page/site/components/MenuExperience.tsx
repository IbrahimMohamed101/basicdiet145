"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { menuPreviewItems, type MenuPreviewItem } from "@/lib/menu-preview-items";
import { MenuLeadCapture, MenuContactButton } from "@/components/MenuLeadCapture";
import { PlanCalculator } from "@/components/PlanCalculator";
import { PromoOfferText, PromoOfferButton } from "@/components/PromoExperience";
import { StoreLinks } from "@/components/StoreLinks";
import { menuArtUrl } from "@/lib/menu-art";
import { verifiedMenuDetails } from "@/lib/menu-item-details";

const foodImage = "https://res.cloudinary.com/da8tyika6/image/upload/f_auto,q_auto:eco,c_limit,w_900/f_auto,q_auto/v1/basicdiet145/menu/file_lltkbm";
const secondImage = "/api/meal-image?id=1IxuZvbSI85kxn9pwF97kGCeScVpz0fdv";
const thirdImage = "/api/meal-image?id=1y1jr9EftvmqVYpckSnuwi7SUwDoBpvzH";
const menuShowcaseCategories = [
  { label: "الوجبات", tag: "MAIN DISHES", image: foodImage },
  { label: "السلطات", tag: "FRESH SALADS", image: secondImage },
  { label: "الفطور", tag: "BREAKFAST", image: "https://res.cloudinary.com/da8tyika6/image/upload/f_auto,q_auto:eco,c_limit,w_900/f_auto,q_auto/v1/basicdiet145/menu/file_pwtdt4" },
  { label: "الساندويتشات", tag: "SANDWICHES", image: "/api/meal-image?id=1Jk3Xg_v-3dQRVx41KNlq_cr5F3aGYZHC" },
] as const;

const menuCategories = [
  "الكل", "الوجبات", "السلطات", "الفطور", "الساندويتشات",
  "الحلويات", "المشروبات", "الزبادي", "الآيس كريم",
];
const categoryOrder = menuCategories.filter((x) => x !== "الكل");
// Curated visual order: authentic, distinct food photos first — not duplicate gram variants.
const featuredItemIds = ["186", "183", "77", "78", "173", "211", "26", "204", "185", "195"];
const sizeVariantFamilies = [
  { key: "shrimp", title: "جمبري", sizes: [{ id: "77", grams: 100 }, { id: "83", grams: 150 }, { id: "84", grams: 200 }] },
  { key: "salmon", title: "سالمون", sizes: [{ id: "78", grams: 100 }, { id: "88", grams: 150 }, { id: "89", grams: 200 }] },
  { key: "fillet", title: "سمك فيليه", sizes: [{ id: "85", grams: 100 }, { id: "86", grams: 150 }, { id: "87", grams: 200 }] },
] as const;
const menuItemById = new Map(menuPreviewItems.map(item => [item.id, item]));
const variantFamilyById = new Map<string, (typeof sizeVariantFamilies)[number]>(sizeVariantFamilies.flatMap(family => family.sizes.map(size => [size.id, family] as const)));


const mealProteins = ["دجاج مشوي", "تونا", "بيض مسلوق", "سالمون", "جمبري"];
const mealCarbs = ["رز أبيض", "رز بالكركم", "رز برياني", "كينوا", "بطاطس مشوي", "بطاطا حلوة", "باستا ألفريدو"];
const mealProteinPhotos: Record<string, string> = {
  "دجاج مشوي": "/api/meal-image?id=1fw69ZcOyMtusTGj9Cx1tVfvpf6ZyJNAu",
  "بيض مسلوق": "/api/menu-art?kind=eggs&tone=cream",
  "تونا": "/api/meal-image?id=1niUYE8DPHKnOuXEA-8DO9DYDJs3xv82U",
  "سالمون": "/api/meal-image?id=1y1jr9EftvmqVYpckSnuwi7SUwDoBpvzH",
  "جمبري": "/api/meal-image?id=1bezXaW35QSvbEV7yEWtShjbltYsN5E1b",
};
const mealCarbPhotos: Record<string, string> = {
  "رز برياني": "/api/menu-art?kind=rice&tone=orange",
  "كينوا": "/api/menu-art?kind=rice&tone=green",
  "بطاطا حلوة": "/api/menu-art?kind=potato&tone=orange",
  "رز أبيض": "/api/meal-image?id=1J0uWPLXV7sTiQEfZzAf0W0WK_HrYpt5O",
  "رز بالكركم": "/api/meal-image?id=1QKGfdTGcXJKk_dk9gpg4dJlb27ibEbcD",
  "بطاطس مشوي": "/api/meal-image?id=1Yee9VzPNT76BYe8BwTWrxjsq1Y6qZoBl",
  "باستا ألفريدو": "/api/meal-image?id=1JR-lQhqRwbwjB9p7nk2n6LNBBiAW1Dne",
};
const saladGroups = [
  { key: "leafy", label: "الورقيات", options: ["خس", "جرجير", "ملفوف"], min: 2, max: 2 },
  { key: "vegetables", label: "الخضروات", options: ["خيار", "طماطم", "جزر", "ذرة", "حمص", "بروكلي", "زيتون أخضر"], min: 0, max: 7 },
  { key: "protein", label: "البروتين", options: ["دجاج مشوي", "تونا", "بيض مسلوق", "جمبري"], min: 1, max: 1 },
  { key: "fruits", label: "الفواكه", options: ["مانجا", "رمان", "تفاح أخضر", "فراولة"], min: 0, max: 4 },
  { key: "extras", label: "جبن ومكسرات", options: ["جبن فيتا", "كاجو", "عين الجمل"], min: 0, max: 2 },
  { key: "sauce", label: "الصوص", options: ["رانش", "سيزر", "زبادي بالنعناع", "بالسميك"], min: 1, max: 1 },
] as const;

type SaladGroupKey = (typeof saladGroups)[number]["key"];

function Heading({ tag, title, copy, id }: { tag: string; title: string; copy: string; id?: string }) {
  return (
    <div className="menu-heading">
      <div>
        <p className="menu-kicker"><span aria-hidden="true" />{tag}</p>
        <h2 id={id}>{title}</h2>
      </div>
      <p>{copy}</p>
    </div>
  );
}

function ProductImage({ item, priority = false }: { item: MenuPreviewItem; priority?: boolean }) {
  const [failed, setFailed] = useState(false);
  const src = failed || !item.image ? menuArtUrl(item.name, item.category) : item.image;
  const illustrative = item.illustrativeImage === true || !item.image || failed;
  return (
    <div className="menu-product-photo">
      <Image key={src} src={src}
        alt={illustrative ? "رسم أو صورة توضيحية للصنف: " + item.name : item.name}
        fill sizes="(max-width: 600px) 46vw, (max-width: 1000px) 34vw, 300px"
        quality={78} priority={priority} unoptimized={src.startsWith("https://") || src.startsWith("/api/menu-art")}
        onError={() => setFailed(true)} />
      {illustrative && <span className="menu-photo-disclosure">صورة توضيحية</span>}
    </div>
  );
}

export function MenuExperience() {
  const [activeBuilder, setActiveBuilder] = useState<"meal" | "salad">("meal");
  const [protein, setProtein] = useState("دجاج مشوي");
  const [carbs, setCarbs] = useState<string[]>([]);
  const [saladTab, setSaladTab] = useState<SaladGroupKey>("leafy");
  const [saladChoices, setSaladChoices] = useState<Record<string, string[]>>({});
  const [category, setCategory] = useState("الكل");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(12);
  const [selectedProduct, setSelectedProduct] = useState<MenuPreviewItem | null>(null);

  const numberFormatter = new Intl.NumberFormat("ar-SA");


  const filteredItems = useMemo(() => menuPreviewItems.filter((item) => {
    return (category === "الكل" || item.category === category) &&
      (search.trim() === "" || item.name.includes(search.trim()) || item.id.includes(search.trim()));
  }).sort((a, b) => {
    if (category === "الكل" && !search.trim()) {
      const indexA = featuredItemIds.indexOf(a.id);
      const indexB = featuredItemIds.indexOf(b.id);
      if (indexA !== -1 || indexB !== -1) return (indexA < 0 ? 999 : indexA) - (indexB < 0 ? 999 : indexB);
    }
    return categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category)
      || Number(Boolean(b.image)) - Number(Boolean(a.image));
  }), [category, search]);

  const displayItems = useMemo(() => {
    const seenFamilies = new Set<string>();
    return filteredItems.filter(item => {
      const family = variantFamilyById.get(item.id);
      if (!family) return true;
      if (seenFamilies.has(family.key)) return false;
      seenFamilies.add(family.key);
      return true;
    });
  }, [filteredItems]);

  const activeSaladGroup = saladGroups.find((group) => group.key === saladTab) || saladGroups[0];
  const saladGroupStatus = saladGroups.map((group) => {
    const count = (saladChoices[group.key] || []).length;
    return { key: group.key, complete: group.min > 0 ? count >= group.min && count <= group.max : count > 0, count };
  });
  const saladTotal = Object.values(saladChoices).reduce((sum, chosen) => sum + chosen.length, 0);
  const selectedSaladLabels = saladGroups.flatMap(group => saladChoices[group.key] || []);
  const mealSelections = 1 + carbs.length;
  const saladMandatoryComplete = saladGroups.filter(group => group.min > 0 && (saladChoices[group.key] || []).length >= group.min).length;

  function toggleCarb(item: string) {
    setCarbs((previous) => previous.includes(item)
      ? previous.filter((value) => value !== item)
      : previous.length >= 2 ? previous : [...previous, item]);
  }

  function toggleSaladOption(key: SaladGroupKey, item: string, max: number) {
    setSaladChoices((previous) => {
      const current = previous[key] || [];
      const updated = current.includes(item)
        ? current.filter((value) => value !== item)
        : max === 1 ? [item] : current.length < max ? [...current, item] : current;
      return { ...previous, [key]: updated };
    });
  }

  useEffect(() => {
    if (!selectedProduct) return;
    function escapeDialog(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedProduct(null);
    }
    window.addEventListener("keydown", escapeDialog);
    return () => window.removeEventListener("keydown", escapeDialog);
  }, [selectedProduct]);

  return (
    <main className="menu-page" id="menu-main">
      <span id="top" aria-hidden="true" />
      <section className="menu-hero" id="menu-top" aria-labelledby="menu-hero-title">
        <div className="page-shell menu-hero-grid">
          <div className="menu-hero-copy">
            <span className="menu-hero-eyebrow"><span className="menu-dot" /> BASIC DIET / OUR MENU</span>
            <h1 id="menu-hero-title">منيو بيسك دايت.<br /><em>وجبات تحبّها.</em></h1>
            <p>وجبات دجاج ولحم وسمك، سلطات، فطور وساندويتشات. تصفّح الصور والأسعار واختار اللي يعجبك.</p>
            <PromoOfferText location="menu" />
            <div className="menu-hero-actions">
              <a className="menu-primary-link" href="#menu-products">استكشف الأطباق <span aria-hidden="true">↙</span></a>
              <a className="menu-ghost-link" href="#menu-custom">كوّن وجبتك <span aria-hidden="true">←</span></a>
            </div>
            <div className="menu-hero-mini-tagline" aria-label="أقسام المنيو">وجبات <span>•</span> سلطات <span>•</span> فطور <span>•</span> ساندويتشات</div>
          </div>
          <div className="menu-hero-art" aria-label="صور أطباق من معرض بيسك دايت">
            <div className="menu-hero-halo" aria-hidden="true" />
            <div className="menu-hero-orbit" aria-hidden="true" />
            <div className="menu-hero-plate menu-hero-plate--main">
              <Image src={foodImage} alt="باستا وايت صوص بالدجاج من منيو بيسك دايت" fill priority unoptimized sizes="(max-width: 700px) 72vw, 430px" />
            </div>
            <div className="menu-hero-plate menu-hero-plate--mini">
              <Image src={secondImage} alt="سلطة سيزر بالدجاج من منيو بيسك دايت" fill sizes="(max-width: 700px) 35vw, 190px" />
            </div>
            <div className="menu-hero-plate menu-hero-plate--third"><Image src={thirdImage} alt="طبق سالمون من منيو بيسك دايت" fill sizes="(max-width: 700px) 22vw, 150px" /></div>


          </div>
        </div>
        <div className="page-shell menu-preview-ribbon" role="note">
          <span>الصور المعلّمة «صورة توضيحية» للعرض فقط. الأسعار حسب قائمة المطعم، ويُرجى تأكيد توفر الأصناف عند التواصل.</span>
        </div>
      </section>

      <section className="menu-featured-categories" aria-labelledby="menu-category-title">
        <div className="page-shell">
          <div className="menu-featured-intro">
            <div><p className="menu-kicker"><span aria-hidden="true" /> EXPLORE THE MENU</p><h2 id="menu-category-title">ابدأ باللي تشتهيه.</h2></div>
            <a href="#menu-products">شوف المنيو بالكامل <span aria-hidden="true">←</span></a>
          </div>
          <div className="menu-featured-grid">
            {menuShowcaseCategories.map((group) => (
              <a key={group.label} href="#menu-products" className="menu-featured-card"
                onClick={() => { setCategory(group.label); setSearch(""); setVisibleCount(12); }}>
                <Image src={group.image} alt="" fill unoptimized={group.image.startsWith("https://")} sizes="(max-width: 760px) 60vw, 26vw" />
                <span className="menu-featured-overlay" aria-hidden="true" />
                <span className="menu-featured-card-content"><small>{group.tag}</small><strong>{group.label}</strong><b aria-hidden="true">←</b></span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="menu-section menu-catalog-section" id="menu-products" aria-labelledby="menu-catalog-title">
        <div className="page-shell">
          <Heading id="menu-catalog-title" tag="FULL MENU / القائمة" title="اختار وجبتك بعينك." copy="تصفح أطباق بيسك دايت بالصور والأسعار واختار القسم اللي يناسبك." />
          <div className="menu-catalog-tools">
            <div className="menu-filter-strip" role="group" aria-label="تصنيفات المنيو">
              {menuCategories.map((group) => <button key={group} type="button" aria-pressed={category === group} className={category === group ? "is-active" : ""} onClick={() => { setCategory(group); setVisibleCount(12); }}>{group}</button>)}
            </div>
            <label className="menu-search"><span className="sr-only">ابحث عن صنف</span><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => { setSearch(event.target.value); setVisibleCount(12); }} placeholder="ابحث عن وجبتك المفضلة" type="search" /></label>
          </div>
          <div className="menu-catalog-count"><span>نتائج البحث: <b>{filteredItems.length}</b> صنف <small>· الأحجام المتعددة في كارت واحد</small></span></div>
          <div className="menu-product-grid">
            {displayItems.slice(0, visibleCount).map((item) => {
              const family = variantFamilyById.get(item.id);
              const activeItem = item;
              return (
                <article className="menu-product-card" key={family?.key || item.id}>
                  <ProductImage key={activeItem.id} item={activeItem} />
                  <div className="menu-product-body">
                    <span className="menu-product-category">{activeItem.category}</span>
                    <h3>{family?.title || activeItem.name}</h3>
                    {family && <p className="menu-product-weights-hint">متاح 100 / 150 / 200 جم · اختار الحجم من التفاصيل</p>}
                    <div className="menu-product-bottom">
                      <div><small>{family ? "يبدأ من" : "السعر"}</small><strong>{numberFormatter.format(activeItem.priceSar)} <span>ر.س</span></strong></div>
                      <button type="button" onClick={() => setSelectedProduct(activeItem)} aria-label={"تفاصيل " + activeItem.name}>التفاصيل <span aria-hidden="true">←</span></button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {displayItems.length > 0 && <aside className="menu-offer-inline" aria-label="ميزة تسجيل الموقع">
            <span className="menu-offer-inline-amount">15%</span>
            <div className="menu-offer-inline-copy"><strong>عجبك الأكل؟ خلي اشتراكك أوفر.</strong>
              <p>سجّل اسمك وجوالك من الموقع. فريقنا يساعدك تختار الاشتراك المناسب ويراجع معك الاستفادة من خصم 15% على الباقة.</p>
              <small>بدون دفع أو التزام بالاشتراك عند التسجيل.</small>
            </div>
            <div className="menu-offer-inline-actions">
              <PromoOfferButton placement="catalog" className="menu-offer-inline-primary">سجّل واستفد من العرض ←</PromoOfferButton>
              <a href="#menu-plans">احسب التوفير أولًا</a>
            </div>
          </aside>}
          {filteredItems.length === 0 && <p className="menu-empty" role="status">ما لقينا أصناف مطابقة. جرّب تصنيف أو اسم مختلف.</p>}
          {visibleCount < displayItems.length && <div className="menu-more-wrap"><button type="button" className="menu-more" onClick={() => setVisibleCount((n) => n + 12)}>عرض المزيد <span aria-hidden="true">↓</span></button></div>}
          <p className="menu-catalog-footnote">الأسعار بالريال السعودي حسب قائمة المطعم، وقد يتغير السعر أو التوفر. الصور التوضيحية لا تمثل بالضرورة شكل الطبق النهائي.</p>
        </div>
      </section>

      <PlanCalculator sectionId="menu-plans" context="menu" />

      <section className="menu-section menu-custom-section" id="menu-custom" aria-labelledby="menu-custom-title">
        <div className="page-shell">
          <Heading id="menu-custom-title" tag="كوّنها بطريقتك" title="اصنع وجبتك أو سلطتك." copy="اختار مكوناتك وشوف اختياراتك تتجمع قدامك. تجربة للمعاينة بدون طلب أو دفع." />
          <div className="menu-builder-switch" role="group" aria-label="نوع تجربة التخصيص">
            <button type="button" className={activeBuilder === "meal" ? "is-active" : ""} aria-pressed={activeBuilder === "meal"} onClick={() => setActiveBuilder("meal")}>
              <span className="menu-builder-switch-num">01</span><b>اصنع وجبتك</b><small>اختار البروتين والكارب</small>
            </button>
            <button type="button" className={activeBuilder === "salad" ? "is-active" : ""} aria-pressed={activeBuilder === "salad"} onClick={() => setActiveBuilder("salad")}>
              <span className="menu-builder-switch-num">02</span><b>اصنع سلطتك</b><small>مكونات على مزاجك</small>
            </button>
          </div>

          <div className="menu-builder-stage">
            <div className="menu-builder-editor">
              {activeBuilder === "meal" ? (
                <div key="meal">
                  <div className="menu-editor-heading"><span>الخطوة 01</span><h3>اختار البروتين والكارب</h3><p>اضغط على الصور اللي تعجبك؛ الملخص يتغير مع كل اختيار.</p></div>
                  <div className="menu-option-block">
                    <div className="menu-option-title"><strong>اختر البروتين</strong><span>اختيار واحد</span></div>
                    <div className="menu-option-grid">
                      {mealProteins.map((option) => <button type="button" key={option} aria-pressed={protein === option} className={"menu-option-photo-button" + (protein === option ? " is-active" : "")} onClick={() => setProtein(option)}>
                        <span className="menu-option-thumb"><Image src={mealProteinPhotos[option] || menuArtUrl(option)} alt="" fill sizes="88px" unoptimized={(mealProteinPhotos[option] || "").startsWith("/api/menu-art")} /></span>
                        <span className="menu-option-name">{option}</span><span className="menu-option-check" aria-hidden="true">{protein === option ? "✓" : "+"}</span>
                      </button>)}
                    </div>
                  </div>
                  <div className="menu-option-block">
                    <div className="menu-option-title"><strong>اختر الكارب</strong><span>{carbs.length} / 2</span></div>
                    <div className="menu-option-grid">
                      {mealCarbs.map((option) => <button type="button" key={option} aria-pressed={carbs.includes(option)} disabled={carbs.length >= 2 && !carbs.includes(option)} className={"menu-option-photo-button" + (carbs.includes(option) ? " is-active" : "")} onClick={() => toggleCarb(option)}>
                        <span className="menu-option-thumb"><Image src={mealCarbPhotos[option] || menuArtUrl(option)} alt="" fill sizes="88px" unoptimized={(mealCarbPhotos[option] || "").startsWith("/api/menu-art")} /></span>
                        <span className="menu-option-name">{option}</span><span className="menu-option-check" aria-hidden="true">{carbs.includes(option) ? "✓" : "+"}</span>
                      </button>)}
                    </div>
                  </div>
                  <p className="menu-editor-note">معاينة للتخصيص فقط. يمكن اختيار بروتين ونوعين كارب هنا؛ الاختيارات النهائية والتوفر حسب التطبيق.</p>
                </div>
              ) : (
                <div key="salad">
                  <div className="menu-editor-heading"><span>الخطوة 02</span><h3>سلطتك على مزاجك</h3><p>اختار من المجموعات المتاحة وشوف المكونات في الملخص.</p></div>
                  <div className="menu-salad-tabs" role="group" aria-label="مجموعات مكونات السلطة">
                    {saladGroups.map((group) => <button key={group.key} type="button" aria-pressed={saladTab === group.key} className={saladTab === group.key ? "is-active" : ""} onClick={() => setSaladTab(group.key)}>{group.label}<small>{saladChoices[group.key]?.length || 0}</small></button>)}
                  </div>
                  <div className="menu-option-block">
                    <div className="menu-option-title"><strong>{activeSaladGroup.label}</strong><span>{activeSaladGroup.min === activeSaladGroup.max ? "اختر " + activeSaladGroup.min : "حتى " + activeSaladGroup.max} خيارات</span></div>
                    <div className="menu-option-grid">
                      {activeSaladGroup.options.map((option) => {
                        const picked = (saladChoices[activeSaladGroup.key] || []).includes(option);
                        const full = (saladChoices[activeSaladGroup.key] || []).length >= activeSaladGroup.max;
                        return <button key={option} type="button" aria-pressed={picked} disabled={!picked && full} className={picked ? "is-active" : ""} onClick={() => toggleSaladOption(activeSaladGroup.key, option, activeSaladGroup.max)}>{option}<span aria-hidden="true">{picked ? "✓" : "+"}</span></button>;
                      })}
                    </div>
                  </div>
                  <p className="menu-editor-note">المجموعات وحدود الاختيارات هنا للتجربة البصرية؛ التخصيص النهائي يتم من التطبيق.</p>
                </div>
              )}
            </div>
            <aside className="menu-builder-summary" aria-label="ملخص المكونات">
              <span className="menu-summary-eyebrow">ملخص اختياراتك</span>
              <div className="menu-summary-visual">
                <div className="menu-summary-visual-photo">
                  <Image key={activeBuilder === "meal" ? protein : "salad"}
                    src={activeBuilder === "meal" ? (mealProteinPhotos[protein] || menuArtUrl(protein)) : secondImage}
                    alt={activeBuilder === "meal" ? "صورة تمثيلية للبروتين المختار: " + protein : "صورة توضيحية للسلطة"}
                    fill sizes="(max-width:760px) 42vw, 230px"
                    unoptimized={activeBuilder === "meal" && (mealProteinPhotos[protein] || "").startsWith("/api/menu-art")} />
                </div>
                <span className="menu-summary-visual-caption">معاينة من صور المنيو وليست صورة لتركيبتك النهائية</span>
              </div>
              <div className="menu-summary-heading">
                <h3>{activeBuilder === "meal" ? "وجبتك" : "سلطتك"}</h3>
                <button type="button" onClick={() => activeBuilder === "meal" ? setCarbs([]) : setSaladChoices({})}>ابدأ من جديد</button>
              </div>
              <div className="menu-summary-chips" aria-live="polite">
                {(activeBuilder === "meal" ? [protein, ...carbs] : selectedSaladLabels).map((choice, index) =>
                  <span key={choice + index}>{choice}</span>)}
                {activeBuilder === "salad" && selectedSaladLabels.length === 0 && <span className="is-empty">ابدأ باختيار مكوناتك</span>}
              </div>
              {activeBuilder === "meal" ? (
                <div className="menu-summary-data">
                  <div><span>البروتين</span><b>{protein}</b></div>
                  <div><span>الكارب</span><b>{carbs.length ? carbs.join(" • ") : "لسه ما اخترت"}</b></div>
                  <div><span>الاختيارات</span><b>{mealSelections} من 3</b></div>
                </div>
              ) : (
                <div className="menu-summary-data">
                  <div><span>المكونات المختارة</span><b>{saladTotal}</b></div>
                  <div><span>مجموعات اخترت منها</span><b>{numberFormatter.format(saladGroupStatus.filter((s) => s.count > 0).length)} من ٦</b></div>
                  <div><span>المجموعات المطلوبة</span><b>{numberFormatter.format(saladMandatoryComplete)} من {numberFormatter.format(saladGroups.filter(g => g.min > 0).length)}</b></div>
                </div>
              )}
              <p className="menu-summary-disclaimer">استعراض فقط. لا يتم إنشاء طلب أو احتساب سعر أو سعرات من هذه الاختيارات.</p>
              <MenuContactButton location="final" intent={activeBuilder === "meal" ? "meal_builder" : "salad_builder"} className="menu-summary-cta">خلّينا نتواصل معك <span aria-hidden="true">←</span></MenuContactButton>
              <div className="menu-builder-store"><span>أو حمّل التطبيق وكمّل بنفسك</span><StoreLinks location="app" /></div>
            </aside>
          </div>
        </div>
      </section>

      <section className="menu-download-section" id="menu-download" aria-labelledby="menu-download-title">
        <div className="page-shell menu-download-grid">
          <div><p className="menu-kicker"><span aria-hidden="true" /> تواصل معنا</p><h2 id="menu-download-title">اختار أكلك…<br /><em>ووفّر 15% على اشتراكك.</em></h2><p>سجّل اسمك ورقم جوالك، وفريقنا يتواصل معك لإكمال اشتراكك والاستفادة من العرض. خصم الباقة فقط، حسب الشروط.</p><MenuLeadCapture /></div>
          <div className="menu-download-food" aria-label="من أطباق بيسك دايت">
            <div className="menu-download-food-main"><Image src={thirdImage} alt="سالمون من منيو بيسك دايت" fill sizes="(max-width: 700px) 45vw, 350px" /></div>
            <div className="menu-download-food-mini"><Image src={secondImage} alt="سلطة سيزر بالدجاج من منيو بيسك دايت" fill sizes="(max-width: 700px) 28vw, 180px" /></div>
          </div>
        </div>
      </section>

      {selectedProduct && (
        <div className="menu-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedProduct(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="menu-detail-title" className="menu-detail-dialog">
            <button type="button" className="menu-dialog-close" autoFocus aria-label="إغلاق التفاصيل" onClick={() => setSelectedProduct(null)}>×</button>
            <ProductImage item={selectedProduct} />
            <div className="menu-detail-copy">
              <span className="menu-detail-eyebrow">{selectedProduct.category} · BASIC DIET</span>
              <h2 id="menu-detail-title">{variantFamilyById.get(selectedProduct.id)?.title || selectedProduct.name}</h2>
              <p className="menu-detail-description">{verifiedMenuDetails[selectedProduct.id]?.description || "المكونات والوصف المعتمدان لهذا الصنف قيد التحديث. تقدر تسأل فريقنا قبل الطلب."}</p>
              {variantFamilyById.get(selectedProduct.id) && (
                <div className="menu-detail-size-group" role="group" aria-label="اختر حجم الصنف">
                  <strong>اختر الوزن</strong>
                  <div>
                    {variantFamilyById.get(selectedProduct.id)?.sizes.map(size => (
                      <button key={size.id} type="button"
                        aria-pressed={selectedProduct.id === size.id}
                        onClick={() => setSelectedProduct(menuItemById.get(size.id) || selectedProduct)}>
                        {size.grams} جم
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="menu-detail-nutrition">
                <strong>المعلومات الغذائية ومسببات الحساسية</strong>
                <p>القيم الغذائية ومسببات الحساسية لم تُعتمد للنشر لهذا الصنف. يُرجى تأكيد التفاصيل مع المطعم، خصوصًا إذا عندك حساسية غذائية.</p>
              </div>
              <div className="menu-detail-purchase-row">
                <div><span>سعر الصنف</span><strong>{numberFormatter.format(selectedProduct.priceSar)} ر.س</strong></div>
                <MenuContactButton location="final" intent={"product_" + selectedProduct.id} className="menu-detail-contact">استفسر عن الصنف ←</MenuContactButton>
              </div>
              <a className="menu-detail-app-link" href="#menu-download" onClick={() => setSelectedProduct(null)}>أو حمّل التطبيق واطلب بنفسك ←</a>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
