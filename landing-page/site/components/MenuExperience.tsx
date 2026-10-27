"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { menuPreviewItems, type MenuPreviewItem } from "@/lib/menu-preview-items";
import { StoreLinks } from "@/components/StoreLinks";
import { MenuLeadCapture, MenuContactButton } from "@/components/MenuLeadCapture";

const foodImage = "https://res.cloudinary.com/da8tyika6/image/upload/f_auto,q_auto:eco,c_limit,w_900/f_auto,q_auto/v1/basicdiet145/menu/file_lltkbm";
const secondImage = "/api/meal-image?id=1IxuZvbSI85kxn9pwF97kGCeScVpz0fdv";
const thirdImage = "/api/meal-image?id=1y1jr9EftvmqVYpckSnuwi7SUwDoBpvzH";
const menuShowcaseCategories = [
  { label: "الوجبات", tag: "MAIN DISHES", image: foodImage },
  { label: "السلطات", tag: "FRESH SALADS", image: secondImage },
  { label: "الفطور", tag: "BREAKFAST", image: "https://res.cloudinary.com/da8tyika6/image/upload/f_auto,q_auto:eco,c_limit,w_900/f_auto,q_auto/v1/basicdiet145/menu/file_pwtdt4" },
  { label: "الساندويتشات", tag: "SANDWICHES", image: "/api/meal-image?id=1Jk3Xg_v-3dQRVx41KNlq_cr5F3aGYZHC" },
] as const;

// These prices are INITIAL BOOTSTRAP EXAMPLES, not authorized production prices.
// Do not expose as an approved catalog or remove the draft warnings.
const draftPlanPrices: Record<number, Record<number, number[]>> = {
  7: {
    100: [138, 276, 414, 552, 690],
    150: [174, 348, 522, 696, 870],
    200: [210, 420, 630, 840, 1050],
  },
  26: {
    100: [516, 935, 1355, 1806, 2257],
    150: [659, 1186, 1732, 2309, 2886],
    200: [750, 1421, 2012, 2683, 3354],
  },
  30: {
    100: [587, 1079, 1511, 2014, 2518],
    150: [720, 1331, 1943, 2590, 3238],
    200: [828, 1619, 2279, 3038, 3798],
  },
};

const menuCategories = [
  "الكل", "الوجبات", "السلطات", "الفطور", "الساندويتشات",
  "الحلويات", "المشروبات", "الزبادي", "الآيس كريم",
];

const mealProteins = ["دجاج مشوي", "تونا", "بيض مسلوق", "سالمون", "جمبري"];
const mealCarbs = ["رز أبيض", "رز بالكركم", "رز برياني", "كينوا", "بطاطس مشوي", "بطاطا حلوة", "باستا ألفريدو"];
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

function DemoLabel() {
  return <span className="menu-demo-mark">معاينة غير معتمدة للنشر</span>;
}

function ProductImage({ item, priority = false }: { item: MenuPreviewItem; priority?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="menu-product-photo">
      {item.image && !failed ? (
        <Image src={item.image} alt={item.name} fill sizes="(max-width: 600px) 46vw, (max-width: 1000px) 34vw, 300px" quality={78} priority={priority} unoptimized={item.image.startsWith("https://")} onError={() => setFailed(true)} />
      ) : (
        <div className="menu-image-fallback" aria-label="صورة الصنف لم تعتمد بعد">
          <span className="menu-fallback-ring" />
          <strong>Basic<br />Diet.</strong>
          <small>الصورة قيد الاعتماد</small>
        </div>
      )}
    </div>
  );
}

export function MenuExperience() {
  const [days, setDays] = useState(26);
  const [grams, setGrams] = useState(150);
  const [meals, setMeals] = useState(2);
  const [activeBuilder, setActiveBuilder] = useState<"meal" | "salad">("meal");
  const [protein, setProtein] = useState("دجاج مشوي");
  const [carbs, setCarbs] = useState<string[]>([]);
  const [saladTab, setSaladTab] = useState<SaladGroupKey>("leafy");
  const [saladChoices, setSaladChoices] = useState<Record<string, string[]>>({});
  const [category, setCategory] = useState("الكل");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(9);
  const [selectedProduct, setSelectedProduct] = useState<MenuPreviewItem | null>(null);

  const price = draftPlanPrices[days][grams][meals - 1];
  const totalMeals = days * meals;
  const numberFormatter = new Intl.NumberFormat("ar-SA");

  const filteredItems = useMemo(() => menuPreviewItems.filter((item) => {
    return (category === "الكل" || item.category === category) &&
      (search.trim() === "" || item.name.includes(search.trim()) || item.id.includes(search.trim()));
  }).sort((a, b) => Number(Boolean(b.image)) - Number(Boolean(a.image))), [category, search]);

  const activeSaladGroup = saladGroups.find((group) => group.key === saladTab) || saladGroups[0];
  const saladGroupStatus = saladGroups.map((group) => {
    const count = (saladChoices[group.key] || []).length;
    return { key: group.key, complete: count >= group.min && count <= group.max, count };
  });
  const saladComplete = saladGroupStatus.every((item) => item.complete);
  const saladTotal = Object.values(saladChoices).reduce((sum, chosen) => sum + chosen.length, 0);

  function toggleCarb(item: string) {
    setCarbs((previous) => previous.includes(item)
      ? previous.filter((value) => value !== item)
      : previous.length >= 3 ? previous : [...previous, item]);
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
            <h1 id="menu-hero-title">منيو بيسك دايت.<br /><em>الطعم اللي تحبّه.</em></h1>
            <p>من أول وجبة لآخر لقمة. اكتشف أطباقنا وسلطاتنا وفطورنا، واختَر اللي يناسب يومك.</p>
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
            <div className="menu-float menu-float--one"><span className="menu-float-indicator" /> <strong>منيو مليان اختيارات</strong><small>Basic Diet</small></div>
            <span className="menu-hero-spark" aria-hidden="true">✳</span>
          </div>
        </div>
        <div className="page-shell menu-preview-ribbon" role="note">
          <DemoLabel /> <span>دي معاينة واجهة. بعض أسعار الباقات تجريبية، وأصناف الكاشير وصورها لم تُعتمد للنشر بعد.</span>
        </div>
      </section>

      <nav className="menu-jump-nav" aria-label="أقسام المنيو">
        <div className="page-shell menu-jump-list">
          <a href="#menu-products">الأطباق والأسعار</a>
          <a href="#menu-plans">الاشتراكات</a>
          <a href="#menu-custom">اصنع وجبتك أو سلطتك</a>
          <a href="#menu-download">تواصل معنا / التطبيق</a>
        </div>
      </nav>

      <section className="menu-featured-categories" aria-labelledby="menu-category-title">
        <div className="page-shell">
          <div className="menu-featured-intro">
            <div><p className="menu-kicker"><span aria-hidden="true" /> EXPLORE THE MENU</p><h2 id="menu-category-title">ابدأ باللي تشتهيه.</h2></div>
            <a href="#menu-products">شوف المنيو بالكامل <span aria-hidden="true">←</span></a>
          </div>
          <div className="menu-featured-grid">
            {menuShowcaseCategories.map((group) => (
              <a key={group.label} href="#menu-products" className="menu-featured-card"
                onClick={() => { setCategory(group.label); setSearch(""); setVisibleCount(9); }}>
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
          <Heading id="menu-catalog-title" tag="FULL MENU / القائمة" title="اختار وجبتك بعينك." copy="صور الأطباق، التصنيفات، وأسعار أصناف الكاشير المرشحة. الصور والتفاصيل النهائية ما زالت قيد المراجعة قبل النشر." />
          <div className="menu-catalog-tools">
            <div className="menu-filter-strip" role="group" aria-label="تصنيفات المنيو">
              {menuCategories.map((group) => <button key={group} type="button" aria-pressed={category === group} className={category === group ? "is-active" : ""} onClick={() => { setCategory(group); setVisibleCount(9); }}>{group}</button>)}
            </div>
            <label className="menu-search"><span className="sr-only">ابحث عن صنف</span><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => { setSearch(event.target.value); setVisibleCount(9); }} placeholder="ابحث عن صنف أو رقم الكاشير" type="search" /></label>
          </div>
          <div className="menu-catalog-count"><span>نتائج البحث: <b>{filteredItems.length}</b> صنف</span><DemoLabel /></div>
          <div className="menu-product-grid">
            {filteredItems.slice(0, visibleCount).map((item) => (
              <article className="menu-product-card" key={item.id}>
                <ProductImage item={item} />
                <div className="menu-product-body">
                  <span className="menu-product-category">{item.category}</span>
                  <h3>{item.name}</h3>
                  <div className="menu-product-bottom">
                    <div><small>سعر الكاشير للمراجعة</small><strong>{numberFormatter.format(item.priceSar)} <span>ر.س</span></strong></div>
                    <button type="button" onClick={() => setSelectedProduct(item)} aria-label={"تفاصيل " + item.name}>التفاصيل <span aria-hidden="true">←</span></button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {filteredItems.length === 0 && <p className="menu-empty" role="status">ما لقينا أصناف مطابقة. جرّب تصنيف أو اسم مختلف.</p>}
          {visibleCount < filteredItems.length && <div className="menu-more-wrap"><button type="button" className="menu-more" onClick={() => setVisibleCount((n) => n + 9)}>عرض المزيد <span aria-hidden="true">↓</span></button></div>}
          <p className="menu-catalog-footnote">المنتجات المعروضة مرشحة فقط. الصورة أو الوصف أو السعرات التي لم يوافق عليها المطعم لا تُنشر كحقيقة نهائية.</p>
        </div>
      </section>

      <section className="menu-section menu-plans-section" id="menu-plans" aria-labelledby="menu-plans-title">
        <div className="page-shell">
          <Heading id="menu-plans-title" tag="SUBSCRIPTIONS / الباقات" title="روتينك. سعرك. اختيارك." copy="جرّب تغيير مدة الاشتراك وحجم الوجبة وعدد الوجبات يوميًا، وشاهد كيف تتغير الباقة أمامك." />
          <div className="menu-plan-layout">
            <div className="menu-plan-picker">
              <p className="menu-control-label">01 / مدة الاشتراك</p>
              <div className="menu-plan-durations" role="group" aria-label="مدة الاشتراك">
                {[7, 26, 30].map((value) => (
                  <button type="button" key={value} className={"menu-duration" + (days === value ? " is-active" : "")}
                    aria-pressed={days === value} onClick={() => setDays(value)}>
                    <strong>{value}</strong><span>يوم</span>
                    {value === 26 && <small>اختيار مميز</small>}
                  </button>
                ))}
              </div>
              <p className="menu-control-label">02 / حجم الوجبة</p>
              <div className="menu-select-pills" role="group" aria-label="حجم الوجبة">
                {[100, 150, 200].map((value) => (
                  <button type="button" key={value} className={grams === value ? "is-active" : ""}
                    aria-pressed={grams === value} onClick={() => setGrams(value)}><b>{value}</b> جم</button>
                ))}
              </div>
              <p className="menu-control-label">03 / عدد الوجبات يوميًا</p>
              <div className="menu-select-pills menu-meal-count" role="group" aria-label="عدد الوجبات">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button type="button" key={value} className={meals === value ? "is-active" : ""}
                    aria-pressed={meals === value} onClick={() => setMeals(value)}>{value}</button>
                ))}
              </div>
            </div>
            <aside className="menu-plan-result" aria-label="معاينة سعر الباقة">
              <span className="menu-plan-result-kicker">BASIC DIET / YOUR PLAN</span>
              <div className="menu-plan-result-top"><span>اشتراك {days} يوم</span><b>{grams} جم</b></div>
              <p>سعر الباقة الأساسي في ملف التهيئة التجريبي</p>
              <div key={days + "-" + grams + "-" + meals} className="menu-price-pop" aria-live="polite" aria-atomic="true">
                <strong>{numberFormatter.format(price)}</strong><span>ر.س</span>
              </div>
              <div className="menu-plan-specs">
                <div><strong>{totalMeals}</strong><span>وجبة خلال الباقة</span></div>
                <div><strong>{meals}</strong><span>وجبة يوميًا</span></div>
                <div><strong>{grams}g</strong><span>حجم البروتين</span></div>
              </div>
              <p className="menu-plan-caution">سعر توضيحي من بيانات bootstrap وليس السعر المعتمد للبيع. لا يشمل رسوم التوصيل والإضافات أو أي خصم.</p>
              <MenuContactButton location="plans" intent="plan_selected" planDays={days} grams={grams} mealsPerDay={meals} className="menu-result-link">تبغى نكلمك عن هذي الباقة؟ <span aria-hidden="true">←</span></MenuContactButton>
              <a className="menu-result-subtle" href="#menu-download">أو حمّل التطبيق وابدأ بنفسك</a>
            </aside>
          </div>
        </div>
      </section>

      <section className="menu-section menu-custom-section" id="menu-custom" aria-labelledby="menu-custom-title">
        <div className="page-shell">
          <Heading id="menu-custom-title" tag="BUILD YOUR OWN / اصنع بنفسك" title="كل التفاصيل منك. والطعم علينا." copy="استكشف شكل تخصيص الوجبة والسلطة. تختار المكونات وتتابع ملخصك، بدون إضافة للسلة أو طلب فعلي." />
          <div className="menu-builder-switch" role="group" aria-label="نوع تجربة التخصيص">
            <button type="button" className={activeBuilder === "meal" ? "is-active" : ""} aria-pressed={activeBuilder === "meal"} onClick={() => setActiveBuilder("meal")}>
              <span className="menu-builder-switch-num">01</span><b>اصنع وجبتك</b><small>بروتين + كارب</small>
            </button>
            <button type="button" className={activeBuilder === "salad" ? "is-active" : ""} aria-pressed={activeBuilder === "salad"} onClick={() => setActiveBuilder("salad")}>
              <span className="menu-builder-switch-num">02</span><b>اصنع سلطتك</b><small>الاختيار من 6 مجموعات</small>
            </button>
          </div>

          <div className="menu-builder-stage">
            <div className="menu-builder-editor">
              {activeBuilder === "meal" ? (
                <div key="meal">
                  <div className="menu-editor-heading"><span>01 / بناء الوجبة</span><h3>كوّن وجبتك خطوة بخطوة</h3><p>الاختيارات نموذج لواجهة التطبيق، وليست قائمة توافر حية.</p></div>
                  <div className="menu-option-block">
                    <div className="menu-option-title"><strong>اختر البروتين</strong><span>اختيار واحد</span></div>
                    <div className="menu-option-grid">
                      {mealProteins.map((option) => <button type="button" key={option} aria-pressed={protein === option} className={protein === option ? "is-active" : ""} onClick={() => setProtein(option)}>{option}<span aria-hidden="true">{protein === option ? "✓" : "+"}</span></button>)}
                    </div>
                  </div>
                  <div className="menu-option-block">
                    <div className="menu-option-title"><strong>اختر الكارب</strong><span>{carbs.length} / 3</span></div>
                    <div className="menu-option-grid">
                      {mealCarbs.map((option) => <button type="button" key={option} aria-pressed={carbs.includes(option)} disabled={carbs.length >= 3 && !carbs.includes(option)} className={carbs.includes(option) ? "is-active" : ""} onClick={() => toggleCarb(option)}>{option}<span aria-hidden="true">{carbs.includes(option) ? "✓" : "+"}</span></button>)}
                    </div>
                  </div>
                  <p className="menu-editor-note">القاعدة التوضيحية هنا: بروتين واحد و3 اختيارات كارب. الأوزان والأسعار النهائية تُجلب من كتالوج التطبيق المعتمد لاحقًا.</p>
                </div>
              ) : (
                <div key="salad">
                  <div className="menu-editor-heading"><span>02 / بناء السلطة</span><h3>سلطتك بالطريقة اللي تحبها</h3><p>مرّ على المجموعات واختَر مكوّناتك.</p></div>
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
                  <p className="menu-editor-note">حدود الاختيار في هذه المعاينة توضيحية. المعتمد فعليًا يأتي من مجموعات الخيارات المنشورة في Backend.</p>
                </div>
              )}
            </div>
            <aside className="menu-builder-summary" aria-label="ملخص المكونات">
              <span className="menu-summary-eyebrow">YOUR CREATION / معاينة حية</span>
              <div className="menu-summary-disc" aria-hidden="true"><span className="menu-summary-disc-center">BD.</span></div>
              <h3>{activeBuilder === "meal" ? "وجبتك كما اخترتها" : "سلطتك كما اخترتها"}</h3>
              {activeBuilder === "meal" ? (
                <div className="menu-summary-data">
                  <div><span>البروتين</span><b>{protein}</b></div>
                  <div><span>الكارب</span><b>{carbs.length ? carbs.join(" • ") : "لسه ما اخترت"}</b></div>
                  <div><span>الاكتمال</span><b>{carbs.length === 3 ? "الخيارات مكتملة" : "اختر " + (3 - carbs.length) + " كارب"}</b></div>
                </div>
              ) : (
                <div className="menu-summary-data">
                  <div><span>المكونات المختارة</span><b>{saladTotal}</b></div>
                  <div><span>المجموعات المكتملة</span><b>{saladGroupStatus.filter((s) => s.complete).length} / 6</b></div>
                  <div><span>الحالة</span><b>{saladComplete ? "الخيارات مكتملة" : "اكمل المجموعات المطلوبة"}</b></div>
                </div>
              )}
              <p className="menu-summary-disclaimer">استعراض تفاعلي فقط. لا نكوّن طلبًا، ولا نحسب سعرًا أو سعرات غير مؤكدة.</p>
              <MenuContactButton location="final" intent={activeBuilder === "meal" ? "meal_builder" : "salad_builder"} className="menu-summary-cta">عندك سؤال؟ خلّينا نتواصل معك <span aria-hidden="true">←</span></MenuContactButton>
              <a className="menu-result-subtle menu-builder-app-cta" href="#menu-download">أو حمّل التطبيق وكمّل اختياراتك</a>
            </aside>
          </div>
        </div>
      </section>

      <section className="menu-download-section" id="menu-download" aria-labelledby="menu-download-title">
        <div className="page-shell menu-download-grid">
          <div><p className="menu-kicker"><span aria-hidden="true" /> KEEP IN TOUCH</p><h2 id="menu-download-title">عجبك المنيو؟<br /><em>خلّنا نساعدك تختار.</em></h2><p>اتفرج على الأصناف الأول براحتك. لو لقيت اللي يناسبك، سيب رقمك في الآخر أو حمّل التطبيق وكمّل بنفسك.</p><MenuLeadCapture /></div>
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
              <span className="menu-product-category">{selectedProduct.category} / POS #{selectedProduct.id}</span>
              <h2 id="menu-detail-title">{selectedProduct.name}</h2>
              <p>هذا الصنف من قائمة مرشحي الموقع. نعرض سعر الكاشير للمراجعة؛ وصف المكونات والسعرات والصورة تحتاج اعتمادًا قبل النشر.</p>
              <strong>{numberFormatter.format(selectedProduct.priceSar)} ر.س <small>سعر مرجعي</small></strong>
              <MenuContactButton location="final" intent={"product_" + selectedProduct.id} className="menu-detail-contact">تبغى نكلمك عن المنيو؟ ←</MenuContactButton>
              <a href="#menu-download" onClick={() => setSelectedProduct(null)}>أو حمّل تطبيق Basic Diet ←</a>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
