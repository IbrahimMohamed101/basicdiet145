const meals = [
  {
    name: "دجاج بالزبدة",
    image:
      "https://drive.google.com/uc?export=view&id=1H2InhiMdECMrs8bsf6L_h9yM-rOfYqw6",
    className: "meal-card--large",
  },
  {
    name: "سلمون",
    image:
      "https://drive.google.com/uc?export=view&id=1y1jr9EftvmqVYpckSnuwi7SUwDoBpvzH",
    className: "",
  },
  {
    name: "سلطة بيسك",
    image:
      "https://drive.google.com/uc?export=view&id=1wCFHNOyUeKD87rLuGVvWAWGVLnndI8a5",
    className: "",
  },
  {
    name: "وجبة ستيك",
    image:
      "https://drive.google.com/uc?export=view&id=1tASbr8vUBgPqdeJywruTTGdUrS7l-unS",
    className: "meal-card--wide",
  },
  {
    name: "باستا ألفريدو",
    image:
      "https://drive.google.com/uc?export=view&id=1JR-lQhqRwbwjB9p7nk2n6LNBBiAW1Dne",
    className: "",
  },
  {
    name: "تشيزكيك توت",
    image:
      "https://drive.google.com/uc?export=view&id=1GPoa36urXJ-H_pZQc1N3t4qc98yI_1WX",
    className: "",
  },
];

export function MealGallery() {
  return (
    <section className="food-section" id="meals" aria-labelledby="food-title">
      <div className="page-shell">
        <div className="section-heading section-heading--split">
          <div>
            <p className="eyebrow">
              <span />
              أكل يشهي أولًا
            </p>
            <h2 id="food-title">
              أكل محسوب ما يشبه فكرة
              <br />
              <span>“أكل الدايت” التقليدية.</span>
            </h2>
          </div>

          <p>
            وجبات متنوعة وطعم فعلي، مع اختيارات تخلي الروتين أسهل من تكرار
            نفس الطبق كل يوم.
          </p>
        </div>

        <div className="meal-grid">
          {meals.map((meal) => (
            <figure
              key={meal.name}
              className={`meal-card ${meal.className}`.trim()}
            >
              <img src={meal.image} alt={`وجبة ${meal.name} من Basic Diet`} />
              <figcaption>
                <span>{meal.name}</span>
                <small>من أصناف Basic Diet</small>
              </figcaption>
            </figure>
          ))}
        </div>

        <a className="food-link" href="#how-it-works">
          شوف كيف تختار وجباتك
          <span aria-hidden="true">←</span>
        </a>
      </div>
    </section>
  );
}
