const DASHBOARD_PASSWORD = "StrongPass123";

const settings = {
  delivery_windows: ["09:00-12:00", "13:00-16:00", "18:00-21:00"],
  subscription_delivery_fee_halala: 0,
  premium_price: 24,
  vat_percentage: 15,
  one_time_meal_price: 29,
  one_time_premium_price: 42,
  custom_salad_base_price: 18,
  custom_meal_base_price: 25,
};

const deliveryZones = [
  {
    name: { ar: "الملقا", en: "Al Malqa" },
    deliveryFeeHalala: 1500,
    isActive: true,
    sortOrder: 1,
  },
  {
    name: { ar: "الياسمين", en: "Al Yasmin" },
    deliveryFeeHalala: 1800,
    isActive: true,
    sortOrder: 2,
  },
  {
    name: { ar: "النرجس", en: "Al Narjis" },
    deliveryFeeHalala: 2000,
    isActive: true,
    sortOrder: 3,
  },
  {
    name: { ar: "حطين", en: "Hittin" },
    deliveryFeeHalala: 2200,
    isActive: true,
    sortOrder: 4,
  },
  {
    name: { ar: "الصحافة", en: "Al Sahafa" },
    deliveryFeeHalala: 1700,
    isActive: true,
    sortOrder: 5,
  },
  {
    name: { ar: "العارض", en: "Al Arid" },
    deliveryFeeHalala: 2600,
    isActive: false,
    sortOrder: 6,
  },
];

const pickupLocations = [
  {
    id: "riyadh-hq",
    name: { ar: "فرع الرياض الرئيسي", en: "Riyadh Main Branch" },
    addressAr: "طريق أنس بن مالك، حي الملقا، الرياض",
    addressEn: "Anas Bin Malik Road, Al Malqa District, Riyadh",
    city: "Riyadh",
    district: { ar: "الملقا", en: "Al Malqa" },
    street: { ar: "طريق أنس بن مالك", en: "Anas Bin Malik Road" },
    building: "BD-145",
    notes: {
      ar: "الاستلام متاح في أي وقت خلال ساعات العمل الرسمية.",
      en: "Pickup is available at any time during official working hours.",
    },
    isActive: true,
  },
];

const plans = [
  {
    name: { ar: "خطة 7 أيام", en: "7 Days Plan" },
    description: {
      ar: "خطة سريعة للبدء من جديد مع عدد أيام قصير وخيارات مرنة للوجبات.",
      en: "A short reset plan with flexible meal combinations for a quick start.",
    },
    daysCount: 7,
    sortOrder: 1,
    skipAllowanceCompensatedDays: 1,
    freezePolicy: { enabled: true, maxDays: 7, maxTimes: 1 },
    gramsOptions: [
      {
        grams: 350,
        sortOrder: 1,
        mealsOptions: [
          { mealsPerDay: 2, priceHalala: 18900, compareAtHalala: 20900, sortOrder: 1 },
          { mealsPerDay: 3, priceHalala: 23900, compareAtHalala: 26900, sortOrder: 2 },
        ],
      },
      {
        grams: 500,
        sortOrder: 2,
        mealsOptions: [
          { mealsPerDay: 2, priceHalala: 20900, compareAtHalala: 22900, sortOrder: 1 },
          { mealsPerDay: 3, priceHalala: 25900, compareAtHalala: 28900, sortOrder: 2 },
        ],
      },
    ],
    isActive: true,
  },
  {
    name: { ar: "خطة 14 يوم", en: "14 Days Plan" },
    description: {
      ar: "خطة متوازنة للأسبوعين مناسبة لمن يريد الاستمرارية دون التزام طويل جدًا.",
      en: "A balanced two-week plan for customers who want consistency without a long commitment.",
    },
    daysCount: 14,
    sortOrder: 2,
    skipAllowanceCompensatedDays: 2,
    freezePolicy: { enabled: true, maxDays: 10, maxTimes: 1 },
    gramsOptions: [
      {
        grams: 350,
        sortOrder: 1,
        mealsOptions: [
          { mealsPerDay: 2, priceHalala: 34900, compareAtHalala: 38900, sortOrder: 1 },
          { mealsPerDay: 3, priceHalala: 42900, compareAtHalala: 46900, sortOrder: 2 },
        ],
      },
      {
        grams: 500,
        sortOrder: 2,
        mealsOptions: [
          { mealsPerDay: 2, priceHalala: 38900, compareAtHalala: 42900, sortOrder: 1 },
          { mealsPerDay: 3, priceHalala: 46900, compareAtHalala: 51900, sortOrder: 2 },
        ],
      },
    ],
    isActive: true,
  },
  {
    name: { ar: "خطة 21 يوم", en: "21 Days Plan" },
    description: {
      ar: "خطة مناسبة لتحسين الالتزام الغذائي مع تنوع أكبر في عدد الوجبات والأحجام.",
      en: "A commitment-focused plan with more variety across meal counts and portion sizes.",
    },
    daysCount: 21,
    sortOrder: 3,
    skipAllowanceCompensatedDays: 3,
    freezePolicy: { enabled: true, maxDays: 14, maxTimes: 2 },
    gramsOptions: [
      {
        grams: 500,
        sortOrder: 1,
        mealsOptions: [
          { mealsPerDay: 2, priceHalala: 55900, compareAtHalala: 61900, sortOrder: 1 },
          { mealsPerDay: 3, priceHalala: 66900, compareAtHalala: 73900, sortOrder: 2 },
        ],
      },
      {
        grams: 750,
        sortOrder: 2,
        mealsOptions: [
          { mealsPerDay: 2, priceHalala: 61900, compareAtHalala: 68900, sortOrder: 1 },
          { mealsPerDay: 3, priceHalala: 72900, compareAtHalala: 79900, sortOrder: 2 },
        ],
      },
    ],
    isActive: true,
  },
  {
    name: { ar: "خطة 28 يوم", en: "28 Days Plan" },
    description: {
      ar: "الخطة الأشمل لتجربة شهر كامل مع أفضل قيمة وتغطية كاملة لاحتياجات الاشتراك.",
      en: "The most complete monthly plan with the strongest value for full subscription coverage.",
    },
    daysCount: 28,
    sortOrder: 4,
    skipAllowanceCompensatedDays: 4,
    freezePolicy: { enabled: true, maxDays: 21, maxTimes: 2 },
    gramsOptions: [
      {
        grams: 500,
        sortOrder: 1,
        mealsOptions: [
          { mealsPerDay: 2, priceHalala: 71900, compareAtHalala: 79900, sortOrder: 1 },
          { mealsPerDay: 3, priceHalala: 85900, compareAtHalala: 94900, sortOrder: 2 },
        ],
      },
      {
        grams: 750,
        sortOrder: 2,
        mealsOptions: [
          { mealsPerDay: 2, priceHalala: 78900, compareAtHalala: 86900, sortOrder: 1 },
          { mealsPerDay: 3, priceHalala: 92900, compareAtHalala: 101900, sortOrder: 2 },
        ],
      },
    ],
    isActive: true,
  },
];

const regularMeals = [
  {
    name: { ar: "دجاج مشوي بالليمون", en: "Lemon Grilled Chicken" },
    description: {
      ar: "صدر دجاج متبل بالليمون والأعشاب مع خضار مشوية.",
      en: "Herb-marinated chicken breast with lemon and grilled vegetables.",
    },
    imageUrl: "https://picsum.photos/seed/basicdiet-regular-lemon-chicken/1200/900",
    calories: 420,
    category: "lunch",
    type: "regular",
    sortOrder: 1,
    isActive: true,
  },
  {
    name: { ar: "دجاج ترياكي مع الأرز", en: "Teriyaki Chicken Rice Bowl" },
    description: {
      ar: "دجاج ترياكي خفيف مع أرز ياسمين وخضار مطهوة.",
      en: "Light teriyaki chicken with jasmine rice and steamed vegetables.",
    },
    imageUrl: "https://picsum.photos/seed/basicdiet-regular-teriyaki-chicken/1200/900",
    calories: 460,
    category: "lunch",
    type: "regular",
    sortOrder: 2,
    isActive: true,
  },
  {
    name: { ar: "كفتة لحم مع بطاطس", en: "Beef Kofta with Potatoes" },
    description: {
      ar: "كفتة لحم متبلة تقدم مع بطاطس مشوية وصلصة طماطم خفيفة.",
      en: "Seasoned beef kofta with roasted potatoes and a light tomato sauce.",
    },
    imageUrl: "https://picsum.photos/seed/basicdiet-regular-kofta/1200/900",
    calories: 510,
    category: "dinner",
    type: "regular",
    sortOrder: 3,
    isActive: true,
  },
  {
    name: { ar: "ستير فراي لحم بقري", en: "Beef Stir Fry" },
    description: {
      ar: "شرائح لحم بقري سريعة التحضير مع خضار آسيوية مقرمشة.",
      en: "Quick-seared beef strips with crisp Asian vegetables.",
    },
    imageUrl: "https://picsum.photos/seed/basicdiet-regular-beef-stir-fry/1200/900",
    calories: 470,
    category: "protein_heavy",
    type: "regular",
    sortOrder: 4,
    isActive: true,
  },
  {
    name: { ar: "مكرونة دجاج ألفريدو لايت", en: "Light Chicken Alfredo Pasta" },
    description: {
      ar: "مكرونة بصوص كريمي خفيف مع دجاج مشوي وفطر.",
      en: "Pasta in a light creamy sauce with grilled chicken and mushrooms.",
    },
    imageUrl: "https://picsum.photos/seed/basicdiet-regular-alfredo/1200/900",
    calories: 530,
    category: "dinner",
    type: "regular",
    sortOrder: 5,
    isActive: true,
  },
  {
    name: { ar: "فاهيتا دجاج", en: "Chicken Fajita Plate" },
    description: {
      ar: "شرائح دجاج متبلة مع فلفل ألوان وأرز بني.",
      en: "Seasoned chicken strips with bell peppers and brown rice.",
    },
    imageUrl: "https://picsum.photos/seed/basicdiet-regular-fajita/1200/900",
    calories: 445,
    category: "lunch",
    type: "regular",
    sortOrder: 6,
    isActive: true,
  },
  {
    name: { ar: "برجر دجاج صحي", en: "Healthy Chicken Burger" },
    description: {
      ar: "برجر دجاج طازج مع خبز حبوب كاملة وصلصة زبادي.",
      en: "Fresh chicken burger with whole-grain bun and yogurt sauce.",
    },
    imageUrl: "https://picsum.photos/seed/basicdiet-regular-chicken-burger/1200/900",
    calories: 430,
    category: "dinner",
    type: "regular",
    sortOrder: 7,
    isActive: true,
  },
  {
    name: { ar: "دجاج بالكاري وجوز الهند", en: "Coconut Curry Chicken" },
    description: {
      ar: "دجاج بصوص كاري خفيف مع أرز أبيض معطر.",
      en: "Chicken in a light coconut curry served with fragrant white rice.",
    },
    imageUrl: "https://picsum.photos/seed/basicdiet-regular-curry-chicken/1200/900",
    calories: 480,
    category: "lunch",
    type: "regular",
    sortOrder: 8,
    isActive: true,
  },
  {
    name: { ar: "سلطة سيزر بالدجاج", en: "Chicken Caesar Salad" },
    description: {
      ar: "خس روماني ودجاج مشوي وصلصة سيزر خفيفة وجبن بارميزان.",
      en: "Romaine lettuce with grilled chicken, light Caesar dressing, and parmesan.",
    },
    imageUrl: "https://picsum.photos/seed/basicdiet-regular-caesar/1200/900",
    calories: 360,
    category: "salad",
    type: "regular",
    sortOrder: 9,
    isActive: true,
  },
  {
    name: { ar: "سلطة كينوا متوسطية", en: "Mediterranean Quinoa Salad" },
    description: {
      ar: "كينوا ملونة مع خضار متوسطية وجبن فيتا خفيف.",
      en: "Colorful quinoa with Mediterranean vegetables and light feta cheese.",
    },
    imageUrl: "https://picsum.photos/seed/basicdiet-regular-quinoa-salad/1200/900",
    calories: 340,
    category: "salad",
    type: "regular",
    sortOrder: 10,
    isActive: true,
  },
  {
    name: { ar: "سلطة تونة بروتينية", en: "High-Protein Tuna Salad" },
    description: {
      ar: "تونة خفيفة مع فاصوليا وخضار ورقية وصلصة ليمون.",
      en: "Light tuna with beans, leafy greens, and lemon dressing.",
    },
    imageUrl: "https://picsum.photos/seed/basicdiet-regular-tuna-salad/1200/900",
    calories: 330,
    category: "protein_heavy",
    type: "regular",
    sortOrder: 11,
    isActive: true,
  },
  {
    name: { ar: "أرز بالدجاج والبروكلي", en: "Chicken and Broccoli Rice" },
    description: {
      ar: "وجبة متوازنة من الدجاج والأرز الأبيض والبروكلي.",
      en: "A balanced meal of chicken, white rice, and broccoli florets.",
    },
    imageUrl: "https://picsum.photos/seed/basicdiet-regular-broccoli-rice/1200/900",
    calories: 440,
    category: "lunch",
    type: "regular",
    sortOrder: 12,
    isActive: true,
  },
  {
    name: { ar: "كرات لحم بصوص الطماطم", en: "Meatballs in Tomato Sauce" },
    description: {
      ar: "كرات لحم طرية مطهوة بصوص طماطم معكرونة قمح كامل.",
      en: "Tender meatballs in tomato sauce with whole-wheat pasta.",
    },
    imageUrl: "https://picsum.photos/seed/basicdiet-regular-meatballs/1200/900",
    calories: 520,
    category: "dinner",
    type: "regular",
    sortOrder: 13,
    isActive: true,
  },
  {
    name: { ar: "شاورما دجاج صحية", en: "Healthy Chicken Shawarma" },
    description: {
      ar: "شاورما دجاج قليلة الدهون مع أرز أو خضار مشوية.",
      en: "Lean chicken shawarma served with rice or roasted vegetables.",
    },
    imageUrl: "https://picsum.photos/seed/basicdiet-regular-shawarma/1200/900",
    calories: 455,
    category: "protein_heavy",
    type: "regular",
    sortOrder: 14,
    isActive: true,
  },
  {
    name: { ar: "دجاج محشي بالسبانخ", en: "Spinach Stuffed Chicken" },
    description: {
      ar: "صدر دجاج محشي بالسبانخ والجبن الخفيف مع خضار جانبية.",
      en: "Chicken breast stuffed with spinach and light cheese, served with vegetables.",
    },
    imageUrl: "https://picsum.photos/seed/basicdiet-regular-spinach-chicken/1200/900",
    calories: 415,
    category: "protein_heavy",
    type: "regular",
    sortOrder: 15,
    isActive: true,
  },
  {
    name: { ar: "رز بالخضار والدجاج", en: "Vegetable Rice with Chicken" },
    description: {
      ar: "أرز بسمتي مع خضار مشكلة وقطع دجاج مشوية.",
      en: "Basmati rice with mixed vegetables and grilled chicken cubes.",
    },
    imageUrl: "https://picsum.photos/seed/basicdiet-regular-vegetable-rice/1200/900",
    calories: 435,
    category: "lunch",
    type: "regular",
    sortOrder: 16,
    isActive: true,
  },
  {
    name: { ar: "سلطة سلمية بالخس والحمص", en: "Chickpea Green Salad" },
    description: {
      ar: "سلطة خضراء غنية بالألياف مع حمص وخيار وطماطم.",
      en: "A fiber-rich green salad with chickpeas, cucumber, and tomatoes.",
    },
    imageUrl: "https://picsum.photos/seed/basicdiet-regular-chickpea-salad/1200/900",
    calories: 290,
    category: "salad",
    type: "regular",
    sortOrder: 17,
    isActive: true,
  },
  {
    name: { ar: "ديك رومي مشوي", en: "Roasted Turkey Breast" },
    description: {
      ar: "شرائح ديك رومي مشوي مع بطاطا حلوة مهروسة.",
      en: "Roasted turkey breast slices with mashed sweet potato.",
    },
    imageUrl: "https://picsum.photos/seed/basicdiet-regular-turkey/1200/900",
    calories: 410,
    category: "protein_heavy",
    type: "regular",
    sortOrder: 18,
    isActive: true,
  },
  {
    name: { ar: "سلطة أفوكادو ودجاج", en: "Avocado Chicken Salad" },
    description: {
      ar: "خس ورقي مع دجاج مشوي وشرائح أفوكادو وصلصة حمضيات.",
      en: "Leafy greens with grilled chicken, avocado slices, and citrus dressing.",
    },
    imageUrl: "https://picsum.photos/seed/basicdiet-regular-avocado-salad/1200/900",
    calories: 375,
    category: "salad",
    type: "regular",
    sortOrder: 19,
    isActive: true,
  },
  {
    name: { ar: "دجاج بالأعشاب والكينوا", en: "Herb Chicken with Quinoa" },
    description: {
      ar: "دجاج بالأعشاب الإيطالية يقدم مع كينوا وخضار مشوية.",
      en: "Italian herb chicken served with quinoa and roasted vegetables.",
    },
    imageUrl: "https://picsum.photos/seed/basicdiet-regular-herb-quinoa/1200/900",
    calories: 425,
    category: "lunch",
    type: "regular",
    sortOrder: 20,
    isActive: true,
  },
];

const dashboardUsers = [
  { email: "superadmin@basicdiet.sa", role: "superadmin", isActive: true, password: DASHBOARD_PASSWORD },
  { email: "admin@basicdiet.sa", role: "admin", isActive: true, password: DASHBOARD_PASSWORD },
  { email: "kitchen@basicdiet.sa", role: "kitchen", isActive: true, password: DASHBOARD_PASSWORD },
  { email: "courier@basicdiet.sa", role: "courier", isActive: true, password: DASHBOARD_PASSWORD },
];

const demoUsers = [
  {
    key: "new_user",
    fullName: "Nora Hassan",
    phone: "+966500000101",
    email: "new.user@demo.basicdiet.sa",
    useCase: "New app user without subscriptions for fresh purchase flow",
  },
  {
    key: "active_delivery",
    fullName: "Omar Alharbi",
    phone: "+966500000102",
    email: "delivery.active@demo.basicdiet.sa",
    useCase: "Active delivery subscription with completed checkout and saved planning",
  },
  {
    key: "active_pickup",
    fullName: "Lama Alqahtani",
    phone: "+966500000103",
    email: "pickup.active@demo.basicdiet.sa",
    useCase: "Active pickup subscription using the single branch flow",
  },
  {
    key: "expired_renewable",
    fullName: "Khaled Almutairi",
    phone: "+966500000104",
    email: "renewal.expired@demo.basicdiet.sa",
    useCase: "Expired subscription with preserved delivery preferences and renewal draft",
  },
  {
    key: "frozen_subscription",
    fullName: "Abeer Alzahrani",
    phone: "+966500000105",
    email: "freeze.active@demo.basicdiet.sa",
    useCase: "Active subscription with frozen day and extended validity window",
  },
  {
    key: "skipped_days",
    fullName: "Sultan Alotaibi",
    phone: "+966500000106",
    email: "skip.active@demo.basicdiet.sa",
    useCase: "Active subscription with skipped and unskipped planning history",
  },
  {
    key: "wallet_balance",
    fullName: "Reem Alanzi",
    phone: "+966500000107",
    email: "wallet.active@demo.basicdiet.sa",
    useCase: "Active subscription with wallet balances, topups, and consumption history",
  },
  {
    key: "premium_overage",
    fullName: "Mazen Aldosari",
    phone: "+966500000108",
    email: "premium.overage@demo.basicdiet.sa",
    useCase: "Active canonical subscription with pending premium overage",
  },
  {
    key: "addon_pending",
    fullName: "Dana Alshammari",
    phone: "+966500000109",
    email: "addon.pending@demo.basicdiet.sa",
    useCase: "Active canonical subscription with one-time addon pending payment",
  },
  {
    key: "canceled_subscription",
    fullName: "Hind Alyami",
    phone: "+966500000110",
    email: "canceled.user@demo.basicdiet.sa",
    useCase: "Canceled subscription visible in app and admin subscription reads",
  },
];

module.exports = {
  DASHBOARD_PASSWORD,
  settings,
  deliveryZones,
  pickupLocations,
  plans,
  regularMeals,
  dashboardUsers,
  demoUsers,
};
