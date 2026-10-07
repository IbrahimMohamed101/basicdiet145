const meals = [
  {
    name: "وجبة ستيك",
    category: "لحوم",
    image:
      "https://drive.google.com/thumbnail?id=1tASbr8vUBgPqdeJywruTTGdUrS7l-unS&sz=w1600",
    featured: true,
  },
  {
    name: "سلمون",
    category: "بحريات",
    image:
      "https://drive.google.com/thumbnail?id=1y1jr9EftvmqVYpckSnuwi7SUwDoBpvzH&sz=w1600",
    featured: true,
  },
  {
    name: "جمبري",
    category: "بحريات",
    image:
      "https://drive.google.com/thumbnail?id=1bezXaW35QSvbEV7yEWtShjbltYsN5E1b&sz=w1200",
  },
  {
    name: "دجاج بالزبدة",
    category: "دجاج",
    image:
      "https://drive.google.com/thumbnail?id=1H2InhiMdECMrs8bsf6L_h9yM-rOfYqw6&sz=w1200",
  },
  {
    name: "شيش طاووق",
    category: "دجاج",
    image:
      "https://drive.google.com/thumbnail?id=1fw69ZcOyMtusTGj9Cx1tVfvpf6ZyJNAu&sz=w1200",
  },
  {
    name: "لحم استرغانوف",
    category: "لحوم",
    image:
      "https://drive.google.com/thumbnail?id=1gciSqekCnVLdjxl9jv7HAF8mUgAn2sc_&sz=w1200",
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
              منيو متنوع كل يوم
            </p>
            <h2 id="food-title">
              أكل محسوب بطعم
              <br />
              <span>تحب ترجع له كل يوم.</span>
            </h2>
          </div>

          <p>
            اختيارات متنوعة بين اللحوم والدجاج والبحريات، عشان تلتزم بخطتك
            بدون ما تحس إنك بتكرر نفس الوجبة.
          </p>
        </div>

        <div className="meal-grid meal-showcase">
          {meals.map((meal, index) => (
            <figure
              key={meal.name}
              className={`meal-card${meal.featured ? " meal-card--featured" : ""}`}
            >
              <div className="meal-image-wrap">
                <img
                  src={meal.image}
                  alt={`وجبة ${meal.name}`}
                  loading={index < 2 ? "eager" : "lazy"}
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
          <p>دي مجرد عينة من الوجبات المتاحة داخل التطبيق.</p>
          <a className="food-link" href="#how-it-works">
            شوف كيف تختار وجباتك
            <span aria-hidden="true">←</span>
          </a>
        </div>
      </div>
    </section>
  );
}
