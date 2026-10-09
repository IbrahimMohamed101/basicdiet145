import Image from "next/image";

const meals = [
  {
    name: "وجبة ستيك",
    category: "لحوم",
    image:
      "/api/meal-image?id=1tASbr8vUBgPqdeJywruTTGdUrS7l-unS",
    featured: true,
  },
  {
    name: "سلمون",
    category: "بحريات",
    image:
      "/api/meal-image?id=1y1jr9EftvmqVYpckSnuwi7SUwDoBpvzH",
    featured: true,
  },
  {
    name: "جمبري",
    category: "بحريات",
    image:
      "/api/meal-image?id=1bezXaW35QSvbEV7yEWtShjbltYsN5E1b",
  },
  {
    name: "دجاج بالزبدة",
    category: "دجاج",
    image:
      "/api/meal-image?id=1H2InhiMdECMrs8bsf6L_h9yM-rOfYqw6",
  },
  {
    name: "شيش طاووق",
    category: "دجاج",
    image:
      "/api/meal-image?id=1fw69ZcOyMtusTGj9Cx1tVfvpf6ZyJNAu",
  },
  {
    name: "لحم استرغانوف",
    category: "لحوم",
    image:
      "/api/meal-image?id=1gciSqekCnVLdjxl9jv7HAF8mUgAn2sc_",
  },
];

export function MealGallery() {
  return (
    <section className="food-section" id="meals" aria-labelledby="food-title">
      <div className="page-shell">
        <div className="section-heading section-heading--split food-heading">
          <div>
            <p className="eyebrow">
              <span />
              من قائمة وجباتنا
            </p>
            <h2 id="food-title">
              أكل محسوب بطعم
              <br />
              <span>تحب ترجع له كل يوم.</span>
            </h2>
          </div>

          <p>
            اختيارات متنوعة بين اللحوم والدجاج والبحريات، عشان تلتزم بخطتك
            بدون ما تحس إنك تكرر نفس الوجبة.
          </p>
        </div>

        <div className="meal-grid meal-showcase">
          {meals.map((meal) => (
            <figure
              key={meal.name}
              className={`meal-card${meal.featured ? " meal-card--featured" : ""}`}
            >
              <div className="meal-image-wrap">
                <Image
                  fill
                  sizes={meal.featured ? "(max-width: 640px) 82vw, (max-width: 1100px) 48vw, 620px" : "(max-width: 640px) 82vw, (max-width: 1100px) 48vw, 310px"}
                  src={meal.image}
                  alt={`وجبة ${meal.name}`}
                  loading="lazy"
                  decoding="async"
                />
              </div>

              <div className="meal-card-shade" aria-hidden="true" />

              <figcaption>
                <small>{meal.category}</small>
                <span>{meal.name}</span>
              </figcaption>
            </figure>
          ))}
        </div>

        <div className="food-footer">
          <p>مجرد لمحة من الوجبات المتاحة في التطبيق.</p>
          <a className="food-link" href="#how-it-works">
            شوف كيف تختار وجباتك
            <span aria-hidden="true">←</span>
          </a>
        </div>
      </div>
    </section>
  );
}
