import Image from "next/image";
import { menuPreviewItems } from "@/lib/menu-preview-items";
import { MenuCalories } from "@/components/MenuCalories";

// A single cashier menu powers both the landing-page preview and /menu.
// Use only real, menu-listed dishes with existing photos. No coming-soon steak.
export const homepageFeaturedMenuIds = ["186", "78", "77", "176", "195", "211"] as const;
const meals = homepageFeaturedMenuIds
  .map((id) => menuPreviewItems.find((item) => item.id === id))
  .filter((item): item is (typeof menuPreviewItems)[number] => Boolean(item?.image));
const currency = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function MealGallery() {
  return (
    <section className="food-section" id="meals" aria-labelledby="food-title">
      <div className="page-shell">
        <div className="section-heading section-heading--split food-heading">
          <div>
            <p className="eyebrow"><span />من منيو بيسك دايت</p>
            <h2 id="food-title">
              أكل محسوب بطعم
              <br />
              <span>تحب ترجع له كل يوم.</span>
            </h2>
          </div>
          <p>
            من أطباق بيسك دايت. شوف الصور والأسعار، واستكشف المنيو الكامل
            واختر بين الوجبات والسلطات والفطور والساندويتشات.
          </p>
        </div>

        <div className="meal-grid meal-showcase">
          {meals.map((meal, index) => (
            <figure
              key={meal.id}
              className={`meal-card${index < 2 ? " meal-card--featured" : ""}`}
            >
              <div className="meal-image-wrap">
                <Image
                  fill
                  sizes={index < 2 ? "(max-width: 640px) 82vw, (max-width: 1100px) 48vw, 620px" : "(max-width: 640px) 82vw, (max-width: 1100px) 48vw, 310px"}
                  src={meal.image || "/api/menu-art?kind=rice&tone=natural"}
                  alt={meal.name}
                  unoptimized={Boolean(meal.image?.startsWith("https://"))}
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div className="meal-card-shade" aria-hidden="true" />
              <figcaption>
                <small>{meal.category}</small>
                <span>{meal.name}</span>
                <strong className="meal-card-price">{currency.format(meal.priceSar)} ر.س</strong>
                <MenuCalories posId={meal.id} />
              </figcaption>
            </figure>
          ))}
        </div>

        <div className="food-footer">
          <p>أطباق أكثر، وخيارات تناسب يومك. استكشف المنيو والأسعار.</p>
          <a className="food-link food-link--menu" href="/menu" aria-label="مشاهدة المزيد من أصناف منيو بيسك دايت وأسعارها">
            مشاهدة المزيد من الأصناف
            <span aria-hidden="true">←</span>
          </a>
        </div>
      </div>
    </section>
  );
}
