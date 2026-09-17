const DASHBOARD_PASSWORD = "StrongPass123";
const { buildDefaultPickupLocation } = require("../../../src/constants/defaultPickupLocation");

const settings = {
  delivery_windows: ["09:00-12:00", "13:00-16:00", "18:00-21:00"],
  pickup_windows: ["18:00-20:00"],
  subscription_delivery_fee_halala: 0,
  premium_price: 24,
  vat_percentage: 15,
  one_time_meal_price: 29,
  one_time_premium_price: 42,
  custom_salad_base_price: 18,
  custom_meal_base_price: 25,
  restaurant_name: "BasicDiet145",
  restaurant_phone: "+966500000000",
  restaurant_address: "King Fahd Road, Riyadh, KSA",
  restaurant_latitude: 24.7136,
  restaurant_longitude: 46.6753,
  restaurant_open_time: "08:00",
  restaurant_close_time: "22:00",
  restaurant_is_open: true,
  restaurant_hours: [
    { dayOfWeek: 0, openTime: "08:00", closeTime: "22:00", isClosed: false },
    { dayOfWeek: 1, openTime: "08:00", closeTime: "22:00", isClosed: false },
    { dayOfWeek: 2, openTime: "08:00", closeTime: "22:00", isClosed: false },
    { dayOfWeek: 3, openTime: "08:00", closeTime: "22:00", isClosed: false },
    { dayOfWeek: 4, openTime: "08:00", closeTime: "22:00", isClosed: false },
    { dayOfWeek: 5, openTime: "12:00", closeTime: "22:00", isClosed: false },
    { dayOfWeek: 6, openTime: "08:00", closeTime: "22:00", isClosed: false },
  ],
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
  buildDefaultPickupLocation(),
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

const mealCategories = [
  {
    key: "salads",
    name: { ar: "سلطات", en: "Salads" },
    description: {
      ar: "خيارات خفيفة ومنعشة مناسبة للغداء أو الوجبات السريعة.",
      en: "Fresh lighter options that work well for lunch or a quick meal.",
    },
    isActive: true,
    sortOrder: 1,
  },
  {
    key: "bowls",
    name: { ar: "بولز", en: "Bowls" },
    description: {
      ar: "وجبات متوازنة في طبق واحد مع بروتين وكربوهيدرات وخضار.",
      en: "Balanced one-bowl meals with protein, grains, and vegetables.",
    },
    isActive: true,
    sortOrder: 2,
  },
  {
    key: "sandwiches",
    name: { ar: "سندويتشات ولفائف", en: "Sandwiches & Wraps" },
    description: {
      ar: "خيارات عملية وسريعة مناسبة لأيام العمل والتنقل.",
      en: "Portable options designed for workdays and grab-and-go planning.",
    },
    isActive: true,
    sortOrder: 3,
  },
  {
    key: "mains",
    name: { ar: "أطباق رئيسية", en: "Hot Plates" },
    description: {
      ar: "أطباق رئيسية أكثر شبعًا لوجبات المساء أو الأيام الطويلة.",
      en: "Hearty plated meals for dinner slots and higher-appetite days.",
    },
    isActive: true,
    sortOrder: 4,
  },
];

const regularMeals = [
  {
    name: { ar: "سلطة دجاج مشوي", en: "Grilled Chicken Salad" },
    description: {
      ar: "خس مقرمش مع دجاج مشوي وطماطم كرزية وخيار وصوص أعشاب خفيف.",
      en: "Crisp greens with grilled chicken, cherry tomatoes, cucumber, and a light herb dressing.",
    },
    imageUrl: "https://picsum.photos/seed/mealplanner-grilled-chicken-salad/1200/900",
    calories: 390,
    proteinGrams: 34,
    carbGrams: 18,
    fatGrams: 14,
    category: "salads",
    type: "regular",
    sortOrder: 1,
    isActive: true,
  },
  {
    name: { ar: "سلطة كينوا متوسطية", en: "Mediterranean Quinoa Salad" },
    description: {
      ar: "كينوا مع حمص وخيار وطماطم وزيتون وصوص ليمون خفيف.",
      en: "Quinoa with chickpeas, cucumber, tomatoes, olives, and a light lemon dressing.",
    },
    imageUrl: "https://picsum.photos/seed/mealplanner-mediterranean-quinoa/1200/900",
    calories: 430,
    proteinGrams: 16,
    carbGrams: 52,
    fatGrams: 15,
    category: "salads",
    type: "regular",
    sortOrder: 2,
    isActive: true,
  },
  {
    name: { ar: "بول دجاج ترياكي", en: "Teriyaki Chicken Bowl" },
    description: {
      ar: "دجاج ترياكي مع أرز بني وبروكلي وجزر وسمسم.",
      en: "Teriyaki chicken with brown rice, broccoli, carrots, and sesame.",
    },
    imageUrl: "https://picsum.photos/seed/mealplanner-teriyaki-chicken/1200/900",
    calories: 590,
    proteinGrams: 42,
    carbGrams: 68,
    fatGrams: 15,
    category: "bowls",
    type: "regular",
    sortOrder: 3,
    isActive: true,
  },
  {
    name: { ar: "لفافة ديك رومي وأفوكادو", en: "Turkey Avocado Wrap" },
    description: {
      ar: "ديك رومي مدخن مع أفوكادو وخس وطماطم في خبز حبوب كاملة.",
      en: "Smoked turkey with avocado, lettuce, tomato, and a whole-grain wrap.",
    },
    imageUrl: "https://picsum.photos/seed/mealplanner-turkey-avocado/1200/900",
    calories: 470,
    proteinGrams: 32,
    carbGrams: 42,
    fatGrams: 19,
    category: "sandwiches",
    type: "regular",
    sortOrder: 4,
    isActive: true,
  },
  {
    name: { ar: "سلمون مشوي مع خضار", en: "Grilled Salmon with Vegetables" },
    description: {
      ar: "سلمون مشوي مع خضار موسمية وصوص أعشاب خفيف.",
      en: "Grilled salmon with seasonal vegetables and a light herb sauce.",
    },
    imageUrl: "https://picsum.photos/seed/mealplanner-grilled-salmon/1200/900",
    calories: 560,
    proteinGrams: 41,
    carbGrams: 24,
    fatGrams: 30,
    category: "mains",
    type: "regular",
    sortOrder: 5,
    isActive: true,
  },
  {
    name: { ar: "دجاج مشوي وبطاطا حلوة", en: "Grilled Chicken & Sweet Potato" },
    description: {
      ar: "صدر دجاج مشوي مع بطاطا حلوة مهروسة وفاصوليا خضراء.",
      en: "Grilled chicken breast with mashed sweet potato and green beans.",
    },
    imageUrl: "https://picsum.photos/seed/mealplanner-grilled-chicken-sweet-potato/1200/900",
    calories: 520,
    proteinGrams: 46,
    carbGrams: 48,
    fatGrams: 14,
    category: "mains",
    type: "regular",
    sortOrder: 6,
    isActive: true,
  },
];

const premiumMeals = [
  {
    name: { ar: "سلمون بصوص الليمون", en: "Lemon Herb Salmon" },
    description: {
      ar: "فيليه سلمون مع صوص ليمون وأعشاب وخضار مشوية.",
      en: "Salmon fillet with lemon-herb sauce and roasted vegetables.",
    },
    imageUrl: "https://picsum.photos/seed/mealplanner-lemon-herb-salmon/1200/900",
    calories: 620,
    proteinGrams: 45,
    carbGrams: 28,
    fatGrams: 34,
    category: "mains",
    type: "premium",
    sortOrder: 1,
    isActive: true,
  },
  {
    name: { ar: "ستيك لحم مع خضار", en: "Beef Steak with Vegetables" },
    description: {
      ar: "ستيك لحم مع خضار سوتيه وصوص فلفل خفيف.",
      en: "Beef steak with sautéed vegetables and a light pepper sauce.",
    },
    imageUrl: "https://picsum.photos/seed/mealplanner-beef-steak/1200/900",
    calories: 680,
    proteinGrams: 52,
    carbGrams: 24,
    fatGrams: 40,
    category: "mains",
    type: "premium",
    sortOrder: 2,
    isActive: true,
  },
];

module.exports = {
  DASHBOARD_PASSWORD,
  settings,
  deliveryZones,
  pickupLocations,
  plans,
  mealCategories,
  regularMeals,
  premiumMeals,
};
