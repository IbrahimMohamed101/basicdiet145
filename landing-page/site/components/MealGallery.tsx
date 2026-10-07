const meals = [
  {
    name: "دجاج بالزبدة",
    image: "/meals/butter-chicken.png",
    className: "meal-card--large",
  },
  {
    name: "سلمون",
    image: "/meals/salmon.png",
    className: "",
  },
  {
    name: "سلطة بيسك",
    image: "/meals/basic-salad.png",
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
