"use client";

import { useState } from "react";
import Image from "next/image";
import { restaurantMenuItems, type RestaurantMenuItem } from "@/lib/restaurant-menu-data";

const categories = ["الدجاج", "الساندوتشات", "الأسماك واللحوم", "الكارب"] as const;
type Category = typeof categories[number];
export type RestaurantMenuTab = Category | "الكل";
const tabs: RestaurantMenuTab[] = ["الكل", ...categories];

const notes: Record<Category, string> = {
  "الدجاج": "السعر لحصة دجاج 100 جم",
  "الساندوتشات": "السعر للسندوتش الكامل",
  "الأسماك واللحوم": "السعر لحصة بروتين 100 جم",
  "الكارب": "جميع أصناف الكارب بسعر 7 ريال",
};

function DishPhoto({ dish }: { dish: RestaurantMenuItem }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="restaurant-menu-photo">
      {failed ? (
        <span className="restaurant-menu-image-fallback">الصورة قيد التحديث</span>
      ) : (
        <Image
          src={dish.image}
          alt={dish.name + " من منيو بيسك دايت"}
          fill
          sizes="(max-width: 540px) 96px, 112px"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
      {dish.illustrative && !failed && <span className="restaurant-menu-image-note">صورة توضيحية</span>}
    </div>
  );
}

export function RestaurantMenu({
  activeTab, onCategoryChange,
}: {
  activeTab: RestaurantMenuTab;
  onCategoryChange: (tab: RestaurantMenuTab) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visibleCategories = activeTab === "الكل" ? categories : [activeTab];
  return (
    <section className="restaurant-menu" id="restaurant-menu" aria-labelledby="restaurant-menu-heading" dir="rtl">
      <div className="page-shell">
        <header className="restaurant-menu-intro">
          <span className="restaurant-menu-eyebrow">BASIC DIET / RESTAURANT MENU</span>
          <h2 id="restaurant-menu-heading">منيو المطعم <em>بالصور والأسعار.</em></h2>
          <p>اختار من الدجاج والسندوتشات والأسماك واللحوم والكارب. الأسعار بالريال السعودي، والسعرات تقديرية.</p>
        </header>
        <div className="restaurant-menu-filter" role="group" aria-label="تصفية أصناف منيو المطعم">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              aria-pressed={activeTab === tab}
              className={"restaurant-menu-tab" + (activeTab === tab ? " is-active" : "")}
              onClick={() => { onCategoryChange(tab); setShowAll(false); }}
            >
              {tab}
              {tab === "الكل" && <span>{restaurantMenuItems.length}</span>}
            </button>
          ))}
        </div>
        {visibleCategories.map((category) => {
          const dishes = restaurantMenuItems.filter((item) => item.category === category);
          const visibleDishes = activeTab === "الكل" && !showAll ? dishes.slice(0, 4) : dishes;
          return (
            <div className="restaurant-menu-group" key={category}>
              <div className="restaurant-menu-group-heading">
                <h3>{category}</h3>
                <span>{notes[category]}</span>
              </div>
              <div className="restaurant-menu-grid">
                {visibleDishes.map((dish) => (
                  <article className="restaurant-menu-card" key={dish.id}>
                    <DishPhoto dish={dish} />
                    <div className="restaurant-menu-card-content">
                      <h4>{dish.name}</h4>
                      <span>{dish.calories} سعرة حرارية تقريبًا</span>
                    </div>
                    <strong className="restaurant-menu-price">{dish.price} <small>ريال</small></strong>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
        {activeTab === "الكل" && (
          <div className="restaurant-menu-expand-wrap">
            <button type="button" className="restaurant-menu-expand" onClick={() => setShowAll(value => !value)} aria-expanded={showAll}>
              {showAll ? "عرض أصناف أقل" : "عرض جميع أصناف المطعم الـ37"}
              <span aria-hidden="true">{showAll ? "↑" : "↓"}</span>
            </button>
          </div>
        )}
        <div className="restaurant-menu-footnotes">
          <p><strong>إضافة 50 جم بروتين:</strong> دجاج +5 ريال · لحم +6 ريال · سمك +5 ريال.</p>
          <p>السعرات تقديرية ولا تشمل أي إضافات أو تعديل على الحصة، وقد تختلف حسب الوصفة الفعلية. للتأكد من المكونات ومسببات الحساسية أو توفر الصنف، يُرجى التواصل مع المطعم.</p>
        </div>
      </div>
    </section>
  );
}
